FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/backend/

# Frontend dist wordt via volume gemount of pre-built meegekopieerd
ENV DATA_DIR=/app/data \
    STATIC_DIR=/app/frontend/dist \
    PORT=7842 \
    PYTHONPATH=/app/backend

EXPOSE 7842

CMD ["python", "-m", "uvicorn", "api_server:app", "--host", "0.0.0.0", "--port", "7842"]
