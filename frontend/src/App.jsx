import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import DeviceCard from "./components/DeviceCard.jsx";
import AddDeviceModal from "./components/AddDeviceModal.jsx";
import PricesPage from "./components/PricesPage.jsx";
import ForecastPage from "./components/ForecastPage.jsx";
import StrategyPage from "./components/StrategyPage.jsx";
import SettingsPage from "./components/SettingsPage.jsx";
import ProfitPage from "./components/ProfitPage.jsx";
import HistoricalFrankPage from "./components/HistoricalFrankPage.jsx";
import EnergyMap from "./components/EnergyMap.jsx";
import HomeWizardPanel from "./components/HomeWizardPanel.jsx";
import SmaInverterPanel from "./components/SmaInverterPanel.jsx";
import LanguageSwitcher from "./components/LanguageSwitcher.jsx";
import LoginPage from "./components/LoginPage.jsx";
import UserManagementPage from "./components/UserManagementPage.jsx";
import { getToken, clearToken, authHeaders, apiFetch } from "./auth.js";

const THEMES = [
  { id: "dark",   icon: "🌙", label: "Dark"   },
  { id: "light",  icon: "☀️", label: "Light"  },
  { id: "matrix", icon: "🟩", label: "Matrix" },
];

function useTheme() {
  const [theme, setThemeState] = useState(
    () => localStorage.getItem("marstek_theme") || "dark"
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("marstek_theme", theme);
  }, [theme]);
  return [theme, setThemeState];
}

function useViewMode() {
  const [mode, setMode] = useState(
    () => localStorage.getItem("marstek_view") || "desktop"
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-view", mode);
    localStorage.setItem("marstek_view", mode);
  }, [mode]);
  return [mode, setMode];
}

function useUiVersion() {
  const [version, setVersion] = useState(
    () => localStorage.getItem("marstek_ui") || "old"
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-ui", version);
    localStorage.setItem("marstek_ui", version);
  }, [version]);
  return [version, setVersion];
}

function ViewToggle() {
  const { t } = useTranslation();
  const [mode, setMode] = useViewMode();
  const isMobile = mode === "mobile";
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={() => setMode(isMobile ? "desktop" : "mobile")}
      title={isMobile ? t('view.toggleDesktop') : t('view.toggleMobile')}
      style={{ gap: 4, fontSize: 12 }}
    >
      {isMobile ? "🖥️" : "📱"}
    </button>
  );
}

function UiVersionToggle() {
  const { t } = useTranslation();
  const [version, setVersion] = useUiVersion();
  const isNew = version === "new";
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={() => setVersion(isNew ? "old" : "new")}
      title={isNew ? t('view.toggleOldUI') : t('view.toggleNewUI')}
      style={{ gap: 4, fontSize: 12 }}
    >
      {isNew ? "🆕" : "🕹️"} {isNew ? t('view.newUI') : t('view.oldUI')}
    </button>
  );
}

function useUiMode() {
  const [mode, setMode] = useState(
    () => localStorage.getItem("marstek_ui_mode") || "classic"
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-ui-mode", mode);
    localStorage.setItem("marstek_ui_mode", mode);
  }, [mode]);
  return [mode, setMode];
}

