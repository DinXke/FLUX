#!/usr/bin/env python3
"""
sma_diag.py — Directe Modbus-diagnostics voor SMA Sunny Boy (SCH-775).

Gebruik:
  python3 sma_diag.py [host] [port] [unit_id]

Standaard: 192.168.255.142 502 3

Draai dit in de FLUX-container:
  docker exec -it smartmarstek python3 /app/sma_diag.py
"""
import struct, sys, time
from typing import Optional

HOST    = sys.argv[1] if len(sys.argv) > 1 else "192.168.255.142"
PORT    = int(sys.argv[2]) if len(sys.argv) > 2 else 502
UNIT    = int(sys.argv[3]) if len(sys.argv) > 3 else 3
TIMEOUT = 2

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    print("pymodbus niet gevonden — pip install pymodbus")
    sys.exit(1)

client = ModbusTcpClient(host=HOST, port=PORT, timeout=TIMEOUT)
if not client.connect():
    print(f"VERBINDING MISLUKT: {HOST}:{PORT}")
    sys.exit(1)

print(f"Verbonden met {HOST}:{PORT}  unit_id={UNIT}\n")

# ─── Unit ID scan: probeer status + pac_w op alle gangbare unit IDs ───────────
print("══ UNIT-ID SCAN (welk unit_id geeft meetwaarden?) ═══════════════════════")
for uid in (1, 2, 3, 4, 126, 255):
    regs3 = None
    try:
        r = client.read_holding_registers(address=30200, count=2, device_id=uid)
        if not (hasattr(r, "isError") and r.isError()): regs3 = r.registers
    except Exception: pass

    pac3 = None
    try:
        r = client.read_holding_registers(address=30774, count=2, device_id=uid)
        if not (hasattr(r, "isError") and r.isError()):
            v = (r.registers[0] << 16) | r.registers[1]
            if v != 0x80000000: pac3 = struct.unpack(">i", struct.pack(">I", v))[0]
    except Exception: pass

    pac4 = None
    try:
        r = client.read_input_registers(address=30774, count=2, device_id=uid)
        if not (hasattr(r, "isError") and r.isError()):
            v = (r.registers[0] << 16) | r.registers[1]
            if v != 0x80000000: pac4 = struct.unpack(">i", struct.pack(">I", v))[0]
    except Exception: pass

    status_raw = None
    if regs3:
        v = (regs3[0] << 16) | regs3[1]
        status_raw = v if v != 0xFFFFFFFF else None

    ok = status_raw is not None or pac3 is not None or pac4 is not None
    flag = " ← WERKT" if ok else ""
    print(f"  uid={uid:3d}  status={status_raw!s:>6}  pac_w FC03={pac3!s:>8}  pac_w FC04={pac4!s:>8}{flag}")

client.close()
print()

# Herverbinden met geconfigureerde unit_id voor de rest van de tests
client = ModbusTcpClient(host=HOST, port=PORT, timeout=TIMEOUT)
if not client.connect():
    print("Herverbinding mislukt"); sys.exit(1)

def _r(fc: int, addr: int, count: int = 2) -> Optional[list]:
    fn = client.read_holding_registers if fc == 3 else client.read_input_registers
    try:
        res = fn(address=addr, count=count, device_id=UNIT)
        if hasattr(res, "isError") and res.isError():
            return None
        return res.registers
    except Exception:
        return None

def _hex(regs) -> str:
    return " ".join(f"0x{r:04X}" for r in regs) if regs else "ERR"

def _u32(regs) -> Optional[int]:
    if not regs or len(regs) < 2: return None
    v = (regs[0] << 16) | regs[1]
    return None if v == 0xFFFFFFFF else v

def _s32(regs) -> Optional[int]:
    if not regs or len(regs) < 2: return None
    v = (regs[0] << 16) | regs[1]
    if v == 0x80000000: return None
    return struct.unpack(">i", struct.pack(">I", v))[0]

def _u64(regs) -> Optional[int]:
    if not regs or len(regs) < 4: return None
    v = (regs[0] << 48) | (regs[1] << 32) | (regs[2] << 16) | regs[3]
    return None if v == 0x8000000000000000 else v

STATUS_LABELS = {303:"Uit", 307:"Netinvoer", 308:"Wacht op net",
                 381:"Stop", 455:"Vermogen beperkt", 1392:"Fout"}

def probe(label: str, fc: int, addr: int, dtype: str, mult: float = 1.0,
          unit_str: str = "", count: int = 2):
    regs = _r(fc, addr, count)
    if regs is None:
        tag = "READ_ERROR"
        val = None
    else:
        raw_hex = _hex(regs)
        if dtype == "U32":   raw = _u32(regs)
        elif dtype == "S32": raw = _s32(regs)
        elif dtype == "U64": raw = _u64(regs)
        else:                raw = None
        if raw is None:
            tag = f"NaN      [{raw_hex}]"
        else:
            scaled = raw * mult
            tag = f"{scaled:>12.3f} {unit_str}  [{raw_hex}]"
        val = raw
    fc_str = f"FC0{fc}"
    print(f"  {fc_str}  reg {addr+1:5d}  {label:<30s}  {tag}")
    return val

