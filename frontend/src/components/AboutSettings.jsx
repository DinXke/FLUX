import { useState, useEffect } from "react";
import { checkForUpdate, downloadAndInstall } from "../lib/updater.ts";

export default function AboutSettings() {
  const buildVersion = import.meta.env.VITE_APP_VERSION || "onbekend";
  const [currentVersion, setCurrentVersion] = useState(buildVersion);
  const [latestVersion, setLatestVersion] = useState(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const autoCheck = async () => {
      try {
        const result = await checkForUpdate();
        if (result.currentVersion && result.currentVersion !== "unknown") {
          setCurrentVersion(result.currentVersion);
        }
        if (result.latestVersion) {
          setLatestVersion(result.latestVersion);
          setHasUpdate(result.hasUpdate);
          localStorage.setItem("flux_version_cache", JSON.stringify(result));
        }
      } catch {
        // silently ignore — version from build env is shown
      }
    };
    autoCheck();
  }, []);

  const handleCheckForUpdate = async () => {
    setChecking(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await checkForUpdate();
      if (result.currentVersion && result.currentVersion !== "onbekend") {
        setCurrentVersion(result.currentVersion);
      }
      if (result.latestVersion) {
        setLatestVersion(result.latestVersion);
        setHasUpdate(result.hasUpdate);
        localStorage.setItem("flux_version_cache", JSON.stringify(result));
        if (result.hasUpdate) setSuccess(true);
        else setError(null);
      }
      if (result.error) {
        setError("Update-check mislukt: " + result.error);
      }
    } catch (err) {
      setError(err.message || "Update-check mislukt");
    } finally {
      setChecking(false);
    }
  };

  const handleDownloadAndInstall = async () => {
    if (!hasUpdate || !latestVersion) return;

    setDownloading(true);
    setError(null);

    try {
      const result = await checkForUpdate();
      if (result.downloadUrl) {
        await downloadAndInstall(result.downloadUrl);
        // Show instructions
        alert(
          "⚠️ Installeren van onbekende bronnen\n\n" +
          "Zorg ervoor dat \"Installeren van onbekende bronnen\" is ingeschakeld in de Android-instellingen.\n\n" +
          "Ga naar: Instellingen > Apps en meldingen > Geavanceerd > App-toestemming > Onbekende apps installeren"
        );
      } else {
        setError("Download URL not found");
      }
    } catch (err) {
      setError(err.message || "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="settings-section">
      <h3>📱 Over deze app</h3>

      <div style={{ marginBottom: "20px" }}>
        <div style={{ marginBottom: "10px" }}>
          <strong>Huidige versie:</strong> {currentVersion}
        </div>
        {latestVersion && (
          <div style={{ marginBottom: "10px" }}>
            <strong>Nieuwste versie:</strong> {latestVersion}
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: "10px",
            marginBottom: "15px",
            backgroundColor: "#fee",
            color: "#c33",
            borderRadius: "4px",
            fontSize: "0.9em",
          }}
        >
          ❌ {error}
        </div>
      )}

      {success && hasUpdate && (
        <div
          style={{
            padding: "10px",
            marginBottom: "15px",
            backgroundColor: "#efe",
            color: "#3c3",
            borderRadius: "4px",
            fontSize: "0.9em",
          }}
        >
          ✅ Update beschikbaar! Klik op "Installeer update" hieronder.
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button
          onClick={handleCheckForUpdate}
          disabled={checking}
          style={{
            padding: "10px 15px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: checking ? "wait" : "pointer",
            opacity: checking ? 0.6 : 1,
          }}
        >
          {checking ? "⏳ Controleren..." : "🔄 Controleer op updates"}
        </button>

        {hasUpdate && (
          <button
            onClick={handleDownloadAndInstall}
            disabled={downloading}
            style={{
              padding: "10px 15px",
              backgroundColor: "#28a745",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: downloading ? "wait" : "pointer",
              opacity: downloading ? 0.6 : 1,
            }}
          >
            {downloading ? "⬇️ Downloaden..." : "📥 Installeer update"}
          </button>
        )}
      </div>

      <div
        style={{
          marginTop: "20px",
          padding: "10px",
          backgroundColor: "#f5f5f5",
          borderRadius: "4px",
          fontSize: "0.85em",
          color: "#666",
        }}
      >
        <strong>ℹ️ Hoe het werkt:</strong>
        <ul style={{ marginTop: "5px" }}>
          <li>Klik op "Controleer op updates" om te kijken of er een nieuwere versie is</li>
          <li>Als er een update beschikbaar is, klik je op "Installeer update"</li>
          <li>De APK wordt gedownload en de installatie start automatisch</li>
          <li>Volg de Android-installatiewizard af</li>
        </ul>
      </div>
    </div>
  );
}
