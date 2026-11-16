
# Stage 1: Build Python Virtual Environment

FROM python:3.12-slim AS builder

WORKDIR /app
# Prevent Python from writing .pyc files & buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install minimal compiler tools for any native C-extension wheels
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential && \
    rm -rf /var/lib/apt/lists/*

# Create isolated virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Stage 2: Minimal Production Runtime (~200 MB)
FROM python:3.12-slim AS runner

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PORT=8000

# Copy pre-built virtual environment from builder stage
COPY --from=builder /opt/venv /opt/venv

# Create a non-root system user and group for security
RUN groupadd --system --gid 1001 appgroup && \
    useradd --system --uid 1001 --gid appgroup --create-home appuser

# Copy application code with non-root ownership
COPY --chown=appuser:appgroup . .

# Ensure start script has executable permissions
RUN chmod +x start.sh

# Switch to non-root user
USER appuser

EXPOSE 8000

CMD ["bash", "start.sh"]
