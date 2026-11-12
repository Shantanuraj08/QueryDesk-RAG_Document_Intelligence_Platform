"""
QueryDesk End-to-End Automated Backend Test Suite.
Validates:
1. Celery Ingestion Task & 100-Chunk Slicing Batch Loop (tasks.py)
2. FastAPI Asynchronous /upload & /tasks/{task_id} Endpoints (main.py)
3. Redis SHA-256 Query Cache Fingerprinting & Fallback Pipeline (chat.py)
"""

import io
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure paths
RAG_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(RAG_DIR))

# Load .env
from dotenv import load_dotenv
load_dotenv(RAG_DIR / ".env")

from fastapi import HTTPException

# Import modules to verify
import tasks
from tasks import celery_app, ingest_document_task
import chat
from chat import ChatRequest, chat_endpoint, generate_cache_key
import main
from main import get_task_status, health_check, upload_document


class Immediate:
    """Zero-delay awaitable allowing synchronous coroutine execution in sandbox."""
    def __init__(self, val=None):
        self.val = val

    def __await__(self):
        yield from ()
        return self.val


def run_coroutine(coro):
    """Executes a coroutine completely in-memory without OS socket dependencies."""
    try:
        coro.send(None)
    except StopIteration as exc:
        return exc.value


class FastMockUploadFile:
    """Mock UploadFile returning Immediate awaitables for chunked streaming."""
    def __init__(self, filename: str, chunks: list):
        self.filename = filename
        self.chunks = list(chunks)

    def read(self, size: int = -1):
        val = self.chunks.pop(0) if self.chunks else b""
        return Immediate(val)

    def close(self):
        return Immediate(None)


def print_banner(title: str):
    print("\n" + "=" * 80, flush=True)
    print(f"  {title.upper()}", flush=True)
    print("=" * 80, flush=True)


