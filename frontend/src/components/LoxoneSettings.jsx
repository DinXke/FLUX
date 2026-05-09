import { apiFetch } from "../auth.js";
import { useState, useEffect, useCallback } from "react";
import { loadFlowCfg, saveFlowCfg } from "./FlowSourcesSettings.jsx";

export default function LoxoneSettings() {
  const [cfg,        setCfg]        = useState(null);
  const [host,       setHost]       = useState("");
  const [port,       setPort]       = useState(80);
  const [username,   setUsername]   = useState("");
  const [password,   setPassword]   = useState("");
  const [pollInt,    setPollInt]     = useState(30);
  const [enabled,    setEnabled]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saveOk,     setSaveOk]     = useState(false);
  const [error,      setError]      = useState(null);
  const [status,     setStatus]     = useState(null);
  const [testing,    setTesting]    = useState(false);
  const [entities,   setEntities]   = useState([]);
  const [loadingEnt, setLoadingEnt] = useState(false);
  const [entError,   setEntError]   = useState(null);
  const [selected,   setSelected]   = useState(new Set());
  const [savingEnt,  setSavingEnt]  = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const r = await apiFetch("/api/loxone/config");
      if (!r.ok) return;
      const d = await r.json();
      setCfg(d);
      setHost(d.host || "");
      setPort(d.port ?? 80);
      setUsername(d.username || "");
      setEnabled(d.enabled ?? false);
      setPollInt(d.poll_interval ?? 30);
      setSelected(new Set((d.selected_entities || []).map((e) => e.uuid)));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSave = async () => {
    if (enabled && !host.trim()) { setError("Host is verplicht bij inschakelen."); return; }
    setSaving(true); setError(null); setSaveOk(false);
    try {
      const body = {
        enabled,
        host: host.trim(),
        port: parseInt(port, 10) || 80,
        username: username.trim(),
        password: password || "",
        poll_interval: parseInt(pollInt, 10) || 30,
        selected_entities: cfg?.selected_entities || [],
      };
      const r = await apiFetch("/api/loxone/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Opslaan mislukt.");
      setPassword("");
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
      loadConfig();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true); setStatus(null);
    try {
      const r = await apiFetch("/api/loxone/status");
      const d = await r.json();
      setStatus(d);
    } catch (e) {
      setStatus({ connected: false, error: e.message });
    }
    setTesting(false);
  };

  const loadEntities = async () => {
    setLoadingEnt(true); setEntError(null);
    try {
      const r = await apiFetch("/api/loxone/entities");
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setEntities(d.entities || []);
    } catch (e) {
      setEntError(e.message);
    }
    setLoadingEnt(false);
  };

  const syncLoxoneToFlow = (selectedEntities) => {
    const flowCfg = loadFlowCfg();
    const existingNodes = flowCfg.custom_nodes ?? [];

    // Verwijder verouderde loxone nodes die niet meer geselecteerd zijn
    const selectedUuids = new Set(selectedEntities.map((e) => e.uuid));
    const filtered = existingNodes.filter((n) => {
      const src = n?.source;
      if (src?.source === "loxone") return selectedUuids.has(src.sensor);
      return true; // behoud non-loxone nodes
    });

    // Voeg nieuwe loxone nodes toe als ze nog niet bestaan
    const existingUuids = new Set(
      filtered
        .filter((n) => n?.source?.source === "loxone")
        .map((n) => n.source.sensor)
    );

    const ENTITY_ICONS = { EnergySocket: "⚡", EnergyMonitor: "⚡", Meter: "📊", PowerMeter: "📊" };

    for (const entity of selectedEntities) {
      if (existingUuids.has(entity.uuid)) continue;
      filtered.push({
        id: `loxone_${entity.uuid}`,
        name: entity.name,
        icon: ENTITY_ICONS[entity.type] ?? "🏡",
        source: { source: "loxone", device_id: "loxone", sensor: entity.uuid, invert: false },
      });
    }

    const updated = { ...flowCfg, custom_nodes: filtered };
    saveFlowCfg(updated);
    // Synchroniseer ook naar server zodat andere browsers/apparaten het zien
    apiFetch("/api/flow/cfg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    }).catch(() => {});
    window.dispatchEvent(new Event("marstek_flow_cfg_changed"));
  };

  const toggleEntity = (uuid) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(uuid) ? n.delete(uuid) : n.add(uuid);
      return n;
    });

  const saveEntities = async () => {
    setSavingEnt(true); setError(null);
    try {
      const selectedEntities = entities
        .filter((e) => selected.has(e.uuid))
        .map(({ uuid, name, type, room }) => ({ uuid, name, type, room }));

      const current = cfg || {};
      const body = {
        enabled: current.enabled ?? false,
        host: current.host || "",
        port: current.port ?? 80,
        username: current.username || "",
        password: "",
        poll_interval: current.poll_interval ?? 30,
        selected_entities: selectedEntities,
      };
      const r = await apiFetch("/api/loxone/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Opslaan mislukt.");

      // Auto-sync: voeg geselecteerde entiteiten toe als custom nodes in de flow
      syncLoxoneToFlow(selectedEntities);

      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
      loadConfig();
    } catch (e) {
      setError(e.message);
    }
    setSavingEnt(false);
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">🏡 Loxone Miniserver</div>

      {/* Enable toggle */}
      <div className="settings-row">
        <div className="settings-row-label">Ingeschakeld</div>
        <div className="settings-row-control">
          <label className="toggle-switch">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      {/* Host */}
      <div className="settings-row">
        <div className="settings-row-label">Host / IP</div>
        <div className="settings-row-control">
          <input
            className="form-input"
            placeholder="192.168.1.100"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </div>
      </div>

      {/* Port */}
      <div className="settings-row">
        <div className="settings-row-label">Poort</div>
        <div className="settings-row-control">
          <input
            className="form-input"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            style={{ width: 100 }}
          />
        </div>
      </div>

      {/* Username */}
      <div className="settings-row">
        <div className="settings-row-label">Gebruikersnaam</div>
        <div className="settings-row-control">
          <input
            className="form-input"
            placeholder="admin"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
      </div>

      {/* Password */}
      <div className="settings-row">
        <div className="settings-row-label">Wachtwoord</div>
        <div className="settings-row-control">
          <input
            className="form-input"
            type="password"
            placeholder={cfg?.password_set ? "••••••• (laat leeg om te bewaren)" : "Wachtwoord"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      </div>

      {/* Poll interval */}
      <div className="settings-row">
        <div className="settings-row-label">Poll interval (s)</div>
        <div className="settings-row-control">
          <input
            className="form-input"
            type="number"
            min={5}
            max={3600}
            value={pollInt}
            onChange={(e) => setPollInt(e.target.value)}
            style={{ width: 100 }}
          />
        </div>
      </div>

      {/* Error / save feedback */}
      {error && <div className="form-error" style={{ margin: "0 20px 8px" }}>{error}</div>}
      {saveOk && (
        <div style={{ margin: "0 20px 8px", fontSize: 13, color: "var(--green)" }}>
          ✓ Opgeslagen
        </div>
      )}

      {/* Buttons */}
      <div style={{ padding: "8px 20px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? "Opslaan…" : "Opslaan"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleTest} disabled={testing}>
          {testing ? "Testen…" : "Verbinding testen"}
        </button>
      </div>

      {/* Connection status */}
      {status && (
        <div style={{ margin: "0 20px 12px", fontSize: 13 }}>
          {status.connected ? (
            <span style={{ color: "var(--green)" }}>
              ✓ Verbonden
              {status.miniserver_info?.version && ` — firmware ${status.miniserver_info.version}`}
            </span>
          ) : (
            <span style={{ color: "var(--red)" }}>
              ✗ Niet verbonden{status.error ? `: ${status.error}` : ""}
            </span>
          )}
        </div>
      )}

      {/* Entity selection */}
      {enabled && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 16 }}>
          <div style={{ padding: "0 20px 8px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>Entiteiten als verbruikers</div>
            <button className="btn btn-ghost btn-sm" onClick={loadEntities} disabled={loadingEnt}>
              {loadingEnt ? "Ophalen…" : "🔄 Ophalen"}
            </button>
          </div>

          {entError && (
            <div className="form-error" style={{ margin: "0 20px 8px" }}>{entError}</div>
          )}

          {entities.length > 0 && (
            <>
              <div style={{ padding: "0 20px", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                Selecteer de entiteiten die als verbruiker in FLUX verschijnen:
              </div>
              <div style={{ maxHeight: 280, overflowY: "auto", padding: "0 20px" }}>
                {entities.map((e) => (
                  <label
                    key={e.uuid}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 0",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(e.uuid)}
                      onChange={() => toggleEntity(e.uuid)}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: "var(--text)" }}>
                        {e.is_energy && "⚡ "}{e.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {e.type}{e.room ? ` · ${e.room}` : ""}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <div style={{ padding: "10px 20px" }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={saveEntities}
                  disabled={savingEnt}
                >
                  {savingEnt ? "Opslaan…" : `Selectie opslaan (${selected.size})`}
                </button>
              </div>
            </>
          )}

          {!loadingEnt && entities.length === 0 && (
            <div style={{ padding: "0 20px 12px", fontSize: 12, color: "var(--text-muted)" }}>
              Klik "Ophalen" om beschikbare entiteiten op te halen van de Miniserver.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
