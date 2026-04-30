import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Battery, Zap, Sun, Brain, TrendingUp, Settings, LogOut, Menu, Moon, Palette, Eye, GripVertical } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import DeviceCard from "./components/DeviceCard.jsx";
import AddDeviceModal from "./components/AddDeviceModal.jsx";
import PricesPage from "./components/PricesPage.jsx";
import ForecastPage from "./components/ForecastPage.jsx";
import StrategyPage from "./components/StrategyPage.jsx";
import SettingsPage from "./components/SettingsPage.jsx";
import AnalysePage from "./components/AnalysePage.jsx";
import EnergyMap from "./components/EnergyMap.jsx";
import HomeWizardPanel from "./components/HomeWizardPanel.jsx";
import SmaInverterPanel from "./components/SmaInverterPanel.jsx";
import LanguageSwitcher from "./components/LanguageSwitcher.jsx";
import LoginPage from "./components/LoginPage.jsx";
import UserManagementPage from "./components/UserManagementPage.jsx";
import { getToken, clearToken, authHeaders, apiFetch, getServerUrl } from "./auth.js";
import ServerSetupPage from "./components/ServerSetupPage.jsx";
import { bootstrapFlowCfg } from "./components/FlowSourcesSettings.jsx";

// ── Dashboard section order + collapse (per user) ────────────────────────────

const DASH_SECTIONS = ["flow", "sma", "homewizard", "devices"];

function loadDashLayout(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    const savedOrder = Array.isArray(saved.order) ? saved.order : [];
    const order = [
      ...savedOrder.filter((id) => DASH_SECTIONS.includes(id)),
      ...DASH_SECTIONS.filter((id) => !savedOrder.includes(id)),
    ];
    return { order, collapsed: saved.collapsed || {} };
  } catch {
    return { order: DASH_SECTIONS, collapsed: {} };
  }
}

function useDashboardLayout(userEmail) {
  const key = `flux_dash_${userEmail || "guest"}`;
  const [layout, setLayout] = useState(() => loadDashLayout(key));

  // Reload when the user key changes (login/logout)
  const prevKey = useRef(key);
  useEffect(() => {
    if (prevKey.current !== key) {
      prevKey.current = key;
      setLayout(loadDashLayout(key));
    }
  }, [key]);

  // Persist changes
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(layout));
  }, [layout, key]);

  const toggleCollapse = useCallback((id) => {
    setLayout((l) => ({ ...l, collapsed: { ...l.collapsed, [id]: !l.collapsed[id] } }));
  }, []);

  const reorder = useCallback((fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    setLayout((l) => {
      const order = [...l.order];
      const [item] = order.splice(fromIdx, 1);
      order.splice(toIdx, 0, item);
      return { ...l, order };
    });
  }, []);

  return { layout, toggleCollapse, reorder };
}

// ── SortableDashboardSection (using @dnd-kit for touch-native support) ──────

