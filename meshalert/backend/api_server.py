"""
MeshAlert API server — FastAPI met SSE + REST.

Endpoints:
  GET  /api/detections/stream      → SSE, event: "detection"
  GET  /api/detections/history     → paginering + filters
  GET  /api/detections/repeaters   → unieke node-namen
  GET  /api/repeaters              → geconfigureerde repeaters (JSON-bestand)
  POST /api/repeaters              → repeater toevoegen
  DELETE /api/repeaters/{id}       → repeater verwijderen
  GET  /*                          → React frontend (static files)
"""
import asyncio
import json
import logging
import os
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import corescope_watch

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("api_server")

DATA_DIR = os.getenv("DATA_DIR", "/app/data")
DB_PATH = os.path.join(DATA_DIR, "detections.db")
REPEATERS_PATH = os.path.join(DATA_DIR, "repeaters.json")
STATIC_DIR = os.getenv("STATIC_DIR", "/app/frontend/dist")

# SSE-subscribers: set van asyncio.Queue's
_sse_clients: set[asyncio.Queue] = set()


def _load_repeaters() -> list[dict]:
    if os.path.exists(REPEATERS_PATH):
        with open(REPEATERS_PATH) as f:
            return json.load(f)
    return []


def _save_repeaters(data: list[dict]) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(REPEATERS_PATH, "w") as f:
        json.dump(data, f, indent=2)


async def _broadcast_detection(det: dict) -> None:
    dead = set()
    for q in _sse_clients:
        try:
            q.put_nowait(det)
        except asyncio.QueueFull:
            dead.add(q)
    _sse_clients.difference_update(dead)


async def _detection_dispatcher(queue: asyncio.Queue) -> None:
    """Leest van de watcher-queue en pusht naar alle SSE-clients."""
    while True:
        det = await queue.get()
        await _broadcast_detection(det)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(DATA_DIR, exist_ok=True)
    queue: asyncio.Queue = asyncio.Queue(maxsize=500)
    asyncio.create_task(corescope_watch.watch(queue, DB_PATH))
    asyncio.create_task(_detection_dispatcher(queue))
    yield


app = FastAPI(title="MeshAlert API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── SSE ──────────────────────────────────────────────────────────────────────

async def _sse_generator() -> AsyncGenerator[str, None]:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _sse_clients.add(q)
    try:
        yield "data: {\"status\": \"connected\"}\n\n"
        while True:
            det = await asyncio.wait_for(q.get(), timeout=25)
            yield f"event: detection\ndata: {json.dumps(det)}\n\n"
    except asyncio.TimeoutError:
        yield ": keepalive\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        _sse_clients.discard(q)


@app.get("/api/detections/stream")
async def detections_stream():
    return StreamingResponse(
        _sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ─── History ──────────────────────────────────────────────────────────────────

@app.get("/api/detections/history")
async def detections_history(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    repeater: str = Query(""),
    timeRange: str = Query("all"),
):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    wheres = []
    params: list = []

    if repeater:
        wheres.append("(node_name = ? OR pubkey_prefix = ?)")
        params.extend([repeater, repeater])

    if timeRange != "all":
        cutoffs = {"today": 1, "7d": 7, "30d": 30}
        days = cutoffs.get(timeRange)
        if days:
            since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            wheres.append("ts >= ?")
            params.append(since)

    where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""

    total = conn.execute(
        f"SELECT COUNT(*) FROM detections {where_sql}", params
    ).fetchone()[0]

    rows = conn.execute(
        f"SELECT ts, node_name, pubkey_prefix, rssi, observer, path_json "
        f"FROM detections {where_sql} ORDER BY ts DESC LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()
    conn.close()

    detections = [
        {
            "timestamp": r["ts"],
            "node": r["node_name"],
            "pubkey_prefix": r["pubkey_prefix"],
            "rssi": r["rssi"],
            "observer": r["observer"],
            "path": json.loads(r["path_json"] or "[]"),
        }
        for r in rows
    ]
    return {"detections": detections, "total": total, "limit": limit, "offset": offset}


@app.get("/api/detections/repeaters")
async def detection_repeaters():
    """Unieke node-namen uit de detectie-history (voor filter-dropdowns)."""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT DISTINCT node_name FROM detections WHERE node_name IS NOT NULL ORDER BY node_name"
    ).fetchall()
    conn.close()
    return {"repeaters": [r[0] for r in rows]}


# ─── Repeater CRUD ────────────────────────────────────────────────────────────

class RepeaterIn(BaseModel):
    name: str
    pubkey_prefix: str


@app.get("/api/repeaters")
async def list_repeaters():
    return _load_repeaters()


@app.post("/api/repeaters", status_code=201)
async def add_repeater(body: RepeaterIn):
    repeaters = _load_repeaters()
    new = {"id": str(uuid.uuid4()), "name": body.name, "pubkey_prefix": body.pubkey_prefix, "last_heard": None}
    repeaters.append(new)
    _save_repeaters(repeaters)
    return new


@app.delete("/api/repeaters/{repeater_id}")
async def delete_repeater(repeater_id: str):
    repeaters = _load_repeaters()
    remaining = [r for r in repeaters if r["id"] != repeater_id]
    if len(remaining) == len(repeaters):
        raise HTTPException(status_code=404, detail="Repeater niet gevonden")
    _save_repeaters(remaining)
    return {}


# ─── Static frontend ──────────────────────────────────────────────────────────

if os.path.isdir(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
else:
    logger.warning("Frontend dist niet gevonden op %s — alleen API beschikbaar", STATIC_DIR)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "7842"))
    uvicorn.run("api_server:app", host="0.0.0.0", port=port, reload=False)
