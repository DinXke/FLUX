package one.scheepers.flux;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "Update")
public class UpdatePlugin extends Plugin {

    private static final String TAG = "UpdatePlugin";
    private long downloadId = -1;
    private String downloadUrl = "";

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        new Thread(() -> {
            try {
                String currentVersion = BuildConfig.VERSION_NAME;
                URL url = new URL("https://api.github.com/repos/DinXke/FLUX/releases/latest");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);

                int responseCode = conn.getResponseCode();
                if (responseCode != 200) {
                    JSObject ret = new JSObject();
                    ret.put("hasUpdate", false);
                    ret.put("currentVersion", currentVersion);
                    ret.put("error", "Failed to fetch releases");
                    call.resolve(ret);
                    return;
                }

                InputStream is = conn.getInputStream();
                StringBuilder response = new StringBuilder();
                byte[] data = new byte[1024];
                int bytesRead;
                while ((bytesRead = is.read(data)) != -1) {
                    response.append(new String(data, 0, bytesRead));
                }
                is.close();
                conn.disconnect();

                JSONObject release = new JSONObject(response.toString());
                String tagName = release.getString("tag_name");
                String latestVersion = tagName.startsWith("v") ? tagName.substring(1) : tagName;
                String downloadUrl = null;

                if (release.has("assets")) {
                    JSONObject assets = release.getJSONArray("assets").getJSONObject(0);
                    downloadUrl = assets.getString("browser_download_url");
                }

                boolean hasUpdate = !currentVersion.equals(latestVersion) && compareVersions(latestVersion, currentVersion) > 0;

                JSObject ret = new JSObject();
                ret.put("hasUpdate", hasUpdate);
                ret.put("currentVersion", currentVersion);
                ret.put("latestVersion", latestVersion);
                ret.put("downloadUrl", downloadUrl);
                call.resolve(ret);

            } catch (Exception e) {
                Log.e(TAG, "Error checking for update", e);
                JSObject ret = new JSObject();
                ret.put("hasUpdate", false);
                ret.put("error", e.getMessage());
                call.reject(e.getMessage(), ret);
            }
        }).start();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL is required");
            return;
        }

        downloadUrl = url;

        try {
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, "flux_update.apk");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

            downloadId = dm.enqueue(request);

            BroadcastReceiver receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (id == downloadId) {
                        installApk(context, url);
                        try {
                            getContext().unregisterReceiver(this);
                        } catch (Exception e) {
                            Log.e(TAG, "Error unregistering receiver", e);
                        }
                    }
                }
            };

            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                getContext().registerReceiver(receiver, filter);
            }

            JSObject ret = new JSObject();
            ret.put("downloading", true);
            call.resolve(ret);

        } catch (Exception e) {
            Log.e(TAG, "Error starting download", e);
            call.reject("Download failed: " + e.getMessage());
        }
    }

    private void installApk(Context context, String url) {
        try {
            File apkFile = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "flux_update.apk");
            if (!apkFile.exists()) {
                Log.e(TAG, "APK file not found: " + apkFile.getAbsolutePath());
                return;
            }

            Uri apkUri = FileProvider.getUriForFile(context, context.getApplicationContext().getPackageName() + ".fileprovider", apkFile);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            context.startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Error installing APK", e);
        }
    }

    private int compareVersions(String v1, String v2) {
        String[] parts1 = v1.split("\\.");
        String[] parts2 = v2.split("\\.");

        int maxLen = Math.max(parts1.length, parts2.length);
        for (int i = 0; i < maxLen; i++) {
            int p1 = i < parts1.length ? Integer.parseInt(parts1[i]) : 0;
            int p2 = i < parts2.length ? Integer.parseInt(parts2[i]) : 0;
            if (p1 != p2) return Integer.compare(p1, p2);
        }
        return 0;
    }
}
