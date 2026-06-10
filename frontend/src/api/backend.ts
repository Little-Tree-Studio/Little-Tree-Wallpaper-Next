import { toast } from '@heroui/react';
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
  IntelligentMarketSource,
  IntelligentMarketHealthUpdate,
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

export async function saveFileDialog(data: string, filename: string): Promise<string | null> {
  return call('save_file_dialog', data, filename);
}

export async function saveBase64ToDownloads(data: string, filename: string): Promise<string | null> {
  return call('save_base64_file', data, filename);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function fetchBlobWithProgress(
  url: string,
  onProgress: (percent: number | null, received: number, total: number | null) => void
): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const total = Number(res.headers.get('content-length')) || null;
  const reader = res.body!.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(total ? Math.round((received / total) * 100) : null, received, total);
  }

  return new Blob(chunks);
}

export async function downloadWithProgress(url: string, filename: string): Promise<string | null> {
  let loadingId = toast('正在下载…', { isLoading: true, timeout: 0 });

  try {
    const blob = await fetchBlobWithProgress(url, (percent, received, _total) => {
      toast.close(loadingId);
      const desc = percent !== null
        ? `已下载 ${percent}%`
        : `已下载 ${(received / 1024).toFixed(1)} KB`;
      loadingId = toast('正在下载…', { isLoading: true, timeout: 0, description: desc });
    });

    toast.close(loadingId);
    const data = await blobToBase64(blob);
    const path = await saveBase64ToDownloads(data, filename);
    if (path) {
      toast.success('下载完成', { timeout: 3000 });
    } else {
      toast.danger('保存失败', { timeout: 0 });
    }
    return path;
  } catch (e) {
    toast.close(loadingId);
    toast.danger('下载失败，请重试', { timeout: 0 });
    return null;
  }
}

export async function saveAsWithProgress(url: string, filename: string): Promise<string | null> {
  if (url.startsWith('data:')) {
    const path = await saveFileDialog(url, filename);
    if (path) {
      toast.success('保存成功', { timeout: 3000 });
    } else {
      toast.info('已取消保存', { timeout: 0 });
    }
    return path;
  }

  let loadingId = toast('正在拉取数据…', { isLoading: true, timeout: 0 });

  try {
    const blob = await fetchBlobWithProgress(url, (percent, received, _total) => {
      toast.close(loadingId);
      const desc = percent !== null
        ? `已下载 ${percent}%`
        : `已下载 ${(received / 1024).toFixed(1)} KB`;
      loadingId = toast('正在拉取数据…', { isLoading: true, timeout: 0, description: desc });
    });

    toast.close(loadingId);
    const data = await blobToBase64(blob);
    const path = await saveFileDialog(data, filename);
    if (path) {
      toast.success('保存成功', { timeout: 3000 });
    } else {
      toast.info('已取消保存', { timeout: 0 });
    }
    return path;
  } catch (e) {
    toast.close(loadingId);
    toast.danger('拉取数据失败，请重试', { timeout: 0 });
    return null;
  }
}

/**
 * 与 saveAsWithProgress 相同的拉取数据流程，但下载完成后将文件设为系统壁纸。
 * 如果是本地路径（localPath）则直接设为壁纸，跳过下载。
 */
export async function setWallpaperWithProgress(
  url: string,
  filename: string,
  localPath?: string | null,
): Promise<string | null> {
  if (localPath) {
    try {
      await setWallpaper(localPath);
      toast.success('已设为壁纸', { timeout: 3000 });
      return localPath;
    } catch {
      toast.danger('设为壁纸失败', { timeout: 0 });
      return null;
    }
  }

  let loadingId = toast('正在拉取数据…', { isLoading: true, timeout: 0 });

  try {
    let data: string;
    if (url.startsWith('data:')) {
      data = url;
    } else {
      const blob = await fetchBlobWithProgress(url, (percent, received, _total) => {
        toast.close(loadingId);
        const desc = percent !== null
          ? `已下载 ${percent}%`
          : `已下载 ${(received / 1024).toFixed(1)} KB`;
        loadingId = toast('正在拉取数据…', { isLoading: true, timeout: 0, description: desc });
      });
      data = await blobToBase64(blob);
    }

    toast.close(loadingId);
    loadingId = toast('正在应用壁纸…', { isLoading: true, timeout: 0 });
    const path = await saveBase64ToDownloads(data, filename);
    if (!path) {
      toast.close(loadingId);
      toast.danger('保存临时文件失败', { timeout: 0 });
      return null;
    }
    await setWallpaper(path);
    toast.close(loadingId);
    toast.success('已设为壁纸', { timeout: 3000 });
    return path;
  } catch {
    toast.close(loadingId);
    toast.danger('拉取数据失败，请重试', { timeout: 0 });
    return null;
  }
}

