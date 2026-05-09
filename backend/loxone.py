"""
loxone.py — Loxone Miniserver integration for FLUX.

Uses the Loxone HTTP/JSON API (no websocket dependency):
  GET http://host/jdev/cfg/api           — Miniserver info
  GET http://host/data/LoxAPP3.json      — full structure file (controls)
  GET http://host/jdev/sps/io/<uuid>     — current value of a control

Authentication: HTTP Basic Auth (username:password).
Poll interval: configurable (default 30 s), same as influx_writer.
"""
import json
import logging
import os
import time
import threading
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional

import requests
from requests.auth import HTTPBasicAuth

log = logging.getLogger(__name__)

LOXONE_CFG_FILE = "loxone_config.json"
LOXONE_ENTITIES_FILE = "loxone_entities.json"

# Types that expose power/energy measurements in Loxone
ENERGY_TYPES = {"EnergyMonitor", "Meter", "PowerMeter", "EnergySocket"}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class LoxoneDevice:
    uuid: str
    name: str
    type: str
    room: str = ""
    current_power_w: float = 0.0
    last_updated: float = 0.0


@dataclass
class LoxoneEnergySocket(LoxoneDevice):
    """Specialised class for Loxone Energy Sockets (power measurement)."""
    pass


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def _cfg_path(data_dir: str) -> str:
    return os.path.join(data_dir, LOXONE_CFG_FILE)


def _entities_path(data_dir: str) -> str:
    return os.path.join(data_dir, LOXONE_ENTITIES_FILE)


def load_loxone_config(data_dir: str) -> dict:
    """Load Loxone connection config from file."""
    path = _cfg_path(data_dir)
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as exc:
        log.warning("Failed to load loxone_config.json: %s", exc)
    return {
        "enabled": False,
        "host": "",
        "port": 80,
        "username": "",
        "password": "",
        "poll_interval": 30,
        "selected_entities": [],
    }


