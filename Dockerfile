ARG BUILD_FROM
FROM $BUILD_FROM

# ── System dependencies ───────────────────────────────────────────────────
RUN apk add --no-cache \
    nodejs \
    npm \
    gcc \
    musl-dev \
    libffi-dev \
    openssl-dev

# ── Build frontend ────────────────────────────────────────────────────────
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# ── Install Python backend ────────────────────────────────────────────────
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

COPY backend/ ./

# ── Add-on helpers ────────────────────────────────────────────────────────
COPY run.sh /run.sh
COPY setup_config.py /app/setup_config.py
RUN chmod +x /run.sh

# ── Environment ───────────────────────────────────────────────────────────
# /data  → HA persistent add-on storage (mapped as data:rw in config.yaml)
# /app/frontend/dist  → pre-built frontend assets
ENV MARSTEK_DATA_DIR=/data \
    MARSTEK_FRONTEND_DIST=/app/frontend/dist \
    PYTHONUNBUFFERED=1

EXPOSE 5000

CMD ["/run.sh"]