/**
 * 使用系统默认应用打开图片。
 * 如果有本地路径直接打开；否则先拉取数据保存到下载目录再打开。
 */
export async function openWithSystemWithProgress(
  url: string,
  filename: string,
  localPath?: string | null,
): Promise<string | null> {
  if (localPath) {
    try {
      await openFile(localPath);
      return localPath;
    } catch {
      toast.danger('打开失败', { timeout: 0 });
      return null;
    }
  }

  let loadingId = toast('正在拉取数据…', { isLoading: true, timeout: 0 });

  try {
    let data: string;
    if (url.startsWith('data:')) {
      data = url;
    } else {
      const blob = await fetchBlobWithProgress(url, (percent, received, _total) => {
        toast.close(loadingId);
        const desc = percent !== null
          ? `已下载 ${percent}%`
          : `已下载 ${(received / 1024).toFixed(1)} KB`;
        loadingId = toast('正在拉取数据…', { isLoading: true, timeout: 0, description: desc });
      });
      data = await blobToBase64(blob);
    }

    toast.close(loadingId);
    const path = await saveBase64ToDownloads(data, filename);
    if (!path) {
      toast.danger('保存临时文件失败', { timeout: 0 });
      return null;
    }
    await openFile(path);
    return path;
  } catch {
    toast.close(loadingId);
    toast.danger('拉取数据失败，请重试', { timeout: 0 });
    return null;
  }
}

export async function sniffImages(url: string): Promise<SniffedImage[]> {
  return call('sniff_images', url);
}

