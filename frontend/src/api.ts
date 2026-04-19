import type { BootstrapPayload, CurrentWallpaperInfo, DebugLogPayload, FavoritePayload, IntelligentMarketHealthUpdate, IntelligentMarketSource, StorageCleanupResult, StorageOptimizeResult, StorageOverviewPayload, StoreResource, WallpaperItem, WallpaperSource } from './types';
import type { ThemeDocument } from './themeSystem';

export type ThemeAssetPayload = {
  path: string;
  name: string;
  mime_type: string;
  data_base64: string;
};

declare global {
  interface Window {
    pywebview?: {
      api: Record<string, (...args: unknown[]) => Promise<any>>;
    };
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function waitForBridgeMethod(method: string, timeoutMs = 3000) {
  const startedAt = Date.now();
  let sawReadyEvent = false;

  const onReady = () => {
    sawReadyEvent = true;
  };

  window.addEventListener('pywebviewready', onReady, { once: true });

  try {
    while (Date.now() - startedAt < timeoutMs) {
      const api = window.pywebview?.api;
      if (api && typeof api[method] === 'function') {
        return api;
      }

      await sleep(sawReadyEvent ? 25 : 50);
    }
  } finally {
    window.removeEventListener('pywebviewready', onReady);
  }

  if (!window.pywebview?.api) {
    throw new Error('pywebview bridge 不可用，请从桌面宿主启动应用');
  }

  throw new Error(`后端桥接尚未完成初始化: ${method}`);
}

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const api = await waitForBridgeMethod(method);
  const fn = api[method];
  if (typeof fn !== 'function') {
    throw new Error(`未找到后端方法: ${method}`);
  }

  const normalizedArgs = [...args];
  while (normalizedArgs.length > 0 && typeof normalizedArgs[normalizedArgs.length - 1] === 'undefined') {
    normalizedArgs.pop();
  }

  return fn(...normalizedArgs) as Promise<T>;
}

export const desktopApi = {
  bootstrap: () => call<BootstrapPayload>('bootstrap'),
  queryBing: (category = 'daily', market = 'zh-CN', count = 8, quality = 'highDef') => call<WallpaperItem[]>('query_bing', category, market, count, quality),
  querySpotlight: (source = 'local', limit = 20, market = 'zh-CN') => call<WallpaperItem[]>('query_spotlight', source, limit, market),
  listSources: () => call<WallpaperSource[]>('list_wallpaper_sources'),
  executeSource: (sourceId: string, apiName: string, parameters: Record<string, unknown>) =>
    call<WallpaperItem[]>('execute_wallpaper_source', sourceId, apiName, parameters),
  listIntelligentMarketSources: (force = false) =>
    call<IntelligentMarketSource[]>('list_intelligent_market_sources', force),
  checkIntelligentMarketSourcesHealth: (sourceIds?: string[], force = false) =>
    call<IntelligentMarketHealthUpdate[]>('check_intelligent_market_sources_health', sourceIds, force),
  executeIntelligentMarketSource: (sourceId: string, parameters: Record<string, unknown>) =>
    call<WallpaperItem[]>('execute_intelligent_market_source', sourceId, parameters),
  toggleFavorite: (wallpaper: WallpaperItem, folderId?: string) => call<{ liked: boolean; favorites: FavoritePayload }>('toggle_favorite', wallpaper, folderId),
  listFavorites: () => call<FavoritePayload>('list_favorites'),
  createFavoriteFolder: (name: string, description?: string) => call<{ folder: FavoritePayload['folders'][number] | null; favorites: FavoritePayload }>('create_favorite_folder', name, description),
  renameFavoriteFolder: (folderId: string, name?: string, description?: string) =>
    call<{ success: boolean; favorites: FavoritePayload }>('rename_favorite_folder', folderId, name, description),
  deleteFavoriteFolder: (folderId: string, moveItemsTo?: string) =>
    call<{ success: boolean; favorites: FavoritePayload }>('delete_favorite_folder', folderId, moveItemsTo),
  moveFavoriteItem: (itemId: string, folderId: string) =>
    call<{ success: boolean; favorites: FavoritePayload }>('move_favorite_item', itemId, folderId),
  localizeFavoriteItem: (itemId: string) =>
    call<{ local_path: string; favorites: FavoritePayload }>('localize_favorite_item', itemId),
  resetFavoriteLocalization: (itemId: string) =>
    call<{ success: boolean; favorites: FavoritePayload }>('reset_favorite_localization', itemId),
  addLocalImagesToFavorites: (folderId?: string) =>
    call<{ added_count: number; favorites: FavoritePayload } | null>('add_local_images_to_favorites', folderId),
  getStorageOverview: () => call<StorageOverviewPayload>('get_storage_overview'),
  pickDownloadDirectory: () => call<{ path: string } | null>('pick_download_directory'),
  setDownloadDirectory: (directory?: string) =>
    call<{ settings: Record<string, unknown>; storage: StorageOverviewPayload }>('set_download_directory', directory),
  openStorageTarget: (targetId: string) => call<{ opened_path: string }>('open_storage_target', targetId),
  clearStorageTargets: (targetIds: string[]) => call<StorageCleanupResult>('clear_storage_targets', targetIds),
  optimizeStorageTargets: (targetIds: string[], quality: number) =>
    call<StorageOptimizeResult>('optimize_storage_targets', targetIds, quality),
  importFavorites: () => call<{ created_folders: number; imported_items: number; favorites: FavoritePayload } | null>('import_favorites'),
  exportFavorites: (folderIds?: string[], itemIds?: string[], includeAssets = true) =>
    call<{ saved_path: string; folder_count: number; item_count: number; include_assets: boolean; favorites: FavoritePayload } | null>('export_favorites', folderIds, itemIds, includeAssets),
  importTheme: () => call<ThemeDocument | null>('import_theme'),
  exportTheme: (themeDocument: ThemeDocument, suggestedName?: string) =>
    call<{ saved_path: string } | null>('export_theme', themeDocument, suggestedName),
  pickThemeAsset: (assetKind: 'image' | 'video' | 'poster') => call<{ path: string } | null>('pick_theme_asset', assetKind),
  readThemeAsset: (assetRef: string) => call<ThemeAssetPayload | null>('read_theme_asset', assetRef),
  updateSettings: (updates: Record<string, unknown>) => call<Record<string, unknown>>('update_settings', updates),
  setWallpaper: (wallpaper: WallpaperItem) => call<{ local_path: string; message: string }>('set_wallpaper', wallpaper),
  downloadWallpaper: (wallpaper: WallpaperItem) => call<{ local_path: string }>('download_wallpaper', wallpaper),
  loadStore: (baseUrl?: string) => call<Record<string, unknown>>('load_store', baseUrl),
  listStoreResources: (resourceType: string = 'theme', baseUrl?: string) =>
    call<StoreResource[]>('list_store_resources', resourceType, baseUrl),
  getStoreResource: (resourceType: string, filename: string, baseUrl?: string) =>
    call<StoreResource | null>('get_store_resource', resourceType, filename, baseUrl),
  sniffImages: (url: string) => call<WallpaperItem[]>('sniff_images', url),
  listPlugins: () => call<Array<Record<string, unknown>>>('list_plugins'),
  setPluginEnabled: (pluginId: string, enabled: boolean) => call<Array<Record<string, unknown>>>('set_plugin_enabled', pluginId, enabled),
  importSource: () => call<WallpaperSource | null>('pick_and_import_source'),
  listHistory: () => call<Array<Record<string, unknown>>>('list_history'),
  getCurrentWallpaper: () => call<CurrentWallpaperInfo | null>('get_current_wallpaper'),
  recordCurrentWallpaper: () => call<CurrentWallpaperInfo | null>('record_current_wallpaper'),
  readDebugLog: (lines = 240) => call<DebugLogPayload>('read_debug_log', lines),
  openDebugLogDirectory: () => call<{ opened_path: string }>('open_debug_log_directory'),
  openDebugLogFile: () => call<{ opened_path: string }>('open_debug_log_file'),
  runtimeSnapshot: () => call<BootstrapPayload['runtime']>('runtime_snapshot'),
  triggerAutoChangeNow: () =>
    call<BootstrapPayload['runtime']['auto_change'] & { last_result?: { local_path: string; message: string } }>('trigger_auto_change_now'),
};
