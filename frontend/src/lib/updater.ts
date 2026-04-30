import { registerPlugin } from '@capacitor/core';
import type { Plugin } from '@capacitor/core';

interface UpdatePluginPlugin extends Plugin {
  checkForUpdate(): Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    downloadUrl?: string;
    error?: string;
  }>;
  downloadAndInstall(options: { url: string }): Promise<{ downloading: boolean }>;
}

const UpdatePlugin = registerPlugin<UpdatePluginPlugin>('Update');

export async function checkForUpdate() {
  try {
    // Check if running on Android
    if (!window.Capacitor?.isPluginAvailable('Update')) {
      return {
        hasUpdate: false,
        currentVersion: 'unknown',
        error: 'Update plugin not available',
      };
    }

    const result = await UpdatePlugin.checkForUpdate();
    return result;
  } catch (error) {
    console.error('Error checking for update:', error);
    return {
      hasUpdate: false,
      currentVersion: 'unknown',
      error: String(error),
    };
  }
}

export async function downloadAndInstall(url: string) {
  try {
    if (!window.Capacitor?.isPluginAvailable('Update')) {
      throw new Error('Update plugin not available');
    }

    const result = await UpdatePlugin.downloadAndInstall({ url });
    return result;
  } catch (error) {
    console.error('Error downloading update:', error);
    throw error;
  }
}
