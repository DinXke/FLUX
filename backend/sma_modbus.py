"""
sma_modbus.py – SMA Sunny Boy Modbus TCP reader.

Polls SMA inverter input registers (FC04) periodically and exposes
the latest reading via get_sma_live(). Starts a background thread
via start_sma_reader(get_settings_fn).

SMA register addressing:
  - 3xxxx registers → input registers (FC04), 0-based addr = reg - 1
  - NaN sentinels: U32=0xFFFFFFFF, S32=0x80000000, U64=0x8000000000000000
"""

import logging
import struct
import threading
import time
from typing import Optional

log = logging.getLogger("sma_modbus")

# ---------------------------------------------------------------------------
# SMA status codes → human-readable label
# ---------------------------------------------------------------------------

_STATUS_LABELS: dict[int, str] = {
    303:  "Uit",
    307:  "Netinvoer",
    308:  "Wacht op net",
    381:  "Stop",
    455:  "Vermogen beperkt",
    1392: "Fout",
}

_SMA_U32_NAN: int = 0xFFFF_FFFF
_SMA_S32_NAN: int = 0x8000_0000
_SMA_U64_NAN: int = 0x8000_0000_0000_0000

# ---------------------------------------------------------------------------
# In-memory cache  (ts=0.0 → never polled)
# ---------------------------------------------------------------------------

_sma_live: dict = {
    "ts":           0.0,
    "pac_w":        None,
    "e_day_wh":     None,
    "e_total_wh":   None,
    "grid_v":       None,
    "freq_hz":      None,
    "dc_power_w":   None,
    "dc_voltage_v": None,
    "status_code":  None,
    "status":       None,
    "online":       False,
}
_sma_lock = threading.Lock()


def get_sma_live() -> dict:
    """Return a copy of the latest SMA live data."""
    with _sma_lock:
        return dict(_sma_live)


# ---------------------------------------------------------------------------
# Register decode helpers
# ---------------------------------------------------------------------------

def _to_u32(regs: list, idx: int) -> Optional[int]:
    if len(regs) < idx + 2:
        return None
    val = (regs[idx] << 16) | regs[idx + 1]
    return None if val == _SMA_U32_NAN else val


def _to_s32(regs: list, idx: int) -> Optional[int]:
    if len(regs) < idx + 2:
        return None
    raw = (regs[idx] << 16) | regs[idx + 1]
    if raw == _SMA_S32_NAN:
        return None
    return struct.unpack(">i", struct.pack(">I", raw))[0]


def _to_u64(regs: list, idx: int) -> Optional[int]:
    if len(regs) < idx + 4:
        return None
    val = (
        (regs[idx]     << 48)
        | (regs[idx+1] << 32)
        | (regs[idx+2] << 16)
        | regs[idx+3]
    )
    return None if val == _SMA_U64_NAN else val


def _read_input(client, address: int, count: int, unit_id: int) -> Optional[list]:
    """Read `count` input registers (FC04) starting at 0-based `address`."""
    try:
        result = client.read_input_registers(
            address=address, count=count, slave=unit_id
        )
        if hasattr(result, "isError") and result.isError():
            log.debug("SMA FC04 error  addr=%d  unit=%d: %s", address, unit_id, result)
            return None
        return result.registers
    except Exception as exc:
        log.debug("SMA FC04 exception  addr=%d: %s", address, exc)
        return None


# ---------------------------------------------------------------------------
# Main poll
# ---------------------------------------------------------------------------

def _poll(host: str, port: int, unit_id: int) -> dict:
    """
    Open a Modbus TCP connection to the SMA inverter, read all registers,
    and return a parsed dict. The connection is closed before returning.

    SMA documents 1-based addresses; pymodbus uses 0-based → subtract 1.
    """
    try:
        from pymodbus.client import ModbusTcpClient
    except ImportError:
        log.error("pymodbus niet geïnstalleerd")
        return {"online": False}

    client = ModbusTcpClient(host=host, port=port, timeout=5)
    if not client.connect():
        log.warning("SMA Modbus: kan niet verbinden met %s:%d", host, port)
        return {"online": False}

    data: dict = {"online": True}
    try:
        # Pac (AC total power)  — reg 30775, S32, W
        r = _read_input(client, 30774, 2, unit_id)
        if r is not None:
            data["pac_w"] = _to_s32(r, 0)

        # E-Day (today's yield)  — reg 30535, U32, Wh
        r = _read_input(client, 30534, 2, unit_id)
        if r is not None:
            data["e_day_wh"] = _to_u32(r, 0)

        # E-Total (lifetime yield)  — reg 30517, U64, Wh
        r = _read_input(client, 30516, 4, unit_id)
        if r is not None:
            data["e_total_wh"] = _to_u64(r, 0)

        # Grid voltage L1  — reg 30581, U32, 0.01 V
        r = _read_input(client, 30580, 2, unit_id)
        if r is not None:
            v = _to_u32(r, 0)
            data["grid_v"] = round(v / 100, 2) if v is not None else None

        # Grid frequency  — reg 30977, U32, 0.01 Hz
        r = _read_input(client, 30976, 2, unit_id)
        if r is not None:
            f = _to_u32(r, 0)
            data["freq_hz"] = round(f / 100, 2) if f is not None else None

        # DC power string 1  — reg 30529, S32, W
        r = _read_input(client, 30528, 2, unit_id)
        if r is not None:
            data["dc_power_w"] = _to_s32(r, 0)

        # DC voltage string 1  — reg 30533, U32, 0.01 V
        r = _read_input(client, 30532, 2, unit_id)
        if r is not None:
            v = _to_u32(r, 0)
            data["dc_voltage_v"] = round(v / 100, 2) if v is not None else None

        # Operating status  — reg 30803, U32
        r = _read_input(client, 30802, 2, unit_id)
        if r is not None:
            code = _to_u32(r, 0)
            data["status_code"] = code
            data["status"] = (
                _STATUS_LABELS.get(code, f"Code {code}") if code is not None else None
            )

    finally:
        client.close()

    return data


