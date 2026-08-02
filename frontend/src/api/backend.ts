import { toast } from '@heroui/react';
import { logError } from '@/lib/log';
import { confirmStaticWallpaperSwitch } from '@/lib/staticWallpaperConfirmation';
import {
  fetchBlobWithProgress,
  formatProgressDescription,
  runWithProgressToast,
} from '@/lib/download';
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
  CnuWorkSummary,
  PixivelWorkSummary,
  TimelineTopicSummary,
  TimelineWallpaperPage,
  WallpaperItem,
  StorageOverview,
  Plugin,
  PluginListResult,
  PluginOperationResult,
} from '@/types';
import type {
  ActiveThemeResponse,
  ThemeAssetSelection,
  ThemeAssetSource,
  ThemeProfile,
  ThemeSummary,
} from '@/theme/types';
import type {
  AutomationDocument,
  AutomationRuntime,
  AutomationSummary,
} from '@/components/AutomationEditor/types';

// ---------------------------------------------------------------------------
// Bridge: the frontend talks to the FastAPI backend over HTTP (same origin).
// A per-session secret token (delivered via the LumiView launch URL) authorizes
// every request via the X-Api-Token header. Same-origin fetch avoids CORS.
// ---------------------------------------------------------------------------
const TOKEN_STORAGE_KEY = '__ltw_api_token__';
export const FAVORITES_CHANGED_EVENT = 'ltw:favorites-changed';
export const PLUGIN_REGISTRY_CHANGED_EVENT = 'ltw:plugin-registry-changed';

export function notifyFavoritesChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT));
  }
}

export function notifyPluginRegistryChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PLUGIN_REGISTRY_CHANGED_EVENT));
  }
}

let _token: string | null = null;
let _readyPromise: Promise<void> | null = null;

const MEDIA_API_PATHS = [
  '/api/preview',
  '/api/cnu-image',
  '/api/sniff-image',
  '/api/pixiv-image',
  '/api/theme-media/',
  '/api/theme-preview/',
  '/api/plugin-assets/',
  '/api/dynamic-wallpaper/asset',
] as const;

/**
 * Keep media transfers out of the RPC origin's browser connection pool.
 * LumiView launches from 127.0.0.1; localhost reaches the same loopback
 * server while being scheduled as a separate browser origin.
 */
function mediaApiUrl(path: string): string {
  if (typeof window === 'undefined' || window.location.hostname !== '127.0.0.1') return path;
  if (!readToken()) return path;
  if (!MEDIA_API_PATHS.some((prefix) => path === prefix || path.startsWith(prefix))) return path;
  const port = window.location.port ? `:${window.location.port}` : '';
  return `${window.location.protocol}//localhost${port}${path}`;
}

/** Use the RPC origin when JavaScript must read a loopback media response. */
function readableMediaUrl(url: string): string {
  if (typeof window === 'undefined' || window.location.hostname !== '127.0.0.1') return url;
  try {
    const parsed = new URL(url, window.location.href);
    if (
      parsed.hostname === 'localhost'
      && parsed.protocol === window.location.protocol
      && parsed.port === window.location.port
      && MEDIA_API_PATHS.some((prefix) => parsed.pathname === prefix || parsed.pathname.startsWith(prefix))
    ) {
      parsed.hostname = window.location.hostname;
      return parsed.toString();
    }
  } catch {
    // Let fetch report malformed external URLs with its normal error.
  }
  return url;
}

function isolateMediaUrls<T>(value: T): T {
  if (typeof value === 'string') return mediaApiUrl(value) as T;
  if (Array.isArray(value)) return value.map(isolateMediaUrls) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, isolateMediaUrls(item)]),
    ) as T;
  }
  return value;
}

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

