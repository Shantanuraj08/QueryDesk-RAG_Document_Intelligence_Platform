import tempfile
from pathlib import Path
from celery.result import AsyncResult
from dotenv import load_dotenv

# Ensure environment variables are loaded regardless of current working directory
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, status
from qdrant_client.models import FieldCondition, Filter, MatchValue

from chat import router as chat_router
from services.qdrant_service import QDRANT_COLLECTION, client
from tasks import celery_app, ingest_document_task

app = FastAPI(
    title="QueryDesk Document Intelligence RAG API",
    version="0.2.0",
)

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
CHUNK_SIZE = 1024 * 1024  # 1 MB streaming buffer

app.include_router(chat_router)


@app.get("/")
def health_check():
    return {
        "status": "running",
        "service": "QueryDesk Document Intelligence RAG API",
    }


@app.post("/upload", status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    chat_id: str = Form(...),
    file: UploadFile = File(...),
    document_id: str = Form(...),
):
    filename = Path(file.filename or "").name
    extension = Path(filename).suffix.lower()

    if not filename or extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF, DOCX, and TXT files are supported.",
        )

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as temp_file:
            temp_path = Path(temp_file.name)
            total_size = 0
            while chunk := await file.read(CHUNK_SIZE):
                total_size += len(chunk)
                if total_size > MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="File exceeds the 10 MB limit.",
                    )
                temp_file.write(chunk)

        if total_size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The uploaded file is empty.",
            )

        # Dispatch background ingestion task to Celery
        task = ingest_document_task.delay(
            str(temp_path),
            filename,
            chat_id,
            document_id,
        )

        return {
            "status": "ACCEPTED",
            "task_id": str(task.id),
            "filename": filename,
            "document_id": document_id,
        }

    except HTTPException:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)
        raise

    except Exception as exc:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not queue file for ingestion: {str(exc)}",
        )

    finally:
        await file.close()


@app.get("/tasks/{task_id}")
def get_task_status(task_id: str):
    try:
        result = AsyncResult(task_id, app=celery_app)
        state = result.state

        if state in ("PENDING", "STARTED"):
            return {"task_id": task_id, "status": "PENDING"}
        elif state == "PROCESSING":
            return {
                "task_id": task_id,
                "status": "PROCESSING",
                "meta": result.info if isinstance(result.info, dict) else {},
            }
        elif state == "SUCCESS":
            return {
                "task_id": task_id,
                "status": "SUCCESS",
                "result": result.result if isinstance(result.result, dict) else {},
            }
        elif state in ("FAILURE", "REVOKED"):
            return {
                "task_id": task_id,
                "status": "FAILURE",
                "error": str(result.info) if result.info else "Task execution failed.",
            }
        else:
            return {"task_id": task_id, "status": state}
    except Exception as exc:
        return {
            "task_id": task_id,
            "status": "PENDING",
            "meta": {"message": f"Waiting for result backend: {str(exc)}"},
        }


@app.delete("/documents")
def delete_document_vectors(
    chat_id: str = Query(..., min_length=1),
    document_id: str | None = Query(default=None, min_length=1),
):
    try:
        conditions = [
            FieldCondition(
                key="chat_id",
                match=MatchValue(value=chat_id),
            )
        ]

        if document_id is not None:
            conditions.append(
                FieldCondition(
                    key="document_id",
                    match=MatchValue(value=document_id),
                )
            )

        client.delete(
            collection_name=QDRANT_COLLECTION,
            points_selector=Filter(must=conditions),
            wait=True,
        )

        return {
            "message": "Vectors deleted successfully",
            "chat_id": chat_id,
            "document_id": document_id,
        }

    except Exception as e:
        print(f"Failed to delete vectors: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to delete vectors",
        )
