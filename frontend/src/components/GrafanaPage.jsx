import { useState } from "react";
import { useTranslation } from "react-i18next";

const DASHBOARDS = [
  { id: "live-energy-flow",     icon: "⚡", labelKey: "grafana.liveFlow" },
  { id: "battery-optimization", icon: "🔋", labelKey: "grafana.battery" },
  { id: "solar-forecast",       icon: "☀️", labelKey: "grafana.solar" },
  { id: "cost-savings",         icon: "💰", labelKey: "grafana.cost" },
  { id: "ai-strategy-log",      icon: "🧠", labelKey: "grafana.aiLog" },
];

function buildGrafanaUrl(uid) {
  return `${window.location.origin}/grafana/d/${uid}?orgId=1&kiosk=tv&theme=dark`;
}

export default function GrafanaPage() {
  const { t } = useTranslation();
  const [active, setActive] = useState(DASHBOARDS[0].id);

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

      {/* Grafana iframe — fills remaining viewport height */}
      <iframe
        key={active}
        src={buildGrafanaUrl(active)}
        title={active}
        style={{
          border: "none",
          width: "100%",
          // 52px header + 8px picker padding*2 + 33px picker btn + 56px mobile nav
          height: "calc(100svh - 10rem)",
          display: "block",
        }}
        allow="fullscreen"
      />
    </div>
  );
}