# ─────────────────────────────────────────────────────────────────────────────
print("══ STATUS ═══════════════════════════════════════════════════════════════")
for addr in (30200, 30201, 30202):
    regs = _r(3, addr, 2)
    v = _u32(regs)
    label = STATUS_LABELS.get(v, f"Code {v}") if v else "—"
    print(f"  FC03  reg {addr+1:5d}  status                           {_hex(regs)}  → {label}")

# ─────────────────────────────────────────────────────────────────────────────
print("\n══ AC VERMOGEN (pac_w, reg 30775, S32) — beide FC's ════════════════════")
probe("pac_w FC03", 3, 30774, "S32", 1, "W")
probe("pac_w FC04", 4, 30774, "S32", 1, "W")

print("\n══ NETSPANNING (grid_v, reg 30783, U32) ════════════════════════════════")
probe("grid_v FC03", 3, 30782, "U32", 0.01, "V")
probe("grid_v FC04", 4, 30782, "U32", 0.01, "V")

print("\n══ NETFREQUENTIE (freq_hz, reg 30803, U32) ═════════════════════════════")
probe("freq_hz FC03", 3, 30802, "U32", 0.01, "Hz")
probe("freq_hz FC04", 4, 30802, "U32", 0.01, "Hz")

print("\n══ DC SPANNING string 1 (reg 30771, U32) ═══════════════════════════════")
probe("dc_voltage FC03", 3, 30770, "U32", 0.01, "V")
probe("dc_voltage FC04", 4, 30770, "U32", 0.01, "V")

print("\n══ DC STROOM string 1 (reg 30769, U32) ═════════════════════════════════")
probe("dc_current FC03", 3, 30768, "U32", 0.001, "A")
probe("dc_current FC04", 4, 30768, "U32", 0.001, "A")

print("\n══ DC VERMOGEN string 1 (reg 30773, S32) ═══════════════════════════════")
probe("dc_power FC03", 3, 30772, "S32", 1, "W")
probe("dc_power FC04", 4, 30772, "S32", 1, "W")

print("\n══ DAGOPBRENGST (reg 30535, U32) ═══════════════════════════════════════")
probe("e_day FC03", 3, 30534, "U32", 1, "Wh")
probe("e_day FC04", 4, 30534, "U32", 1, "Wh")

print("\n══ TOTAALOPBRENGST alt (reg 30531, U32 kWh) ════════════════════════════")
probe("e_total_kwh FC03", 3, 30530, "U32", 1000, "Wh")
probe("e_total_kwh FC04", 4, 30530, "U32", 1000, "Wh")

print("\n══ TOTAALOPBRENGST U64 (reg 30513, U64 Wh) ═════════════════════════════")
probe("e_total_u64 FC03", 3, 30512, "U64", 1, "Wh", count=4)
probe("e_total_u64 FC04", 4, 30512, "U64", 1, "Wh", count=4)

print("\n══ INTERNE TEMP (reg 30953, S32) ═══════════════════════════════════════")
probe("temp_c FC03", 3, 30952, "S32", 0.1, "°C")
probe("temp_c FC04", 4, 30952, "S32", 0.1, "°C")

print("\n══ BEDRIJFSTIJD (reg 30541, U32 s) ═════════════════════════════════════")
probe("op_time FC03", 3, 30540, "U32", 1, "s")
probe("op_time FC04", 4, 30540, "U32", 1, "s")

print("\n══ PV LIMITER (reg 42062, U32 W) ═══════════════════════════════════════")
probe("wmax_lim FC03", 3, 42061, "U32", 1, "W")

# ─────────────────────────────────────────────────────────────────────────────
print("\n══ MINI-SCAN FC03 30000-30050 (blokken van 10) ══════════════════════════")
for base in range(30000, 30050, 10):
    regs = _r(3, base, 10)
    if regs:
        nonzero = [(base+i+1, r) for i, r in enumerate(regs)
                   if r not in (0, 0xFFFF, 0x8000)]
        if nonzero:
            for reg, raw in nonzero:
                print(f"  FC03  reg {reg:5d}  raw=0x{raw:04X} ({raw})")

print("\n══ MINI-SCAN FC04 30500-30560 ════════════════════════════════════════════")
for base in range(30500, 30560, 10):
    regs = _r(4, base, 10)
    if regs:
        nonzero = [(base+i+1, r) for i, r in enumerate(regs)
                   if r not in (0, 0xFFFF, 0x8000)]
        if nonzero:
            for reg, raw in nonzero:
                print(f"  FC04  reg {reg:5d}  raw=0x{raw:04X} ({raw})")

print("\n══ MINI-SCAN FC03 30750-30830 ════════════════════════════════════════════")
for base in range(30750, 30830, 10):
    regs = _r(3, base, 10)
    if regs:
        nonzero = [(base+i+1, r) for i, r in enumerate(regs)
                   if r not in (0, 0xFFFF, 0x8000)]
        if nonzero:
            for reg, raw in nonzero:
                print(f"  FC03  reg {reg:5d}  raw=0x{raw:04X} ({raw})")

print("\n══ MINI-SCAN FC04 30750-30830 ════════════════════════════════════════════")
for base in range(30750, 30830, 10):
    regs = _r(4, base, 10)
    if regs:
        nonzero = [(base+i+1, r) for i, r in enumerate(regs)
                   if r not in (0, 0xFFFF, 0x8000)]
        if nonzero:
            for reg, raw in nonzero:
                print(f"  FC04  reg {reg:5d}  raw=0x{raw:04X} ({raw})")

client.close()
print("\nKlaar.")