function SortableDashboardSection({ id, title, extra, collapsed, onToggle, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`dash-section${isDragging ? " dash-section--dragging" : ""}`}
    >
      <div className="dash-section-header">
        <span
          className="dash-section-handle"
          {...listeners}
          {...attributes.listeners}
          title="Versleep om te herordenen"
          style={{ cursor: isDragging ? "grabbing" : "grab", display: "flex", alignItems: "center" }}
        >
          <GripVertical size={18} />
        </span>
        <button className="dash-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
          <span className="dash-section-title">{title}</span>
          <span className={`dash-section-chevron${collapsed ? "" : " dash-section-chevron--open"}`}>›</span>
        </button>
        {extra && <div className="dash-section-extra">{extra}</div>}
      </div>
      <div className={`dash-section-body${collapsed ? "" : " dash-section-body--open"}`}>
        {children}
      </div>
    </div>
  );
}

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
  const isNativeApp = typeof window !== 'undefined' &&
    (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.isNative === true);
  const needsServerSetup = isNativeApp && !getServerUrl();
  const [authState, setAuthState] = useState(needsServerSetup ? "serverSetup" : "app");
  const [currentUser, setCurrentUser] = useState(null);

  // ── All page/device state (hooks must be declared before any early return) ──
  const [page, setPage]       = useState("batteries");
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [powerMap, setPowerMap] = useState({});

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
            bootstrapFlowCfg(apiFetch);
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

  const [devicesError, setDevicesError] = useState(null);
  const fetchDevices = useCallback(async () => {
    try {
      const res = await apiFetch("/api/devices");
      if (res.ok) {
        setDevices(await res.json());
        setDevicesError(null);
      } else {
        setDevicesError(`Server fout: ${res.status}`);
      }
    } catch (e) {
      setDevicesError(`Verbinding mislukt: ${e.message}`);
    }
    finally   { setLoading(false); }
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  // ── Auto-update check (Capacitor native only) ──
  useEffect(() => {
    if (!isNativeApp || authState !== "app") return;
    const cap = window.Capacitor;
    if (!cap) return;
    cap.Plugins?.UpdatePlugin?.checkForUpdate?.().then(result => {
      if (result?.hasUpdate && result?.downloadUrl) {
        const ok = window.confirm(
          `FLUX update beschikbaar: v${result.latestVersion}\n(huidig: v${result.currentVersion})\n\nNu installeren?`
        );
        if (ok) cap.Plugins?.UpdatePlugin?.downloadAndInstall?.({ url: result.downloadUrl });
      }
    }).catch(() => { /* update check mislukt, stil negeren */ });
  }, [isNativeApp, authState]);

  const { layout, toggleCollapse, reorder } = useDashboardLayout(currentUser?.email);

  // Setup @dnd-kit sensors for touch and pointer support
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const activeIdx = layout.order.indexOf(active.id);
      const overIdx = layout.order.indexOf(over.id);
      if (activeIdx >= 0 && overIdx >= 0) {
        reorder(activeIdx, overIdx);
      }
    }
  }, [layout.order, reorder]);

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
  function handleServerSetupComplete() {
    async function checkAuth() {
      const token = getToken();
      if (token) {
        try {
          const res = await apiFetch("/api/auth/me", { headers: authHeaders() });
          if (res.ok) {
            const user = await res.json();
            setCurrentUser({ email: user.email, role: user.role });
            bootstrapFlowCfg(apiFetch);
            setAuthState("app");
            return;
          }
        } catch { /* network error */ }
        clearToken();
      }
      try {
        const probe = await apiFetch("/api/users");
        if (probe.status === 401) {
          setAuthState("login");
          return;
        }
      } catch { /* unreachable — stay on app */ }
      setAuthState("app");
    }
    checkAuth();
  }

  function handleLogin(user) {
    setCurrentUser(user);
    setAuthState("app");
    bootstrapFlowCfg(apiFetch);
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

  const [mode] = useViewMode();
  const isMobile = mode === "mobile";
  const isAdmin = currentUser?.role === "admin";

  const NAV_ITEMS = [
    { id: "batteries", Icon: Battery, label: t('nav.batteries') },
    { id: "prices",    Icon: Zap, label: t('nav.prices') },
    { id: "forecast",  Icon: Sun, label: t('nav.forecast') },
    { id: "strategy",  Icon: Brain, label: t('nav.strategy') },
    { id: "analyse",   Icon: TrendingUp, label: t('nav.analyse', 'Analyse') },
    { id: "settings",  Icon: Settings, label: t('nav.settings') },
  ];

  // Build batteries array for HomeFlow
  const homeFlowBatteries = devices.map((d) => ({
    id: d.id,
    name: d.name,
    ...(powerMap[d.id] ?? {}),
  }));

  const firstWithPhase = Object.values(powerMap).find((p) => p.phaseVoltages);
  const firstWithVolt  = Object.values(powerMap).find((p) => p.acVoltage != null);

  const energyMapRef = useRef(null);
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      energyMapRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  // ── Server setup screen (Capacitor only) ──
  if (authState === "serverSetup") {
    return <ServerSetupPage onComplete={handleServerSetupComplete} />;
  }

  // ── Login screen (after ALL hooks) ──
  if (authState === "login") {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <>
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-header-brand">
          <span className="app-header-logo"><Battery size={24} /></span>
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
              <n.Icon size={18} style={{ marginRight: 4 }} /> {n.label}
            </button>
          ))}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!isMobile && (
            <>
              <ViewToggle />
              <UiModeToggle />
              <ThemeToggle />
              <UiVersionToggle />
              <LanguageSwitcher />
            </>
          )}
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
              <LogOut size={16} style={{ marginRight: 4 }} /> {t('auth.logout')}
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
            <span className="mobile-nav-icon"><n.Icon size={24} /></span>
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
              {devicesError ? (
                <>
                  <div className="empty-state-title">Verbindingsfout</div>
                  <div className="empty-state-desc" style={{color:'#f87171',fontFamily:'monospace',fontSize:'0.85em'}}>{devicesError}</div>
                  {isNativeApp && (
                    <button className="btn btn-secondary" style={{marginBottom:'0.5rem'}} onClick={() => setAuthState("serverSetup")}>
                      Server URL wijzigen
                    </button>
                  )}
                  <button className="btn btn-primary" onClick={fetchDevices}>Opnieuw proberen</button>
                </>
              ) : (
                <>
                  <div className="empty-state-title">{t('empty.title')}</div>
                  <div className="empty-state-desc">{t('empty.description')}</div>
                  <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                    {t('buttons.addDevice')}
                  </button>
                </>
              )}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <div className="batteries-page">
                <SortableContext items={layout.order} strategy={verticalListSortingStrategy}>
                  {layout.order.map((sectionId) => {
                    const collapsed = !!layout.collapsed[sectionId];
                    const sectionProps = {
                      id: sectionId,
                      title: sectionId === "flow"       ? t('cards.powerBalance')
                           : sectionId === "sma"        ? t('sma.panelTitle', 'SMA Omvormer')
                           : sectionId === "homewizard" ? "HomeWizard"
                           : t('nav.batteries'),
                      collapsed,
                      onToggle:  () => toggleCollapse(sectionId),
                    };

                    if (sectionId === "flow") return (
                      <SortableDashboardSection
                        key={sectionId}
                        {...sectionProps}
                        extra={
                          <button
                            className="home-flow-fullscreen-btn"
                            onClick={toggleFullscreen}
                            title="Volledig scherm"
                            aria-label="Volledig scherm"
                          >⛶</button>
                        }
                      >
                        <div ref={energyMapRef} style={{ padding: "4px 12px 12px" }}>
                          <EnergyMap
                            batteries={homeFlowBatteries}
                            phaseVoltages={firstWithPhase?.phaseVoltages ?? null}
                            acVoltage={firstWithVolt?.acVoltage ?? null}
                          />
                        </div>
                      </SortableDashboardSection>
                    );

                    if (sectionId === "sma") return (
                      <SortableDashboardSection key={sectionId} {...sectionProps}>
                        <SmaInverterPanel />
                      </SortableDashboardSection>
                    );

                    if (sectionId === "homewizard") return (
                      <SortableDashboardSection key={sectionId} {...sectionProps}>
                        <HomeWizardPanel />
                      </SortableDashboardSection>
                    );

                    return (
                      <SortableDashboardSection key={sectionId} {...sectionProps}>
                        <div className="device-grid" style={{ padding: "12px 14px 14px" }}>
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
                      </SortableDashboardSection>
                    );
                  })}
                </SortableContext>
              </div>
            </DndContext>
          )
        )}

        {page === "prices"    && <PricesPage />}
        {page === "forecast"  && <ForecastPage />}
        {page === "strategy"  && <StrategyPage />}
        {page === "analyse"   && <AnalysePage />}

        {page === "settings" && (
          <SettingsPage
            devices={devices}
            powerMap={powerMap}
            onDeviceAdded={handleDeviceAdded}
            onDeviceEdited={handleDeviceEdited}
            onDeviceDeleted={handleDeviceDeleted}
            isMobile={isMobile}
            theme={localStorage.getItem("marstek_theme") || "dark"}
            onThemeChange={(theme) => {
              localStorage.setItem("marstek_theme", theme);
              document.documentElement.setAttribute("data-theme", theme);
            }}
            uiMode={localStorage.getItem("marstek_ui_mode") || "classic"}
            onUiModeChange={(mode) => {
              localStorage.setItem("marstek_ui_mode", mode);
              document.documentElement.setAttribute("data-ui-mode", mode);
            }}
            uiVersion={localStorage.getItem("marstek_ui") || "old"}
            onUiVersionChange={(version) => {
              localStorage.setItem("marstek_ui", version);
              document.documentElement.setAttribute("data-ui", version);
            }}
            viewMode={mode}
            onViewModeChange={(newMode) => {
              localStorage.setItem("marstek_view", newMode);
              document.documentElement.setAttribute("data-view", newMode);
            }}
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
