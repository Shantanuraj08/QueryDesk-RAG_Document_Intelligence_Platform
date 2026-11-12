import hashlib
import json
import os
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

# Ensure environment variables are loaded regardless of current working directory
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
import redis.asyncio as redis

from services.generation_service import generate_answer
from services.retrieval_service import retrieve_chunks

router = APIRouter(prefix="/chat", tags=["Chat"])

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
redis_client = redis.from_url(
    REDIS_URL,
    decode_responses=True,
    socket_timeout=3.0,
    socket_connect_timeout=3.0,
    max_connections=4,
)

CACHE_TTL_SECONDS = 3600  # 1 Hour


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    chat_id: str = Field(min_length=1)
    document_id: Optional[str] = None
    top_k: int = Field(default=3, ge=1, le=10)


def generate_cache_key(document_id: Optional[str], query: str) -> str:
    target_doc = (document_id or "global").strip()
    clean_query = " ".join(query.lower().split())
    raw_payload = f"{target_doc}:{clean_query}".encode("utf-8")
    fingerprint = hashlib.sha256(raw_payload).hexdigest()
    return f"querydesk:cache:{fingerprint}"


@router.post("")
async def chat_endpoint(request: ChatRequest):
    question = request.question.strip()
    chat_id = request.chat_id.strip()

    if not question:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Question cannot be empty.",
        )

    # Normalized lowercase whitespace-stripped string for deterministic fingerprinting
    clean_query = " ".join(question.lower().split())
    cache_key = generate_cache_key(request.document_id, clean_query)

    try:
        cached_result = await redis_client.get(cache_key)
        if cached_result:
            payload = json.loads(cached_result)
            payload["cached"] = True
            return payload
    except Exception:
        # Cache degradation must not interrupt query pipeline
        pass

    try:
        chunks = retrieve_chunks(
            question=question,
            chat_id=chat_id,
            document_id=request.document_id,
            limit=request.top_k,
        )

        if not chunks:
            fallback_response = {
                "question": question,
                "answer": "I couldn't find relevant information in the available documents.",
                "sources": [],
                "cached": False,
            }
            return fallback_response

        answer = generate_answer(
            question=question,
            retrieved_chunks=chunks,
        )

        sources = []
        for index, chunk in enumerate(chunks, start=1):
            sources.append(
                {
                    "citation": f"Source {index}",
                    "filename": chunk.get("source", "Unknown document"),
                    "document_id": chunk.get("document_id"),
                    "score": chunk.get("score"),
                    "metadata": chunk.get("metadata", {}),
                }
            )

        response_payload = {
            "question": question,
            "answer": answer,
            "sources": sources,
            "cached": False,
        }

        try:
            await redis_client.set(
                name=cache_key,
                value=json.dumps(response_payload),
                ex=CACHE_TTL_SECONDS,
            )
        except Exception:
            pass

        return response_payload

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference execution failed: {str(exc)}",
        )
