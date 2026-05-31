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

function isApiAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.pywebview?.api;
}

function getApi(): Record<string, (...args: any[]) => Promise<any>> {
  if (isApiAvailable()) {
    return window.pywebview!.api;
  }
  return new Proxy({} as Record<string, (...args: any[]) => Promise<any>>, {
    get(_target, prop: string) {
      return (..._args: any[]) => {
        console.warn(`pywebview API not available: ${prop}()`);
        return Promise.resolve(null);
      };
    },
  });
}

export async function getCurrentWallpaper(): Promise<WallpaperInfo | null> {
  return getApi().get_current_wallpaper();
}

export async function setWallpaper(path: string): Promise<void> {
  return getApi().set_wallpaper(path);
}

export async function getBingWallpaper(): Promise<BingWallpaper | null> {
  return getApi().get_bing_wallpaper();
}

export async function getSpotlightWallpapers(): Promise<SpotlightImage[] | null> {
  return getApi().get_spotlight_wallpapers();
}

export async function getHitokoto(categories?: string[]): Promise<Hitokoto | null> {
  return getApi().get_hitokoto(categories);
}

export async function downloadFile(url: string, filename?: string): Promise<string | null> {
  return getApi().download_file(url, filename);
}

export async function copyToClipboard(text: string): Promise<void> {
  return getApi().copy_to_clipboard(text);
}

export async function saveFileDialog(data: string, filename: string): Promise<void> {
  return getApi().save_file_dialog(data, filename);
}

export async function sniffImages(url: string): Promise<SniffedImage[]> {
  return getApi().sniff_images(url);
}

export async function getFavorites(): Promise<{ folders: FavoriteFolder[]; items: FavoriteItem[] }> {
  return getApi().get_favorites();
}

export async function addFavorite(item: Omit<FavoriteItem, 'id' | 'created_at'>): Promise<FavoriteItem> {
  return getApi().add_favorite(item);
}

export async function updateFavorite(item: FavoriteItem): Promise<void> {
  return getApi().update_favorite(item);
}

export async function removeFavorite(id: string): Promise<void> {
  return getApi().remove_favorite(id);
}

export async function createFavoriteFolder(name: string, description?: string): Promise<FavoriteFolder> {
  return getApi().create_favorite_folder(name, description);
}

export async function getStoreResources(type: string): Promise<StoreResource[]> {
  return getApi().get_store_resources(type);
}

export async function installStoreResource(resource: StoreResource): Promise<void> {
  return getApi().install_store_resource(resource);
}

export async function getSettings(): Promise<AppSettings> {
  return getApi().get_settings();
}

export async function setSettings(settings: AppSettings): Promise<void> {
  return getApi().set_settings(settings);
}

export async function getSetting(key: string): Promise<any> {
  return getApi().get_setting(key);
}

export async function setSetting(key: string, value: any): Promise<void> {
  return getApi().set_setting(key, value);
}

export async function getHistory(): Promise<{ path: string; title: string; reason: string; time: string }[]> {
  return getApi().get_history();
}

export async function addToHistory(path: string, title: string, reason: string): Promise<void> {
  return getApi().add_to_history(path, title, reason);
}

export async function checkForUpdates(): Promise<{ has_update: boolean; version: string; changelog: string } | null> {
  return getApi().check_for_updates();
}

export async function openFolder(path: string): Promise<void> {
  return getApi().open_folder(path);
}

export async function openUrl(url: string): Promise<void> {
  return getApi().open_url(url);
}

export async function getWallpaperSources(): Promise<{ id: string; name: string; enabled: boolean }[]> {
  return getApi().get_wallpaper_sources();
}

export async function selectLocalImage(): Promise<string | null> {
  return getApi().select_local_image();
}

export async function exportFavorites(folderId?: string): Promise<string> {
  return getApi().export_favorites(folderId);
}

export async function importFavorites(path: string): Promise<void> {
  return getApi().import_favorites(path);
}
