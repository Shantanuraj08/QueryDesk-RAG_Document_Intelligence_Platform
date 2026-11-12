#!/usr/bin/env bash
set -euo pipefail

# Run Celery with lower CPU priority and single-process solo pool to stay under 512 MB RAM
nice -n 10 celery -A tasks.celery_app worker \
  -P solo \
  --concurrency=1 \
  --without-gossip \
  --without-mingle \
  --loglevel=info &

# Keep FastAPI in foreground as PID 1 with a single worker
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1

