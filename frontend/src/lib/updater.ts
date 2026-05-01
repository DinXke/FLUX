import { registerPlugin } from '@capacitor/core';
import type { Plugin } from '@capacitor/core';

interface UpdatePluginPlugin extends Plugin {
  downloadAndInstall(options: { url: string }): Promise<{ downloading: boolean }>;
}

const UpdatePlugin = registerPlugin<UpdatePluginPlugin>('Update');

const GITHUB_API = 'https://api.github.com/repos/DinXke/FLUX/releases/latest';

export async function checkForUpdate() {
  const currentVersion = import.meta.env.VITE_APP_VERSION || 'onbekend';
  try {
    const res = await fetch(GITHUB_API);
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    const latestVersion: string = data.tag_name?.replace(/^v/, '') ?? '';
    const downloadUrl: string =
      data.assets?.find((a: { name: string; browser_download_url: string }) =>
        a.name.endsWith('.apk')
      )?.browser_download_url ?? '';
    const hasUpdate =
      !!latestVersion &&
      !!currentVersion &&
      currentVersion !== 'onbekend' &&
      latestVersion !== currentVersion;
    return { hasUpdate, currentVersion, latestVersion, downloadUrl };
  } catch (error) {
    return { hasUpdate: false, currentVersion, error: String(error) };
  }
}

export async function downloadAndInstall(url: string) {
  if (!window.Capacitor?.isPluginAvailable('Update')) {
    throw new Error('Native update plugin niet beschikbaar — installeer de APK handmatig');
  }
  return UpdatePlugin.downloadAndInstall({ url });
}
