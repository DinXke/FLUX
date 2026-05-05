# Stage 1: bouw React frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend + frontend dist
FROM python:3.11-slim
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV DATA_DIR=/app/data \
    STATIC_DIR=/app/frontend/dist \
    PORT=7842 \
    PYTHONPATH=/app/backend

EXPOSE 7842

CMD ["python", "-m", "uvicorn", "api_server:app", "--host", "0.0.0.0", "--port", "7842"]
