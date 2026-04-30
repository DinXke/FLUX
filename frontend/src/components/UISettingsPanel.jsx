import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Moon, Sun, Palette, Eye } from "lucide-react";

const THEMES = [
  { id: "dark",   icon: "🌙", label: "Dark"   },
  { id: "light",  icon: "☀️", label: "Light"  },
  { id: "matrix", icon: "🟩", label: "Matrix" },
];

export default function UISettingsPanel({ isMobile, theme, onThemeChange, uiMode, onUiModeChange, uiVersion, onUiVersionChange, viewMode, onViewModeChange }) {
  const { t, i18n } = useTranslation();
  const [currentTheme, setCurrentTheme] = useState(theme || "dark");
  const [currentUiMode, setCurrentUiMode] = useState(uiMode || "classic");
  const [currentUiVersion, setCurrentUiVersion] = useState(uiVersion || "old");
  const [currentViewMode, setCurrentViewMode] = useState(viewMode || "desktop");
  const [language, setLanguage] = useState(i18n.language);

  const handleThemeChange = (newTheme) => {
    setCurrentTheme(newTheme);
    onThemeChange?.(newTheme);
  };

  const handleUiModeChange = (newMode) => {
    setCurrentUiMode(newMode);
    onUiModeChange?.(newMode);
  };

  const handleUiVersionChange = (newVersion) => {
    setCurrentUiVersion(newVersion);
    onUiVersionChange?.(newVersion);
  };

  const handleViewModeChange = (newMode) => {
    setCurrentViewMode(newMode);
    onViewModeChange?.(newMode);
  };

  const handleLanguageChange = (newLang) => {
    setLanguage(newLang);
    i18n.changeLanguage(newLang);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 14px 14px" }}>
      {/* Theme selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Theme</label>
        <div style={{ display: "flex", gap: 8 }}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => handleThemeChange(t.id)}
              style={{
                padding: "8px 12px",
                border: currentTheme === t.id ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: currentTheme === t.id ? "var(--bg-card-hover)" : "var(--bg-card)",
                color: currentTheme === t.id ? "var(--accent)" : "var(--text)",
                borderRadius: 6,
                cursor: "pointer",
                flex: 1,
                fontSize: 12,
                fontWeight: 500,
                transition: "all 0.2s",
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* UI Mode selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>UI Style</label>
        <div style={{ display: "flex", gap: 8 }}>
          {["classic", "new"].map((mode) => (
            <button
              key={mode}
              onClick={() => handleUiModeChange(mode)}
              style={{
                padding: "8px 12px",
                border: currentUiMode === mode ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: currentUiMode === mode ? "var(--bg-card-hover)" : "var(--bg-card)",
                color: currentUiMode === mode ? "var(--accent)" : "var(--text)",
                borderRadius: 6,
                cursor: "pointer",
                flex: 1,
                fontSize: 12,
                fontWeight: 500,
                transition: "all 0.2s",
                textTransform: "capitalize",
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* UI Version selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>UI Version</label>
        <div style={{ display: "flex", gap: 8 }}>
          {["old", "new"].map((version) => (
            <button
              key={version}
              onClick={() => handleUiVersionChange(version)}
              style={{
                padding: "8px 12px",
                border: currentUiVersion === version ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: currentUiVersion === version ? "var(--bg-card-hover)" : "var(--bg-card)",
                color: currentUiVersion === version ? "var(--accent)" : "var(--text)",
                borderRadius: 6,
                cursor: "pointer",
                flex: 1,
                fontSize: 12,
                fontWeight: 500,
                transition: "all 0.2s",
                textTransform: "capitalize",
              }}
            >
              {version}
            </button>
          ))}
        </div>
      </div>

      {/* View Mode selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>View Mode</label>
        <div style={{ display: "flex", gap: 8 }}>
          {["desktop", "mobile"].map((mode) => (
            <button
              key={mode}
              onClick={() => handleViewModeChange(mode)}
              style={{
                padding: "8px 12px",
                border: currentViewMode === mode ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: currentViewMode === mode ? "var(--bg-card-hover)" : "var(--bg-card)",
                color: currentViewMode === mode ? "var(--accent)" : "var(--text)",
                borderRadius: 6,
                cursor: "pointer",
                flex: 1,
                fontSize: 12,
                fontWeight: 500,
                transition: "all 0.2s",
                textTransform: "capitalize",
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Language selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Language</label>
        <select
          value={language}
          onChange={(e) => handleLanguageChange(e.target.value)}
          style={{
            padding: "8px 12px",
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
            color: "var(--text)",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          <option value="en">English</option>
          <option value="nl">Nederlands</option>
          <option value="de">Deutsch</option>
          <option value="fr">Français</option>
        </select>
      </div>
    </div>
  );
}
