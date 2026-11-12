
import os
from uuid import uuid4

from dotenv import load_dotenv
from qdrant_client import QdrantClient, models

load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
QDRANT_COLLECTION = os.getenv(
    "QDRANT_COLLECTION",
    "support_documents",
)

if not QDRANT_URL or not QDRANT_API_KEY:
    raise ValueError("Qdrant configuration is missing from .env")

client = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY,
    check_compatibility=False,
)



def store_chunks(
    chunks,
    vectors,
    filename: str,
    chat_id: str,
    document_id: str,
):
    if len(chunks) != len(vectors):
        raise ValueError("Chunk and vector counts do not match")

    points = []

    for chunk, vector in zip(chunks, vectors):
        payload = {
            "chat_id": chat_id,
            "document_id": document_id,
            "source": filename,
            "text": chunk.page_content,
            "metadata": chunk.metadata,
        }

        points.append(
            models.PointStruct(
                id=str(uuid4()),
                vector=vector,
                payload=payload,
            )
        )

    if points:
        client.upsert(
            collection_name=QDRANT_COLLECTION,
            points=points,
            wait=True,
        )

    return len(points)

def create_payload_indexes():
    for field_name in ["chat_id", "document_id"]:
        client.create_payload_index(
            collection_name=QDRANT_COLLECTION,
            field_name=field_name,
            field_schema=models.PayloadSchemaType.KEYWORD,
            wait=True,
        )

    print("Payload indexes created successfully.")