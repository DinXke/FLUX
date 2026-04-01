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

# ── Startup script ────────────────────────────────────────────────────────
COPY smartmarstek/run.sh /run.sh
RUN chmod +x /run.sh

# ── Environment ───────────────────────────────────────────────────────────
# Data (settings, devices, ...) → /data  (HA persistent add-on storage)
# Frontend dist built into the image at /app/frontend/dist
ENV MARSTEK_DATA_DIR=/data \
    MARSTEK_FRONTEND_DIST=/app/frontend/dist \
    PYTHONUNBUFFERED=1

EXPOSE 5000

CMD ["/run.sh"]
