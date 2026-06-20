import { toast } from '@heroui/react';
import { logError } from '@/lib/log';
import type {
  WallpaperInfo,
  BingWallpaper,
  SpotlightImage,
  Hitokoto,
  FavoriteItem,
  FavoriteFolder,
  FavoritesData,
  SniffedImage,
  StoreResource,
  AppSettings,
  CustomSentence,
  IntelligentMarketSource,
  IntelligentMarketHealthUpdate,
} from '@/types';

// ---------------------------------------------------------------------------
// Bridge: the frontend talks to the FastAPI backend over HTTP (same origin).
// A per-session secret token (delivered via the pywebview launch URL) authorizes
// every request via the X-Api-Token header. Same-origin fetch avoids CORS.
// ---------------------------------------------------------------------------
const TOKEN_STORAGE_KEY = '__ltw_api_token__';

let _token: string | null = null;
let _readyPromise: Promise<void> | null = null;

function readToken(): string | null {
  if (_token) return _token;
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) {
      _token = stored;
      return _token;
    }
  } catch {
    /* sessionStorage may be unavailable; ignore */
  }

  // On first launch the token arrives as ?token=... in the launch URL.
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('token');
  if (fromUrl) {
    _token = fromUrl;
    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, fromUrl);
    } catch {
      /* ignore */
    }
    // Strip the token from the address bar so it is not visible to the user.
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('token');
      window.history.replaceState({}, '', clean.toString());
    } catch {
      /* ignore */
    }
  }
  return _token;
}

function authHeaders(): Record<string, string> {
  const token = readToken();
  return token ? { 'X-Api-Token': token } : {};
}

async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { headers: authHeaders() });
    return res.ok;
  } catch (e) {
    logError('Health check failed', e);
    return false;
  }
}

/** Resolve once the backend is reachable and authorized. */
export function waitForApi(): Promise<void> {
  if (_readyPromise) return _readyPromise;
  _readyPromise = (async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (readToken() && (await healthCheck())) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('backend not ready');
  })();
  return _readyPromise;
}

async function call<T>(method: string, ...args: any[]): Promise<T> {
  await waitForApi();
  let res: Response;
  try {
    res = await fetch(`/api/rpc/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ args }),
    });
  } catch (e) {
    logError(`RPC ${method} fetch failed`, e);
    throw new Error(`后端连接失败: ${method}`);
  }

  let payload: any;
  try {
    payload = await res.json();
  } catch (e) {
    logError(`RPC ${method} returned invalid JSON`, e);
    throw new Error(`后端返回无效数据: ${method}`);
  }

  if (!res.ok || payload?.error) {
    const message = payload?.error?.message || `调用失败: ${method}`;
    logError(`RPC ${method} failed`, new Error(message));
    throw new Error(message);
  }
  return payload.result as T;
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

export async function getSentence(): Promise<Hitokoto | null> {
  return call('get_sentence');
}

export async function importCustomSentences(): Promise<CustomSentence[] | null> {
  return call('import_custom_sentences');
}

export async function exportCustomSentences(): Promise<string | null> {
  return call('export_custom_sentences');
}

export async function downloadFile(url: string, filename?: string): Promise<string | null> {
  return call('download_file', url, filename);
}

export async function copyToClipboard(text: string): Promise<void> {
  return call('copy_to_clipboard', text);
}

/** Persist a raw binary blob into the downloads directory. Returns the path. */
export async function saveBlobToDownloads(blob: Blob, filename: string): Promise<string | null> {
  await waitForApi();
  try {
    const res = await fetch(`/api/save-download?filename=${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: authHeaders(),
      body: blob,
    });
    const payload = await res.json();
    if (!res.ok || payload?.error) {
      logError('saveBlobToDownloads failed', new Error(payload?.error?.message || `HTTP ${res.status}`));
      return null;
    }
    return (payload.path as string) ?? null;
  } catch (e) {
    logError('saveBlobToDownloads failed', e);
    return null;
  }
}

