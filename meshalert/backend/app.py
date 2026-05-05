from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
import asyncio
import json
import os

app = FastAPI(title="MeshAlert API", version="1.0.0")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ Models ============

class Detection(BaseModel):
    timestamp: datetime
    node: str
    rssi: int
    observer: str
    path: Optional[List[str]] = None

# ============ Simulated In-Memory Storage ============
# TODO: Replace with SQLite in SCH-2326

detections_buffer = []
repeaters_set = set()

# ============ API Endpoints ============

@app.get("/api/health")
async def health():
    """Health check endpoint"""
    return {"status": "ok", "service": "meshalert"}

@app.get("/api/detections/stream")
async def stream_detections():
    """SSE stream of real-time detections"""
    async def event_generator():
        # Simulated stream - will be connected to actual mesh detector in SCH-2326
        try:
            while True:
                if detections_buffer:
                    det = detections_buffer.pop(0)
                    yield f"data: {json.dumps(det, default=str)}\n\n"
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/detections/history")
async def get_history(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    repeater: Optional[str] = None,
    timeRange: Optional[str] = None,
):
    """Get paginated historical detections"""
    # TODO: Query SQLite with filters in SCH-2326

    filtered = detections_buffer

    if repeater:
        filtered = [d for d in filtered if d.get("observer") == repeater]

    if timeRange == "today":
        today = datetime.now().date()
        filtered = [d for d in filtered if datetime.fromisoformat(d["timestamp"]).date() == today]
    elif timeRange == "7d":
        week_ago = datetime.now() - timedelta(days=7)
        filtered = [d for d in filtered if datetime.fromisoformat(d["timestamp"]) > week_ago]
    elif timeRange == "30d":
        month_ago = datetime.now() - timedelta(days=30)
        filtered = [d for d in filtered if datetime.fromisoformat(d["timestamp"]) > month_ago]

    total = len(filtered)
    paginated = filtered[offset : offset + limit]

    return {
        "detections": paginated,
        "total": total,
        "offset": offset,
        "limit": limit,
    }

@app.get("/api/detections/repeaters")
async def get_repeaters():
    """Get list of unique repeaters"""
    return {"repeaters": sorted(list(repeaters_set))}

@app.post("/api/detections/ingest")
async def ingest_detection(detection: Detection):
    """Ingest a new detection from mesh detector (internal API)"""
    det_dict = detection.model_dump(mode='json')
    detections_buffer.append(det_dict)
    repeaters_set.add(detection.observer)

    # Keep buffer size reasonable
    if len(detections_buffer) > 10000:
        detections_buffer.pop(0)

    return {"status": "ok", "buffer_size": len(detections_buffer)}

# ============ Static Files ============

frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5001)
