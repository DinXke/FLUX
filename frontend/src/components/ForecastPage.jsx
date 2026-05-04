import { apiFetch } from "../auth.js";
/**
 * ForecastPage – Zonneopbrengst voorspelling via forecast.solar + consumptie via Prophet ML
 * Toont vandaag en morgen als staafdiagram (15-minuten intervallen voor generatie).
 * Consumptie forecast is uurlijks met 95% betrouwbaarheidsbanden.
 */
import { useState, useEffect, useCallback } from "react";
import { loadFlowCfg } from "./FlowSourcesSettings.jsx";

function syncFlowCfgToBackend() {
  const cfg = loadFlowCfg();
  apiFetch("/api/flow/cfg", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  }).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtHour(ts) {
  // ts = "2024-04-01 08:15:00"
  return ts.slice(11, 16);
}

function fmtKwh(wh) {
  if (wh == null) return "—";
  if (wh >= 1000) return `${(wh / 1000).toFixed(2)} kWh`;
  return `${Math.round(wh)} Wh`;
}

function fmtW(w) {
  if (w == null) return "—";
  if (w >= 1000) return `${(w / 1000).toFixed(2)} kW`;
  return `${Math.round(w)} W`;
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function today()    { return localDateStr(new Date()); }
function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return localDateStr(d); }

// Filter watts/wh_period to a specific date (YYYY-MM-DD)
function filterDay(obj, date) {
  return Object.entries(obj)
    .filter(([k]) => k.startsWith(date))
    .sort(([a], [b]) => a.localeCompare(b));
}

// ── Bar chart ─────────────────────────────────────────────────────────────────