async function callRequest<T>(method: string, args: any[], signal?: AbortSignal): Promise<T> {
  await waitForApi();
  let res: Response;
  try {
    res = await fetch(`/api/rpc/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ args }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
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
  return isolateMediaUrls(payload.result as T);
}

async function call<T>(method: string, ...args: any[]): Promise<T> {
  return callRequest<T>(method, args);
}

export async function listAutomations(): Promise<AutomationSummary[]> { return call('list_automations'); }
export async function getAutomation(id: string): Promise<AutomationDocument> { return call('get_automation', id); }
export async function pickAndImportAutomation(): Promise<AutomationDocument | null> { return call('pick_and_import_automation'); }
export async function exportAutomation(id: string, format: 'ltauto' | 'json'): Promise<string | null> { return call('export_automation', id, format); }
export async function saveAutomation(document: AutomationDocument): Promise<AutomationDocument> { return call('save_automation', document); }
export async function deleteAutomation(id: string): Promise<void> { return call('delete_automation', id); }
export async function setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationDocument> { return call('set_automation_enabled', id, enabled); }
export async function runAutomation(id: string, variables: Record<string, unknown> = {}): Promise<AutomationRuntime> { return call('run_automation', id, variables); }
export async function cancelAutomation(): Promise<AutomationRuntime> { return call('cancel_automation'); }
export async function getAutomationRuntime(): Promise<AutomationRuntime> { return call('get_automation_runtime'); }

export interface AutomationResourceCatalog {
  intelligent_market: IntelligentMarketSource[];
  wallpaper_sources: WallpaperSource[];
  favorite_folders: FavoriteFolder[];
}

export async function getAutomationResourceCatalog(): Promise<AutomationResourceCatalog> {
  return call('get_automation_resource_catalog');
}

export async function selectAutomationLocalImage(): Promise<string | null> {
  return call('select_automation_local_image');
}

export async function selectAutomationDirectory(): Promise<string | null> {
  return call('select_automation_directory');
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

export interface DisplayResolution {
  id: string;
  name: string;
  width: number;
  height: number;
  is_primary: boolean;
}

export async function getDisplayResolutions(): Promise<DisplayResolution[]> {
  return call('get_display_resolutions');
}

export interface SetWallpaperResult {
  success: boolean;
  error?: string;
  code?: string;
  requires_confirmation?: boolean;
  cancelled?: boolean;
}

async function setWallpaperRaw(path: string, confirmed = false): Promise<SetWallpaperResult> {
  return call('set_wallpaper', path, confirmed);
}

async function applyStaticWallpaper(path: string, confirmed: boolean): Promise<SetWallpaperResult> {
  const result = await setWallpaperRaw(path, confirmed);
  if (!result.requires_confirmation) return result;
  if (!await confirmStaticWallpaperSwitch()) return { success: false, cancelled: true };
  return setWallpaperRaw(path, true);
}

async function confirmDynamicWallpaperStopIfNeeded(): Promise<boolean | null> {
  const status = await getDynamicWallpaperStatus();
  if (!status.running && !status.operation_busy) return false;
  return await confirmStaticWallpaperSwitch() ? true : null;
}

export async function setWallpaper(path: string): Promise<SetWallpaperResult> {
  const confirmed = await confirmDynamicWallpaperStopIfNeeded();
  if (confirmed === null) return { success: false, cancelled: true };
  return applyStaticWallpaper(path, confirmed);
}

export interface PendingStaticWallpaper {
  id: string;
  path: string;
  name: string;
  created_at: string;
}

export async function getPendingStaticWallpaper(): Promise<PendingStaticWallpaper | null> {
  return call('get_pending_static_wallpaper');
}

export async function resolvePendingStaticWallpaper(
  taskId: string,
  confirmed: boolean,
): Promise<SetWallpaperResult> {
  return call('resolve_pending_static_wallpaper', taskId, confirmed);
}

/** Static application identity (rarely changes). Sourced from the
 *  project-root ``build/app_info.json``. */
export interface AppInfo {
  /** Localised application name (Chinese). */
  name: string;
  /** English application name. */
  name_en: string;
  /** Python / npm package name, e.g. ``"little-tree-wallpaper"``. */
  package_name: string;
  /** One-line description, suitable for the about screen. */
  description: string;
  /** Author / vendor name. */
  author: string;
  /** Public repository URL, or empty when not published. */
  repo_url: string;
}

export interface BuildInfo {
  /** Build channel: ``"beta"`` (development) or ``"stable"`` (release). The
   *  value is baked into the binary at packaging time and cannot be changed
   *  at runtime. */
  build_type: string;
  /** Application version, e.g. ``"2.0.0"``. For source runs this is
   *  ``"0.0.0"`` (no build provenance). */
  version: string;
  /** ISO-8601 timestamp the build was produced. For source runs this is
   *  the process start time. */
  build_time: string;
  /** Short git commit hash the build was produced from. ``"source"`` for
   *  a source run. */
  git_commit: string;
  /** How the build was produced (``"manual"``, ``"pyinstaller"``, ...).
   *  ``"source"`` when running from source. */
  built_by: string;
  /** True when the app is running from source (``build.json`` missing). */
  source_run: boolean;
}

export async function getAppInfo(): Promise<AppInfo> {
  return call<AppInfo>('get_app_info');
}

export async function getBuildInfo(): Promise<BuildInfo> {
  return call<BuildInfo>('get_build_info');
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

export async function getClipboardText(): Promise<string> {
  return call('get_clipboard_text');
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

function filenameForBlob(filename: string, blob: Blob): string {
  const extensions: Record<string, string> = {
    'image/avif': '.avif',
    'image/bmp': '.bmp',
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  const extension = extensions[blob.type.toLowerCase().split(';', 1)[0]];
  if (!extension) return filename;
  return /\.[a-z0-9]+$/i.test(filename)
    ? filename.replace(/\.[a-z0-9]+$/i, extension)
    : `${filename}${extension}`;
}

interface DownloadPreferences {
  timeoutMs: number;
  concurrentTasks: number;
}

let downloadPreferencesCache: DownloadPreferences | null = null;

async function getDownloadPreferences(): Promise<DownloadPreferences> {
  if (downloadPreferencesCache) return downloadPreferencesCache;
  try {
    const configured = await call<Record<string, unknown>>('get_setting', 'download');
    const timeoutSeconds = Math.max(10, Math.min(600, Number(configured?.timeout_seconds) || 120));
    const concurrentTasks = Math.max(1, Math.min(8, Number(configured?.concurrent_tasks) || 3));
    downloadPreferencesCache = { timeoutMs: timeoutSeconds * 1000, concurrentTasks };
  } catch {
    downloadPreferencesCache = { timeoutMs: 120_000, concurrentTasks: 3 };
  }
  return downloadPreferencesCache;
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

/** Overwrite a file path returned by a previous save-as operation. */
export async function saveBlobToPath(blob: Blob, path: string): Promise<string | null> {
  await waitForApi();
  try {
    const res = await fetch(`/api/save-file?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: authHeaders(),
      body: blob,
    });
    const payload = await res.json();
    if (!res.ok || payload?.error) {
      logError('saveBlobToPath failed', new Error(payload?.error?.message || `HTTP ${res.status}`));
      return null;
    }
    return (payload.path as string) ?? null;
  } catch (e) {
    logError('saveBlobToPath failed', e);
    return null;
  }
}

