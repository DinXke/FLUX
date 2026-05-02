import { apiFetch } from "../auth.js";
import { useState, useEffect, useCallback } from "react";
import { loadFlowCfg } from "./FlowSourcesSettings.jsx";

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  house:   "#22d3ee",
  solar:   "#fbbf24",
  grid:    "#c084fc",
  battery: "#34d399",
  ev:      "#60a5fa",
};

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(w, sign = false) {
  if (w == null) return "—";
  const abs = Math.abs(w);
  const s = sign && w > 0 ? "+" : "";
  if (abs >= 1000) return `${s}${(w / 1000).toFixed(2)} kW`;
  return `${s}${Math.round(w)} W`;
}
function fmtPct(v) { return v == null ? null : `${v.toFixed(0)}%`; }
function flowSpeed(power) {
  const abs = Math.abs(power ?? 0);
  if (abs < 50)   return "2.5s";
  if (abs < 500)  return "1.8s";
  if (abs < 2000) return "1.2s";
  return "0.7s";
}

// ── Data resolution ───────────────────────────────────────────────────────────
function resolveOne(sc, batteries, hwData, haData, influxLive, smaLive) {
  if (sc.source === "esphome") {
    const b = batteries.find((x) => x.id === sc.device_id);
    const v = b?.[sc.sensor];
    return v == null ? null : sc.invert ? -v : v;
  }
  if (sc.source === "homewizard") {
    const dev = hwData?.devices?.find((d) => d.id === sc.device_id);
    const s = dev?.sensors?.[sc.sensor];
    return s?.value == null ? null : sc.invert ? -s.value : s.value;
  }
  if (sc.source === "homeassistant") {
    const e = haData?.[sc.sensor];
    return e?.value == null ? null : sc.invert ? -e.value : e.value;
  }
  if (sc.source === "influx") {
    const v = influxLive?.[sc.sensor];
    return v == null ? null : sc.invert ? -v : v;
  }
  if (sc.source === "sma_reader") {
    const v = smaLive?.pac_w;
    return v == null ? null : sc.invert ? -v : v;
  }
  return null;
}

function resolveSlot(key, cfg, batteries, hwData, haData, influxLive, smaLive) {
  let sc = cfg?.[key];
  if (!sc) return null;
  if (!Array.isArray(sc)) sc = [sc];
  const isAvg = key === "bat_soc";
  let total = null, count = 0;
  for (const s of sc) {
    const v = resolveOne(s, batteries, hwData, haData, influxLive, smaLive);
    if (v != null) { total = (total ?? 0) + v; count++; }
  }
  if (total == null) return null;
  return isAvg && count > 0 ? total / count : total;
}

// ── Node card (rounded rectangle) ─────────────────────────────────────────────
function NodeCard({ cx, cy, w, h, icon, label, power, color, active, soc, socColor, detail, detailColor }) {
  const x = cx - w / 2, y = cy - h / 2;
  const hasSoc = soc != null;
  const powerFrac = hasSoc ? 0.37 : 0.44;

  return (
    <g>
      {/* Glow halo */}
      {active && (
        <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx={16}
          fill="none" stroke={color} strokeWidth={10}
          opacity={0.12} filter="url(#em-glow)" />
      )}
      {/* Card background */}
      <rect x={x} y={y} width={w} height={h} rx={13}
        fill={active ? color + "12" : "var(--bg-card-inner)"}
        stroke={active ? color : "var(--border)"}
        strokeWidth={active ? 2 : 1.2} />

      {/* Icon */}
      <text x={cx} y={y + h * 0.22} textAnchor="middle" dominantBaseline="middle"
        fontSize={h >= 130 ? 26 : 22} style={{ userSelect: "none" }}>{icon}</text>

      {/* Power — dominant */}
      <text x={cx} y={y + h * powerFrac} textAnchor="middle" dominantBaseline="middle"
        fill={active ? color : "var(--text-dim)"}
        fontSize={h >= 130 ? 22 : 19}
        fontWeight="800"
        fontFamily="'Courier New',Courier,monospace">
        {fmt(power)}
      </text>

      {/* SOC bar (battery only) */}
      {hasSoc && (() => {
        const bw = w - 28, bh = 5;
        const bx = x + 14, by = y + h * 0.54;
        const filled = Math.max(0, Math.min(1, soc / 100)) * bw;
        return (
          <g>
            <rect x={bx} y={by} width={bw} height={bh} rx={2.5}
              fill="rgba(0,0,0,0.45)" />
            <rect x={bx} y={by} width={filled} height={bh} rx={2.5}
              fill={socColor} filter="url(#em-glow)" />
            <text x={cx} y={y + h * 0.67} textAnchor="middle" dominantBaseline="middle"
              fill={socColor} fontSize={11} fontWeight="700"
              fontFamily="Inter,system-ui,sans-serif">{fmtPct(soc)}</text>
          </g>
        );
      })()}

      {/* Detail label */}
      {detail && (
        <text x={cx} y={y + h * 0.82} textAnchor="middle" dominantBaseline="middle"
          fill={detailColor || "var(--text-dim)"} fontSize={10}
          fontFamily="Inter,system-ui,sans-serif">{detail}</text>
      )}

      {/* Bottom label */}
      <text x={cx} y={y + h * 0.93} textAnchor="middle" dominantBaseline="middle"
        fill="var(--text-muted)" fontSize={10} letterSpacing="1.5"
        fontFamily="Inter,system-ui,sans-serif">{label}</text>
    </g>
  );
}

