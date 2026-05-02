# Global ARG must be declared before first FROM to be usable in FROM instructions
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-python:3.13-alpine3.21

# ── Stage 1: build frontend natively (always amd64, no QEMU) ─────────────────
FROM --platform=linux/amd64 node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# ── Stage 2: HA add-on image (target arch via BUILD_FROM) ────────────────────
FROM $BUILD_FROM

# System dependencies (no nodejs/npm needed – frontend is pre-built)
RUN apk add --no-cache \
    gcc \
    g++ \
    musl-dev \
    libffi-dev \
    openssl-dev \
    cmake \
    make

# Copy pre-built frontend dist from builder stage
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Install Python backend
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Add-on helpers
COPY run.sh /run.sh
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
COPY setup_config.py /app/setup_config.py
RUN chmod +x /run.sh /app/docker-entrypoint.sh

# Environment
ENV MARSTEK_DATA_DIR=/data \
    MARSTEK_FRONTEND_DIST=/app/frontend/dist \
    PYTHONUNBUFFERED=1

EXPOSE 5000
CMD ["/run.sh"]