export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  await waitForApi();
  try {
    const res = await fetch('/api/copy-image', {
      method: 'POST',
      headers: authHeaders(),
      body: blob,
    });
    if (!res.ok) return false;
    const payload = await res.json();
    return payload?.ok === true;
  } catch (e) {
    logError('copyImageToClipboard failed', e);
    return false;
  }
}

export async function copyImageToClipboardWithProgress(url: string): Promise<boolean> {
  const { timeoutMs } = await getDownloadPreferences();
  const blob = await runWithProgressToast<Blob | null>(
    {
      loadingLabel: '正在拉取数据…',
      loadingDescription: formatProgressDescription,
      failureLabel: '拉取数据失败，请重试',
    },
    (onProgress) => fetchBlobWithProgress(readableMediaUrl(url), onProgress, { headers: authHeaders(), timeoutMs })
  );
  if (!blob) return false;

  const copied = await runWithProgressToast<boolean>(
    {
      loadingLabel: '正在复制到剪贴板…',
      successLabel: '已复制图片',
      failureLabel: '复制图片失败',
    },
    async () => copyImageToClipboard(blob)
  );
  return copied === true;
}

export async function downloadWithProgress(
  url: string,
  filename: string,
  localPath?: string | null,
): Promise<string | null> {
  if (localPath) {
    return runWithProgressToast<string | null>(
      {
        loadingLabel: '正在复制到下载目录…',
        successLabel: '下载完成',
        failureLabel: '下载失败',
      },
      async () => downloadFile(localPath, filename),
    );
  }
  const { timeoutMs } = await getDownloadPreferences();

  return runWithProgressToast<string | null>(
    {
      loadingLabel: '正在下载…',
      loadingDescription: formatProgressDescription,
      successLabel: '下载完成',
      failureLabel: '下载失败，请重试',
    },
    async (onProgress) => {
      const blob = await fetchBlobWithProgress(readableMediaUrl(url), onProgress, { headers: authHeaders(), timeoutMs });
      const path = await saveBlobToDownloads(blob, filenameForBlob(filename, blob));
      if (!path) {
        toast.danger('保存失败', { timeout: 0 });
      }
      return path;
    }
  );
}

export async function saveAsWithProgress(
  url: string,
  filename: string,
  localPath?: string | null,
): Promise<string | null> {
  const sourceUrl = localPath ? localPreviewUrl(localPath) : url;
  const { timeoutMs } = await getDownloadPreferences();
  const result = await runWithProgressToast<{ path: string | null; cancelled: boolean }>(
    {
      loadingLabel: '正在拉取数据…',
      loadingDescription: formatProgressDescription,
      successLabel: '保存成功',
      failureLabel: '拉取数据失败，请重试',
    },
    async (onProgress) => {
      const blob = await fetchBlobWithProgress(readableMediaUrl(sourceUrl), onProgress, { headers: authHeaders(), timeoutMs });
      const path = await saveBlobAs(blob, filenameForBlob(filename, blob));
      return { path, cancelled: path === null };
    }
  );
  if (!result) return null;
  if (result.cancelled) {
    toast.info('已取消保存', { timeout: 0 });
    return null;
  }
  return result.path;
}

