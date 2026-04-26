"""
sma_modbus.py – SMA Sunny Boy Modbus TCP reader.

Polls SMA inverter registers periodically and exposes the latest reading
via get_sma_live(). Starts a background thread via start_sma_reader().

SMA register addressing (SB30-50-1AV-40 / SBn-n-1AV-40):
  - 3xxxx registers → FC04 input registers OR FC03 holding registers
  - SMA uses 1-based Modbus addressing: register number == pymodbus address (no -1)
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

# Status codes that indicate the device is actively running (not standby/night)
_RUNNING_STATUS_CODES: frozenset[int] = frozenset({307, 308, 455})

_SMA_U32_NAN: int = 0xFFFF_FFFF
_SMA_S32_NAN: int = 0x8000_0000
_SMA_U64_NAN: int = 0x8000_0000_0000_0000

# ---------------------------------------------------------------------------
# Configurable register map
# ---------------------------------------------------------------------------
# Each entry:
#   key    – field name stored in the live-data dict
#   label  – human-readable name shown in the UI
#   reg    – 1-based register number (as in SMA docs and Loxone IO-adres)
#   fc     – Modbus function code: 3 = holding (FC03), 4 = input (FC04)
#   dtype  – "U32", "S32", or "U64"
#   mult   – multiplier applied to the raw integer before storing
#              (e.g. 0.01 for 0.01V→V, 1000.0 for kWh→Wh, 1.0 for direct)
#   unit   – raw register unit label (informational)

_DEFAULT_REGISTER_MAP: list[dict] = [
    {"key": "pac_w",        "label": "AC-vermogen",       "reg": 30775, "fc": 3, "dtype": "S32", "mult": 1.0,    "unit": "W"},
    {"key": "e_total_wh",   "label": "Totaalopbrengst",   "reg": 30531, "fc": 4, "dtype": "U32", "mult": 1000.0, "unit": "kWh"},
    {"key": "e_day_wh",     "label": "Dagopbrengst",      "reg": 30535, "fc": 4, "dtype": "U32", "mult": 1.0,    "unit": "Wh"},
    {"key": "grid_v",       "label": "Netspanning L1",    "reg": 30783, "fc": 3, "dtype": "U32", "mult": 0.01,   "unit": "0.01V"},
    {"key": "freq_hz",      "label": "Netfrequentie",     "reg": 30803, "fc": 4, "dtype": "U32", "mult": 0.01,   "unit": "0.01Hz"},
    {"key": "temp_c",       "label": "Interne temp.",     "reg": 30953, "fc": 3, "dtype": "S32", "mult": 0.1,    "unit": "0.1°C"},
    {"key": "op_time_s",    "label": "Bedrijfstijd",      "reg": 30541, "fc": 4, "dtype": "U32", "mult": 1.0,    "unit": "s"},
    {"key": "dc_current_a", "label": "DC stroom str1",    "reg": 30769, "fc": 4, "dtype": "U32", "mult": 0.001,  "unit": "mA"},
    {"key": "dc_voltage_v", "label": "DC spanning str1",  "reg": 30771, "fc": 4, "dtype": "U32", "mult": 0.01,   "unit": "0.01V"},
    {"key": "dc_power_w",   "label": "DC vermogen str1",  "reg": 30773, "fc": 4, "dtype": "S32", "mult": 1.0,    "unit": "W"},
]


def get_default_register_map() -> list[dict]:
    """Return a deep copy of the default register map (safe for mutation)."""
    return [dict(r) for r in _DEFAULT_REGISTER_MAP]


def _poll_register(client, reg_conf: dict, unit_id: int) -> Optional[float]:
    """Read one register entry and return the scaled value, or None on error/NaN."""
    addr  = reg_conf["reg"]              # SMA uses 1-based Modbus addressing
    fc    = reg_conf["fc"]
    dtype = reg_conf["dtype"]
    mult  = float(reg_conf.get("mult", 1.0))
    count = 4 if dtype == "U64" else 2

    r = _read_holding(client, addr, count, unit_id) if fc == 3 \
        else _read_input(client, addr, count, unit_id)
    if r is None:
        return None

    if dtype == "U32":
        raw = _to_u32(r, 0)
    elif dtype == "S32":
        raw = _to_s32(r, 0)
    else:
        raw = _to_u64(r, 0)

    if raw is None:
        return None
    return raw * mult if mult != 1.0 else raw

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
    "temp_c":       None,
    "op_time_s":    None,
    "dc_power_w":   None,
    "dc_voltage_v": None,
    "dc_current_a": None,
    "status":       None,
    "status_code":  None,
    "online":       False,
    "night_mode":   False,
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
            address=address, count=count, device_id=unit_id
        )
        if hasattr(result, "isError") and result.isError():
            log.debug("SMA FC04 error  addr=%d  unit=%d: %s", address, unit_id, result)
            return None
        return result.registers
    except Exception as exc:
        log.debug("SMA FC04 exception  addr=%d: %s", address, exc)
        return None


def _read_holding(client, address: int, count: int, unit_id: int) -> Optional[list]:
    """Read `count` holding registers (FC03) starting at 0-based `address`."""
    try:
        result = client.read_holding_registers(
            address=address, count=count, device_id=unit_id
        )
        if hasattr(result, "isError") and result.isError():
            log.debug("SMA FC03 error  addr=%d  unit=%d: %s", address, unit_id, result)
            return None
        return result.registers
    except Exception as exc:
        log.debug("SMA FC03 exception  addr=%d: %s", address, exc)
        return None


def _read_status(client, unit_id: int) -> Optional[int]:
    """
    Read device status ENUM. SMA uses 1-based Modbus addressing, so SMA register
    30201 (Condition) is read at pymodbus address 30201.
    Try both 30201 (1-based, correct) and 30200 (0-based, legacy fallback).
    Returns the raw status code integer or None.
    """
    for addr in (30201, 30200):
        r = _read_holding(client, addr, 2, unit_id)
        if r is not None:
            code = _to_u32(r, 0)
            if code is not None and code != 0:
                log.debug("SMA status found at addr=%d  code=%d", addr, code)
                return code
    return None


def poll_diagnostics(host: str, port: int, unit_id: int, use_udp: bool = False) -> dict:
    """
    Extended diagnostic poll: tries all key registers and returns raw values.
    Used by /api/sma/test.
    """
    client = _make_client(host, port, use_udp=use_udp)
    if client is None:
        return {"online": False, "error": "pymodbus niet geïnstalleerd"}
    if not client.connect():
        return {"online": False, "error": f"Kan niet verbinden met {host}:{port}"}

    result: dict = {"online": True, "raw": {}, "unit_id": unit_id}

    # (key, 1-based SMA addr == Modbus addr, count, dtype, scale, fc)
    # Primary: SMA SB30-50-1AV-40 Modbus register map (high addresses, FC03/FC04)
    # Low_*:  alternative addressing: addr = SMA_reg - 30001 (kept for diagnostic reference)
    # Alt_*:  cross-FC probes and scan-found addresses
    PROBES_FC03 = [
        ("pac_w",            30775, 2, "S32",    1, 3),  # SMA reg 30775 — Pac (W)
        ("grid_v",           30783, 2, "U32",  100, 3),  # SMA reg 30783 — Uac L1 (0.01V)
        ("temp_c",           30953, 2, "S32",   10, 3),  # SMA reg 30953 — Internal temp (0.1°C)
        ("status_code",      30201, 2, "U32",    1, 3),  # SMA reg 30201 — Device status (ENUM)
        ("alt_status_code",  30201, 2, "U32",    1, 3),  # same addr, kept for compat
        ("alt_nominal_w",    30205, 2, "U32",    1, 3),  # SMA reg 30205 — Nominal AC power (W)
        ("wmax_lim_w",       42062, 2, "U32",    1, 3),  # SMA reg 42062 — WMaxLim (PV limiter)
        ("wmax_lim_pct",     40236, 2, "U32",    1, 3),  # SMA reg 40236 — WMaxLimPct
        # Cross-FC: registers normally FC04 — check if SB4.x responds via FC03 instead
        ("alt_dc_current_fc3", 30769, 2, "U32", 1000, 3),  # SMA reg 30769 via FC03
        ("alt_dc_voltage_fc3", 30771, 2, "U32",  100, 3),  # SMA reg 30771 via FC03
        ("alt_dc_power_fc3",   30773, 2, "S32",    1, 3),  # SMA reg 30773 via FC03
        ("alt_freq_fc3",       30803, 2, "U32",  100, 3),  # SMA reg 30803 via FC03
        ("alt_op_time_fc3",    30541, 2, "U32",    1, 3),  # SMA reg 30541 via FC03
        ("alt_e_total_fc3",    30531, 2, "U32",    1, 3),  # SMA reg 30531 via FC03
        ("alt_e_day_fc3",      30535, 2, "U32",    1, 3),  # SMA reg 30535 via FC03
        # FC03 low-address probes: addr = SMA_reg - 30001 (standard Modbus holding reg)
        ("low_pac_w_fc3",      774, 2, "S32",    1, 3),  # SMA reg 30775 at std addr
        ("low_grid_v_fc3",     782, 2, "U32",  100, 3),  # SMA reg 30783 at std addr
        ("low_freq_fc3",       802, 2, "U32",  100, 3),  # SMA reg 30803 at std addr
        ("low_dc_cur_fc3",     768, 2, "U32", 1000, 3),  # SMA reg 30769 at std addr
        ("low_dc_v_fc3",       770, 2, "U32",  100, 3),  # SMA reg 30771 at std addr
        ("low_dc_pwr_fc3",     772, 2, "S32",    1, 3),  # SMA reg 30773 at std addr
        ("low_temp_fc3",       952, 2, "S32",   10, 3),  # SMA reg 30953 at std addr
        ("low_op_fc3",         540, 2, "U32",    1, 3),  # SMA reg 30541 at std addr
        ("low_etot_fc3",       530, 2, "U32",    1, 3),  # SMA reg 30531 at std addr
        ("low_eday_fc3",       534, 2, "U32",    1, 3),  # SMA reg 30535 at std addr
        ("low_stat_fc3",       200, 2, "U32",    1, 3),  # SMA reg 30201 at std addr
        ("low_etot64_fc3",     512, 4, "U64",    1, 3),  # SMA reg 30513 U64 at std addr
        ("low_eday64_fc3",     516, 4, "U64",    1, 3),  # SMA reg 30517 U64 at std addr
        # FC03 40000+ addresses found in register scan (possible alt measurement map)
        ("scan_pac_w_40197",  40196, 2, "U32",    1, 3),  # scan found 4000 at reg 40197
        ("scan_grid_v_40135", 40134, 2, "U32",    1, 3),  # scan found 230 at reg 40135
        ("scan_freq_40137",   40136, 2, "U32",  100, 3),  # scan found 5000 at reg 40137
    ]
    PROBES_FC04 = [
        ("e_total_wh",      30513, 4, "U64",    1, 4),  # SMA reg 30513 — E-Total (Wh) U64
        ("e_day_wh",        30517, 4, "U64",    1, 4),  # SMA reg 30517 — E-Day (Wh) U64
        ("alt_e_total_kwh", 30531, 2, "U32",    1, 4),  # SMA reg 30531 — E-Total (kWh) U32
        ("alt_e_day_wh",    30535, 2, "U32",    1, 4),  # SMA reg 30535 — E-Day (Wh) U32
        ("freq_hz",         30803, 2, "U32",  100, 4),  # SMA reg 30803 — Grid freq (0.01Hz)
        ("op_time_s",       30541, 2, "U32",    1, 4),  # SMA reg 30541 — Operating time (s)
        ("dc_current_a",    30769, 2, "U32", 1000, 4),  # SMA reg 30769 — DC current str1 (mA)
        ("dc_voltage_v",    30771, 2, "U32",  100, 4),  # SMA reg 30771 — DC voltage str1 (0.01V)
        ("dc_power_w",      30773, 2, "S32",    1, 4),  # SMA reg 30773 — DC power str1 (W)
        # Cross-FC: registers normally FC03 — check if SB4.x responds via FC04 instead
        ("alt_pac_w_fc4",   30775, 2, "S32",    1, 4),  # SMA reg 30775 via FC04
        ("alt_grid_v_fc4",  30783, 2, "U32",  100, 4),  # SMA reg 30783 via FC04
        ("alt_temp_c_fc4",  30953, 2, "S32",   10, 4),  # SMA reg 30953 via FC04
        # FC04 low-address probes: addr = SMA_reg - 30001 (standard Modbus input reg)
        ("low_pac_w_fc4",      774, 2, "S32",    1, 4),  # SMA reg 30775 at std FC04 addr
        ("low_grid_v_fc4",     782, 2, "U32",  100, 4),  # SMA reg 30783 at std FC04 addr
        ("low_freq_fc4",       802, 2, "U32",  100, 4),  # SMA reg 30803 at std FC04 addr
        ("low_dc_cur_fc4",     768, 2, "U32", 1000, 4),  # SMA reg 30769 at std FC04 addr
        ("low_dc_v_fc4",       770, 2, "U32",  100, 4),  # SMA reg 30771 at std FC04 addr
        ("low_dc_pwr_fc4",     772, 2, "S32",    1, 4),  # SMA reg 30773 at std FC04 addr
        ("low_temp_fc4",       952, 2, "S32",   10, 4),  # SMA reg 30953 at std FC04 addr
        ("low_op_fc4",         540, 2, "U32",    1, 4),  # SMA reg 30541 at std FC04 addr
        ("low_etot_fc4",       530, 2, "U32",    1, 4),  # SMA reg 30531 at std FC04 addr
        ("low_eday_fc4",       534, 2, "U32",    1, 4),  # SMA reg 30535 at std FC04 addr
        ("low_stat_fc4",       200, 2, "U32",    1, 4),  # SMA reg 30201 at std FC04 addr
        ("low_etot64_fc4",     512, 4, "U64",    1, 4),  # SMA reg 30513 U64 at std addr
        ("low_eday64_fc4",     516, 4, "U64",    1, 4),  # SMA reg 30517 U64 at std addr
    ]

    nan_count = 0
    val_count = 0

    def _probe(key, addr, cnt, dtype, scale, fc):
        nonlocal nan_count, val_count
        regs = _read_holding(client, addr, cnt, unit_id) if fc == 3 else _read_input(client, addr, cnt, unit_id)
        if regs is None:
            result["raw"][key] = {"fc": fc, "addr": addr + 1, "status": "read_error"}
            return None
        raw_hex = [f"0x{r:04X}" for r in regs]
        if dtype == "U32":
            parsed = _to_u32(regs, 0)
        elif dtype == "S32":
            parsed = _to_s32(regs, 0)
        else:
            parsed = _to_u64(regs, 0)
        val = round(parsed / scale, 3) if parsed is not None and scale > 1 else parsed
        is_nan = parsed is None
        result["raw"][key] = {"fc": fc, "addr": addr + 1, "regs": raw_hex, "value": val, "nan": is_nan}
        if is_nan:
            nan_count += 1
        elif val is not None:
            val_count += 1
            result[key] = val
        return val

    try:
        for key, addr, cnt, dtype, scale, fc in PROBES_FC03:
            _probe(key, addr, cnt, dtype, scale, fc)
        for key, addr, cnt, dtype, scale, fc in PROBES_FC04:
            _probe(key, addr, cnt, dtype, scale, fc)

        # Prefer alt_status_code if primary status_code not found
        if "status_code" not in result and "alt_status_code" in result:
            result["status_code"] = result["alt_status_code"]
        if "alt_status_code" in result:
            del result["alt_status_code"]

        # Decode status code to label
        if "status_code" in result:
            result["status"] = _STATUS_LABELS.get(int(result["status_code"]), f"Code {result['status_code']}")

        # Night mode: connection OK but no measurement values returned
        # Covers both NaN returns and full READ ERROR situations (Modbus exceptions in standby)
        # Exception: if status indicates device is actively running, measurements are
        # unavailable due to register map mismatch (device model differs from expected).
        measurement_val_keys = {"pac_w", "e_total_wh", "e_day_wh", "grid_v",
                                "freq_hz", "temp_c", "dc_power_w", "dc_voltage_v", "dc_current_a"}
        has_measurements = any(k in result for k in measurement_val_keys)
        status_running = result.get("status_code") in _RUNNING_STATUS_CODES
        if not has_measurements and result.get("online"):
            if status_running:
                result["measurements_unavailable"] = True
                result["measurements_unavailable_msg"] = (
                    f"Omvormer actief ({result.get('status', '?')}) maar meetregisters "
                    "reageren niet. Mogelijk een ander apparaattype dan SB30-50-1AV-40. "
                    "Controleer het exacte SMA-model en het bijbehorende Modbus-registermap."
                )
            else:
                result["night_mode"] = True
                result["night_mode_msg"] = (
                    "Omvormer bereikbaar maar alle meetregisters zijn niet beschikbaar. "
                    "Dit is normaal gedrag van SMA-omvormers in nacht/standby-modus. "
                    "Overdag worden hier live waarden getoond."
                )

    finally:
        client.close()

    return result


# ---------------------------------------------------------------------------
# Main poll
# ---------------------------------------------------------------------------

def _make_client(host: str, port: int, use_udp: bool = False):
    """Return a pymodbus TCP or UDP client based on the use_udp flag."""
    try:
        if use_udp:
            from pymodbus.client import ModbusUdpClient
            return ModbusUdpClient(host=host, port=port, timeout=1)
        else:
            from pymodbus.client import ModbusTcpClient
            return ModbusTcpClient(host=host, port=port, timeout=1)
    except ImportError:
        return None


def _batch_read_registers(client, register_map: list, unit_id: int) -> dict:
    """
    Read all registers in register_map using the fewest possible Modbus requests.

    Registers are sorted by (fc, address) and grouped into batches when consecutive
    registers of the same FC are within MAX_GAP words of each other. Each batch is
    read in a single FC03/FC04 request; individual values are extracted by offset.

    Returns {key: scaled_value_or_None} for every entry in register_map.
    """
    MAX_GAP = 4  # max gap in register words allowed inside a single batch request

    def _word_count(dtype: str) -> int:
        return 4 if dtype == "U64" else 2

    # Sort by FC then by address so consecutive registers are adjacent
    sorted_regs = sorted(register_map, key=lambda r: (r["fc"], r["reg"]))

    # Build batches: list of [reg_conf, ...]
    batches: list[list[dict]] = []
    current: list[dict] = []
    for reg_conf in sorted_regs:
        if not current:
            current = [reg_conf]
            continue
        prev = current[-1]
        prev_end = prev["reg"] + _word_count(prev.get("dtype", "U32"))
        this_start = reg_conf["reg"]
        if reg_conf["fc"] == prev["fc"] and (this_start - prev_end) <= MAX_GAP:
            current.append(reg_conf)
        else:
            batches.append(current)
            current = [reg_conf]
    if current:
        batches.append(current)

    results: dict = {}

    for batch in batches:
        fc = batch[0]["fc"]
        first_addr = batch[0]["reg"]
        last_conf = batch[-1]
        last_addr = last_conf["reg"]
        total_count = last_addr + _word_count(last_conf.get("dtype", "U32")) - first_addr

        regs = _read_holding(client, first_addr, total_count, unit_id) if fc == 3 \
               else _read_input(client, first_addr, total_count, unit_id)

        for reg_conf in batch:
            key = reg_conf["key"]
            if regs is None:
                results[key] = None
                continue
            offset = reg_conf["reg"] - first_addr
            dtype  = reg_conf.get("dtype", "U32")
            if dtype == "U32":
                raw = _to_u32(regs, offset)
            elif dtype == "S32":
                raw = _to_s32(regs, offset)
            else:
                raw = _to_u64(regs, offset)
            if raw is None:
                results[key] = None
            else:
                mult = float(reg_conf.get("mult", 1.0))
                if mult < 1.0:
                    results[key] = round(
                        raw * mult,
                        max(1, len(str(mult).rstrip("0").split(".")[-1])),
                    )
                else:
                    results[key] = raw * mult if mult != 1.0 else raw

    return results


def _poll(host: str, port: int, unit_id: int, use_udp: bool = False, register_map=None) -> dict:
    """
    Open a Modbus TCP (or UDP) connection to the SMA inverter, read all registers,
    and return a parsed dict. The connection is closed before returning.

    register_map: list of register config dicts (see _DEFAULT_REGISTER_MAP).
    If None, uses _DEFAULT_REGISTER_MAP.
    SMA uses 1-based Modbus addressing: register number == Modbus address.
    """
    if register_map is None:
        register_map = _DEFAULT_REGISTER_MAP

    client = _make_client(host, port, use_udp)
    if client is None:
        log.error("pymodbus niet geïnstalleerd")
        return {"online": False}

    if not client.connect():
        log.warning("SMA Modbus: kan niet verbinden met %s:%d (udp=%s)", host, port, use_udp)
        return {"online": False}

    data: dict = {"online": True}
    try:
        # Read all configured measurement registers in batches to minimise the number
        # of Modbus round trips (and therefore the TCP session hold time, which matters
        # when another client such as Loxone also polls the same inverter).
        # Always write every key (None on failure) so the cache merge never retains
        # stale values from a previous poll.
        data.update(_batch_read_registers(client, register_map, unit_id))

        # Device status — always set (None if unreadable) so cache never shows a stale
        # status_code from a prior poll alongside a contradictory night_mode from this one.
        code = _read_status(client, unit_id)
        data["status_code"] = code
        data["status"] = _STATUS_LABELS.get(code, f"Code {code}") if code is not None else None

        # Night/standby mode: TCP connected but all measurement registers return
        # Modbus exceptions. Normal SMA behavior during darkness/standby.
        # Exception: if status says device is actively running, it's a register map
        # mismatch — measurements are unavailable but device is not in night mode.
        measurement_keys = ("pac_w", "e_day_wh", "e_total_wh", "grid_v",
                            "freq_hz", "temp_c", "dc_power_w", "dc_voltage_v", "dc_current_a")
        has_values = any(data.get(k) is not None for k in measurement_keys)
        status_running = data.get("status_code") in _RUNNING_STATUS_CODES
        data["night_mode"] = not has_values and not status_running
        data["measurements_unavailable"] = not has_values and status_running
        if not has_values and status_running:
            log.warning(
                "SMA status=%s maar meetregisters reageren niet — "
                "controleer of het apparaattype overeenkomt met het registermap",
                data.get("status"),
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
    "offline_since":    None,
    "offline_notified": False,
    "last_error_code":  None,
    "day_summary_sent_date": None,
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
    if online and code is not None and code == 1392:
        if _alert_state["last_error_code"] != code:
            _notify("sma_error", {
                "message": f"SMA foutcode: {code} ({result.get('status', '?')})",
            })
            _alert_state["last_error_code"] = code
    elif code != 1392:
        _alert_state["last_error_code"] = None

    # ── Day summary (sent once per day when pac drops to 0) ──────────────────
    if online:
        pac = result.get("pac_w") or 0
        today = str(_date.today())
        if pac == 0 and _alert_state["day_summary_sent_date"] != today:
            e_day = result.get("e_day_wh")
            if e_day is not None and e_day > 100:
                kwh = round(e_day / 1000, 2)
                _notify("sma_day_summary", {
                    "message": f"SMA dagopbrengst: {kwh} kWh",
                    "e_day_wh": e_day,
                })
                _alert_state["day_summary_sent_date"] = today


_POLL_RETRY_DELAY = 2   # seconds between retry attempts when measurements missing
_POLL_MAX_RETRIES = 2   # extra attempts if all measurements are None (connection conflict)


def _reader_loop(get_settings_fn, interval: int) -> None:
    log.info("SMA Modbus reader gestart  interval=%ds", interval)
    while True:
        try:
            s = get_settings_fn()
            if not s.get("sma_reader_enabled"):
                time.sleep(interval)
                continue
            host         = (s.get("sma_reader_host") or "").strip()
            port         = int(s.get("sma_reader_port", 502))
            unit_id      = int(s.get("sma_reader_unit_id", 3))
            use_udp      = bool(s.get("sma_reader_use_udp", False))
            register_map = s.get("sma_reader_registers") or None
            if not host:
                time.sleep(interval)
                continue

            result = _poll(host, port, unit_id, use_udp=use_udp, register_map=register_map)

            # Retry when device is online but all measurements failed — typically a
            # simultaneous Modbus TCP session held by another client (e.g. Loxone).
            # A short pause lets the other client finish its cycle.
            # Skip retries when night_mode or measurements_unavailable: retrying won't help
            # (standby state or register map mismatch — not a transient session conflict).
            measurement_keys = ("pac_w", "e_day_wh", "e_total_wh", "grid_v", "freq_hz")
            for attempt in range(_POLL_MAX_RETRIES):
                has_data = any(result.get(k) is not None for k in measurement_keys)
                if has_data or not result.get("online"):
                    break
                if result.get("night_mode") or result.get("measurements_unavailable"):
                    break
                log.debug("SMA meetregisters leeg, retry %d/%d na %ds",
                          attempt + 1, _POLL_MAX_RETRIES, _POLL_RETRY_DELAY)
                time.sleep(_POLL_RETRY_DELAY)
                result = _poll(host, port, unit_id, use_udp=use_udp, register_map=register_map)

            _update_cache(result)
            _check_alerts(result)
            log.debug(
                "SMA live  pac=%sW  e_day=%sWh  status=%s  night=%s",
                result.get("pac_w"), result.get("e_day_wh"),
                result.get("status"), result.get("night_mode"),
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


# ---------------------------------------------------------------------------
# Modbus register scanner
# ---------------------------------------------------------------------------

# Well-known SMA register labels (1-based) — SB30-50-1AV-40 register map
_KNOWN_REGS: dict[int, str] = {
    # SMA SB30-50-1AV-40 register map (primary)
    30201: "Apparaatstatus (ENUM)",
    30233: "Foutcode (ENUM)",
    30513: "E-Total — totaalopbrengst (Wh, U64)",
    30517: "E-Day — dagopbrengst (Wh, U64)",
    30521: "E-Total alternatief (Wh, U64)",
    30541: "Bedrijfstijd (s, U32)",
    30769: "DC stroom string 1 (mA, U32)",
    30771: "DC spanning string 1 (0.01V, U32)",
    30773: "DC vermogen string 1 (W, S32)",
    30775: "Pac — AC vermogen (W, S32)",
    30783: "Uac L1 — netspanning (0.01V, U32)",
    30803: "Netfrequentie (0.01Hz, U32)",
    30813: "Uac L2 — netspanning fase 2 (0.01V, U32)",
    30823: "Uac L3 — netspanning fase 3 (0.01V, U32)",
    30953: "Interne temperatuur (0.1°C, S32)",
    40185: "Max schijnbaar vermogen (VA)",
    40236: "WMaxLimPct — vermogenslimiet (%)",
    42062: "WMaxLim — PV limiter absolute (W)",
    # Alternate register addresses (SBx-1AV-40 older firmware — confirmed via Loxone config)
    30202: "Apparaatstatus hoog-word alt (ENUM, U32 hoog)",
    30203: "Apparaatstatus alt (ENUM, U32 laag of U16)",
    30205: "Nominaal AC-vermogen alt (W)",
    30531: "E-Total alt — totaalopbrengst (kWh, U32)",
    30535: "E-Day alt — dagopbrengst (Wh, U32)",
}

# SMA register ranges worth scanning (start_addr_0based, count, fc)
_SCAN_RANGES = [
    # Standard SMA SB30-50 / SunSpec measurement range
    (30000, 1000, 4),   # FC04: 30001–31000 — main measurement block
    (30000, 1000, 3),   # FC03: 30001–31000 — same range via holding
    # Low-address range: standard Modbus input registers (SMA reg 30775 = FC04 addr 774)
    (   0, 1000, 4),    # FC04:    1–1000  — standard input register addressing
    (   0, 1000, 3),    # FC03:    1–1000  — standard holding register addressing
    # Extended 31000-40000 gap (not in standard docs, may contain alt measurement map)
    (31000, 2000, 4),   # FC04: 31001–33000 — extended FC04 range
    (31000, 2000, 3),   # FC03: 31001–33000 — extended FC03 range
    # Control registers
    (40000,  500, 3),   # FC03: 40001–40500 — control registers
    (40000,  500, 4),   # FC04: 40001–40500 — same via input registers
    (40900,  200, 3),   # FC03: 40901–41100 — extended control
    (42000,  100, 3),   # FC03: 42001–42100 — WMaxLim area
]

_BLOCK = 10  # registers per read attempt


def scan_registers(host: str, port: int, unit_id: int,
                   progress_cb=None, use_udp: bool = False) -> list[dict]:
    """
    Scan all SMA register ranges via FC03 and FC04.
    Returns a list of dicts for every register address that returned a
    non-NaN, non-error value.

    progress_cb(done, total) is called after each block if provided.
    This call is synchronous and may take 30–90 seconds.
    use_udp=True uses Modbus over UDP instead of TCP (connectionless, no session conflict).
    """
    client = _make_client(host, port, use_udp=use_udp)
    if client is None:
        return []
    if not client.connect():
        return []

    found: list[dict] = []
    total_blocks = sum((count // _BLOCK + 1) for _, count, _ in _SCAN_RANGES)
    done_blocks  = 0

    try:
        for range_start, range_count, fc in _SCAN_RANGES:
            addr = range_start
            end  = range_start + range_count
            while addr < end:
                batch = min(_BLOCK, end - addr)
                try:
                    if fc == 3:
                        result = client.read_holding_registers(
                            address=addr, count=batch, device_id=unit_id
                        )
                    else:
                        result = client.read_input_registers(
                            address=addr, count=batch, device_id=unit_id
                        )
                    if not (hasattr(result, "isError") and result.isError()):
                        regs = result.registers
                        for i, raw in enumerate(regs):
                            reg_1based = addr + i + 1
                            if raw in (0xFFFF, 0x8000, 0xFFFFFFFF, 0x80000000):
                                continue  # NaN sentinel
                            # Compute U32/S32 from this word + the next word in the block
                            u32 = s32 = None
                            if i + 1 < len(regs):
                                combined = (raw << 16) | regs[i + 1]
                                if combined not in (_SMA_U32_NAN, _SMA_S32_NAN):
                                    u32 = combined
                                    s32 = struct.unpack(">i", struct.pack(">I", combined))[0]
                            found.append({
                                "reg":   reg_1based,
                                "addr":  addr + i,
                                "fc":    fc,
                                "raw":   raw,
                                "hex":   f"0x{raw:04X}",
                                "u32":   u32,
                                "s32":   s32,
                                "label": _KNOWN_REGS.get(reg_1based, ""),
                            })
                except Exception:
                    pass
                addr += batch
                done_blocks += 1
                if progress_cb:
                    progress_cb(done_blocks, total_blocks)
    finally:
        client.close()

    # Deduplicate: keep first occurrence per (reg, fc)
    seen: set = set()
    unique: list[dict] = []
    for item in found:
        key = (item["reg"], item["fc"])
        if key not in seen:
            seen.add(key)
            unique.append(item)

    return sorted(unique, key=lambda x: (x["reg"], x["fc"]))
