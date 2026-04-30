import { useState } from "react";
import { useTranslation } from "react-i18next";
import ProfitPage from "./ProfitPage.jsx";
import HistoricalFrankPage from "./HistoricalFrankPage.jsx";
import GrafanaPage from "./GrafanaPage.jsx";

export default function AnalysePage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("profit");

  const tabs = [
    { id: "profit", label: t('nav.profit') },
    { id: "history", label: t('nav.history') },
    { id: "statistics", label: t('nav.statistics') },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <div style={{
        display: "flex",
        gap: 8,
        padding: "0 14px 8px",
        borderBottom: "1px solid var(--border-color)",
        overflowX: "auto",
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px 12px",
              border: "none",
              background: activeTab === tab.id ? "var(--primary)" : "transparent",
              color: activeTab === tab.id ? "white" : "var(--text-muted)",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              whiteSpace: "nowrap",
              transition: "all 0.2s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {activeTab === "profit" && <ProfitPage />}
        {activeTab === "history" && <HistoricalFrankPage />}
        {activeTab === "statistics" && <GrafanaPage />}
      </div>
    </div>
  );
}
