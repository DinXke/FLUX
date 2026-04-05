import { useState, useEffect, useCallback } from "react";

// ── helpers ────────────────────────────────────────────────────────────────

function fmtEur(v) {
  if (v == null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + " €";
}
function fmtEurAbs(v) {
  if (v == null) return "—";
  return v.toFixed(2) + " €";
}
function fmtDate(d) {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${+day}/${+m}`;
}
function fmtDateLong(d) {
  if (!d) return "";
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short" });
}

// ── Summary card ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: "var(--card-bg)",
      border: "1px solid var(--border-color)",
      borderRadius: 10,
      padding: "14px 18px",
      minWidth: 150,
      flex: "1 1 150px",
    }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "var(--text-primary)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Bar chart ──────────────────────────────────────────────────────────────

function DayBarsChart({ days }) {
  const [hovered, setHovered] = useState(null);

  if (!days || days.length === 0) return null;

  const maxCost = Math.max(...days.map(d => Math.max(d.cost_no_eur, d.cost_with_eur, 0.01)));
  const BAR_W  = 10;
  const GAP    = 2;
  const PAIR_W = BAR_W * 2 + GAP + 8;
  const H      = 140;
  const PAD_L  = 42;
  const PAD_B  = 32;
  const PAD_T  = 10;
  const width  = PAD_L + days.length * PAIR_W + 8;
  const chartH = H + PAD_T + PAD_B;

  function barY(val) {
    return PAD_T + H - (val / maxCost) * H;
  }
  function barH(val) {
    return (val / maxCost) * H;
  }

  // Y-axis ticks
  const ticks = [0, 0.25, 0.5, 0.75, 1.0].map(f => ({
    val: f * maxCost,
    y:   PAD_T + H - f * H,
  }));

  const hov = hovered != null ? days[hovered] : null;

  return (
    <div style={{ overflowX: "auto" }}>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 12, color: "var(--text-muted)" }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#e05c5c", marginRight: 4 }} />Zonder automatisatie</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#4caf80", marginRight: 4 }} />Met automatisatie</span>
      </div>

      <svg width={Math.max(width, 300)} height={chartH} style={{ display: "block" }}>
        {/* Y-axis ticks */}
        {ticks.map(t => (
          <g key={t.val}>
            <line x1={PAD_L - 4} y1={t.y} x2={PAD_L + days.length * PAIR_W} y2={t.y}
                  stroke="var(--border-color)" strokeWidth={0.5} strokeDasharray="3,3" />
            <text x={PAD_L - 6} y={t.y + 4} textAnchor="end"
                  fill="var(--text-muted)" fontSize={9}>
              {t.val.toFixed(2)}
            </text>
          </g>
        ))}

        {/* Bars per day */}
        {days.map((d, i) => {
          const x0  = PAD_L + i * PAIR_W;
          const noH = barH(Math.max(0, d.cost_no_eur));
          const wiH = barH(Math.max(0, d.cost_with_eur));
          const sav = d.savings_eur;
          return (
            <g key={d.date}
               style={{ cursor: "pointer" }}
               onMouseEnter={() => setHovered(i)}
               onMouseLeave={() => setHovered(null)}>
              {/* hover highlight */}
              {hovered === i && (
                <rect x={x0 - 2} y={PAD_T} width={PAIR_W} height={H}
                      fill="var(--text-primary)" fillOpacity={0.05} rx={2} />
              )}
              {/* no-auto bar (orange/red) */}
              <rect x={x0} y={barY(Math.max(0, d.cost_no_eur))}
                    width={BAR_W} height={Math.max(1, noH)}
                    fill={hovered === i ? "#f07070" : "#e05c5c"} rx={2} />
              {/* with-auto bar (green) */}
              <rect x={x0 + BAR_W + GAP} y={barY(Math.max(0, d.cost_with_eur))}
                    width={BAR_W} height={Math.max(1, wiH)}
                    fill={hovered === i ? "#5dcc8a" : "#4caf80"} rx={2} />
              {/* savings dot */}
              {sav > 0.005 && (
                <text x={x0 + BAR_W + GAP / 2} y={barY(Math.max(0, d.cost_no_eur)) - 3}
                      textAnchor="middle" fill="#a3d8b0" fontSize={7}>
                  +{(sav * 100).toFixed(0)}ct
                </text>
              )}
              {/* date label */}
              <text x={x0 + BAR_W + GAP / 2} y={chartH - 4}
                    textAnchor="middle" fill="var(--text-muted)" fontSize={9}>
                {fmtDate(d.date)}
              </text>
            </g>
          );
        })}

        {/* Y axis line */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + H + 4}
              stroke="var(--border-color)" strokeWidth={1} />
      </svg>

      {/* Tooltip */}
      {hov && (
        <div style={{
          background: "var(--card-bg)",
          border: "1px solid var(--border-color)",
          borderRadius: 8,
          padding: "10px 14px",
          fontSize: 12,
          marginTop: 8,
          display: "inline-block",
          minWidth: 220,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{fmtDateLong(hov.date)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ color: "#e05c5c" }}>Zonder auto: {fmtEurAbs(hov.cost_no_eur)}</div>
            <div style={{ color: "#4caf80" }}>Met auto:    {fmtEurAbs(hov.cost_with_eur)}</div>
            <div style={{ color: hov.savings_eur >= 0 ? "#4caf80" : "#e05c5c", fontWeight: 600 }}>
              Besparing: {fmtEur(hov.savings_eur)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cumulative savings chart ───────────────────────────────────────────────

function CumulativeChart({ days }) {
  if (!days || days.length === 0) return null;

  let cum = 0;
  const points = days.map(d => { cum += d.savings_eur; return cum; });
  const minV = Math.min(0, ...points);
  const maxV = Math.max(0.01, ...points);
  const range = maxV - minV;

  const W   = 420;
  const H   = 80;
  const PAD_L = 48;
  const PAD_B = 20;
  const PAD_T = 10;
  const innerW = W - PAD_L - 8;
  const innerH = H;

  function px(i) { return PAD_L + (i / (points.length - 1 || 1)) * innerW; }
  function py(v) { return PAD_T + innerH - ((v - minV) / (range || 1)) * innerH; }

  const pathD = points.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");

  // Zero line
  const zeroY = py(0);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H + PAD_T + PAD_B} style={{ display: "block" }}>
        {/* Zero line */}
        <line x1={PAD_L} y1={zeroY} x2={W - 8} y2={zeroY}
              stroke="var(--border-color)" strokeWidth={1} strokeDasharray="4,3" />
        <text x={PAD_L - 6} y={zeroY + 4} textAnchor="end"
              fill="var(--text-muted)" fontSize={9}>0</text>

        {/* Max label */}
        <text x={PAD_L - 6} y={PAD_T + 4} textAnchor="end"
              fill="var(--text-muted)" fontSize={9}>{maxV.toFixed(2)}</text>

        {/* Area fill */}
        <path d={`${pathD} L${px(points.length - 1).toFixed(1)},${zeroY} L${PAD_L},${zeroY} Z`}
              fill="#4caf80" fillOpacity={0.12} />

        {/* Line */}
        <path d={pathD} fill="none" stroke="#4caf80" strokeWidth={2} strokeLinejoin="round" />

        {/* End point */}
        <circle cx={px(points.length - 1)} cy={py(points[points.length - 1])}
                r={4} fill="#4caf80" />
        <text x={px(points.length - 1) + 6} y={py(points[points.length - 1]) + 4}
              fill="#4caf80" fontSize={10} fontWeight={700}>
          {fmtEur(points[points.length - 1])}
        </text>

        {/* Y axis */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH + 4}
              stroke="var(--border-color)" strokeWidth={1} />

        {/* X labels: first and last */}
        <text x={PAD_L} y={H + PAD_T + PAD_B - 2} textAnchor="middle"
              fill="var(--text-muted)" fontSize={9}>{fmtDate(days[0].date)}</text>
        <text x={px(days.length - 1)} y={H + PAD_T + PAD_B - 2} textAnchor="middle"
              fill="var(--text-muted)" fontSize={9}>{fmtDate(days[days.length - 1].date)}</text>
      </svg>
    </div>
  );
}

// ── Day detail table ───────────────────────────────────────────────────────

function DayDetail({ day }) {
  if (!day) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        Uurdetail — {fmtDateLong(day.date)}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ fontSize: 11, borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              {["Uur", "Prijs (ct)", "Zon (Wh)", "Verbuik (Wh)", "Net (Wh)", "Zonder auto (ct)", "Met auto (ct)", "Besparing (ct)"].map(h => (
                <th key={h} style={{ padding: "4px 8px", borderBottom: "1px solid var(--border-color)", textAlign: "right", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {day.hours.map(h => {
              const sav = h.cost_no_ct - h.cost_with_ct;
              return (
                <tr key={h.h} style={{ borderBottom: "1px solid var(--border-color)" }}>
                  <td style={{ padding: "3px 8px", textAlign: "right" }}>{h.h}:00</td>
                  <td style={{ padding: "3px 8px", textAlign: "right" }}>{h.price_ct.toFixed(1)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", color: "#f5c842" }}>{h.solar_wh}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right" }}>{h.house_wh}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", color: h.net_wh > 0 ? "#e05c5c" : "#4caf80" }}>{h.net_wh > 0 ? `+${h.net_wh}` : h.net_wh}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", color: "#e05c5c" }}>{h.cost_no_ct.toFixed(1)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", color: "#4caf80" }}>{h.cost_with_ct.toFixed(1)}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", color: sav >= 0 ? "#4caf80" : "#e05c5c", fontWeight: sav !== 0 ? 600 : 400 }}>
                    {sav > 0 ? "+" : ""}{sav.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

const PERIODS = [
  { label: "7 dagen",  days: 7  },
  { label: "30 dagen", days: 30 },
  { label: "90 dagen", days: 90 },
];

export default function ProfitPage() {
  const [period,    setPeriod]    = useState(30);
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [selDay,    setSelDay]    = useState(null);  // selected day for detail

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelDay(null);
    try {
      const r = await fetch(`api/profit?days=${period}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const days    = data?.days    || [];
  const summary = data?.summary || null;
  const warning = data?.warning || null;

  const selectedDayData = selDay != null ? days[selDay] : null;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "12px 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>💰 Winst & Besparing</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {PERIODS.map(p => (
            <button key={p.days}
              onClick={() => setPeriod(p.days)}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid var(--border-color)",
                background: period === p.days ? "var(--accent-color, #4caf80)" : "var(--card-bg)",
                color: period === p.days ? "#fff" : "var(--text-primary)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: period === p.days ? 600 : 400,
              }}>
              {p.label}
            </button>
          ))}
          <button onClick={load} style={{
            padding: "5px 10px", borderRadius: 6,
            border: "1px solid var(--border-color)",
            background: "var(--card-bg)", color: "var(--text-muted)",
            cursor: "pointer", fontSize: 12,
          }} title="Verversen">↺</button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)", fontSize: 13, padding: "20px 0" }}>
          <div className="loading-spinner" style={{ width: 18, height: 18 }} />
          Historische data laden…
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: "rgba(224,92,92,0.1)", border: "1px solid #e05c5c", borderRadius: 8, padding: "10px 14px", color: "#e05c5c", fontSize: 13, marginBottom: 12 }}>
          ⚠ {error}
        </div>
      )}

      {/* Warning (no data) */}
      {warning && !loading && (
        <div style={{ background: "rgba(245,200,66,0.1)", border: "1px solid #f5c842", borderRadius: 8, padding: "10px 14px", color: "#f5c842", fontSize: 13, marginBottom: 12 }}>
          ⚠ {warning}
        </div>
      )}

      {/* Summary cards */}
      {summary && !loading && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
          <SummaryCard
            label={`Totale besparing (${summary.days_with_data}d)`}
            value={`+ ${summary.total_savings_eur.toFixed(2)} €`}
            sub={`Gem. ${(summary.avg_daily_savings_eur * 100).toFixed(1)} ct/dag`}
            color="#4caf80"
          />
          <SummaryCard
            label="% bespaard t.o.v. geen auto"
            value={`${summary.pct_saved.toFixed(1)} %`}
            sub={`${summary.total_cost_with_eur.toFixed(2)} € vs ${summary.total_cost_no_eur.toFixed(2)} €`}
            color="#4caf80"
          />
          <SummaryCard
            label="Kost zonder automatisatie"
            value={`${summary.total_cost_no_eur.toFixed(2)} €`}
            sub="Altijd anti-feed, nooit netladen"
            color="#e05c5c"
          />
          <SummaryCard
            label="Kost met automatisatie"
            value={`${summary.total_cost_with_eur.toFixed(2)} €`}
            sub="Werkelijke gemeten netafname"
            color="#4caf80"
          />
        </div>
      )}

      {/* Explanation */}
      {!loading && days.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
          <strong>Methode:</strong> "Zonder automatisatie" simuleert anti-feed modus (batterij laadt van zonne-overschot, ontlaadt voor verbruik — nooit netladen).
          "Met automatisatie" gebruikt de werkelijke gemeten netafname/teruglevering uit InfluxDB.
          Klik op een dag voor uurdetail.
        </div>
      )}

      {/* Main bar chart */}
      {!loading && days.length > 0 && (
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 10, padding: "16px 14px", marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Dagelijkse energiekosten</div>
          <DayBarsChart days={days} />

          {/* Clickable day selector */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 14 }}>
            {days.map((d, i) => (
              <button key={d.date}
                onClick={() => setSelDay(selDay === i ? null : i)}
                style={{
                  padding: "2px 8px",
                  borderRadius: 5,
                  border: "1px solid var(--border-color)",
                  background: selDay === i ? "var(--accent-color, #4caf80)" : "var(--card-bg)",
                  color: selDay === i ? "#fff" : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 10,
                }}>
                {fmtDate(d.date)} {d.savings_eur > 0 ? `+${(d.savings_eur * 100).toFixed(0)}ct` : `${(d.savings_eur * 100).toFixed(0)}ct`}
              </button>
            ))}
          </div>

          {/* Day detail */}
          {selectedDayData && <DayDetail day={selectedDayData} />}
        </div>
      )}

      {/* Cumulative savings chart */}
      {!loading && days.length > 1 && (
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 10, padding: "16px 14px" }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Cumulatieve besparing</div>
          <CumulativeChart days={days} />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
            Totale winst t.o.v. altijd anti-feed zonder netladen
          </div>
        </div>
      )}
    </div>
  );
}
