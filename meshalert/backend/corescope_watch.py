"""
CoreScope WebSocket watcher.

Verbindt met de CoreScope mesh-server, filtert detecties op pubkey-prefix,
slaat ze op in SQLite, pusht ze naar de SSE-queue en stuurt Telegram-alerts
met rate limiting.
"""
import asyncio
import json
import logging
import os
import sqlite3
import time
from datetime import datetime, timezone

import httpx
import websockets
from websockets.exceptions import ConnectionClosed, InvalidURI

logger = logging.getLogger("corescope_watch")

# Gedeelde state (geïnitialiseerd vanuit api_server.py)
detection_queue: asyncio.Queue | None = None
db_path: str = "/app/data/detections.db"

# Rate-limiting: {pubkey_prefix: last_alert_timestamp}
_last_alert: dict[str, float] = {}


def _env_list(key: str, default: str) -> list[str]:
    return [v.strip() for v in os.getenv(key, default).split(",") if v.strip()]


WATCH_PUBKEYS: list[str] = _env_list("WATCH_PUBKEYS", "fc1c4b,DinX-EDG,JZH.H39")
ALERT_COOLDOWN = int(os.getenv("ALERT_COOLDOWN_MINUTES", "5")) * 60
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
CORESCOPE_WS_URL = os.getenv("CORESCOPE_WS_URL", "ws://corescope:8765")


def init_db(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS detections (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          TEXT    NOT NULL,
            node_name   TEXT,
            pubkey_prefix TEXT,
            rssi        INTEGER,
            observer    TEXT,
            path_json   TEXT
        )
    """)
    conn.commit()
    conn.close()


def _save_detection(det: dict) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO detections (ts, node_name, pubkey_prefix, rssi, observer, path_json) "
        "VALUES (?,?,?,?,?,?)",
        (
            det.get("timestamp", datetime.now(timezone.utc).isoformat()),
            det.get("node_name") or det.get("node"),
            det.get("pubkey_prefix"),
            det.get("rssi"),
            det.get("observer"),
            json.dumps(det.get("path", [])),
        ),
    )
    conn.commit()
    conn.close()


async def _send_telegram(text: str) -> None:
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json={"chat_id": TELEGRAM_CHAT_ID, "text": text})
    except Exception as exc:  # noqa: BLE001
        logger.warning("Telegram fout: %s", exc)


def _rate_limited(pubkey_prefix: str) -> bool:
    now = time.monotonic()
    last = _last_alert.get(pubkey_prefix, 0)
    if now - last < ALERT_COOLDOWN:
        return True
    _last_alert[pubkey_prefix] = now
    return False


def _matches_watch_list(det: dict) -> bool:
    node = det.get("node_name") or det.get("node", "")
    prefix = det.get("pubkey_prefix", "")
    return any(w in node or w in prefix for w in WATCH_PUBKEYS)


async def _handle_message(raw: str) -> None:
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        return

    # CoreScope stuurt mogelijk een wrapper; pak de detectie eruit
    det = msg.get("detection") or msg if msg.get("rssi") is not None else None
    if det is None:
        return

    if not _matches_watch_list(det):
        return

    # Normaliseer timestamp
    if "timestamp" not in det:
        det["timestamp"] = datetime.now(timezone.utc).isoformat()

    _save_detection(det)

    if detection_queue is not None:
        await detection_queue.put(det)

    pubkey = det.get("pubkey_prefix", det.get("node_name", "unknown"))
    if not _rate_limited(pubkey):
        node = det.get("node_name") or det.get("node", "?")
        rssi = det.get("rssi", "?")
        text = f"🔍 MeshAlert: {node} gedetecteerd (RSSI {rssi} dBm)"
        asyncio.create_task(_send_telegram(text))


async def watch(queue: asyncio.Queue, path: str) -> None:
    """Hoofdloop: verbinden, luisteren, reconnecten bij fouten."""
    global detection_queue, db_path
    detection_queue = queue
    db_path = path
    init_db(path)

    backoff = 2
    while True:
        try:
            logger.info("Verbinden met CoreScope: %s", CORESCOPE_WS_URL)
            async with websockets.connect(CORESCOPE_WS_URL, ping_interval=30) as ws:
                backoff = 2
                logger.info("Verbonden met CoreScope")
                async for message in ws:
                    await _handle_message(message)
        except (ConnectionClosed, OSError, InvalidURI) as exc:
            logger.warning("CoreScope verbinding verbroken: %s — retry in %ds", exc, backoff)
        except Exception as exc:  # noqa: BLE001
            logger.error("Onverwachte fout: %s — retry in %ds", exc, backoff)

        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)
