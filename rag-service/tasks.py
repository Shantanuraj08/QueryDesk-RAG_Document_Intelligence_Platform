import gc
import os
from pathlib import Path
from uuid import uuid4
from celery import Celery
from dotenv import load_dotenv

# Ensure environment variables are loaded regardless of current working directory
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

from qdrant_client import models
from services.document_parser import load_document
from services.embedding_service import embed_texts
from services.qdrant_service import QDRANT_COLLECTION, client
from services.text_splitter import split_documents

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "querydesk_tasks",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=3600,
    broker_pool_limit=2,
    broker_connection_retry_on_startup=True,
    redis_socket_timeout=5.0,
    redis_socket_connect_timeout=5.0,
)

BATCH_SIZE = 100


@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=15,
)
def ingest_document_task(
    self,
    file_path: str,
    filename: str,
    chat_id: str,
    document_id: str,
) -> dict:
    self.update_state(
        state="PROCESSING",
        meta={"step": "parsing", "filename": filename, "document_id": document_id},
    )

    path_obj = Path(file_path)

    try:
        if not path_obj.exists():
            raise FileNotFoundError(f"Staged file not found at path: {file_path}")

        documents = load_document(file_path)
        for doc in documents:
            doc.metadata["source"] = filename

        self.update_state(
            state="PROCESSING",
            meta={
                "step": "chunking",
                "filename": filename,
                "document_id": document_id,
                "documents_loaded": len(documents),
            },
        )

        chunks = split_documents(documents)
        if not chunks:
            raise ValueError("No extractable text chunks could be generated from document.")

        total_chunks = len(chunks)
        total_points_stored = 0

        self.update_state(
            state="PROCESSING",
            meta={
                "step": "embedding_and_indexing",
                "filename": filename,
                "document_id": document_id,
                "total_chunks": total_chunks,
                "processed_chunks": 0,
            },
        )

        # Slicing batch loop: groups of 100 points maximum
        for i in range(0, total_chunks, BATCH_SIZE):
            chunk_slice = chunks[i : i + BATCH_SIZE]
            texts = [chunk.page_content for chunk in chunk_slice]

            vectors = embed_texts(texts)

            points = []
            for chunk, vector in zip(chunk_slice, vectors):
                points.append(
                    models.PointStruct(
                        id=str(uuid4()),
                        vector=vector,
                        payload={
                            "chat_id": chat_id,
                            "document_id": document_id,
                            "source": filename,
                            "text": chunk.page_content,
                            "metadata": chunk.metadata,
                        },
                    )
                )

            if points:
                client.upsert(
                    collection_name=QDRANT_COLLECTION,
                    points=points,
                    wait=True,
                )
                total_points_stored += len(points)

            self.update_state(
                state="PROCESSING",
                meta={
                    "step": "embedding_and_indexing",
                    "filename": filename,
                    "document_id": document_id,
                    "total_chunks": total_chunks,
                    "processed_chunks": min(i + BATCH_SIZE, total_chunks),
                },
            )

        return {
            "status": "SUCCESS",
            "filename": filename,
            "document_id": document_id,
            "chat_id": chat_id,
            "chunks_created": total_chunks,
            "points_stored": total_points_stored,
        }

    except (FileNotFoundError, ValueError):
        raise

    except Exception as exc:
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc)
        raise exc

    finally:
        if path_obj.exists():
            path_obj.unlink(missing_ok=True)
        gc.collect()