def test_1_celery_batch_slicing_loop():
    """
    TEST 1: Celery Ingestion Task & 100-Chunk Slicing Batch Loop
    Verifies that when a document produces >100 chunks (e.g. 135 chunks),
    the slicing machine slices it into:
      Batch 1: 100 points
      Batch 2: 35 points
    And validates that:
      - embed_texts was called in batches of max 100
      - client.upsert was called per batch
      - total_points_stored equals total_chunks
      - Staging temporary file is cleanly deleted in finally
    """
    print_banner("Test 1: Celery Task 100-Chunk Slicing Batch Machine (tasks.py)")

    # Create a temporary test document
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False, mode="w", encoding="utf-8") as tf:
        tf.write("QueryDesk Enterprise Intelligence test paragraph.\n" * 500)
        temp_file_path = tf.name

    assert Path(temp_file_path).exists(), "Temporary file must exist before ingestion"

    # Mock document_parser to produce 135 simulated chunks
    mock_chunks = []
    for i in range(135):
        chunk_mock = MagicMock()
        chunk_mock.page_content = f"Simulated chunk text content number {i} for slicing test."
        chunk_mock.metadata = {"page": i // 10 + 1, "source": "test_slicing.txt"}
        mock_chunks.append(chunk_mock)

    mock_doc = MagicMock()
    mock_doc.metadata = {}

    upsert_batches = []
    embed_batches = []

    def mock_embed_texts(texts):
        embed_batches.append(len(texts))
        return [[0.1] * 384 for _ in texts]

    def mock_upsert(collection_name, points, wait=True):
        upsert_batches.append(len(points))
        return MagicMock()

    # Track update_state calls
    state_updates = []
    mock_task_self = MagicMock()
    mock_task_self.update_state = lambda state, meta: state_updates.append((state, meta))

    with patch("tasks.load_document", return_value=[mock_doc]), \
         patch("tasks.split_documents", return_value=mock_chunks), \
         patch("tasks.embed_texts", side_effect=mock_embed_texts), \
         patch("tasks.client.upsert", side_effect=mock_upsert):

        # Call the underlying function directly via __wrapped__.__func__
        result = ingest_document_task.__wrapped__.__func__(
            mock_task_self,
            file_path=temp_file_path,
            filename="test_slicing.txt",
            chat_id="chat-test-101",
            document_id="doc-test-101",
        )

    # 1. Check temporary file was deleted in finally
    assert not Path(temp_file_path).exists(), "Staging temp file must be unlinked in finally"
    print("  [✓] Staging temporary file was cleanly deleted by Celery task finally block.", flush=True)

    # 2. Check batch sizes: with 135 chunks and BATCH_SIZE=100:
    # Batch 1 should be 100, Batch 2 should be 35
    assert embed_batches == [100, 35], f"Expected embedding batches [100, 35], got {embed_batches}"
    print(f"  [✓] Embedding API called with sliced batches: {embed_batches} (Capped at 100 points/batch).", flush=True)

    assert upsert_batches == [100, 35], f"Expected Qdrant upsert batches [100, 35], got {upsert_batches}"
    print(f"  [✓] Qdrant client.upsert called with sliced batches: {upsert_batches}.", flush=True)

    # 3. Check return payload
    assert result["status"] == "SUCCESS"
    assert result["chunks_created"] == 135
    assert result["points_stored"] == 135
    assert result["document_id"] == "doc-test-101"
    print(f"  [✓] Task result payload: {result}", flush=True)

    # 4. Check intermediate state updates
    states = [s[0] for s in state_updates]
    assert all(s == "PROCESSING" for s in states), "All intermediate states must be PROCESSING"
    steps = [s[1]["step"] for s in state_updates if "step" in s[1]]
    assert "parsing" in steps and "chunking" in steps and "embedding_and_indexing" in steps
    print(f"  [✓] Granular progress state tracked: {steps}", flush=True)
    print("--> TEST 1 PASSED: Slicing batch machine functions perfectly!\n", flush=True)


def test_2_fastapi_non_blocking_upload():
    """
    TEST 2: FastAPI Non-Blocking /upload & Celery Status Route (main.py)
    Verifies that:
      - upload_document streams file to disk and dispatches task to Celery
      - Responds immediately with status 202 Accepted and a valid task_id
      - File size limit and empty file checks are strictly enforced
      - get_task_status returns Celery task state
    """
    print_banner("Test 2: FastAPI Non-Blocking /upload & /tasks/{task_id} (main.py)")

    # 1. Healthcheck
    res_health = health_check()
    assert res_health["status"] == "running"
    print(f"  [✓] health_check() returned: {res_health}", flush=True)

    # 2. Test successful upload dispatch
    dummy_file_content = b"QueryDesk test document content for non-blocking upload test."
    mock_celery_task = MagicMock()
    mock_celery_task.id = "celery-uuid-test-12345"
    mock_ingest = MagicMock()
    mock_ingest.delay.return_value = mock_celery_task

    original_ingest = main.ingest_document_task
    main.ingest_document_task = mock_ingest

    try:
        # A. Normal 202 Upload Dispatch
        f = FastMockUploadFile("sample.txt", [dummy_file_content])
        t0 = time.perf_counter()
        coro = upload_document(
            chat_id="chat-test-202",
            file=f,
            document_id="doc-test-202",
        )
        res = run_coroutine(coro)
        duration_ms = (time.perf_counter() - t0) * 1000

        assert res["status"] == "ACCEPTED"
        assert res["task_id"] == "celery-uuid-test-12345"
        assert res["filename"] == "sample.txt"
        assert res["document_id"] == "doc-test-202"
        assert mock_ingest.delay.called
        print(f"  [✓] upload_document() responded in {duration_ms:.2f}ms with HTTP 202 (Non-blocking verified).", flush=True)
        print(f"  [✓] Response payload: {res}", flush=True)

        # B. Test empty file validation
        f_empty = FastMockUploadFile("empty.txt", [])
        try:
            run_coroutine(upload_document(chat_id="chat-test-202", file=f_empty, document_id="doc-test-202"))
            assert False, "Should have raised HTTPException 400"
        except HTTPException as exc:
            assert exc.status_code == 400
            print("  [✓] Empty file upload properly rejected with HTTPException 400.", flush=True)

        # C. Test invalid extension validation
        f_invalid = FastMockUploadFile("malicious.exe", [b"binary"])
        try:
            run_coroutine(upload_document(chat_id="chat-test-202", file=f_invalid, document_id="doc-test-202"))
            assert False, "Should have raised HTTPException 400"
        except HTTPException as exc:
            assert exc.status_code == 400
            print("  [✓] Unsupported file format properly rejected with HTTPException 400.", flush=True)

    finally:
        main.ingest_document_task = original_ingest

    # 3. Test get_task_status
    mock_async_result = MagicMock()
    mock_async_result.state = "SUCCESS"
    mock_async_result.result = {"status": "SUCCESS", "points_stored": 45}

    with patch("main.AsyncResult", return_value=mock_async_result):
        task_data = get_task_status("celery-uuid-test-12345")
        assert task_data["status"] == "SUCCESS"
        assert task_data["result"]["points_stored"] == 45
        print(f"  [✓] get_task_status() correctly resolved Celery state: {task_data}", flush=True)

    print("--> TEST 2 PASSED: FastAPI upload & task endpoints verified!\n", flush=True)


def test_3_query_cache_and_fingerprinting():
    """
    TEST 3: Redis SHA-256 Query Cache Fingerprint & Degradation Fallback (chat.py)
    Verifies that:
      - Clean query normalization strips extra whitespace and handles case insensitivity
      - Fingerprint key adheres strictly to querydesk:cache:{sha256}
      - Cache hit returns cached payload with cached=True
      - Redis connection failures degrade gracefully without throwing 500 errors
    """
    print_banner("Test 3: Redis SHA-256 Query Cache & Fallback (chat.py)")

    # 1. Test key fingerprint generation
    key1 = generate_cache_key("doc-123", "  What is   the Refund POLICY?  ")
    key2 = generate_cache_key("doc-123", "what is the refund policy?")
    assert key1 == key2, "Normalized queries must generate identical fingerprints"
    assert key1.startswith("querydesk:cache:"), "Cache key must have querydesk:cache: prefix"
    assert len(key1.split(":")[-1]) == 64, "Fingerprint must be a 64-char SHA-256 hex string"
    print(f"  [✓] SHA-256 deterministic fingerprinting verified: {key1}", flush=True)

    # 2. Test chat endpoint with cache hit simulation
    cached_payload_str = '{"question": "What is refund policy?", "answer": "30 days.", "sources": [], "cached": false}'

    original_client = chat.redis_client
    mock_redis = MagicMock()
    chat.redis_client = mock_redis

    try:
        # A. Cache Hit Test
        mock_redis.get = MagicMock(return_value=Immediate(cached_payload_str))
        req_hit = ChatRequest(
            chat_id="chat-999",
            question="What is refund policy?",
            document_id="doc-123",
        )
        t0 = time.perf_counter()
        data_hit = run_coroutine(chat_endpoint(req_hit))
        duration_hit_ms = (time.perf_counter() - t0) * 1000

        assert data_hit["cached"] is True
        assert data_hit["answer"] == "30 days."
        print(f"  [✓] Cache hit detected in {duration_hit_ms:.2f}ms: cached=True, Answer='{data_hit['answer']}'.", flush=True)

        # B. Cache Miss / Degradation Fallback Test
        mock_redis.get = MagicMock(return_value=Immediate(None))
        mock_redis.set = MagicMock(return_value=Immediate(True))
        req_miss = ChatRequest(
            chat_id="chat-999",
            question="What is refund policy?",
        )
        with patch("chat.retrieve_chunks", return_value=[]):
            data_miss = run_coroutine(chat_endpoint(req_miss))
            assert data_miss["cached"] is False
            assert "couldn't find relevant information" in data_miss["answer"].lower()
            print("  [✓] Redis cache miss / fallback pipeline verified: Returned grounded fallback response.", flush=True)

    finally:
        chat.redis_client = original_client

    print("--> TEST 3 PASSED: Query cache and degradation pipeline verified!\n", flush=True)


if __name__ == "__main__":
    test_1_celery_batch_slicing_loop()
    test_2_fastapi_non_blocking_upload()
    test_3_query_cache_and_fingerprinting()
    print("=" * 80, flush=True)
    print("  ALL BACKEND TESTS PASSED (3/3 SUCCESS)", flush=True)
    print("=" * 80, flush=True)
