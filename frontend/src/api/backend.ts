import type {
  WallpaperInfo,
  BingWallpaper,
  SpotlightImage,
  Hitokoto,
  FavoriteItem,
  FavoriteFolder,
  SniffedImage,
  StoreResource,
  AppSettings,
} from '@/types';

async function waitForApi(): Promise<void> {
  if (typeof window !== 'undefined' && window.pywebview?.api) {
    return;
  }
  return new Promise((resolve) => {
    const onReady = () => resolve();
    window.addEventListener('pywebviewready', onReady, { once: true });
  });
}

async function call<T>(method: string, ...args: any[]): Promise<T> {
  await waitForApi();
  const api = window.pywebview!.api;
  const fn = api[method];
  if (typeof fn !== 'function') {
    throw new Error(`未找到后端方法: ${method}`);
  }
  return fn(...args);
}

// --- Global bootstrap cache ---
let _bootstrapCache: any = null;
let _bootstrapPromise: Promise<any> | null = null;

export async function bootstrapCached(force = false): Promise<any> {
  if (!force && _bootstrapCache) return _bootstrapCache;
  if (!force && _bootstrapPromise) return _bootstrapPromise;
  _bootstrapPromise = call<any>('bootstrap').then((data) => {
    _bootstrapCache = data;
    return data;
  });
  return _bootstrapPromise;
}

export function getBootstrapCache(): any {
  return _bootstrapCache;
}

export function invalidateBootstrapCache(): void {
  _bootstrapCache = null;
  _bootstrapPromise = null;
}

export async function getCurrentWallpaper(): Promise<WallpaperInfo | null> {
  return call('get_current_wallpaper');
}

export async function setWallpaper(path: string): Promise<void> {
  return call('set_wallpaper', path);
}

export async function getBingWallpaper(): Promise<BingWallpaper | null> {
  return call('get_bing_wallpaper');
}

export async function getSpotlightWallpapers(): Promise<SpotlightImage[] | null> {
  return call('get_spotlight_wallpapers');
}

export async function getHitokoto(categories?: string[]): Promise<Hitokoto | null> {
  return call('get_hitokoto', categories);
}

export async function downloadFile(url: string, filename?: string): Promise<string | null> {
  return call('download_file', url, filename);
}

export async function copyToClipboard(text: string): Promise<void> {
  return call('copy_to_clipboard', text);
}

export async function saveFileDialog(data: string, filename: string): Promise<void> {
  return call('save_file_dialog', data, filename);
}

export async function sniffImages(url: string): Promise<SniffedImage[]> {
  return call('sniff_images', url);
}

export async function getFavorites(): Promise<{ folders: FavoriteFolder[]; items: FavoriteItem[] }> {
  return call('get_favorites');
}

export async function addFavorite(item: Omit<FavoriteItem, 'id' | 'created_at'>): Promise<FavoriteItem> {
  return call('add_favorite', item);
}

export async function updateFavorite(item: FavoriteItem): Promise<void> {
  return call('update_favorite', item);
}

export async function removeFavorite(id: string): Promise<void> {
  return call('remove_favorite', id);
}

export async function createFavoriteFolder(name: string, description?: string): Promise<FavoriteFolder> {
  return call('create_favorite_folder', name, description);
}

export async function getStoreResources(type: string): Promise<StoreResource[]> {
  return call('get_store_resources', type);
}

export async function installStoreResource(resource: StoreResource): Promise<void> {
  return call('install_store_resource', resource);
}

export async function getSettings(): Promise<AppSettings> {
  return call('get_settings');
}

export async function setSettings(settings: AppSettings): Promise<void> {
  return call('set_settings', settings);
}

export async function getSetting(key: string): Promise<any> {
  return call('get_setting', key);
}

export async function setSetting(key: string, value: any): Promise<void> {
  return call('set_setting', key, value);
}

export async function getHistory(): Promise<{ path: string; title: string; reason: string; time: string }[]> {
  return call('get_history');
}

export async function addToHistory(path: string, title: string, reason: string): Promise<void> {
  return call('add_to_history', path, title, reason);
}

export async function checkForUpdates(): Promise<{ has_update: boolean; version: string; changelog: string } | null> {
  return call('check_for_updates');
}

export async function openFolder(path: string): Promise<void> {
  return call('open_folder', path);
}

export async function openUrl(url: string): Promise<void> {
  return call('open_url', url);
}

export async function getWallpaperSources(): Promise<{ id: string; name: string; enabled: boolean }[]> {
  return call('get_wallpaper_sources');
}

export async function selectLocalImage(): Promise<string | null> {
  return call('select_local_image');
}

export async function exportFavorites(folderId?: string): Promise<string> {
  return call('export_favorites', folderId);
}

export async function importFavorites(path: string): Promise<void> {
  return call('import_favorites', path);
}

// --- Enhanced API methods ---

export async function bootstrap(): Promise<any> {
  return call('bootstrap');
}

export async function queryBing(
  category: string = 'daily',
  market: string = 'zh-CN',
  count: number = 8,
  quality: string = 'highDef'
): Promise<any[]> {
  return call('query_bing', category, market, count, quality);
}

export async function querySpotlight(
  source: string = 'local',
  limit: number = 20,
  market: string = 'zh-CN'
): Promise<any[]> {
  return call('query_spotlight', source, limit, market);
}

export async function listHistory(): Promise<any[]> {
  return call('list_history');
}

export async function recordCurrentWallpaper(): Promise<any | null> {
  return call('record_current_wallpaper');
}

export async function runtimeSnapshot(): Promise<any> {
  return call('runtime_snapshot');
}

export async function getStorageOverview(): Promise<any> {
  return call('get_storage_overview');
}

export async function pickDownloadDirectory(): Promise<{ path: string } | null> {
  return call('pick_download_directory');
}

export async function setDownloadDirectory(directory?: string): Promise<any> {
  return call('set_download_directory', directory);
}

export async function updateSettings(updates: Record<string, any>): Promise<any> {
  return call('update_settings', updates);
}

export async function triggerAutoChangeNow(planId?: string): Promise<any> {
  return call('trigger_auto_change_now', planId);
}

export async function getDebugLog(lines: number = 240): Promise<any> {
  return call('get_debug_log', lines);
}

export async function openDebugLogDirectory(): Promise<any> {
  return call('open_debug_log_directory');
}

export async function openDebugLogFile(): Promise<any> {
  return call('open_debug_log_file');
}