/** Prompt for a save location and persist a raw binary blob there. */
export async function saveBlobAs(blob: Blob, filename: string): Promise<string | null> {
  await waitForApi();
  try {
    const res = await fetch(`/api/save-as?filename=${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: authHeaders(),
      body: blob,
    });
    const payload = await res.json();
    if (!res.ok || payload?.error) {
      logError('saveBlobAs failed', new Error(payload?.error?.message || `HTTP ${res.status}`));
      return null;
    }
    return (payload.path as string) ?? null;
  } catch (e) {
    logError('saveBlobAs failed', e);
    return null;
  }
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
    const path = await saveBlobToDownloads(blob, filename);
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
  let loadingId = toast('正在拉取数据…', { isLoading: true, timeout: 0 });

  try {
    // fetch() works for both http(s) and data: URLs, so the flow is unified.
    const blob = await fetchBlobWithProgress(url, (percent, received, _total) => {
      toast.close(loadingId);
      const desc = percent !== null
        ? `已下载 ${percent}%`
        : `已下载 ${(received / 1024).toFixed(1)} KB`;
      loadingId = toast('正在拉取数据…', { isLoading: true, timeout: 0, description: desc });
    });

    toast.close(loadingId);
    const path = await saveBlobAs(blob, filename);
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
    const blob = await fetchBlobWithProgress(url, (percent, received, _total) => {
      toast.close(loadingId);
      const desc = percent !== null
        ? `已下载 ${percent}%`
        : `已下载 ${(received / 1024).toFixed(1)} KB`;
      loadingId = toast('正在拉取数据…', { isLoading: true, timeout: 0, description: desc });
    });

    toast.close(loadingId);
    loadingId = toast('正在应用壁纸…', { isLoading: true, timeout: 0 });
    const path = await saveBlobToDownloads(blob, filename);
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
    const blob = await fetchBlobWithProgress(url, (percent, received, _total) => {
      toast.close(loadingId);
      const desc = percent !== null
        ? `已下载 ${percent}%`
        : `已下载 ${(received / 1024).toFixed(1)} KB`;
      loadingId = toast('正在拉取数据…', { isLoading: true, timeout: 0, description: desc });
    });

    toast.close(loadingId);
    const path = await saveBlobToDownloads(blob, filename);
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

export async function getFavorites(): Promise<FavoritesData> {
  return call('get_favorites');
}

export async function addFavorite(item: Omit<FavoriteItem, 'id' | 'created_at'>): Promise<FavoriteItem> {
  const tags = [...item.tags];
  if (item.source_type === 'bing' && !tags.includes('Bing')) {
    tags.push('Bing');
  }
  if (item.source_type === 'spotlight' && !tags.includes('Windows聚焦')) {
    tags.push('Windows聚焦');
  }
  return call('add_favorite', { ...item, tags });
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

export async function ensureTag(name: string): Promise<void> {
  return call('ensure_tag', name);
}

export async function renameTag(oldName: string, newName: string): Promise<void> {
  return call('rename_tag', oldName, newName);
}

export async function deleteTag(name: string): Promise<void> {
  return call('delete_tag', name);
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

export async function getLocalImageUrl(path: string, maxSize = 960): Promise<string | null> {
  return call('get_local_image_url', path, maxSize);
}

/**
 * Build a token-authenticated preview URL for a local file directly on the
 * client (no round-trip). The server still validates that the path is within an
 * allowed directory, so this is safe to use for any local_path value.
 */
export function localPreviewUrl(path: string, maxSize = 960): string {
  const token = readToken();
  const q = `path=${encodeURIComponent(path)}&max=${maxSize}${token ? `&token=${token}` : ''}`;
  return `/api/preview?${q}`;
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

export interface LogStats {
  directory: string;
  file_count: number;
  entry_count: number;
  error_count: number;
  size_bytes: number;
  level: string;
  levels: string[];
}

export async function getLogStats(): Promise<LogStats> {
  return call('get_log_stats');
}

export async function setLogFileLevel(level: string): Promise<LogStats> {
  return call('set_log_file_level', level);
}

export async function clearLogs(): Promise<LogStats & { removed: number }> {
  return call('clear_logs');
}

export async function openDebugLogDirectory(): Promise<any> {
  return call('open_debug_log_directory');
}

export async function openDebugLogFile(): Promise<any> {
  return call('open_debug_log_file');
}

export async function saveDebugLog(targetPath?: string): Promise<{ saved_path: string; error?: string; cancelled?: boolean }> {
  return call('save_debug_log', targetPath);
}

export async function getCrashReports(): Promise<Array<{ path: string; name: string; size: number; created_at: string }>> {
  return call('get_crash_reports');
}

export async function openCrashReport(reportPath: string): Promise<any> {
  return call('open_crash_report', reportPath);
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
      max_response_size_mb?: number;
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
    response?: { format?: string; type?: string; charset?: string };
    mapping?: { items?: string; fields?: Record<string, string> };
    pagination?: {
      strategy?: string;
      max_pages?: number;
      page_size?: number;
      concurrency?: number;
      delay_ms?: number;
      merge_results?: boolean;
      param_name?: string;
      start_value?: number;
      increment?: number;
      cursor_path?: string;
      cursor_param?: string;
      cursor_in?: string;
      stop_on_missing?: boolean;
      initial_cursor?: string;
      next_selector?: string;
      attr?: string;
    };
    post_process?: {
      filter?: string;
      merge?: Record<string, string>;
    };
    validation?: {
      required_fields?: string[];
      constraints?: Array<{
        path: string;
        regex?: string;
        min_length?: number;
        max_length?: number;
        min?: number;
        max?: number;
        action: string;
      }>;
    };
    error_handling?: {
      on_http_4xx?: string;
      on_http_5xx?: string;
      on_empty_response?: string;
      on_mapping_failure?: string;
      fallback_api?: string;
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