function UiModeToggle() {
  const { t } = useTranslation();
  const [mode, setMode] = useUiMode();
  const isNew = mode === "new";
  return (
    <button
      className="btn btn-ghost btn-sm ui-mode-toggle"
      onClick={() => setMode(isNew ? "classic" : "new")}
      title={isNew ? t('view.toggleClassic') : t('view.toggleNew')}
      style={{ gap: 4, fontSize: 12 }}
    >
      {isNew ? t('view.classic') : t('view.new')}
    </button>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const current = THEMES.find((t) => t.id === theme) || THEMES[0];
  const detailsRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (detailsRef.current && !detailsRef.current.contains(e.target)) {
        detailsRef.current.open = false;
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  function pick(id) {
    setTheme(id);
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <details ref={detailsRef} className="theme-picker">
      <summary className="btn btn-ghost btn-sm theme-picker-summary" style={{ gap: 4, fontSize: 12 }}>
        {current.icon} {current.label}
      </summary>
      <div className="theme-picker-menu">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={`theme-picker-item${theme === t.id ? " active" : ""}`}
            onClick={() => pick(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
    </details>
  );
}

export default function App() {
  const { t } = useTranslation();

  // ── Auth state (must come before ALL other hooks) ──
  // Start as "app" immediately so the UI never blocks. Auth check runs in
  // the background and only flips to "login" when the server requires it.
  const [authState, setAuthState] = useState("app");
  const [currentUser, setCurrentUser] = useState(null);

  // ── All page/device state (hooks must be declared before any early return) ──
  const [page, setPage]       = useState("batteries");
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [powerMap, setPowerMap] = useState({});
  const [energyMapExpanded, setEnergyMapExpanded] = useState(() => {
    const saved = localStorage.getItem("marstek_energymap_expanded");
    return saved !== null ? saved === "true" : null;
  });

  // ── Background auth probe ──
  useEffect(() => {
    async function checkAuth() {
      const token = getToken();
      if (token) {
        try {
          const res = await apiFetch("/api/auth/me", { headers: authHeaders() });
          if (res.ok) {
            const user = await res.json();
            setCurrentUser({ email: user.email, role: user.role });
            return;
          }
        } catch { /* network error — skip */ }
        clearToken();
      }
      try {
        const probe = await apiFetch("/api/users");
        if (probe.status === 401) setAuthState("login");
      } catch { /* unreachable server — stay on app */ }
    }
    checkAuth();
  }, []);

  // ── Redirect to login when any apiFetch detects an expired token ──
  useEffect(() => {
    function onAuthExpired() {
      setCurrentUser(null);
      setAuthState("login");
    }
    window.addEventListener('auth:expired', onAuthExpired);
    return () => window.removeEventListener('auth:expired', onAuthExpired);
  }, []);

  // ── Apply saved theme/view/ui on mount ──
  useEffect(() => {
    const theme = localStorage.getItem("marstek_theme") || "dark";
    document.documentElement.setAttribute("data-theme", theme);
    const view = localStorage.getItem("marstek_view") || "desktop";
    document.documentElement.setAttribute("data-view", view);
    const ui = localStorage.getItem("marstek_ui") || "old";
    document.documentElement.setAttribute("data-ui", ui);
    const uiMode = localStorage.getItem("marstek_ui_mode") || "classic";
    document.documentElement.setAttribute("data-ui-mode", uiMode);
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await apiFetch("api/devices");
      if (res.ok) setDevices(await res.json());
    } catch { /* keep existing list */ }
    finally   { setLoading(false); }
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  // Once devices load for the first time, set default based on count if no saved preference
  useEffect(() => {
    if (!loading && energyMapExpanded === null) {
      const defaultExpanded = devices.length >= 2;
      localStorage.setItem("marstek_energymap_expanded", String(defaultExpanded));
      setEnergyMapExpanded(defaultExpanded);
    }
  }, [loading, devices.length, energyMapExpanded]);

  const handlePowerUpdate = useCallback((deviceId, data) => {
    setPowerMap((prev) => {
      const cur = prev[deviceId];
      if (cur &&
          cur.acPower === data.acPower &&
          cur.batPower === data.batPower &&
          cur.acVoltage === data.acVoltage) return prev;
      return { ...prev, [deviceId]: data };
    });
  }, []);

  // ── Auth handlers ──
  function handleLogin(user) {
    setCurrentUser(user);
    setAuthState("app");
  }

  function handleLogout() {
    clearToken();
    setCurrentUser(null);
    setAuthState("login");
  }

  // ── Device handlers ──
  const handleDeviceAdded   = (device)  => { setDevices((p) => [...p, device]); };
  const handleDeviceEdited  = (updated) => { setDevices((p) => p.map((d) => d.id === updated.id ? updated : d)); };
  const handleDeviceDeleted = (id)      => {
    setDevices((p) => p.filter((d) => d.id !== id));
    setPowerMap((p) => { const n = { ...p }; delete n[id]; return n; });
  };

  const isAdmin = currentUser?.role === "admin";

  const NAV_ITEMS = [
    { id: "batteries", icon: "🔋", label: t('nav.batteries') },
    { id: "prices",    icon: "⚡", label: t('nav.prices') },
    { id: "forecast",  icon: "☀️", label: t('nav.forecast') },
    { id: "strategy",  icon: "🧠", label: t('nav.strategy') },
    { id: "profit",    icon: "💰", label: t('nav.profit') },
    { id: "frank",     icon: "📊", label: t('nav.history') },
    { id: "settings",  icon: "⚙️", label: t('nav.settings') },
    ...(isAdmin ? [{ id: "users", icon: "👥", label: t('nav.users') }] : []),
  ];

  // Build batteries array for HomeFlow
  const homeFlowBatteries = devices.map((d) => ({
    id: d.id,
    name: d.name,
    ...(powerMap[d.id] ?? {}),
  }));

  const firstWithPhase = Object.values(powerMap).find((p) => p.phaseVoltages);
  const firstWithVolt  = Object.values(powerMap).find((p) => p.acVoltage != null);

  const toggleEnergyMap = () => {
    setEnergyMapExpanded((prev) => {
      const next = !(prev ?? true);
      localStorage.setItem("marstek_energymap_expanded", String(next));
      return next;
    });
  };

  const energyMapVisible = energyMapExpanded ?? true;

  // ── Login screen (after ALL hooks) ──
  if (authState === "login") {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <>
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-header-brand">
          <span className="app-header-logo">🔋</span>
          <div>
            <div className="app-header-title">{t('app.title')}</div>
            <div className="app-header-subtitle app-header-subtitle--desktop">{t('app.subtitle')}</div>
          </div>
        </div>

        {/* Desktop navigation */}
        <nav className="app-nav app-nav--desktop">
          {NAV_ITEMS.map((n) => (
            <button key={n.id}
              className={`nav-btn ${page === n.id ? "active" : ""}`}
              onClick={() => setPage(n.id)}
              aria-current={page === n.id ? "page" : undefined}
            >
              {n.icon} {n.label}
            </button>
          ))}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ViewToggle />
          <UiModeToggle />
          <ThemeToggle />
          <UiVersionToggle />
          <LanguageSwitcher />
          {page === "batteries" && (
            <button className="btn btn-primary btn--add-desktop" onClick={() => setShowAdd(true)}>
              {t('buttons.addDesktop')}
            </button>
          )}
          {currentUser && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleLogout}
              title={`${currentUser.email} — ${t('auth.logout')}`}
              style={{ fontSize: 12 }}
            >
              🔓 {t('auth.logout')}
            </button>
          )}
        </div>
      </header>

      {/* ── Mobile bottom nav ── */}
      <nav className="app-nav--mobile">
        {NAV_ITEMS.map((n) => (
          <button key={n.id}
            className={`mobile-nav-btn ${page === n.id ? "active" : ""}`}
            onClick={() => setPage(n.id)}
            aria-current={page === n.id ? "page" : undefined}
          >
            <span className="mobile-nav-icon">{n.icon}</span>
            <span className="mobile-nav-label">{n.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Main ── */}
      <main className="app-main">
        {page === "batteries" && (
          loading ? (
            <div className="loading-overlay">
              <div className="loading-spinner" />
              <span>{t('loading.devices')}</span>
            </div>
          ) : devices.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔋</div>
              <div className="empty-state-title">{t('empty.title')}</div>
              <div className="empty-state-desc">
                {t('empty.description')}
              </div>
              <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                {t('buttons.addDevice')}
              </button>
            </div>
          ) : (
            <div className="batteries-page">
              {/* ── Aggregated home flow ── */}
              <div className="home-flow-card">
                <button
                  className="home-flow-card-title home-flow-card-toggle"
                  onClick={toggleEnergyMap}
                  aria-expanded={energyMapVisible}
                >
                  {t('cards.powerBalance')}
                  <span className={`home-flow-chevron${energyMapVisible ? " home-flow-chevron--open" : ""}`}>›</span>
                </button>
                <div className={`home-flow-body${energyMapVisible ? " home-flow-body--open" : ""}`}>
                  <EnergyMap
                    batteries={homeFlowBatteries}
                    phaseVoltages={firstWithPhase?.phaseVoltages ?? null}
                    acVoltage={firstWithVolt?.acVoltage ?? null}
                  />
                </div>
              </div>

              {/* ── SMA Inverter live panel ── */}
              <SmaInverterPanel />

              {/* ── HomeWizard panel ── */}
              <HomeWizardPanel />

              {/* ── Individual device cards ── */}
              <div className="device-grid">
                {devices.map((device) => (
                  <DeviceCard
                    key={device.id}
                    device={device}
                    onDelete={handleDeviceDeleted}
                    onEdit={handleDeviceEdited}
                    onPowerUpdate={handlePowerUpdate}
                  />
                ))}
              </div>
            </div>
          )
        )}

        {page === "prices"    && <PricesPage />}
        {page === "forecast"  && <ForecastPage />}
        {page === "strategy"  && <StrategyPage />}
        {page === "profit"    && <ProfitPage />}
        {page === "frank"     && <HistoricalFrankPage />}

        {page === "settings" && (
          <SettingsPage
            devices={devices}
            powerMap={powerMap}
            onDeviceAdded={handleDeviceAdded}
            onDeviceEdited={handleDeviceEdited}
            onDeviceDeleted={handleDeviceDeleted}
          />
        )}

        {page === "users" && isAdmin && <UserManagementPage />}
      </main>

      {/* Mobile FAB for adding devices */}
      {page === "batteries" && (
        <button className="fab" onClick={() => setShowAdd(true)} title={t('fab.addDevice')}>+</button>
      )}

      {showAdd && (
        <AddDeviceModal onClose={() => setShowAdd(false)} onAdded={handleDeviceAdded} />
      )}
    </>
  );
}