export async function setWallpaperWithProgress(
  url: string,
  filename: string,
  localPath?: string | null,
): Promise<string | null> {
  const confirmed = await confirmDynamicWallpaperStopIfNeeded();
  if (confirmed === null) return null;
  if (localPath) {
    const appliedPath = await runWithProgressToast<string | null>(
      {
        loadingLabel: '正在应用壁纸…',
        failureLabel: '设为壁纸失败',
      },
      async () => {
        const applied = await applyStaticWallpaper(localPath, confirmed);
        if (applied.cancelled) return null;
        if (!applied.success) throw new Error(applied.error || '设置壁纸失败');
        return localPath;
      }
    );
    if (appliedPath) toast.success('已设为壁纸', { timeout: 3000 });
    return appliedPath;
  }
  const { timeoutMs } = await getDownloadPreferences();

  // Two-stage flow: fetch with progress toast, then save + apply via
  // toast.promise. This keeps the progress bar visible for the slow part
  // (download) and switches to an unambiguous "已设为壁纸" toast for the
  // quick part.
  const blob = await runWithProgressToast<Blob | null>(
    {
      loadingLabel: '正在拉取数据…',
      loadingDescription: formatProgressDescription,
      failureLabel: '拉取数据失败，请重试',
    },
    (onProgress) => fetchBlobWithProgress(readableMediaUrl(url), onProgress, { headers: authHeaders(), timeoutMs })
  );
  if (!blob) return null;

  const result = await runWithProgressToast<string | null>(
    {
      loadingLabel: '正在应用壁纸…',
      failureLabel: '设为壁纸失败',
    },
    async () => {
      const path = await saveBlobToDownloads(blob, filenameForBlob(filename, blob));
      if (!path) {
        throw new Error('保存临时文件失败');
      }
      const applied = await applyStaticWallpaper(path, confirmed);
      if (applied.cancelled) return null;
      if (!applied.success) throw new Error(applied.error || '设置壁纸失败');
      return path;
    }
  );
  if (result) toast.success('已设为壁纸', { timeout: 3000 });
  return result;
}

export async function openWithSystemWithProgress(
  url: string,
  filename: string,
  localPath?: string | null,
): Promise<string | null> {
  if (localPath) {
    return runWithProgressToast<string | null>(
      {
        loadingLabel: '正在打开…',
        successLabel: '已打开',
        failureLabel: '打开失败',
      },
      async () => {
        await openFile(localPath);
        return localPath;
      }
    );
  }
  const { timeoutMs } = await getDownloadPreferences();

  const blob = await runWithProgressToast<Blob | null>(
    {
      loadingLabel: '正在拉取数据…',
      loadingDescription: formatProgressDescription,
      failureLabel: '拉取数据失败，请重试',
    },
    (onProgress) => fetchBlobWithProgress(readableMediaUrl(url), onProgress, { headers: authHeaders(), timeoutMs })
  );
  if (!blob) return null;

  const result = await toast.promise(
    (async () => {
      const path = await saveBlobToDownloads(blob, filenameForBlob(filename, blob));
      if (!path) {
        throw new Error('保存临时文件失败');
      }
      await openFile(path);
      return path;
    })(),
    {
      loading: '正在打开…',
      success: '已打开',
      error: (err) => `打开失败: ${err instanceof Error ? err.message : String(err)}`,
    }
  );
  return (result as string | null) ?? null;
}

export interface DownloadManyOptions {
  concurrency?: number;
  onItemStart?: (item: { url: string; filename: string }, index: number) => void;
  onItemComplete?: (item: { url: string; filename: string }, index: number, result: string | null) => void;
}

export async function downloadManyWithProgress(
  items: Array<{ url: string; filename: string }>,
  options: DownloadManyOptions = {}
): Promise<Array<{ url: string; filename: string; path: string | null }>> {
  const preferences = await getDownloadPreferences();
  const { onItemStart, onItemComplete } = options;
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? preferences.concurrentTasks));
  const results: Array<{ url: string; filename: string; path: string | null }> = items.map((i) => ({
    ...i,
    path: null,
  }));
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      onItemStart?.(item, index);
      const path = await downloadWithProgress(item.url, item.filename);
      results[index].path = path;
      onItemComplete?.(item, index, path);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function sniffImages(url: string): Promise<SniffedImage[]> {
  return call('sniff_images', url);
}

export async function searchBaiduImages(
  text: string,
  index: number = 0,
  size: number = 30,
  signal?: AbortSignal,
): Promise<SniffedImage[]> {
  return callRequest('search_baidu_images', [text, index, size], signal);
}

export async function searchPexelsImages(
  text: string,
  page: number = 1,
  size: number = 24,
  signal?: AbortSignal,
): Promise<SniffedImage[]> {
  return callRequest('search_pexels_images', [text, page, size], signal);
}

export async function searchPixivImages(
  text: string,
  source: number = 1,
  excludeAI: boolean = false,
  r18: 0 | 1 | 2 = 0,
  size: number = 15,
  page: number = 1,
  signal?: AbortSignal,
): Promise<SniffedImage[]> {
  return callRequest('search_pixiv_images', [text, source, excludeAI, r18, size, page], signal);
}

export async function getFavorites(): Promise<FavoritesData> {
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
  return call('create_favorite_folder', name, description ?? '');
}

export async function updateFavoriteFolder(id: string, name: string, description?: string): Promise<FavoriteFolder> {
  return call('update_favorite_folder', id, name, description ?? '');
}

