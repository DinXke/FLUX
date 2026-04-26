import { useState, useEffect, useRef } from "react";

const DEFAULTS = {
  sma_reader_enabled:    false,
  sma_reader_host:       "",
  sma_reader_port:       502,
  sma_reader_unit_id:    3,
  sma_reader_use_udp:    false,
  sma_reader_interval_s: 10,
  sma_reader_max_w:      4000,
};

function Toggle({ on, onChange }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}
      aria-pressed={on} type="button" />
  );
}

function Row({ label, desc, children }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{label}</div>
        {desc && <div className="settings-row-desc">{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export default function SmaReaderSettings() {
  const [vals,    setVals]    = useState(DEFAULTS);
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    fetch("api/strategy/settings")
      .then((r) => r.json())
      .then((d) => {
        setVals({
          sma_reader_enabled:    d.sma_reader_enabled    ?? DEFAULTS.sma_reader_enabled,
          sma_reader_host:       d.sma_reader_host       ?? DEFAULTS.sma_reader_host,
          sma_reader_port:       d.sma_reader_port       ?? DEFAULTS.sma_reader_port,
          sma_reader_unit_id:    d.sma_reader_unit_id    ?? DEFAULTS.sma_reader_unit_id,
          sma_reader_use_udp:    d.sma_reader_use_udp    ?? DEFAULTS.sma_reader_use_udp,
          sma_reader_interval_s: d.sma_reader_interval_s ?? DEFAULTS.sma_reader_interval_s,
          sma_reader_max_w:      d.sma_reader_max_w      ?? DEFAULTS.sma_reader_max_w,
        });
      })
      .catch(() => {});
  }, []);

  function patch(key, value) {
    setVals((v) => ({ ...v, [key]: value }));
    setSuccess(false);
  }

  async function save() {
    setSaving(true); setError(null); setSuccess(false);
    try {
      const r = await fetch("api/strategy/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vals),
      });
      if (!r.ok) throw new Error(await r.text());
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true); setTestResult(null);
    // Save current settings first so the test uses the entered host
    try {
      await fetch("api/strategy/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vals),
      });
      const r = await fetch("api/sma/test", { method: "POST" });
      const d = await r.json();
      setTestResult(d);
    } catch (e) {
      setTestResult({ error: e.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">☀️ SMA Omvormer — Modbus Reader</div>
      <p className="settings-section-desc" style={{ marginBottom: 16, fontSize: 13, color: "var(--text-muted)" }}>
        Lees live data van de SMA Sunny Boy terug via Modbus TCP: AC-vermogen, dagopbrengst,
        netspanning, frequentie en DC-spanning. De data wordt gebruikt als solar-bron in het
        stroomvlak en opgeslagen in InfluxDB.
      </p>

      <Row label="Ingeschakeld" desc="Polling activeren">
        <Toggle on={vals.sma_reader_enabled} onChange={(v) => patch("sma_reader_enabled", v)} />
      </Row>

      <Row label="IP-adres omvormer" desc="Let op: dit kan afwijken van het PV Limiter IP (bv. .141 vs .142)">
        <input className="form-input" style={{ width: 200 }}
          placeholder="192.168.1.x"
          value={vals.sma_reader_host}
          onChange={(e) => patch("sma_reader_host", e.target.value)} />
      </Row>

      <Row label="Poort" desc="Standaard 502 (Modbus TCP)">
        <input className="form-input" style={{ width: 80 }} type="number" min={1} max={65535}
          value={vals.sma_reader_port}
          onChange={(e) => patch("sma_reader_port", Number(e.target.value))} />
      </Row>

      <Row label="Unit ID" desc="SMA standaard = 3">
        <input className="form-input" style={{ width: 80 }} type="number" min={1} max={247}
          value={vals.sma_reader_unit_id}
          onChange={(e) => patch("sma_reader_unit_id", Number(e.target.value))} />
      </Row>

      <Row label="Modbus UDP" desc="Gebruik UDP i.p.v. TCP — verbindingsloos, voorkomt sessieconflict met andere Modbus-clients (bv. Loxone)">
        <Toggle on={!!vals.sma_reader_use_udp} onChange={(v) => patch("sma_reader_use_udp", v)} />
      </Row>

      <Row label="Pollinterval (seconden)" desc="Hoe vaak data wordt uitgelezen (5–60 s)">
        <input className="form-input" style={{ width: 80 }} type="number" min={5} max={60}
          value={vals.sma_reader_interval_s}
          onChange={(e) => patch("sma_reader_interval_s", Number(e.target.value))} />
      </Row>

      <Row label="Max vermogen (W)" desc="Nominaal piekvermorgen — gebruikt voor strategie-logica">
        <input className="form-input" style={{ width: 100 }} type="number" min={100} max={20000} step={100}
          value={vals.sma_reader_max_w}
          onChange={(e) => patch("sma_reader_max_w", Number(e.target.value))} />
      </Row>

      <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "Opslaan…" : "Opslaan"}
        </button>
        <button className="btn btn-secondary" onClick={testConnection} disabled={testing}
          style={{ opacity: vals.sma_reader_host ? 1 : 0.5 }}>
          {testing ? "Verbinden…" : "Verbinding testen"}
        </button>
        {success && <span style={{ color: "var(--success)", fontSize: 13 }}>✓ Opgeslagen</span>}
        {error   && <span style={{ color: "var(--danger)",  fontSize: 13 }}>{error}</span>}
      </div>

      {testResult && (
        <div style={{
          marginTop: 16, padding: "12px 16px", borderRadius: 8,
          background: testResult.online
            ? testResult.night_mode ? "rgba(255,214,0,.06)" : "rgba(0,230,100,.08)"
            : "rgba(255,80,80,.08)",
          border: `1px solid ${testResult.online
            ? testResult.night_mode ? "rgba(255,214,0,.35)" : "var(--success)"
            : "var(--danger)"}`,
          fontSize: 13,
        }}>
          {testResult.error && !testResult.online ? (
            <span style={{ color: "var(--danger)" }}>Verbinding mislukt: {testResult.error}</span>
          ) : testResult.online ? (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8,
                color: testResult.night_mode ? "#ffd600" : "var(--success)" }}>
                {testResult.night_mode ? "🌙 Verbinding OK — omvormer in nachtmodus" : "✓ Verbinding geslaagd"}
              </div>

              {testResult.night_mode && (
                <div style={{ marginBottom: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {testResult.night_mode_msg}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", marginBottom: 12 }}>
                <span>AC-vermogen</span><span><strong>{testResult.pac_w != null ? testResult.pac_w + " W" : "— (nacht)"}</strong></span>
                <span>Dagopbrengst</span><span><strong>{testResult.e_day_wh != null ? (testResult.e_day_wh / 1000).toFixed(2) + " kWh" : "— (nacht)"}</strong></span>
                <span>Netspanning</span><span><strong>{testResult.grid_v != null ? testResult.grid_v + " V" : "— (nacht)"}</strong></span>
                <span>Frequentie</span><span><strong>{testResult.freq_hz != null ? testResult.freq_hz + " Hz" : "— (nacht)"}</strong></span>
                <span>DC-vermogen</span><span><strong>{testResult.dc_power_w != null ? testResult.dc_power_w + " W" : "— (nacht)"}</strong></span>
                <span>DC-spanning</span><span><strong>{testResult.dc_voltage_v != null ? testResult.dc_voltage_v + " V" : "— (nacht)"}</strong></span>
                <span>Status</span><span><strong>{testResult.status ?? "— (nacht)"}</strong></span>
              </div>

              {/* Raw register diagnostics */}
              {testResult.raw && Object.keys(testResult.raw).length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: 12 }}>
                    🔍 Raw registerwaarden tonen
                  </summary>
                  <div style={{
                    marginTop: 8, fontFamily: "monospace", fontSize: 11,
                    background: "var(--bg)", padding: "8px 10px", borderRadius: 6,
                    overflowX: "auto",
                  }}>
                    {Object.entries(testResult.raw).map(([k, v]) => (
                      <div key={k} style={{ marginBottom: 3 }}>
                        <span style={{ color: "var(--text-muted)" }}>FC{v.fc} addr={v.addr}:</span>{" "}
                        <span style={{ color: v.nan ? "#ffa000" : v.value != null ? "var(--success)" : "var(--danger)" }}>
                          {v.status === "read_error" ? "READ ERROR" : v.nan ? `NaN (${(v.regs||[]).join(",")})` : `${v.value} (${(v.regs||[]).join(",")})`}
                        </span>{" "}
                        <span style={{ color: "var(--text-muted)" }}>← {k}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ) : (
            <span style={{ color: "var(--danger)" }}>Verbinding mislukt — controleer IP en unit ID</span>
          )}
        </div>
      )}

      <SmaRegisterMapEditor />
      <SmaScanner host={vals.sma_reader_host} port={vals.sma_reader_port} unitId={vals.sma_reader_unit_id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Register map editor
// ---------------------------------------------------------------------------

const DTYPES  = ["U32", "S32", "U64"];
const FC_OPTS = [{ v: 3, l: "FC03 Holding" }, { v: 4, l: "FC04 Input" }];

function SmaRegisterMapEditor() {
  const [regs,      setRegs]      = useState(null);
  const [isDefault, setIsDefault] = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState(null);
  const [success,   setSuccess]   = useState(false);
  const [open,      setOpen]      = useState(false);

  useEffect(() => {
    fetch("api/sma/register-map")
      .then((r) => r.json())
      .then((d) => { setRegs(d.registers); setIsDefault(d.is_default); })
      .catch(() => {});
  }, []);

  function updateRow(i, field, value) {
    setRegs((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
    setSuccess(false);
  }

  function deleteRow(i) {
    setRegs((prev) => prev.filter((_, idx) => idx !== i));
    setSuccess(false);
  }

  function addRow() {
    setRegs((prev) => [...prev, { key: `custom_${prev.length}`, label: "Nieuw register", reg: 30001, fc: 3, dtype: "U32", mult: 1.0, unit: "" }]);
    setSuccess(false);
  }

  async function save() {
    setSaving(true); setError(null); setSuccess(false);
    try {
      const r = await fetch("api/sma/register-map", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registers: regs }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Fout bij opslaan");
      setRegs(d.registers); setIsDefault(d.is_default);
      setSuccess(true); setTimeout(() => setSuccess(false), 3000);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function reset() {
    setSaving(true); setError(null); setSuccess(false);
    try {
      const r = await fetch("api/sma/register-map", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Fout");
      setRegs(d.registers); setIsDefault(true);
      setSuccess(true); setTimeout(() => setSuccess(false), 3000);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (!regs) return null;

  return (
    <div style={{
      marginTop: 24, padding: "16px", borderRadius: 10,
      border: "1px solid var(--border)", background: "var(--card)",
    }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "none", border: "none", cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", gap: 8, width: "100%",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>⚙️ Registermap configureren</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
          {isDefault ? "standaard" : "aangepast"} · {regs.length} registers
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "12px 0", lineHeight: 1.5 }}>
            Stel per meting in welk registeradres (1-based, zoals in SMA-docs en Loxone), FC03 of FC04,
            datatype en vermenigvuldiger FLUX moet uitlezen.
          </p>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
                  <th style={{ textAlign: "left", padding: "4px 6px", minWidth: 120 }}>Label</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", minWidth: 70  }}>Key</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", minWidth: 80  }}>Register</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", minWidth: 110 }}>FC</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", minWidth: 90  }}>Data type</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", minWidth: 80  }}>Mult.</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", minWidth: 60  }}>Eenheid</th>
                  <th style={{ padding: "4px 6px" }}></th>
                </tr>
              </thead>
              <tbody>
                {regs.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "3px 4px" }}>
                      <input className="form-input" style={{ width: "100%", minWidth: 110, fontSize: 12 }}
                        value={r.label} onChange={(e) => updateRow(i, "label", e.target.value)} />
                    </td>
                    <td style={{ padding: "3px 4px" }}>
                      <input className="form-input" style={{ width: "100%", minWidth: 80, fontSize: 12 }}
                        value={r.key} onChange={(e) => updateRow(i, "key", e.target.value)} />
                    </td>
                    <td style={{ padding: "3px 4px" }}>
                      <input className="form-input" style={{ width: 72, fontSize: 12 }}
                        type="number" min={1} max={65535}
                        value={r.reg} onChange={(e) => updateRow(i, "reg", Number(e.target.value))} />
                    </td>
                    <td style={{ padding: "3px 4px" }}>
                      <select className="form-input" style={{ fontSize: 12, padding: "2px 4px" }}
                        value={r.fc} onChange={(e) => updateRow(i, "fc", Number(e.target.value))}>
                        {FC_OPTS.map(({ v, l }) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "3px 4px" }}>
                      <select className="form-input" style={{ fontSize: 12, padding: "2px 4px" }}
                        value={r.dtype} onChange={(e) => updateRow(i, "dtype", e.target.value)}>
                        {DTYPES.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "3px 4px" }}>
                      <input className="form-input" style={{ width: 72, fontSize: 12 }}
                        type="number" step="any"
                        value={r.mult} onChange={(e) => updateRow(i, "mult", parseFloat(e.target.value) || 1)} />
                    </td>
                    <td style={{ padding: "3px 4px" }}>
                      <input className="form-input" style={{ width: 56, fontSize: 12 }}
                        value={r.unit || ""} onChange={(e) => updateRow(i, "unit", e.target.value)} />
                    </td>
                    <td style={{ padding: "3px 4px" }}>
                      <button type="button" onClick={() => deleteRow(i)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", fontSize: 14, padding: "0 4px" }}
                        title="Verwijder">&times;</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-secondary" type="button" onClick={addRow} style={{ fontSize: 12 }}>
              + Regel toevoegen
            </button>
            <button className="btn btn-primary" type="button" onClick={save} disabled={saving} style={{ fontSize: 12 }}>
              {saving ? "Opslaan…" : "Registermap opslaan"}
            </button>
            {!isDefault && (
              <button className="btn btn-secondary" type="button" onClick={reset} disabled={saving} style={{ fontSize: 12 }}>
                Terugzetten naar standaard
              </button>
            )}
            {success && <span style={{ color: "var(--success)", fontSize: 12 }}>✓ Opgeslagen</span>}
            {error   && <span style={{ color: "var(--danger)",  fontSize: 12 }}>{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modbus register scanner
// ---------------------------------------------------------------------------

function SmaScanner({ host }) {
  const [scanning,  setScanning]  = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [results,   setResults]   = useState(null);
  const [error,     setError]     = useState(null);
  const pollRef = useRef(null);

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function startScan() {
    setScanning(true); setResults(null); setError(null); setProgress(0);
    try {
      const r = await fetch("api/sma/scan", { method: "POST" });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Fout"); }
    } catch (e) {
      setError(e.message); setScanning(false); return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch("api/sma/scan/status");
        const d = await r.json();
        setProgress(d.progress ?? 0);
        if (!d.running) {
          stopPoll();
          setScanning(false);
          if (d.error) setError(d.error);
          else setResults(d.results ?? []);
        }
      } catch { stopPoll(); setScanning(false); }
    }, 800);
  }

  return (
    <div style={{
      marginTop: 24, padding: "16px", borderRadius: 10,
      border: "1px solid var(--border)", background: "var(--card)",
    }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>🔍 Modbus Register Scanner</div>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Scant alle SMA-registerranges (FC03 + FC04, 30001–31000 en 40001–43100) en toont
        welke adressen geldige waarden teruggeven. Handig om te achterhalen welke registers
        jouw omvormer ondersteunt. Duurt ±30–90 seconden.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button className="btn btn-secondary" onClick={startScan}
          disabled={scanning || !host}
          title={!host ? "Vul eerst een IP-adres in" : ""}>
          {scanning ? `Scannen… (${progress}%)` : "Start scan"}
        </button>
        {scanning && (
          <div style={{ flex: 1, maxWidth: 200, height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", borderRadius: 3, background: "#ffd600", transition: "width .3s" }} />
          </div>
        )}
        {error && <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span>}
      </div>

      {results !== null && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {results.length === 0
                ? "Geen registers met geldige waarden gevonden."
                : `${results.length} register(s) gevonden:`}
            </span>
            {results.length > 0 && (
              <button
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: "2px 8px" }}
                onClick={() => {
                  const header = "Reg,FC,Raw (16-bit),Hex,U32,S32,Bekende naam";
                  const rows = results.map(r => `${r.reg},FC0${r.fc},${r.raw},${r.hex},${r.u32 ?? ""},${r.s32 ?? ""},"${r.label || ""}"`);
                  const csv = [header, ...rows].join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = "modbus_scan.csv"; a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                ⬇ Download CSV
              </button>
            )}
          </div>
          {results.length > 0 && (
            <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 500, border: "1px solid var(--border)", borderRadius: 6 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "monospace" }}>
                <thead style={{ position: "sticky", top: 0, background: "var(--card)", zIndex: 1 }}>
                  <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Reg</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>FC</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Raw (16-bit)</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Hex</th>
                    <th style={{ textAlign: "right", padding: "4px 8px" }}>U32</th>
                    <th style={{ textAlign: "right", padding: "4px 8px" }}>S32</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Bekende naam</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)", background: r.label ? "rgba(255,214,0,.04)" : "transparent" }}>
                      <td style={{ padding: "3px 8px", color: r.label ? "#ffd600" : "var(--text)", fontWeight: r.label ? 600 : 400 }}>{r.reg}</td>
                      <td style={{ padding: "3px 8px", color: "var(--text-muted)" }}>FC0{r.fc}</td>
                      <td style={{ padding: "3px 8px" }}>{r.raw}</td>
                      <td style={{ padding: "3px 8px", color: "var(--text-muted)" }}>{r.hex}</td>
                      <td style={{ padding: "3px 8px", textAlign: "right", color: r.u32 != null ? "var(--text)" : "var(--text-muted)" }}>{r.u32 ?? "—"}</td>
                      <td style={{ padding: "3px 8px", textAlign: "right", color: r.s32 != null ? (r.s32 < 0 ? "#f06" : "var(--text)") : "var(--text-muted)" }}>{r.s32 ?? "—"}</td>
                      <td style={{ padding: "3px 8px", color: r.label ? "#ffd600" : "var(--text-muted)" }}>{r.label || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
