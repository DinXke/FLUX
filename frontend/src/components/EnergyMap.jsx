import { apiFetch } from "../auth.js";
import { useState, useEffect, useCallback } from "react";
import { loadFlowCfg } from "./FlowSourcesSettings.jsx";

// ── Color palette ─────────────────────────────────────────────────────────────
const C = {
  house:   "#00e5ff",
  solar:   "#ffd600",
  grid:    "#e040fb",
  battery: "#00e676",
  ev:      "#4488ff",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
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
function resolveOne(sc, batteries, hwData, haData) {
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
  return null;
}
function resolveSlot(key, cfg, batteries, hwData, haData) {
  let sc = cfg?.[key];
  if (!sc) return null;
  if (!Array.isArray(sc)) sc = [sc];
  const isAvg = key === "bat_soc";
  let total = null, count = 0;
  for (const s of sc) {
    const v = resolveOne(s, batteries, hwData, haData);
    if (v != null) { total = (total ?? 0) + v; count++; }
  }
  if (total == null) return null;
  return isAvg && count > 0 ? total / count : total;
}

// ── SOC progress ring ─────────────────────────────────────────────────────────
function SocRing({ cx, cy, r, soc }) {
  const innerR = r - 5;
  const circ = 2 * Math.PI * innerR;
  const filled = Math.max(0, Math.min(1, soc / 100)) * circ;
  const color = soc < 20 ? "#ef4444" : soc < 50 ? "#f59e0b" : "#22c55e";
  return (
    <circle cx={cx} cy={cy} r={innerR} fill="none"
      stroke={color} strokeWidth={4}
      strokeDasharray={`${filled} ${circ - filled}`}
      strokeLinecap="round" opacity={0.9}
      transform={`rotate(-90 ${cx} ${cy})`} />
  );
}

// ── Circular flow node ────────────────────────────────────────────────────────
function FlowNode({ cx, cy, r, icon, label, power, color, sublabel, sublabelColor, active, soc }) {
  const bg  = color + "15";
  const str = active ? color : color + "60";
  return (
    <g>
      {active && (
        <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke={color}
          strokeWidth={8} opacity={0.1} filter="url(#em2-glow)" />
      )}
      <circle cx={cx} cy={cy} r={r} fill={bg} stroke={str}
        strokeWidth={active ? 2.5 : 1.5} />
      {soc != null && <SocRing cx={cx} cy={cy} r={r} soc={soc} />}
      <text x={cx} y={cy - 10} textAnchor="middle" dominantBaseline="middle"
        fontSize={r >= 60 ? 30 : 24} style={{ userSelect: "none" }}>{icon}</text>
      <text x={cx} y={cy + 15} textAnchor="middle" dominantBaseline="middle"
        fill={active ? color : "#64748b"} fontSize={15} fontWeight="700"
        fontFamily="'Courier New',Courier,monospace">
        {fmt(power)}
      </text>
      <text x={cx} y={cy + r + 16} textAnchor="middle" dominantBaseline="middle"
        fill="#94a3b8" fontSize={10} letterSpacing="0.8"
        fontFamily="Inter,system-ui,sans-serif">{label}</text>
      {sublabel && (
        <text x={cx} y={cy + r + 29} textAnchor="middle" dominantBaseline="middle"
          fill={sublabelColor || "#64748b"} fontSize={10}
          fontFamily="Inter,system-ui,sans-serif">{sublabel}</text>
      )}
    </g>
  );
}

// ── Animated connection line with power pill ──────────────────────────────────
function FlowLine({ x1, y1, x2, y2, color, active, reverse, power }) {
  const dur = flowSpeed(power);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const isHoriz = Math.abs(x2 - x1) > Math.abs(y2 - y1);
  const px = isHoriz ? mx        : mx + 36;
  const py = isHoriz ? my - 16   : my;
  const label = active && power != null ? fmt(Math.abs(power)) : null;
  const tw = label ? Math.max(label.length * 7.5 + 16, 48) : 0;

  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke="rgba(100,116,139,0.18)" strokeWidth={4.5} strokeLinecap="round" />
      {active && (
        <line x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={color} strokeWidth={4} strokeDasharray="10 8"
          strokeLinecap="round" opacity={0.88} filter="url(#em2-glow)">
          <animate attributeName="stroke-dashoffset"
            from={reverse ? "0" : "72"} to={reverse ? "72" : "0"}
            dur={dur} repeatCount="indefinite" />
        </line>
      )}
      {label && (
        <g>
          <rect x={px - tw / 2} y={py - 11} width={tw} height={22}
            fill="var(--bg-card, #0f172a)" stroke={color} strokeWidth={1.2} rx={11} />
          <text x={px} y={py} textAnchor="middle" dominantBaseline="middle"
            fill={color} fontSize={11} fontWeight="700"
            fontFamily="'Courier New',Courier,monospace">{label}</text>
        </g>
      )}
    </g>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EnergyMap({ batteries = [], phaseVoltages, acVoltage }) {
  const [hwData, setHwData] = useState(null);
  const [haData, setHaData] = useState({});
  const [cfg,    setCfg]    = useState(() => loadFlowCfg());

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

  useEffect(() => {
    pollHw(); pollHa(cfg);
    const id = setInterval(() => { pollHw(); pollHa(cfg); }, 10000);
    return () => clearInterval(id);
  }, [pollHw, pollHa, cfg]);

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
  const solarPower  = resolveSlot("solar_power", cfg, batteries, hwData, haData);
  const netPowerRaw = resolveSlot("net_power",   cfg, batteries, hwData, haData);
  const batPowerRaw = resolveSlot("bat_power",   cfg, batteries, hwData, haData);
  const batSoc      = resolveSlot("bat_soc",     cfg, batteries, hwData, haData) ?? avgSoc;
  const evPower     = resolveSlot("ev_power",    cfg, batteries, hwData, haData);

  // netDisplayPower: positive = export to grid
  const netDisplayPower = netPowerRaw != null ? -netPowerRaw : totalAc;
  const batDisplayPower = batPowerRaw ?? totalBat;
  const housePower = (netDisplayPower != null || batDisplayPower != null || solarPower != null)
    ? (batDisplayPower ?? 0) - (netDisplayPower ?? 0)
      + (solarPower ?? 0) - (evPower ?? 0)
    : null;

  const showSolar = !!(Array.isArray(cfg.solar_power) ? cfg.solar_power.length > 0 : cfg.solar_power)
    || solarPower != null;
  const showEv    = Array.isArray(cfg.ev_power) ? cfg.ev_power.length > 0 : !!cfg.ev_power;

  // ── Flow state ─────────────────────────────────────────────────────────────
  const netActive   = netDisplayPower != null && Math.abs(netDisplayPower) > 5;
  const netToGrid   = (netDisplayPower ?? 0) > 0;
  const netColor    = netActive ? (netToGrid ? "#22c55e" : "#ef4444") : "#334155";

  const batActive   = batDisplayPower != null && Math.abs(batDisplayPower) > 5;
  const batDisch    = (batDisplayPower ?? 0) > 0;
  const batColor    = batActive ? (batDisch ? "#f59e0b" : "#3b82f6") : "#334155";

  const solarActive = solarPower != null && solarPower > 10;
  const evActive    = evPower    != null && evPower    > 10;

  const socColor    = batSoc == null ? "#475569"
    : batSoc < 20 ? "#ef4444" : batSoc < 50 ? "#f59e0b" : "#22c55e";

  const phaseStr = phaseVoltages
    ? [
        phaseVoltages.L1 != null ? `L1:${phaseVoltages.L1.toFixed(0)}V` : null,
        phaseVoltages.L2 != null ? `L2:${phaseVoltages.L2.toFixed(0)}V` : null,
        phaseVoltages.L3 != null ? `L3:${phaseVoltages.L3.toFixed(0)}V` : null,
      ].filter(Boolean).join("  ")
    : acVoltage != null ? `${acVoltage.toFixed(1)} V` : null;

  // ── Layout ─────────────────────────────────────────────────────────────────
  const W = 600, H = 460;
  const rHub = 64, rMid = 52, rSol = 50, rEv = 46;

  const HUB  = { cx: 300, cy: 240 };
  const GRID = { cx: 76,  cy: 240 };
  const BAT  = { cx: 524, cy: 240 };
  const SOL  = { cx: 300, cy: 66  };
  const EV   = { cx: 300, cy: 410 };

  const netLine = { x1: GRID.cx + rMid, y1: GRID.cy, x2: HUB.cx - rHub, y2: HUB.cy };
  const batLine = { x1: HUB.cx + rHub,  y1: HUB.cy,  x2: BAT.cx - rMid, y2: BAT.cy };
  const solLine = { x1: SOL.cx, y1: SOL.cy + rSol, x2: HUB.cx, y2: HUB.cy - rHub };
  const evLine  = { x1: HUB.cx, y1: HUB.cy + rHub, x2: EV.cx,  y2: EV.cy  - rEv  };

  return (
    <div className="energy-map-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="energy-map-svg"
        aria-label="Energie stroomoverzicht">
        <defs>
          <filter id="em2-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="em2-bg" cx="50%" cy="50%" r="70%">
            <stop offset="0%"   stopColor="rgba(15,23,42,0)"   />
            <stop offset="100%" stopColor="rgba(15,23,42,0.5)" />
          </radialGradient>
        </defs>

        <rect width={W} height={H} fill="var(--bg-card, #0f172a)" rx={12} />
        <rect width={W} height={H} fill="url(#em2-bg)" rx={12} />

        {/* ── Connections (behind nodes) ── */}
        <FlowLine {...netLine} color={netColor} active={netActive}
          reverse={netToGrid} power={netDisplayPower} />

        <FlowLine {...batLine} color={batColor} active={batActive}
          reverse={batDisch} power={batDisplayPower} />

        {showSolar && (
          <FlowLine {...solLine} color={C.solar} active={solarActive}
            reverse={false} power={solarPower} />
        )}

        {showEv && (
          <FlowLine {...evLine} color={C.ev} active={evActive}
            reverse={false} power={evPower} />
        )}

        {/* ── Nodes ── */}

        {showSolar && (
          <FlowNode cx={SOL.cx} cy={SOL.cy} r={rSol}
            icon="☀️" label="SOLAR"
            power={solarPower} color={C.solar} active={solarActive} />
        )}

        <FlowNode cx={GRID.cx} cy={GRID.cy} r={rMid}
          icon="⚡" label="NET"
          power={netPowerRaw ?? (netDisplayPower != null ? -netDisplayPower : null)}
          color={C.grid} active={netActive}
          sublabel={netActive ? (netToGrid ? "↑ teruglevering" : "↓ afname") : null}
          sublabelColor={netColor} />

        <FlowNode cx={HUB.cx} cy={HUB.cy} r={rHub}
          icon="🏠" label="WONING"
          power={housePower} color={C.house}
          active={housePower != null && housePower > 10}
          sublabel={phaseStr} sublabelColor="#64748b" />

        <FlowNode cx={BAT.cx} cy={BAT.cy} r={rMid}
          icon="🔋" label="BATTERIJ"
          power={batDisplayPower} color={C.battery} active={batActive}
          soc={batSoc}
          sublabel={batSoc != null ? fmtPct(batSoc) : null}
          sublabelColor={socColor} />

        {showEv && (
          <FlowNode cx={EV.cx} cy={EV.cy} r={rEv}
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
