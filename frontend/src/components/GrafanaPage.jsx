import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

const DASHBOARDS = [
  { id: "live-energy-flow",     icon: "⚡", labelKey: "grafana.liveFlow" },
  { id: "battery-optimization", icon: "🔋", labelKey: "grafana.battery" },
  { id: "solar-forecast",       icon: "☀️", labelKey: "grafana.solar" },
  { id: "cost-savings",         icon: "💰", labelKey: "grafana.cost" },
  { id: "ai-strategy-log",      icon: "🧠", labelKey: "grafana.aiLog" },
];

export default function GrafanaPage() {
  const { t } = useTranslation();
  const [active, setActive] = useState(DASHBOARDS[0].id);
  const [grafanaBase, setGrafanaBase] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/grafana-url")
      .then((r) => r.json())
      .then((d) => setGrafanaBase(d.url))
      .catch(() => setError("Kon Grafana URL niet ophalen"));
  }, []);

  const iframeSrc = grafanaBase
    ? `${grafanaBase}/d/${active}?orgId=1&kiosk=tv&theme=dark`
    : null;

  return (
    <div style={{ margin: "-24px", display: "flex", flexDirection: "column" }}>
      {/* Dashboard tab picker */}
      <div style={{
        display: "flex",
        overflowX: "auto",
        gap: 4,
        padding: "8px",
        flexShrink: 0,
        scrollbarWidth: "none",
        borderBottom: "1px solid var(--border)",
      }}>
        {DASHBOARDS.map((d) => (
          <button
            key={d.id}
            onClick={() => setActive(d.id)}
            className={`btn btn-sm${active === d.id ? " btn-primary" : " btn-ghost"}`}
            style={{ whiteSpace: "nowrap", flexShrink: 0 }}
          >
            {d.icon} {t(d.labelKey, d.id)}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: 16, color: "var(--red, #ef4444)" }}>{error}</div>
      )}

      {iframeSrc && (
        <iframe
          key={iframeSrc}
          src={iframeSrc}
          title={active}
          style={{
            border: "none",
            width: "100%",
            height: "calc(100svh - 10rem)",
            display: "block",
          }}
          allow="fullscreen"
        />
      )}
    </div>
  );
}