export async function searchBaiduImages(text: string, index: number = 0, size: number = 30): Promise<SniffedImage[]> {
  return call('search_baidu_images', text, index, size);
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

export async function openFile(path: string): Promise<void> {
  return call('open_file', path);
}

export async function openUrl(url: string): Promise<void> {
  return call('open_url', url);
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

export async function getLocalImageBase64(path: string): Promise<string | null> {
  return call('get_local_image_base64', path);
}

// --- Enhanced API methods ---

export async function bootstrap(): Promise<any> {
  return call('bootstrap');
}

export async function queryBing(
  category: string = 'daily',
  market: string = 'zh-CN',
  count: number = 8,
  quality: string = 'highDef',
  forceRefresh: boolean = false
): Promise<any[]> {
  return call('query_bing', category, market, count, quality, forceRefresh);
}

export async function querySpotlight(
  source: string = 'local',
  limit: number = 20,
  market: string = 'zh-CN',
  forceRefresh: boolean = false
): Promise<any[]> {
  return call('query_spotlight', source, limit, market, forceRefresh);
}

export async function clearSourceCache(source?: 'bing' | 'spotlight'): Promise<{ cleared: string[] }> {
  return call('clear_source_cache', source);
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

export async function listIntelligentMarketSources(force: boolean = false): Promise<IntelligentMarketSource[]> {
  return call('list_intelligent_market_sources', force);
}

export async function checkIntelligentMarketSourcesHealth(
  sourceIds?: string[],
  force: boolean = false
): Promise<IntelligentMarketHealthUpdate[]> {
  return call('check_intelligent_market_sources_health', sourceIds, force);
}

export async function executeIntelligentMarketSource(
  sourceId: string,
  parameters: Record<string, unknown> = {}
): Promise<any[]> {
  return call('execute_intelligent_market_source', sourceId, parameters);
}

// --- Wallpaper Source API ---

export interface WallpaperSource {
  identifier: string;
  name: string;
  version: string;
  description?: string;
  details?: string;
  logo?: string;
  footer_text?: string;
  enabled?: boolean;
  source_kind?: string;
  is_builtin?: boolean;
  can_delete?: boolean;
  invalid?: boolean;
  error?: string;
  categories?: WallpaperSourceCategory[];
  category_groups?: WallpaperSourceCategoryGroup[];
  apis?: WallpaperSourceApi[];
}

export interface WallpaperSourceCategory {
  id: string;
  name: string;
  category?: string;
  subcategory?: string;
  subsubcategory?: string;
  icon?: string;
  description?: string;
}

export interface WallpaperSourceCategoryGroup {
  name: string;
  category_ids: string[];
}

export interface WallpaperSourceApi {
  name: string;
  description?: string;
  logo?: string;
  categories?: string[];
  parameters?: WallpaperSourceApiParameter[];
  request?: {
    url?: string;
    method?: string;
    timeout_seconds?: number;
    interval_seconds?: number;
    body?: string;
    body_type?: string;
    headers?: Record<string, string>;
  };
  response?: {
    format?: string;
    type?: string;
  };
  mapping?: {
    items?: string;
    item_mapping?: Record<string, string>;
  };
  post_process?: Record<string, string>;
  validation?: {
    required_fields?: string[];
    field_patterns?: any[];
    quality_rules?: any[];
  };
  error_handling?: {
    http_codes?: any[];
    on_empty_response?: string;
    on_mapping_failed?: string;
    fallback_to?: string;
  };
  cache?: {
    enabled?: boolean;
    ttl_seconds?: number;
    key_template?: string;
  };
  static_list?: { urls?: string[] };
  static_dict?: { items?: any[] };
}

export interface WallpaperSourceApiParameter {
  key: string;
  label?: string;
  type?: string;
  default?: any;
  choices?: string[];
  hidden?: boolean;
  description?: string;
  placeholder?: string;
  min_length?: number;
  max_length?: number;
}

export interface WallpaperSourceCreatorPayload {
  source: {
    identifier: string;
    name: string;
    version: string;
    description?: string;
    details?: string;
    logo?: string;
    footer_text?: string;
    merge?: {
      enabled?: boolean;
      strategy?: string;
      priority?: number;
      metadata_source?: string;
      allow_metadata_override?: boolean;
    };
  };
  config: {
    request: {
      global_interval_seconds?: number;
      timeout_seconds?: number;
      max_concurrent?: number;
      skip_ssl_verify?: boolean;
      user_agent?: string;
      headers?: Array<{ key: string; value: string }>;
      retry?: {
        max_attempts?: number;
        backoff_base?: number;
        initial_delay_ms?: number;
      };
      cache?: {
        enabled?: boolean;
        default_ttl_seconds?: number;
        max_memory_mb?: number;
      };
      variables?: Array<{ key: string; value: string }>;
    };
  };
  categories: {
    template?: { icon?: string; category?: string };
    categories: WallpaperSourceCategory[];
    category_groups?: WallpaperSourceCategoryGroup[];
    level_icons?: {
      category?: Array<{ key: string; value: string }>;
      subcategory?: Array<{ key: string; value: string }>;
      subsubcategory?: Array<{ key: string; value: string }>;
    };
  };
  apis: Array<{
    name: string;
    description?: string;
    logo?: string;
    categories?: string[];
    parameters?: WallpaperSourceApiParameter[];
    request?: {
      url?: string;
      method?: string;
      timeout_seconds?: number;
      interval_seconds?: number;
      body?: string;
      body_type?: string;
      headers?: Array<{ key: string; value: string }>;
    };
    response?: { format?: string; type?: string };
    mapping?: { items?: string; item_mapping?: Array<{ key: string; value: string }> };
    post_process?: Array<{ key: string; value: string }>;
    validation?: {
      required_fields?: string[];
      field_patterns?: any[];
      quality_rules?: any[];
    };
    error_handling?: {
      http_codes?: any[];
      on_empty_response?: string;
      on_mapping_failed?: string;
      fallback_to?: string;
    };
    cache?: { enabled?: boolean; ttl_seconds?: number; key_template?: string };
    static_list_urls?: string[];
    static_dict_items?: any[];
  }>;
}

export type WallpaperSourceExternalExportFormat = 'apicore_v1' | 'apicore_v2' | 'openapi_3_2';

export interface WallpaperSourceExportOptions {
  openapi?: {
    servers?: string[];
    tags_by_api?: Record<string, string[]>;
  };
}

export async function getWallpaperSources(): Promise<WallpaperSource[]> {
  return call('get_wallpaper_sources');
}

export async function setWallpaperSourceEnabled(sourceId: string, enabled: boolean): Promise<WallpaperSource> {
  return call('set_wallpaper_source_enabled', sourceId, enabled);
}

export async function deleteWallpaperSource(sourceId: string): Promise<{ deleted: boolean; identifier: string }> {
  return call('delete_wallpaper_source', sourceId);
}

export async function executeWallpaperSource(sourceId: string, apiName: string, parameters?: Record<string, unknown>): Promise<any[]> {
  return call('execute_wallpaper_source', sourceId, apiName, parameters);
}

export async function pickAndImportSource(): Promise<WallpaperSource | null> {
  return call('pick_and_import_source');
}

export async function importWallpaperSourceAsDraft(): Promise<WallpaperSourceCreatorPayload | null> {
  return call('import_wallpaper_source_as_draft');
}

export async function createWallpaperSource(payload: WallpaperSourceCreatorPayload): Promise<WallpaperSource> {
  return call('create_wallpaper_source', payload);
}

export async function exportWallpaperSource(sourceId: string, suggestedName?: string): Promise<{ saved_path: string } | null> {
  return call('export_wallpaper_source', sourceId, suggestedName);
}

export async function exportWallpaperSourcePayload(
  payload: WallpaperSourceCreatorPayload,
  exportFormat: WallpaperSourceExternalExportFormat,
  suggestedName?: string,
  exportOptions?: WallpaperSourceExportOptions
): Promise<{ saved_path: string } | null> {
  return call('export_wallpaper_source_payload', payload, exportFormat, suggestedName, exportOptions);
}