export async function deleteFavoriteFolder(id: string): Promise<void> {
  return call('delete_favorite_folder', id);
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

export async function getSettings(signal?: AbortSignal): Promise<AppSettings> {
  return callRequest('get_settings', [], signal);
}

export async function setSettings(settings: AppSettings): Promise<void> {
  return call('set_settings', settings);
}

export async function listThemes(): Promise<ThemeSummary[]> {
  return call('list_themes');
}

export async function getTheme(themeId: string): Promise<ThemeProfile> {
  return call('get_theme', themeId);
}

export interface SystemFontInfo {
  family: string;
  full_name: string;
  style: string;
}

export async function listSystemFonts(): Promise<SystemFontInfo[]> {
  return call('list_system_fonts');
}

export async function getActiveTheme(): Promise<ActiveThemeResponse> {
  return call('get_active_theme');
}

export async function saveTheme(theme: ThemeProfile): Promise<ThemeProfile> {
  return call('save_theme', theme);
}

export async function activateThemeProfile(themeId: string): Promise<ThemeProfile> {
  return call('activate_theme', themeId);
}

export async function duplicateTheme(themeId: string, name?: string): Promise<ThemeProfile> {
  return call('duplicate_theme', themeId, name);
}

export async function deleteTheme(themeId: string): Promise<void> {
  return call('delete_theme', themeId);
}

export async function pickThemeAsset(
  themeId: string,
  role: 'image' | 'video' | 'font',
  mode: Extract<ThemeAssetSource['mode'], 'bundled' | 'path'>,
): Promise<ThemeAssetSelection | null> {
  return call('pick_theme_asset', themeId, role, mode);
}

export async function pickAndImportTheme(): Promise<ThemeProfile | null> {
  return call('pick_and_import_theme');
}

export async function exportTheme(themeId: string): Promise<string | null> {
  return call('export_theme', themeId);
}

export type ThemeMediaRole = 'background' | 'font' | 'window-minimize' | 'window-maximize' | 'window-restore' | 'window-close';

export function themeMediaUrl(themeId: string, role: ThemeMediaRole, version = ''): string {
  const token = readToken();
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (version) params.set('v', version);
  const query = params.size ? `?${params.toString()}` : '';
  return mediaApiUrl(`/api/theme-media/${encodeURIComponent(themeId)}/${role}${query}`);
}

export function themePreviewUrl(previewToken: string): string {
  const token = readToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return mediaApiUrl(`/api/theme-preview/${encodeURIComponent(previewToken)}${query}`);
}

export function pluginAssetUrl(pluginId: string, assetPath: string, packageHash?: string | null): string {
  const token = readToken();
  const encodedPath = assetPath.split('/').map(encodeURIComponent).join('/');
  const query = new URLSearchParams();
  if (token) query.set('token', token);
  if (packageHash) query.set('v', packageHash);
  const suffix = query.size ? `?${query.toString()}` : '';
  return mediaApiUrl(`/api/plugin-assets/${encodeURIComponent(pluginId)}/${encodedPath}${suffix}`);
}

export async function listPlugins(signal?: AbortSignal): Promise<PluginListResult> {
  return callRequest('list_plugins', [], signal);
}

async function pluginMutation<T extends Plugin | PluginOperationResult>(
  method: string,
  args: unknown[],
): Promise<T> {
  const result = await callRequest<T>(method, args);
  notifyPluginRegistryChanged();
  return result;
}

export async function installPluginPackage(
  path?: string | null,
  allowDowngrade = false,
): Promise<PluginOperationResult> {
  return pluginMutation('install_plugin_package', [path ?? null, allowDowngrade]);
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<Plugin> {
  return pluginMutation('set_plugin_enabled', [pluginId, enabled]);
}

export async function reloadPlugin(pluginId: string): Promise<Plugin> {
  return pluginMutation('reload_plugin', [pluginId]);
}

export async function removePlugin(pluginId: string): Promise<PluginOperationResult> {
  return pluginMutation('remove_plugin', [pluginId]);
}

export async function invokePluginAction(
  pluginId: string,
  action: string,
  payload: unknown = null,
): Promise<PluginOperationResult> {
  return call('invoke_plugin_action', pluginId, action, payload);
}

export async function getSetting(key: string): Promise<any> {
  return call('get_setting', key);
}

let settingWriteQueue: Promise<void> = Promise.resolve();

export function setSetting(key: string, value: any): Promise<void> {
  if (key === 'download' || key.startsWith('download.')) downloadPreferencesCache = null;
  const request = settingWriteQueue.then(() => call<void>('set_setting', key, value));
  settingWriteQueue = request.catch(() => undefined);
  return request;
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

export interface DynamicWallpaperEvent {
  time: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
}

export interface DynamicWallpaperStatus {
  supported: boolean;
  platform: string;
  windows_version: {
    major: number;
    minor: number;
    build: number;
    revision: number;
    display_version: string;
    text: string;
    modern_expected: boolean;
  };
  expected_structure: 'modern_child' | 'legacy_top_level';
  detected_structure: 'modern_child' | 'legacy_top_level' | 'not_initialized' | 'unsupported';
  structure_label: string;
  structure_reason: string;
  structure_matches_version: boolean;
  runtime_ready: boolean;
  host_window_ready: boolean;
  prepared_window_handle: string;
  operation_busy: boolean;
  operation_phase: string;
  operation_started_at: string;
  explorer_ready: boolean;
  workerw_ready: boolean;
  progman_handle: string;
  def_view_handle: string;
  workerw_handle: string;
  desktop_host_kind: string;
  window_handle: string;
  window: {
    valid: boolean;
    visible: boolean;
    parent_matches: boolean;
    parent_handle: string;
    class_name: string;
    title: string;
    window_rect: { left: number; top: number; width: number; height: number };
    host_rect: { left: number; top: number; width: number; height: number };
    error?: string;
  };
  running: boolean;
  dynamic_type: DynamicBackgroundType | '';
  runtime_mode: 'raw-video' | 'scene' | '';
  runtime_revision: number;
  media_path: string;
  media_name: string;
  media_exists: boolean;
  media_size: number;
  media_modified_at: string;
  media_content_type: string;
  media_revision: number;
  started_at: string;
  last_error: string;
  last_operation: string;
  telemetry: {
    received: boolean;
    event: string;
    updated_at: string;
    player_loaded_at: string;
    media_revision: number;
    current_time: number;
    duration: number;
    progress: number;
    paused: boolean;
    ended: boolean;
    seeking: boolean;
    ready_state: number;
    network_state: number;
    video_width: number;
    video_height: number;
    buffered_start: number;
    buffered_end: number;
    buffered_ranges: number;
    muted: boolean;
    volume: number;
    loop: boolean;
    playback_rate: number;
    fps: number;
    fps_source: string;
    dropped_frames: number;
    total_frames: number;
    error_code: number;
    error_message: string;
    visibility: string;
  };
  supported_extensions: string[];
  events: DynamicWallpaperEvent[];
}

export async function selectDynamicWallpaperMedia(): Promise<string | null> {
  return call('select_dynamic_wallpaper_media');
}

export async function getDynamicWallpaperStatus(): Promise<DynamicWallpaperStatus> {
  return call('get_dynamic_wallpaper_status');
}

export async function startDynamicWallpaper(
  path: string,
  muted: boolean,
  loop: boolean,
  playbackRate: number,
): Promise<DynamicWallpaperStatus> {
  return call('start_dynamic_wallpaper', path, muted, loop, playbackRate);
}

export async function stopDynamicWallpaper(): Promise<DynamicWallpaperStatus> {
  return call('stop_dynamic_wallpaper');
}

export async function controlDynamicWallpaper(action: 'play' | 'pause' | 'auto' | 'reload' | 'next' | 'previous'): Promise<DynamicWallpaperStatus> {
  return call('control_dynamic_wallpaper', action);
}

export type DynamicBackgroundType = 'video' | 'image' | 'slideshow';
export type DynamicSlideshowSource = 'folder' | 'favorites';
export type DynamicOverlayEffect =
  | 'none'
  | 'snow'
  | 'petals'
  | 'rain'
  | 'leaves'
  | 'fireflies'
  | 'bubbles'
  | 'dust'
  | 'stars';
export type DynamicImageFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down' | 'repeat';
export type DynamicTransition =
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'zoom'
  | 'zoom-out'
  | 'blur'
  | 'wipe'
  | 'diagonal-wipe'
  | 'iris'
  | 'shutter'
  | 'flip'
  | 'rotate'
  | 'grayscale'
  | 'ken-burns';

export interface DynamicBackgroundConfig {
  type: DynamicBackgroundType;
  path: string;
  source: DynamicSlideshowSource;
  folder_id: string;
  items: string[];
  interval_seconds: number;
  transition: DynamicTransition;
  transition_duration: number;
  shuffle: boolean;
  muted: boolean;
  volume: number;
  loop: boolean;
  playback_rate: number;
  autoplay: boolean;
  image_fit: DynamicImageFit;
  overlay_effect: DynamicOverlayEffect;
  overlay_density: number;
  overlay_speed: number;
  overlay_size: number;
  overlay_opacity: number;
}

export interface DynamicWidgetInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  background_opacity: number;
  background_blur: boolean;
  settings: Record<string, unknown>;
}

export interface DynamicWallpaperScene {
  background: DynamicBackgroundConfig;
  widgets: DynamicWidgetInstance[];
  revision: number;
}

export async function selectDynamicWallpaperImage(): Promise<string | null> {
  return call('select_dynamic_wallpaper_image');
}

export async function getDynamicWallpaperScene(resolveItems = false): Promise<DynamicWallpaperScene> {
  return call('get_dynamic_wallpaper_scene', resolveItems);
}

export async function resolveDynamicWallpaperScene(scene: DynamicWallpaperScene): Promise<DynamicWallpaperScene> {
  return call('resolve_dynamic_wallpaper_scene', scene);
}

export async function reportDynamicWallpaperTelemetry(payload: {
  media_revision: number;
  event: string;
  paused: boolean;
  ended?: boolean;
}): Promise<void> {
  await waitForApi();
  const response = await fetch('/api/dynamic-wallpaper/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('动态壁纸运行状态上报失败');
}

export async function getDynamicWallpaperCatalog(): Promise<{ favorite_folders: FavoriteFolder[] }> {
  return call('get_dynamic_wallpaper_catalog');
}

export async function saveDynamicWallpaperScene(scene: DynamicWallpaperScene): Promise<DynamicWallpaperScene> {
  return call('save_dynamic_wallpaper_scene', scene);
}

export async function startDynamicWallpaperScene(scene: DynamicWallpaperScene): Promise<DynamicWallpaperStatus> {
  return call('start_dynamic_wallpaper_scene', scene);
}

export async function applyDynamicWallpaperScene(scene: DynamicWallpaperScene): Promise<{
  scene: DynamicWallpaperScene;
  status: DynamicWallpaperStatus;
}> {
  return call('apply_dynamic_wallpaper_scene', scene);
}

export async function openDynamicWidgetEditor(): Promise<boolean> {
  return call('open_dynamic_widget_editor');
}

export async function closeDynamicWidgetEditor(): Promise<boolean> {
  return call('close_dynamic_widget_editor');
}

export function dynamicWallpaperAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/api/')) return mediaApiUrl(path);
  const token = readToken();
  const query = `path=${encodeURIComponent(path)}${token ? `&token=${token}` : ''}`;
  return mediaApiUrl(`/api/dynamic-wallpaper/asset?${query}`);
}

export type FavoriteExportScope = 'selected' | 'folder' | 'all';

export interface FavoriteExportOptions {
  scope: FavoriteExportScope;
  folder_id?: string;
  item_ids?: string[];
  include_local_data: boolean;
  compression: boolean;
  compression_level: number;
}

export interface FavoriteExportResult {
  path: string;
  item_count: number;
  folder_count: number;
  local_file_count: number;
  missing_local_count: number;
  compressed: boolean;
  compression_level: number | null;
}

export interface FavoriteImportResult {
  imported_items: number;
  skipped_items: number;
  added_folders: number;
  restored_local_files: number;
  missing_local_files: number;
}

export async function exportFavorites(options: FavoriteExportOptions): Promise<FavoriteExportResult> {
  return call('export_favorites', options);
}

export async function importFavorites(path: string): Promise<FavoriteImportResult> {
  return call('import_favorites', path);
}

export async function pickAndImportFavorites(): Promise<FavoriteImportResult | null> {
  return call('pick_and_import_favorites');
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
  return mediaApiUrl(`/api/preview?${q}`);
}

/** Original-quality URL for a local image file (no thumbnail re-encode). */
export function localFileUrl(path: string): string {
  const token = readToken();
  const q = `path=${encodeURIComponent(path)}${token ? `&token=${token}` : ''}`;
  return mediaApiUrl(`/api/preview?${q}`);
}

// --- AI generation records ---

export interface GeneratedImageRecord {
  id: string;
  path: string;
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  size?: string;
  providerName?: string;
  modelName?: string;
  revisedPrompt?: string;
  createdAt?: number;
  preview_url?: string;
}

export async function getGeneratedImages(): Promise<GeneratedImageRecord[]> {
  return call('get_generated_images');
}

export async function saveGeneratedImage(
  blob: Blob,
  filename: string,
  meta: Omit<GeneratedImageRecord, 'path' | 'preview_url'>,
): Promise<GeneratedImageRecord | null> {
  await waitForApi();
  try {
    const params = new URLSearchParams({ filename, meta: JSON.stringify(meta) });
    const res = await fetch(`/api/save-generated?${params}`, {
      method: 'POST',
      headers: authHeaders(),
      body: blob,
    });
    const payload = await res.json();
    if (!res.ok || payload?.error) {
      logError('saveGeneratedImage failed', new Error(payload?.error?.message || `HTTP ${res.status}`));
      return null;
    }
    return (payload.record as GeneratedImageRecord) ?? null;
  } catch (e) {
    logError('saveGeneratedImage failed', e);
    return null;
  }
}

export async function deleteGeneratedImage(id: string): Promise<void> {
  return call('delete_generated_image', id);
}

export async function clearGeneratedImages(deleteFiles: boolean = true): Promise<void> {
  return call('clear_generated_images', deleteFiles);
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

export async function queryCnuSelected(
  page: number = 1,
  limit: number = 20,
  forceRefresh: boolean = false,
): Promise<CnuWorkSummary[]> {
  return call('query_cnu_selected', page, limit, forceRefresh);
}

export async function queryCnuWorks(
  section: 'inspiration' | 'discovery',
  order: 'hot' | 'recommend' | 'recent',
  categoryId: string = '0',
  page: number = 1,
  limit: number = 40,
  forceRefresh: boolean = false,
): Promise<CnuWorkSummary[]> {
  return call('query_cnu_works', section, order, categoryId, page, limit, forceRefresh);
}

export async function getCnuWork(workId: string): Promise<WallpaperItem[]> {
  return call('get_cnu_work', workId);
}

export async function queryPixivelRanking(
  mode: string = 'day',
  page: number = 1,
  limit: number = 30,
  forceRefresh: boolean = false,
  rankingDate?: string,
  signal?: AbortSignal,
): Promise<PixivelWorkSummary[]> {
  return callRequest('query_pixivel_ranking', [mode, page, limit, forceRefresh, rankingDate], signal);
}

export async function getPixivelWork(workId: string): Promise<WallpaperItem[]> {
  return call('get_pixivel_work', workId);
}

export async function listTimelineTopics(
  forceRefresh: boolean = false,
  signal?: AbortSignal,
): Promise<TimelineTopicSummary[]> {
  return callRequest('list_timeline_topics', [forceRefresh], signal);
}

export async function queryTimelineWallpapers(
  mode: 'latest' | 'trending' | 'random' | 'topic',
  cursor: number | null = null,
  topic: string = '',
  seed?: number,
  forceRefresh: boolean = false,
  signal?: AbortSignal,
): Promise<TimelineWallpaperPage> {
  return callRequest(
    'query_timeline_wallpapers',
    [mode, cursor, topic, seed, forceRefresh],
    signal,
  );
}

export async function clearSourceCache(source?: 'bing' | 'spotlight' | 'cnu' | 'pixivel' | 'timeline'): Promise<{ cleared: string[] }> {
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

export async function getStorageOverview(): Promise<StorageOverview> {
  return call('get_storage_overview');
}

export interface StorageOperationResult {
  overview: StorageOverview;
  removed?: number;
  skipped?: number;
  failed: number;
  compressed?: number;
  saved_bytes?: number;
}

export interface StorageDirectoryInspection {
  path: string;
  is_empty: boolean;
  entry_count: number;
  same_as_current: boolean;
}

export interface StorageOperationStatus {
  id: string;
  running: boolean;
  kind: '' | 'downloads' | 'favorites';
  title: string;
  message: string;
  current: number;
  total: number;
  success: boolean | null;
  error: string;
  moved: number;
  undeleted: number;
  started_at: string;
  finished_at: string;
}

export async function inspectStorageDirectory(directory: string, kind: 'downloads' | 'favorites'): Promise<StorageDirectoryInspection> {
  return call('inspect_storage_directory', directory, kind);
}

export async function getStorageOperationStatus(): Promise<StorageOperationStatus> {
  return call('get_storage_operation_status');
}

export async function startStorageDirectoryChange(
  kind: 'downloads' | 'favorites',
  directory: string | undefined,
  migrate: boolean,
  allowNonEmpty: boolean,
): Promise<StorageOperationStatus> {
  return call('start_storage_directory_change', kind, directory, migrate, allowNonEmpty);
}

export async function clearStorageCategory(categoryId: string): Promise<StorageOperationResult> {
  return call('clear_storage_category', categoryId);
}

export async function compressDownloads(formatId: string, quality: number): Promise<StorageOperationResult> {
  return call('compress_downloads', formatId, quality);
}

export async function pickDownloadDirectory(): Promise<{ path: string } | null> {
  return call('pick_download_directory');
}

export async function setDownloadDirectory(directory?: string, migrate: boolean = false, allowNonEmpty: boolean = false): Promise<{ settings: AppSettings; storage: StorageOverview; moved: number; undeleted: number }> {
  return call('set_download_directory', directory, migrate, allowNonEmpty);
}

export async function pickFavoritesDirectory(): Promise<{ path: string } | null> {
  return call('pick_favorites_directory');
}

export async function setFavoritesDirectory(directory?: string, migrate: boolean = false, allowNonEmpty: boolean = false): Promise<{ settings: AppSettings; storage: StorageOverview; moved: number; undeleted: number; backup: string }> {
  return call('set_favorites_directory', directory, migrate, allowNonEmpty);
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

export async function clearLogs(): Promise<LogStats & { removed: number; failed: number; truncated: number }> {
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
  config?: {
    request?: {
      global_interval_seconds?: number;
      timeout_seconds?: number;
      max_concurrent?: number;
      skip_ssl_verify?: boolean;
      user_agent?: string;
      headers?: Record<string, string>;
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
      variables?: Record<string, string>;
    };
  };
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
  contains_nsfw?: boolean;
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
  type?: 'text' | 'choice' | 'boolean';
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
    contains_nsfw?: boolean;
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

export async function updateWallpaperSource(sourceId: string, payload: WallpaperSourceCreatorPayload): Promise<WallpaperSource> {
  return call('update_wallpaper_source', sourceId, payload);
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