# ---------------------------------------------------------------------------
# Background thread
# ---------------------------------------------------------------------------

def _update_cache(d: dict) -> None:
    with _sma_lock:
        _sma_live.update(d)
        _sma_live["ts"] = time.time()


_alert_state: dict = {
    "offline_since":    None,   # float timestamp when online→offline transition happened
    "offline_notified": False,  # True = already sent the offline alert this outage
    "last_error_code":  None,   # last status_code that was an error
    "day_summary_sent_date": None,  # "YYYY-MM-DD" of last day-summary
}


def _check_alerts(result: dict) -> None:
    """Fire Telegram alerts based on state transitions."""
    try:
        from telegram import notify_event as _notify
        from datetime import date as _date
    except ImportError:
        return

    online = result.get("online", False)

    # ── Offline alert ────────────────────────────────────────────────────────
    if not online:
        if _alert_state["offline_since"] is None:
            _alert_state["offline_since"] = time.time()
            _alert_state["offline_notified"] = False
        elif not _alert_state["offline_notified"]:
            offline_s = time.time() - _alert_state["offline_since"]
            if offline_s >= 300:  # 5 min grace period
                _notify("sma_offline", {"message": "SMA Sunny Boy niet bereikbaar (> 5 min)"})
                _alert_state["offline_notified"] = True
    else:
        _alert_state["offline_since"] = None
        _alert_state["offline_notified"] = False

    # ── Error status alert ───────────────────────────────────────────────────
    code = result.get("status_code")
    if online and code is not None and code == 1392:  # 1392 = Fout
        if _alert_state["last_error_code"] != code:
            _notify("sma_error", {
                "message": f"SMA foutcode: {code} ({result.get('status', '?')})",
            })
            _alert_state["last_error_code"] = code
    elif code != 1392:
        _alert_state["last_error_code"] = None

    # ── Day summary (sent once per day around sunset: pac drops to 0) ────────
    if online:
        pac = result.get("pac_w") or 0
        today = str(_date.today())
        if pac == 0 and _alert_state["day_summary_sent_date"] != today:
            e_day = result.get("e_day_wh")
            if e_day is not None and e_day > 100:  # only if we actually produced something
                kwh = round(e_day / 1000, 2)
                _notify("sma_day_summary", {
                    "message": f"SMA dagopbrengst: {kwh} kWh",
                    "e_day_wh": e_day,
                })
                _alert_state["day_summary_sent_date"] = today


def _reader_loop(get_settings_fn, interval: int) -> None:
    log.info("SMA Modbus reader gestart  interval=%ds", interval)
    while True:
        try:
            s = get_settings_fn()
            if not s.get("sma_reader_enabled"):
                time.sleep(interval)
                continue
            host    = (s.get("sma_reader_host") or "").strip()
            port    = int(s.get("sma_reader_port", 502))
            unit_id = int(s.get("sma_reader_unit_id", 3))
            if not host:
                time.sleep(interval)
                continue
            result = _poll(host, port, unit_id)
            _update_cache(result)
            _check_alerts(result)
            log.debug(
                "SMA live  pac=%sW  e_day=%sWh  status=%s",
                result.get("pac_w"), result.get("e_day_wh"), result.get("status"),
            )
        except Exception as exc:
            log.warning("SMA reader loop uitzondering: %s", exc)
            with _sma_lock:
                _sma_live["online"] = False
                _sma_live["ts"] = time.time()
        time.sleep(interval)


def start_sma_reader(get_settings_fn, interval: int = 10) -> threading.Thread:
    """Spawn a background daemon thread that polls the SMA inverter."""
    t = threading.Thread(
        target=_reader_loop,
        args=(get_settings_fn, interval),
        daemon=True,
        name="sma-reader",
    )
    t.start()
    return t