// ── Animated connection line ───────────────────────────────────────────────────
function ConnLine({ x1, y1, x2, y2, color, active, reverse, power }) {
  const dur = flowSpeed(power);
  const horiz = Math.abs(x2 - x1) > Math.abs(y2 - y1);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const lx = horiz ? mx : mx + 46;
  const ly = horiz ? my - 20 : my;
  const label = active && power != null ? fmt(Math.abs(power)) : null;
  const tw = label ? Math.max(label.length * 8.5 + 16, 52) : 0;

  return (
    <g>
      {/* Track */}
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke="var(--border)" strokeWidth={6} strokeLinecap="round" />
      {/* Animated dots */}
      {active && (
        <line x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={color} strokeWidth={3.5}
          strokeDasharray="12 9" strokeLinecap="round"
          opacity={0.88} filter="url(#em-glow)">
          <animate attributeName="stroke-dashoffset"
            from={reverse ? "0" : "84"} to={reverse ? "84" : "0"}
            dur={dur} repeatCount="indefinite" />
        </line>
      )}
      {/* Power pill */}
      {label && (
        <g>
          <rect x={lx - tw / 2} y={ly - 11} width={tw} height={22}
            fill="var(--bg-card)" stroke={color} strokeWidth={1.3} rx={11} />
          <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
            fill={color} fontSize={11.5} fontWeight="700"
            fontFamily="'Courier New',Courier,monospace">{label}</text>
        </g>
      )}
    </g>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EnergyMap({ batteries = [], phaseVoltages, acVoltage }) {
  const [hwData,     setHwData]     = useState(null);
  const [haData,     setHaData]     = useState({});
  const [influxLive, setInfluxLive] = useState({});
  const [smaLive,    setSmaLive]    = useState({});
  const [cfg,        setCfg]        = useState(() => loadFlowCfg());

  useEffect(() => {
    const refresh = () => setCfg(loadFlowCfg());
    window.addEventListener("marstek_flow_cfg_changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("marstek_flow_cfg_changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const pollHw = useCallback(async () => {
    try {
      const r = await apiFetch("api/homewizard/data");
      if (r.ok) setHwData(await r.json());
    } catch {}
  }, []);

  const pollHa = useCallback(async (currentCfg) => {
    const ids = Object.values(currentCfg).flat()
      .filter((sc) => sc?.source === "homeassistant" && sc.sensor)
      .map((sc) => sc.sensor);
    if (!ids.length) return;
    try {
      const r = await apiFetch("api/ha/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_ids: ids }),
      });
      if (r.ok) setHaData(await r.json());
    } catch {}
  }, []);

  const pollInflux = useCallback(async (currentCfg) => {
    const hasInflux = Object.values(currentCfg).flat().some((sc) => sc?.source === "influx");
    if (!hasInflux) return;
    try {
      const r = await apiFetch("api/influx/live-slots");
      if (r.ok) setInfluxLive(await r.json());
    } catch {}
  }, []);

  const pollSma = useCallback(async (currentCfg) => {
    const hasSma = Object.values(currentCfg).flat().some((sc) => sc?.source === "sma_reader");
    if (!hasSma) return;
    try {
      const r = await apiFetch("api/sma/live");
      if (r.ok) setSmaLive(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    pollHw(); pollHa(cfg); pollInflux(cfg); pollSma(cfg);
    const id = setInterval(() => { pollHw(); pollHa(cfg); pollInflux(cfg); pollSma(cfg); }, 10000);
    return () => clearInterval(id);
  }, [pollHw, pollHa, pollInflux, pollSma, cfg]);

  // ── ESPHome aggregates ─────────────────────────────────────────────────────
  let totalAc = null, totalBat = null;
  for (const b of batteries) {
    if (b.acPower  != null) totalAc  = (totalAc  ?? 0) + b.acPower;
    if (b.batPower != null) totalBat = (totalBat ?? 0) + b.batPower;
  }
  const socsWithData = batteries.map((b) => b.soc).filter((v) => v != null);
  const avgSoc = socsWithData.length > 0
    ? socsWithData.reduce((a, v) => a + v, 0) / socsWithData.length : null;

  // ── Slot resolution ────────────────────────────────────────────────────────
  const solarPower  = resolveSlot("solar_power", cfg, batteries, hwData, haData, influxLive, smaLive);
  const netPowerRaw = resolveSlot("net_power",   cfg, batteries, hwData, haData, influxLive, smaLive);
  const batPowerRaw = resolveSlot("bat_power",   cfg, batteries, hwData, haData, influxLive, smaLive);
  const batSoc      = resolveSlot("bat_soc",     cfg, batteries, hwData, haData, influxLive, smaLive) ?? avgSoc;
  const evPower     = resolveSlot("ev_power",    cfg, batteries, hwData, haData, influxLive, smaLive);
  const v1 = resolveSlot("voltage_l1", cfg, batteries, hwData, haData, influxLive, smaLive);
  const v2 = resolveSlot("voltage_l2", cfg, batteries, hwData, haData, influxLive, smaLive);
  const v3 = resolveSlot("voltage_l3", cfg, batteries, hwData, haData, influxLive, smaLive);

  // ── Sign convention ────────────────────────────────────────────────────────
  // netDisplayPower: positive = export to grid
  const netDisplayPower = netPowerRaw != null ? -netPowerRaw : totalAc;
  // batDisplayPower: positive = discharging
  const batDisplayPower = batPowerRaw ?? totalBat;
  const housePower = (netDisplayPower != null || batDisplayPower != null || solarPower != null)
    ? (batDisplayPower ?? 0) - (netDisplayPower ?? 0) + (solarPower ?? 0) - (evPower ?? 0)
    : null;

  const showSolar = !!(Array.isArray(cfg.solar_power) ? cfg.solar_power.length > 0 : cfg.solar_power)
    || solarPower != null;
  const showEv = Array.isArray(cfg.ev_power) ? cfg.ev_power.length > 0 : !!cfg.ev_power;

  // Check if SMA is configured as solar source
  const hasSmaReader = cfg?.solar_power && (Array.isArray(cfg.solar_power)
    ? cfg.solar_power.some((sc) => sc?.source === "sma_reader")
    : cfg.solar_power?.source === "sma_reader");

  // Detect solar power limit: status_code === 455 or wmax_lim_w < pac_w (99% threshold)
  const solarLimited = hasSmaReader && (
    smaLive?.status_code === 455 ||
    (smaLive?.wmax_lim_w != null && smaLive?.pac_w != null && smaLive.wmax_lim_w < smaLive.pac_w * 0.99)
  );

  // ── Flow states ────────────────────────────────────────────────────────────
  const netActive   = netDisplayPower != null && Math.abs(netDisplayPower) > 5;
  const netToGrid   = (netDisplayPower ?? 0) > 0;
  const netColor    = netActive ? (netToGrid ? "#22c55e" : "#ef4444") : "#334155";

  const batActive   = batDisplayPower != null && Math.abs(batDisplayPower) > 5;
  const batDisch    = (batDisplayPower ?? 0) > 0;
  const batColor    = batActive ? (batDisch ? "#f59e0b" : "#3b82f6") : "#334155";

  const solarActive = solarPower != null && solarPower > 10;
  const solarColor  = solarLimited ? "#f97316" : C.solar;
  const evActive    = evPower    != null && evPower    > 10;

  const socColor    = batSoc == null ? "#475569"
    : batSoc < 20 ? "#ef4444" : batSoc < 50 ? "#f59e0b" : "#22c55e";

  // ── Phase voltages ─────────────────────────────────────────────────────────
  const ePV = (v1 != null || v2 != null || v3 != null)
    ? { L1: v1 ?? phaseVoltages?.L1, L2: v2 ?? phaseVoltages?.L2, L3: v3 ?? phaseVoltages?.L3 }
    : phaseVoltages;
  const phaseStr = ePV
    ? [
        ePV.L1 != null ? `L1:${ePV.L1.toFixed(0)}V` : null,
        ePV.L2 != null ? `L2:${ePV.L2.toFixed(0)}V` : null,
        ePV.L3 != null ? `L3:${ePV.L3.toFixed(0)}V` : null,
      ].filter(Boolean).join("  ")
    : acVoltage != null ? `${acVoltage.toFixed(1)} V` : null;

  // ── Layout ─────────────────────────────────────────────────────────────────
  const W = 860;
  const H = showEv ? 520 : 440;
  const hubCY = showEv ? 250 : 230;

  const cHUB  = { cx: 430, cy: hubCY };
  const cGRID = { cx: 95,  cy: hubCY };
  const cBAT  = { cx: 765, cy: hubCY };
  const cSOL  = { cx: 430, cy: 68 };
  const cEV   = { cx: 430, cy: showEv ? H - 68 : 0 };

  const wHub = 168, hHub = 136;
  const wSat = 150, hSat = 124;
  const wSol = 148, hSol = 114;
  const wEv  = 142, hEv  = 114;

  // Connection endpoints (node edge → node edge)
  const gridLine = {
    x1: cGRID.cx + wSat / 2, y1: cGRID.cy,
    x2: cHUB.cx  - wHub / 2, y2: cHUB.cy,
  };
  const batLine = {
    x1: cHUB.cx  + wHub / 2, y1: cHUB.cy,
    x2: cBAT.cx  - wSat / 2, y2: cBAT.cy,
  };
  const solLine = {
    x1: cSOL.cx, y1: cSOL.cy + hSol / 2,
    x2: cHUB.cx, y2: cHUB.cy - hHub / 2,
  };
  const evLine = {
    x1: cHUB.cx, y1: cHUB.cy + hHub / 2,
    x2: cEV.cx,  y2: cEV.cy  - hEv  / 2,
  };

  return (
    <div className="energy-map-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="energy-map-svg"
        aria-label="Energie stroomoverzicht">
        <defs>
          <filter id="em-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="em-bg" cx="50%" cy="50%" r="65%">
            <stop offset="0%"   stopColor="rgba(20,30,48,0)" />
            <stop offset="100%" stopColor="rgba(8,12,24,0.6)" />
          </radialGradient>
        </defs>

        <rect width={W} height={H} fill="var(--bg-card)" rx={14} />

        {/* Connections (behind nodes) */}
        <ConnLine {...gridLine} color={netColor} active={netActive}
          reverse={netToGrid} power={netDisplayPower} />
        <ConnLine {...batLine} color={batColor} active={batActive}
          reverse={batDisch} power={batDisplayPower} />
        {showSolar && (
          <ConnLine {...solLine} color={solarColor} active={solarActive}
            reverse={false} power={solarPower} />
        )}
        {showEv && (
          <ConnLine {...evLine} color={C.ev} active={evActive}
            reverse={false} power={evPower} />
        )}

        {/* Nodes */}
        {showSolar && (
          <NodeCard cx={cSOL.cx} cy={cSOL.cy} w={wSol} h={hSol}
            icon={solarLimited ? "⚡" : "☀️"} label="SOLAR"
            power={solarPower} color={solarColor} active={solarActive} />
        )}

        <NodeCard cx={cGRID.cx} cy={cGRID.cy} w={wSat} h={hSat}
          icon="⚡" label="NET"
          power={netPowerRaw ?? (netDisplayPower != null ? -netDisplayPower : null)}
          color={C.grid} active={netActive}
          detail={netActive ? (netToGrid ? "↑ teruglevering" : "↓ afname") : null}
          detailColor={netColor} />

        <NodeCard cx={cHUB.cx} cy={cHUB.cy} w={wHub} h={hHub}
          icon="🏠" label="WONING"
          power={housePower} color={C.house}
          active={housePower != null && housePower > 10}
          detail={phaseStr} />

        <NodeCard cx={cBAT.cx} cy={cBAT.cy} w={wSat} h={hSat}
          icon="🔋" label="BATTERIJ"
          power={batDisplayPower} color={C.battery} active={batActive}
          soc={batSoc} socColor={socColor}
          detail={batActive ? (batDisch ? "↑ ontladen" : "↓ laden") : null}
          detailColor={batColor} />

        {showEv && (
          <NodeCard cx={cEV.cx} cy={cEV.cy} w={wEv} h={hEv}
            icon="🚗" label="EV LADER"
            power={evPower} color={C.ev} active={evActive} />
        )}
      </svg>

      {/* Per-battery breakdown when multiple batteries */}
      {batteries.length > 1 && (
        <div className="home-flow-breakdown">
          {batteries.map((b) => {
            const pwr = b.batPower;
            const cls = pwr == null ? "" : pwr > 5 ? "hfb-discharge" : pwr < -5 ? "hfb-charge" : "";
            return (
              <div key={b.id} className={`hfb-item ${cls}`}>
                <span className="hfb-name">{b.name}</span>
                <span className="hfb-power">{fmt(pwr, true)}</span>
                {b.soc != null && (
                  <span style={{ fontSize: 10, color: socColor, fontFamily: "monospace" }}>
                    {b.soc.toFixed(0)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