def save_loxone_config(data_dir: str, cfg: dict) -> bool:
    """Save Loxone connection config."""
    path = _cfg_path(data_dir)
    try:
        os.makedirs(data_dir, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        return True
    except Exception as exc:
        log.error("Failed to save loxone_config.json: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Loxone HTTP API client
# ---------------------------------------------------------------------------

class LoxoneClient:
    """Lightweight synchronous HTTP client for the Loxone Miniserver API."""

    def __init__(self, host: str, port: int, username: str, password: str, timeout: int = 10):
        self.base_url = f"http://{host}:{port}"
        self.auth = HTTPBasicAuth(username, password)
        self.timeout = timeout

    def _get(self, path: str) -> dict:
        url = f"{self.base_url}{path}"
        resp = requests.get(url, auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def get_api_info(self) -> dict:
        """Return Miniserver info (version, serial, …)."""
        data = self._get("/jdev/cfg/api")
        return data.get("LL", {}).get("value", {})

    def get_structure_file(self) -> dict:
        """Download the full LoxAPP3 structure (all rooms, controls, …)."""
        url = f"{self.base_url}/data/LoxAPP3.json"
        resp = requests.get(url, auth=self.auth, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def get_entity_value(self, uuid: str) -> Optional[float]:
        """
        Read the current value of a control by its UUID.
        Returns the numeric value or None on failure.
        """
        try:
            data = self._get(f"/jdev/sps/io/{uuid}/")
            raw = data.get("LL", {}).get("value")
            if raw is None:
                return None
            return float(raw)
        except Exception as exc:
            log.debug("get_entity_value(%s) failed: %s", uuid, exc)
            return None


# ---------------------------------------------------------------------------
# Entity discovery
# ---------------------------------------------------------------------------

def get_structure_file(data_dir: str) -> Optional[dict]:
    """Connect to Loxone and return the full structure file."""
    cfg = load_loxone_config(data_dir)
    if not cfg.get("enabled") or not cfg.get("host"):
        return None
    client = LoxoneClient(
        host=cfg["host"],
        port=int(cfg.get("port", 80)),
        username=cfg.get("username", ""),
        password=cfg.get("password", ""),
    )
    return client.get_structure_file()


def discover_entities(data_dir: str) -> List[dict]:
    """
    Return all controls from the Loxone structure file as flat dicts.
    Each entry has: uuid, name, type, room.
    """
    structure = get_structure_file(data_dir)
    if not structure:
        return []

    rooms: Dict[str, str] = {
        uuid: info.get("name", "")
        for uuid, info in structure.get("rooms", {}).items()
    }
    controls = structure.get("controls", {})

    entities = []
    for uuid, ctrl in controls.items():
        ctrl_type = ctrl.get("type", "")
        room_uuid = ctrl.get("room", "")
        entities.append({
            "uuid": uuid,
            "name": ctrl.get("name", uuid),
            "type": ctrl_type,
            "room": rooms.get(room_uuid, ""),
            "is_energy": ctrl_type in ENERGY_TYPES,
        })
    return entities


def get_entity_value(data_dir: str, uuid: str) -> Optional[float]:
    """Read current value of a specific Loxone entity."""
    cfg = load_loxone_config(data_dir)
    if not cfg.get("enabled") or not cfg.get("host"):
        return None
    client = LoxoneClient(
        host=cfg["host"],
        port=int(cfg.get("port", 80)),
        username=cfg.get("username", ""),
        password=cfg.get("password", ""),
    )
    return client.get_entity_value(uuid)


# ---------------------------------------------------------------------------
# Poll selected entities  →  returns list[LoxoneDevice]
# ---------------------------------------------------------------------------

def poll_selected_entities(data_dir: str) -> List[LoxoneDevice]:
    """
    Poll the current power (W) for all selected_entities from config.
    Returns a list of LoxoneDevice objects with current_power_w filled in.
    """
    cfg = load_loxone_config(data_dir)
    if not cfg.get("enabled") or not cfg.get("host"):
        return []

    selected: List[dict] = cfg.get("selected_entities", [])
    if not selected:
        return []

    client = LoxoneClient(
        host=cfg["host"],
        port=int(cfg.get("port", 80)),
        username=cfg.get("username", ""),
        password=cfg.get("password", ""),
    )

    results = []
    for entity in selected:
        uuid = entity.get("uuid")
        if not uuid:
            continue
        try:
            val = client.get_entity_value(uuid)
            dev_cls = LoxoneEnergySocket if entity.get("type") in ENERGY_TYPES else LoxoneDevice
            dev = dev_cls(
                uuid=uuid,
                name=entity.get("name", uuid),
                type=entity.get("type", ""),
                room=entity.get("room", ""),
                current_power_w=float(val) if val is not None else 0.0,
                last_updated=time.time(),
            )
            results.append(dev)
        except Exception as exc:
            log.debug("poll_selected_entities: failed for %s: %s", uuid, exc)
    return results


# ---------------------------------------------------------------------------
# Connection status check
# ---------------------------------------------------------------------------

def get_connection_status(data_dir: str) -> dict:
    """Return connection status dict for the API status endpoint."""
    cfg = load_loxone_config(data_dir)
    if not cfg.get("enabled"):
        return {"connected": False, "enabled": False, "error": None}

    if not cfg.get("host"):
        return {"connected": False, "enabled": True, "error": "No host configured"}

    try:
        client = LoxoneClient(
            host=cfg["host"],
            port=int(cfg.get("port", 80)),
            username=cfg.get("username", ""),
            password=cfg.get("password", ""),
            timeout=5,
        )
        info = client.get_api_info()
        return {
            "connected": True,
            "enabled": True,
            "host": cfg["host"],
            "port": cfg.get("port", 80),
            "miniserver_info": info,
            "error": None,
        }
    except Exception as exc:
        return {
            "connected": False,
            "enabled": True,
            "host": cfg["host"],
            "error": str(exc),
        }