function BarChart({ slots, color, unit, maxVal, actuals, isToday = true }) {
  const now    = new Date();
  const nowStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const actualVals = actuals ? Object.values(actuals).filter((v) => v > 0) : [];
  const max    = maxVal || Math.max(1,
    ...slots.map(([, v]) => v),
    ...actualVals,
  );

  if (!slots.length) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
        Geen data beschikbaar voor deze dag.
      </div>
    );
  }

  return (
    <div className="forecast-chart">
      {slots.map(([ts, val], i) => {
        const h       = fmtHour(ts);
        const pct     = Math.round((val / max) * 100);
        const isPast  = isToday && h <= nowStr;
        const showLabel = i % 4 === 0 || i === slots.length - 1;
        // Find matching actual slot (same HH:MM prefix)
        const actualVal = actuals
          ? Object.entries(actuals).find(([k]) => k.slice(11, 16) === h)?.[1]
          : null;
        const actualPct = actualVal != null ? Math.round((actualVal / max) * 100) : null;
        return (
          <div key={ts} className="forecast-bar-col"
            title={`${h}  ${unit === "W" ? fmtW(val) : fmtKwh(val)}${actualVal != null ? `  •  Werkelijk: ${fmtW(actualVal)}` : ""}`}>
            <div className="forecast-bar-track" style={{ position: "relative" }}>
              {/* Forecast bar */}
              <div
                className="forecast-bar-fill"
                style={{
                  height: `${pct}%`,
                  background: isPast ? `rgba(${color},0.25)` : `rgba(${color},0.85)`,
                  boxShadow: isPast ? "none" : `0 0 6px rgba(${color},0.7)`,
                }}
              />
              {/* Actual overlay bar */}
              {actualPct != null && (
                <div style={{
                  position: "absolute", bottom: 0, left: "15%", right: "15%",
                  height: `${actualPct}%`,
                  background: "rgba(56,189,248,0.7)",
                  borderRadius: "2px 2px 0 0",
                  boxShadow: "0 0 5px rgba(56,189,248,0.5)",
                  pointerEvents: "none",
                }} />
              )}
            </div>
            {showLabel && (
              <div className="forecast-bar-label">{h}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Consumption forecast panel ────────────────────────────────────────────────

function ConsumptionForecastPanel({ prophetData }) {
  if (!prophetData || !prophetData.data || prophetData.data.length === 0) {
    return null;
  }

  const now = new Date();
  const todayStr = localDateStr(now);
  const d2 = new Date(now); d2.setDate(d2.getDate() + 1);
  const tomorrowStr = localDateStr(d2);

  // Split forecast by day
  const todayForecast = prophetData.data.filter(d => d.timestamp.startsWith(todayStr));
  const tomorrowForecast = prophetData.data.filter(d => d.timestamp.startsWith(tomorrowStr));
  const otherDaysForecast = prophetData.data.filter(d => !d.timestamp.startsWith(todayStr) && !d.timestamp.startsWith(tomorrowStr));

  const renderForecastDay = (title, dayData) => {
    if (!dayData || dayData.length === 0) return null;

    const totalKwh = dayData.reduce((s, d) => s + (d.forecast || 0), 0);
    const avgKwh = totalKwh / dayData.length;
    const maxKwh = Math.max(...dayData.map(d => d.upper || d.forecast || 0));

    return (
      <div className="forecast-day-panel" style={{ marginBottom: 12 }}>
        <div className="forecast-day-header">
          <span className="forecast-day-title">{title} (Consumptievoorspelling)</span>
          <div className="forecast-day-stats">
            <span className="forecast-stat">
              <span className="forecast-stat-label">Verwacht totaal</span>
              <span className="forecast-stat-value" style={{ color: "#f97316" }}>{fmtKwh(totalKwh * 1000)}</span>
            </span>
            <span className="forecast-stat">
              <span className="forecast-stat-label">Gemiddelde/uur</span>
              <span className="forecast-stat-value" style={{ color: "#f97316" }}>{fmtKwh(avgKwh * 1000)}</span>
            </span>
          </div>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, display: "flex", gap: 16 }}>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(249,115,22,0.85)", borderRadius: 2, marginRight: 4 }} />Voorspelling</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(249,115,22,0.25)", borderRadius: 2, marginRight: 4 }} />95% CI</span>
        </div>

        <div className="forecast-chart-label">Energieverbruik per uur (kWh)</div>
        <div className="forecast-chart" style={{ height: 120 }}>
          {dayData.map((d, i) => {
            const h = d.timestamp.slice(11, 16);
            const pct = Math.round((d.forecast / maxKwh) * 100);
            const upperPct = Math.round(((d.upper || d.forecast) / maxKwh) * 100);
            const lowerPct = Math.round(((d.lower || 0) / maxKwh) * 100);
            const showLabel = i % 4 === 0 || i === dayData.length - 1;

            return (
              <div key={`${d.timestamp}`} className="forecast-bar-col"
                title={`${h}  ${fmtKwh(d.forecast * 1000)}  (95% CI: ${fmtKwh(d.lower * 1000)} - ${fmtKwh(d.upper * 1000)})`}>
                <div className="forecast-bar-track" style={{ position: "relative" }}>
                  {/* 95% CI band */}
                  <div style={{
                    position: "absolute", bottom: 0, left: "10%", right: "10%",
                    height: `${upperPct}%`,
                    background: "rgba(249,115,22,0.15)",
                    pointerEvents: "none",
                  }} />
                  {/* Forecast bar */}
                  <div
                    className="forecast-bar-fill"
                    style={{
                      height: `${pct}%`,
                      background: "rgba(249,115,22,0.85)",
                      boxShadow: "0 0 6px rgba(249,115,22,0.5)",
                    }}
                  />
                </div>
                {showLabel && (
                  <div className="forecast-bar-label">{h}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
      <div style={{ marginBottom: 16 }}>
        <div className="forecast-title" style={{ fontSize: 16, marginBottom: 4 }}>💡 Consumptievoorspelling</div>
        <div className="forecast-subtitle" style={{ fontSize: 12 }}>
          7-daags uurlijks verbruik gebaseerd op ML-model (Prophet)
          {prophetData.trained_on_days && <span style={{ marginLeft: 8 }}>· getraind op {Math.round(prophetData.trained_on_days)}d</span>}
        </div>
      </div>

      {renderForecastDay("Vandaag", todayForecast)}
      {renderForecastDay("Morgen", tomorrowForecast)}

      {otherDaysForecast.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: 12, padding: 8 }}>
            Volgende dagen ({otherDaysForecast.length / 24 | 0} dagen)
          </summary>
          <div style={{ marginTop: 8 }}>
            {(() => {
              const byDay = {};
              otherDaysForecast.forEach(d => {
                const day = d.timestamp.slice(0, 10);
                if (!byDay[day]) byDay[day] = [];
                byDay[day].push(d);
              });
              return Object.entries(byDay).map(([day, dayData]) =>
                renderForecastDay(day, dayData)
              );
            })()}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Day panel ─────────────────────────────────────────────────────────────────

function DayPanel({ title, date, watts, whPeriod, whDay, isToday, actualWatts }) {
  const wSlots  = filterDay(watts,    date);
  const wpSlots = filterDay(whPeriod, date);
  const totalWh = whDay[date] ?? wpSlots.reduce((s, [, v]) => s + v, 0);

  // Find peak
  const peak    = wSlots.length ? wSlots.reduce((m, [, v]) => Math.max(m, v), 0) : null;
  const peakTs  = peak != null ? wSlots.find(([, v]) => v === peak)?.[0] : null;

  // Up to now (today only)
  let producedWh = null;
  if (isToday) {
    const now = new Date();
    // Use local time to match forecast.solar timestamps (which are in local time)
    const pad = (n) => String(n).padStart(2, "0");
    const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    producedWh = wpSlots
      .filter(([k]) => k <= nowStr)
      .reduce((s, [, v]) => s + v, 0);
  }

  // Actual totaal (Wh from 15-min W averages × 0.25h)
  const actualTotalWh = actualWatts && Object.keys(actualWatts).length
    ? Object.values(actualWatts).reduce((s, v) => s + v * 0.25, 0)
    : null;

  return (
    <div className="forecast-day-panel">
      <div className="forecast-day-header">
        <span className="forecast-day-title">{title}</span>
        <div className="forecast-day-stats">
          <span className="forecast-stat">
            <span className="forecast-stat-label">Verwacht totaal</span>
            <span className="forecast-stat-value" style={{ color: "#ffd600" }}>{fmtKwh(totalWh)}</span>
          </span>
          {peak != null && (
            <span className="forecast-stat">
              <span className="forecast-stat-label">Piek</span>
              <span className="forecast-stat-value" style={{ color: "#4ade80" }}>
                {fmtW(peak)}
                {peakTs && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> om {fmtHour(peakTs)}</span>}
              </span>
            </span>
          )}
          {isToday && producedWh != null && (
            <span className="forecast-stat">
              <span className="forecast-stat-label">Geproduceerd (verwacht)</span>
              <span className="forecast-stat-value" style={{ color: "#38bdf8" }}>{fmtKwh(producedWh)}</span>
            </span>
          )}
          {actualTotalWh != null && (
            <span className="forecast-stat">
              <span className="forecast-stat-label">Werkelijk</span>
              <span className="forecast-stat-value" style={{ color: "#38bdf8" }}>
                {fmtKwh(actualTotalWh)}
                {totalWh > 0 && (
                  <span style={{ color: "var(--text-muted)", fontWeight: 400, marginLeft: 6 }}>
                    ({Math.round((actualTotalWh / totalWh) * 100)}%)
                  </span>
                )}
              </span>
            </span>
          )}
        </div>
      </div>

      {actualWatts && Object.keys(actualWatts).length > 0 && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, display: "flex", gap: 16 }}>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(255,214,0,0.85)", borderRadius: 2, marginRight: 4 }} />Voorspelling</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(56,189,248,0.7)", borderRadius: 2, marginRight: 4 }} />Werkelijk</span>
        </div>
      )}

      {/* Power (W) chart */}
      <div className="forecast-chart-label">Vermogen (W)</div>
      <BarChart slots={wSlots}  color="255,214,0"  unit="W"  actuals={actualWatts} isToday={isToday} />

      {/* Energy per period (Wh) chart */}
      <div className="forecast-chart-label" style={{ marginTop: 12 }}>Energie per kwartier (Wh)</div>
      <BarChart slots={wpSlots} color="74,222,128" unit="Wh" isToday={isToday} />
    </div>
  );
}

// ── Historical day panel (actuals only, no forecast) ─────────────────────────

function ActualDayPanel({ date, watts }) {
  const slots = Object.entries(watts)
    .filter(([k]) => k.startsWith(date))
    .sort(([a], [b]) => a.localeCompare(b));

  const totalWh  = slots.reduce((s, [, v]) => s + v * 0.25, 0);
  const peak     = slots.length ? slots.reduce((m, [, v]) => Math.max(m, v), 0) : null;
  const peakTs   = peak != null ? slots.find(([, v]) => v === peak)?.[0] : null;

  return (
    <div className="forecast-day-panel">
      <div className="forecast-day-header">
        <span className="forecast-day-title">{date}</span>
        <div className="forecast-day-stats">
          <span className="forecast-stat">
            <span className="forecast-stat-label">Werkelijk totaal</span>
            <span className="forecast-stat-value" style={{ color: "#38bdf8" }}>{fmtKwh(totalWh)}</span>
          </span>
          {peak != null && (
            <span className="forecast-stat">
              <span className="forecast-stat-label">Piek</span>
              <span className="forecast-stat-value" style={{ color: "#38bdf8" }}>
                {fmtW(peak)}
                {peakTs && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> om {fmtHour(peakTs)}</span>}
              </span>
            </span>
          )}
        </div>
      </div>
      {slots.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
          Geen werkelijke data beschikbaar voor deze dag.
        </div>
      ) : (
        <>
          <div className="forecast-chart-label">Werkelijk vermogen (W)</div>
          <BarChart slots={slots} color="56,189,248" unit="W" />
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function addDays(dateStr, n) {
  const d = new Date(dateStr); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function ForecastPage() {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastFetch,   setLastFetch]   = useState(null);
  const [actualWatts,  setActualWatts]  = useState(null);
  const [actualsError, setActualsError] = useState(null);
  // Navigation: null = forecast view (today+tomorrow), date string = historical
  const [histDate,    setHistDate]    = useState(null);
  const [histWatts,   setHistWatts]   = useState(null);
  const [histLoading, setHistLoading] = useState(false);
  // Prophet consumption forecast
  const [prophetData, setProphetData] = useState(null);
  const [prophetLoading, setProphetLoading] = useState(false);
  const [prophetError, setProphetError] = useState(null);

  const todayStr    = today();
  const tomorrowStr = tomorrow();

  const loadActuals = useCallback(async (date) => {
    setActualsError(null);
    syncFlowCfgToBackend();
    // Small delay so the flow_cfg POST completes before the actuals GET
    await new Promise((r) => setTimeout(r, 300));
    try {
      const r = await apiFetch(`api/forecast/actuals?date=${date}`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        if (d.watts && Object.keys(d.watts).length > 0) {
          setActualWatts(d.watts);
        } else if (d.error) {
          setActualsError(d.error);
        } else if (d.warning) {
          setActualsError(d.warning);
        }
      } else {
        setActualsError(d.error || `HTTP ${r.status}`);
      }
    } catch { /* actuals optional */ }
  }, []);

  const loadHistActuals = useCallback(async (date) => {
    setHistLoading(true); setHistWatts(null);
    try {
      const r = await apiFetch(`api/forecast/actuals?date=${date}`);
      if (r.ok) { const d = await r.json(); setHistWatts(d.watts ?? {}); }
    } catch { setHistWatts({}); }
    finally { setHistLoading(false); }
  }, []);

  const loadProphet = useCallback(async () => {
    setProphetLoading(true);
    setProphetError(null);
    try {
      const r = await apiFetch("/api/forecast/prophet");
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setProphetError(d.error || `HTTP ${r.status}`);
        setProphetData(null);
      } else {
        const d = await r.json();
        if (d.status === "success") {
          setProphetData(d);
          setProphetError(null);
        } else {
          setProphetError(d.error || d.message || "Prophet forecast unavailable");
          setProphetData(null);
        }
      }
    } catch (e) {
      setProphetError(e.message);
      setProphetData(null);
    } finally {
      setProphetLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch("/api/forecast/estimate");
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setData(await r.json());
      setLastFetch(new Date());
      loadActuals(todayStr);
    } catch (e) { setError(e.message); }
    finally     { setLoading(false); }
  }, [loadActuals, todayStr]);

  useEffect(() => {
    load();
    loadProphet();
  }, [load, loadProphet]);

  const goBack = () => {
    const base = histDate ?? todayStr;
    const prev = addDays(base, -1);
    setHistDate(prev);
    loadHistActuals(prev);
  };

  const goForward = () => {
    if (!histDate) return;
    const next = addDays(histDate, 1);
    if (next >= todayStr) {
      setHistDate(null);
      setHistWatts(null);
    } else {
      setHistDate(next);
      loadHistActuals(next);
    }
  };

  return (
    <div className="forecast-page">
      <div className="forecast-header">
        <div>
          <div className="forecast-title">☀️ Zonneopbrengst voorspelling</div>
          {lastFetch && !histDate && (
            <div className="forecast-subtitle">
              Bijgewerkt: {lastFetch.toLocaleTimeString("nl-BE")}
              <span style={{ color: "var(--text-dim)", marginLeft: 8 }}>· cache 15 min</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-ghost btn-sm" onClick={goBack} title="Vorige dag">◀</button>
          {histDate ? (
            <button className="btn btn-ghost btn-sm" onClick={() => { setHistDate(null); setHistWatts(null); }}
              style={{ minWidth: 90 }}>
              {histDate}
            </button>
          ) : (
            <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 90, textAlign: "center" }}>
              Vandaag
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={goForward}
            disabled={!histDate} title="Volgende dag">▶</button>
          {!histDate && (
            <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
              {loading ? "Laden…" : "↺"}
            </button>
          )}
        </div>
      </div>

      {loading && !data && (
        <div className="loading-overlay" style={{ position: "relative", height: 120 }}>
          <div className="loading-spinner" />
          <span>Voorspelling ophalen…</span>
        </div>
      )}

      {error && (
        <div className="forecast-error">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠ Kon voorspelling niet laden</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{error}</div>
          {error.includes("niet ingesteld") && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              Stel de locatie in via <strong>Instellingen → Forecast.Solar</strong>.
            </div>
          )}
        </div>
      )}

      {/* Historical view */}
      {histDate && (
        histLoading ? (
          <div className="loading-overlay" style={{ position: "relative", height: 80 }}>
            <div className="loading-spinner" />
            <span>Ophalen…</span>
          </div>
        ) : (
          <ActualDayPanel date={histDate} watts={histWatts ?? {}} />
        )
      )}

      {/* Forecast view (today + tomorrow) */}
      {!histDate && data && !error && (
        <>
          {data.errors?.length > 0 && (
            <div className="forecast-error" style={{ marginBottom: 16 }}>
              {data.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
            </div>
          )}
          {actualsError && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, padding: "4px 8px",
              background: "rgba(239,68,68,0.08)", borderRadius: 6, border: "1px solid rgba(239,68,68,0.2)" }}>
              ⚠ Werkelijke opbrengst: {actualsError}
            </div>
          )}
          <DayPanel
            title="Vandaag"
            date={todayStr}
            watts={data.watts}
            whPeriod={data.watt_hours_period}
            whDay={data.watt_hours_day}
            isToday={true}
            actualWatts={actualWatts}
          />
          <DayPanel
            title="Morgen"
            date={tomorrowStr}
            watts={data.watts}
            whPeriod={data.watt_hours_period}
            whDay={data.watt_hours_day}
            isToday={false}
          />

          {/* Prophet consumption forecast */}
          {prophetLoading && (
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)", padding: "16px 0", textAlign: "center" }}>
              Consumptievoorspelling ophalen…
            </div>
          )}
          {prophetError && !prophetError.includes("not installed") && (
            <div style={{ marginTop: 24, fontSize: 11, color: "var(--text-muted)", padding: "8px 12px",
              background: "rgba(249,115,22,0.08)", borderRadius: 6, border: "1px solid rgba(249,115,22,0.2)" }}>
              ℹ Consumptievoorspelling: {prophetError}
            </div>
          )}
          {prophetData && !prophetError && (
            <ConsumptionForecastPanel prophetData={prophetData} />
          )}
        </>
      )}
    </div>
  );
}
