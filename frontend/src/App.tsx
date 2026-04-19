import {
  AppBar,
  Alert,
  Avatar,
  Backdrop,
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  CardMedia,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  MenuItem,
  Paper,
  Snackbar,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import CollectionsBookmarkRoundedIcon from '@mui/icons-material/CollectionsBookmarkRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import ExploreRoundedIcon from '@mui/icons-material/ExploreRounded';
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded';
import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import InfoRoundedIcon from '@mui/icons-material/InfoRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import LocalMallRoundedIcon from '@mui/icons-material/LocalMallRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded';
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import WallpaperRoundedIcon from '@mui/icons-material/WallpaperRounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { desktopApi } from './api';
import { ThemeManagerPanel } from './components/ThemeManagerPanel';
import { WallpaperCreator } from './components/WallpaperCreator';
import { createTranslator, resolveLocale } from './i18n';
import type { SupportedLocale, TranslateFn } from './i18n';
import {
  DEFAULT_THEME_ID,
  buildThemeCatalog,
  ensureUniqueThemeId,
  extractCustomThemes,
  getBuiltinThemeDocuments,
  getThemeRiskFlags,
  normalizeThemeDocument,
  resolveThemeDocument,
} from './themeSystem';
import type { ThemeDocument } from './themeSystem';
import type {
  BootstrapPayload,
  CurrentWallpaperInfo,
  DebugLogPayload,
  FavoriteFolder,
  FavoriteItem,
  IntelligentMarketHealthUpdate,
  IntelligentMarketParameter,
  IntelligentMarketSource,
  StorageEntry,
  StorageOverviewPayload,
  StoreResource,
  WallpaperItem,
  WallpaperSource,
} from './types';

type NavKey = 'home' | 'resource' | 'favorite' | 'store' | 'generate' | 'sniff' | 'history' | 'settings' | 'about';

type NavItem = {
  key: NavKey;
  label: string;
  subtitle: string;
  icon: JSX.Element;
  group: 'browse' | 'tools' | 'info';
};

type BingCollectionTab = 'daily' | 'recent';
type SpotlightCollectionTab = 'local' | 'online';
type ScreenBingQuality = `screen:${number}x${number}`;
type BingQuality = 'highDef' | 'ultraHighDef' | ScreenBingQuality;
type FavoriteLocalizationFilter = 'all' | 'localized' | 'remote' | 'failed';

const drawerWidth = 280;
import { APP_VERSION, APP_LOGO, STUDIO_LOGO } from './constants';

const appLogoSrc = APP_LOGO;
const studioLogoSrc = STUDIO_LOGO;
const DEFAULT_BING_MARKET = 'auto';
const DEFAULT_BING_MARKET_BY_LANGUAGE: Record<SupportedLocale, string> = {
  'zh-CN': 'zh-CN',
  'en-US': 'en-US',
};
const BING_MARKET_OPTIONS = [
  { value: 'auto', labelKey: 'settings.ui.bingMarket.auto' },
  { value: 'zh-CN', labelKey: 'settings.ui.bingMarket.zhCN' },
  { value: 'ja-JP', labelKey: 'settings.ui.bingMarket.jaJP' },
  { value: 'en-US', labelKey: 'settings.ui.bingMarket.enUS' },
  { value: 'en-GB', labelKey: 'settings.ui.bingMarket.enGB' },
] as const;
const INTELLIGENT_MARKET_ALL_CATEGORY = '__all__';
const INTELLIGENT_MARKET_MIRROR_OPTIONS = [
  { value: 'auto', labelKey: 'resource.im.mirror.auto' },
  { value: 'github', labelKey: 'resource.im.mirror.github' },
  { value: 'jsdelivr', labelKey: 'resource.im.mirror.jsdelivr' },
  { value: 'ghproxy', labelKey: 'resource.im.mirror.ghproxy' },
] as const;
const INTELLIGENT_MARKET_HEALTH_BATCH_SIZE = 6;

function getIntelligentMarketParameterLabel(param: IntelligentMarketParameter, index: number, t: TranslateFn): string {
  return param.friendly_name?.trim() || param.name?.trim() || t('resource.im.parameterFallback', { index: index + 1 });
}

function getIntelligentMarketParameterDefaultValue(param: IntelligentMarketParameter): string | boolean {
  const type = String(param.type ?? 'string').toLowerCase();
  if (type === 'boolean') {
    return Boolean(param.default_value);
  }
  if (type === 'list') {
    if (Array.isArray(param.default_value)) {
      const separator = param.split_str || '\n';
      return param.default_value.map((item) => String(item)).join(separator);
    }
    return String(param.default_value ?? '');
  }
  return String(param.default_value ?? '');
}

function normalizeIntelligentMarketParameterValue(param: IntelligentMarketParameter, value: unknown): unknown {
  const type = String(param.type ?? 'string').toLowerCase();
  if (type === 'boolean') {
    return Boolean(value);
  }
  if (type === 'list') {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return [];
    }
    if (param.split_str) {
      return raw.split(param.split_str).map((item) => item.trim()).filter(Boolean);
    }
    return raw.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
  }
  return value;
}

function intelligentMarketSourceMatches(source: IntelligentMarketSource, searchText: string): boolean {
  if (!searchText) {
    return true;
  }
  const haystack = [source.category, source.friendly_name, source.intro, source.link, source.file_path]
    .filter((segment): segment is string => Boolean(segment))
    .join(' ')
    .toLowerCase();
  return haystack.includes(searchText);
}

function getIntelligentMarketHealthColor(status?: string | null): 'success' | 'error' | 'warning' | 'default' {
  if (status === 'healthy') {
    return 'success';
  }
  if (status === 'unhealthy') {
    return 'error';
  }
  if (status === 'unknown') {
    return 'warning';
  }
  return 'default';
}

function getIntelligentMarketHealthLabel(status: string | null | undefined, t: TranslateFn): string {
  if (status === 'healthy') {
    return t('resource.im.health.healthy');
  }
  if (status === 'unhealthy') {
    return t('resource.im.health.unhealthy');
  }
  return t('resource.im.health.unknown');
}

function mergeIntelligentMarketHealthUpdates(
  sources: IntelligentMarketSource[],
  updates: IntelligentMarketHealthUpdate[],
): IntelligentMarketSource[] {
  if (updates.length === 0) {
    return sources;
  }

  const updateMap = new Map(updates.map((update) => [update.id, update]));
  return sources.map((source) => {
    const update = updateMap.get(source.id);
    return update ? { ...source, ...update } : source;
  });
}

function truncateMiddle(value: string, maxLength = 56): string {
  if (value.length <= maxLength) {
    return value;
  }

  const edgeLength = Math.max(8, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, edgeLength)}...${value.slice(-edgeLength)}`;
}

function resolveImageSource(value?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  if (/^(https?:|data:|blob:|file:)/i.test(raw)) {
    return raw;
  }
  if (/^[a-zA-Z]:[\\/]/.test(raw)) {
    return encodeURI(`file:///${raw.replace(/\\/g, '/')}`);
  }
  if (raw.startsWith('\\\\')) {
    return encodeURI(`file:${raw.replace(/\\/g, '/')}`);
  }
  return raw;
}

function looksLikeLocalResource(value?: string | null): boolean {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return false;
  }
  if (/^file:/i.test(raw)) {
    return true;
  }
  if (/^[a-zA-Z]:[\\/]/.test(raw)) {
    return true;
  }
  return raw.startsWith('\\\\');
}

function resolvePreviewDialogSource(item: WallpaperItem): string {
  if (looksLikeLocalResource(item.image_url) && item.preview_url) {
    return resolveImageSource(item.preview_url);
  }
  return resolveImageSource(item.image_url || item.preview_url || '');
}

function formatTimestamp(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function formatFileSize(size?: number | null): string | null {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return null;
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function getStorageTargetTitle(targetId: string, t: TranslateFn): string {
  switch (targetId) {
    case 'downloads':
      return t('settings.storage.target.downloads.title');
    case 'favorite_localizations':
      return t('settings.storage.target.favoriteLocalizations.title');
    case 'wallpaper_history':
      return t('settings.storage.target.wallpaperHistory.title');
    case 'intelligent_market_cache':
      return t('settings.storage.target.intelligentMarketCache.title');
    case 'ltws_cache':
      return t('settings.storage.target.ltwsCache.title');
    case 'logs':
      return t('settings.storage.target.logs.title');
    default:
      return targetId;
  }
}

function getStorageTargetDescription(targetId: string, t: TranslateFn): string {
  switch (targetId) {
    case 'downloads':
      return t('settings.storage.target.downloads.description');
    case 'favorite_localizations':
      return t('settings.storage.target.favoriteLocalizations.description');
    case 'wallpaper_history':
      return t('settings.storage.target.wallpaperHistory.description');
    case 'intelligent_market_cache':
      return t('settings.storage.target.intelligentMarketCache.description');
    case 'ltws_cache':
      return t('settings.storage.target.ltwsCache.description');
    case 'logs':
      return t('settings.storage.target.logs.description');
    default:
      return targetId;
  }
}

function getStorageScopeLabel(scope: string, t: TranslateFn): string {
  return scope === 'cache' ? t('settings.storage.scope.cache') : t('settings.storage.scope.data');
}

function getStorageScopeColor(scope: string): 'info' | 'warning' {
  return scope === 'cache' ? 'warning' : 'info';
}

function matchesBingQuality(items: WallpaperItem[], quality: BingQuality): boolean {
  if (items.length === 0) {
    return true;
  }

  const currentQuality = items[0]?.metadata?.quality;
  return typeof currentQuality !== 'string' || currentQuality === quality;
}

function parseScreenBingQuality(quality: string): { width: number; height: number } | null {
  const match = /^screen:(\d{2,5})x(\d{2,5})$/.exec(quality);
  if (!match) {
    return null;
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function formatBingQualityLabel(quality: string, t: TranslateFn): string {
  if (quality === 'highDef') {
    return t('resource.bing.quality.highDef');
  }
  if (quality === 'ultraHighDef') {
    return t('resource.bing.quality.ultraHighDef');
  }

  const screenQuality = parseScreenBingQuality(quality);
  if (screenQuality) {
    return t('resource.bing.quality.screen', { width: screenQuality.width, height: screenQuality.height });
  }

  return quality;
}

function resolveBingMarket(language: SupportedLocale, market: string | null | undefined): string {
  const normalizedMarket = String(market ?? '').trim();
  if (!normalizedMarket || normalizedMarket === DEFAULT_BING_MARKET) {
    return DEFAULT_BING_MARKET_BY_LANGUAGE[language] ?? 'en-US';
  }
  return normalizedMarket;
}

function localizeBackendMessage(message: string, t: TranslateFn): string {
  if (message === '壁纸已更新') {
    return t('errors.wallpaperUpdated');
  }
  if (message === '下载壁纸超时，请稍后重试或切换其他画质。') {
    return t('errors.downloadTimeout');
  }
  if (message === '当前平台暂未实现设置壁纸') {
    return t('errors.platformNotSupported');
  }
  if (message === '自动换壁纸没有可用的数据源') {
    return t('errors.autoChangeNoSource');
  }
  if (message.startsWith('下载壁纸失败:')) {
    return `${t('errors.downloadFailedPrefix')}: ${message.slice('下载壁纸失败:'.length).trim()}`;
  }
  return message;
}

function localizeSourceName(sourceId: string, fallback: string, t: TranslateFn): string {
  switch (sourceId) {
    case 'builtin.bing_daily':
      return t('builtin.bingDaily');
    case 'builtin.bing_recent':
      return t('builtin.bingRecent');
    case 'builtin.windows_spotlight':
      return t('builtin.spotlightLocal');
    case 'builtin.windows_spotlight_online':
      return t('builtin.spotlightOnline');
    default:
      return fallback;
  }
}

function localizeStoreName(id: string, fallback: string, t: TranslateFn): string {
  switch (id) {
    case 'example.generator':
      return t('builtin.store.plugin.exampleGenerator.name');
    default:
      return fallback;
  }
}

function localizeStoreDescription(id: string, fallback: string, t: TranslateFn): string {
  switch (id) {
    case 'aurora-paper':
      return t('builtin.store.theme.auroraPaper.description');
    case 'builtin.bing_daily':
      return t('builtin.store.source.bingDaily.description');
    case 'example.generator':
      return t('builtin.store.plugin.exampleGenerator.description');
    default:
      return fallback;
  }
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export default function App({ onThemeChange }: { onThemeChange: (themeDocument: ThemeDocument, options?: { cache?: boolean }) => void }) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [route, setRoute] = useState<NavKey>('home');
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resourceTab, setResourceTab] = useState(0);
  const [bingCollectionTab, setBingCollectionTab] = useState<BingCollectionTab>('daily');
  const [spotlightCollectionTab, setSpotlightCollectionTab] = useState<SpotlightCollectionTab>('local');
  const [bingQuality, setBingQuality] = useState<BingQuality>('highDef');
  const [settingsTab, setSettingsTab] = useState(0);
  const [storeTab, setStoreTab] = useState(0);
  const [gallery, setGallery] = useState<WallpaperItem[]>([]);
  const [bingDailyGallery, setBingDailyGallery] = useState<WallpaperItem[]>([]);
  const [bingRecentGallery, setBingRecentGallery] = useState<WallpaperItem[]>([]);
  const [spotlightLocalGallery, setSpotlightLocalGallery] = useState<WallpaperItem[]>([]);
  const [spotlightOnlineGallery, setSpotlightOnlineGallery] = useState<WallpaperItem[]>([]);
  const [bingDailyLoaded, setBingDailyLoaded] = useState(false);
  const [bingRecentLoaded, setBingRecentLoaded] = useState(false);
  const [spotlightLocalLoaded, setSpotlightLocalLoaded] = useState(false);
  const [spotlightOnlineLoaded, setSpotlightOnlineLoaded] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedSourceApi, setSelectedSourceApi] = useState('');
  const [intelligentMarketSources, setIntelligentMarketSources] = useState<IntelligentMarketSource[]>([]);
  const [intelligentMarketLoaded, setIntelligentMarketLoaded] = useState(false);
  const [intelligentMarketLoading, setIntelligentMarketLoading] = useState(false);
  const [intelligentMarketSearch, setIntelligentMarketSearch] = useState('');
  const [selectedIntelligentMarketCategory, setSelectedIntelligentMarketCategory] = useState(INTELLIGENT_MARKET_ALL_CATEGORY);
  const [selectedIntelligentMarketSourceId, setSelectedIntelligentMarketSourceId] = useState('');
  const [intelligentMarketParameterValues, setIntelligentMarketParameterValues] = useState<Record<string, unknown>>({});
  const [preview, setPreview] = useState<WallpaperItem | null>(null);
  const [sniffUrl, setSniffUrl] = useState('https://www.bing.com');
  const [storeData, setStoreData] = useState<Record<string, unknown> | null>(null);
  const [storeResources, setStoreResources] = useState<StoreResource[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeDetailResource, setStoreDetailResource] = useState<StoreResource | null>(null);
  const [plugins, setPlugins] = useState<Array<Record<string, unknown>>>([]);
  const [runtime, setRuntime] = useState<BootstrapPayload['runtime'] | null>(null);
  const [snackbar, setSnackbar] = useState('');
  const [debugLog, setDebugLog] = useState<DebugLogPayload | null>(null);
  const [debugLogDialogOpen, setDebugLogDialogOpen] = useState(false);
  const [storageOverview, setStorageOverview] = useState<StorageOverviewPayload | null>(null);
  const [storageClearTargetId, setStorageClearTargetId] = useState<string | null>(null);
  const [storageOptimizeTargets, setStorageOptimizeTargets] = useState<string[]>(['favorite_localizations', 'downloads']);
  const [storageOptimizeQuality, setStorageOptimizeQuality] = useState(78);
  const [selectedFavoriteFolderId, setSelectedFavoriteFolderId] = useState<string>('__all__');
  const [favoriteFolderDialogMode, setFavoriteFolderDialogMode] = useState<'create' | 'rename' | null>(null);
  const [favoriteFolderName, setFavoriteFolderName] = useState('');
  const [favoriteFolderDescription, setFavoriteFolderDescription] = useState('');
  const [favoriteDeleteDialogOpen, setFavoriteDeleteDialogOpen] = useState(false);
  const [favoriteDeleteMoveTargetId, setFavoriteDeleteMoveTargetId] = useState('default');
  const [favoriteSearchQuery, setFavoriteSearchQuery] = useState('');
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteLocalizationFilter>('all');
  const [themePreviewDocument, setThemePreviewDocument] = useState<ThemeDocument | null>(null);
  const intelligentMarketHealthRequestIdRef = useRef(0);
  const intelligentMarketDetailRef = useRef<HTMLDivElement | null>(null);

  const currentWallpaper = boot?.home?.current_wallpaper ?? null;
  const debugSettings = (boot?.settings?.debug ?? {}) as Record<string, unknown>;
  const storageSettings = (boot?.settings?.storage ?? {}) as Record<string, unknown>;
  const uiSettings = (boot?.settings?.ui ?? {}) as Record<string, unknown>;
  const wallpaperSettings = (boot?.settings?.wallpaper ?? {}) as Record<string, unknown>;
  const bingSettings = (wallpaperSettings.bing ?? {}) as Record<string, unknown>;
  const intelligentMarketSettings = (boot?.settings?.im ?? {}) as Record<string, unknown>;
  const startupSettings = (boot?.settings?.startup ?? {}) as Record<string, unknown>;
  const language = resolveLocale(String(uiSettings.language ?? 'zh-CN'));
  const t = useMemo(() => createTranslator(language), [language]);
  const builtinThemes = useMemo(() => getBuiltinThemeDocuments(language), [language]);
  const customThemes = useMemo(() => extractCustomThemes(uiSettings.custom_themes), [uiSettings.custom_themes]);
  const activeThemeId = String(uiSettings.theme_profile ?? DEFAULT_THEME_ID);
  const themeCatalog = useMemo(() => buildThemeCatalog(builtinThemes, customThemes), [builtinThemes, customThemes]);
  const activeThemeDocument = useMemo(
    () => resolveThemeDocument(activeThemeId, builtinThemes, customThemes),
    [activeThemeId, builtinThemes, customThemes],
  );
  const displayResolution = runtime?.display;
  const screenResolution = useMemo(() => {
    const width = Math.max(1, Math.round(displayResolution?.width ?? 1920));
    const height = Math.max(1, Math.round(displayResolution?.height ?? 1080));
    return {
      width,
      height,
      quality: `screen:${width}x${height}` as ScreenBingQuality,
    };
  }, [displayResolution?.height, displayResolution?.width]);
  const spotlightMarket = language === 'en-US' ? 'en-US' : 'zh-CN';
  const bingMarketSetting = String(bingSettings.market ?? DEFAULT_BING_MARKET);
  const bingMarket = resolveBingMarket(language, bingMarketSetting);
  const intelligentMarketMirrorPreference = String(intelligentMarketSettings.mirror_preference ?? 'auto');
  const currentWallpaperName = currentWallpaper?.local_path.split(/[/\\]/).pop() ?? t('home.currentWallpaperName');
  const navigation = useMemo<NavItem[]>(() => [
    { key: 'home', label: t('nav.home.label'), subtitle: t('nav.home.subtitle'), icon: <HomeRoundedIcon />, group: 'browse' },
    { key: 'resource', label: t('nav.resource.label'), subtitle: t('nav.resource.subtitle'), icon: <WallpaperRoundedIcon />, group: 'browse' },
    { key: 'favorite', label: t('nav.favorite.label'), subtitle: t('nav.favorite.subtitle'), icon: <FavoriteRoundedIcon />, group: 'browse' },
    { key: 'history', label: t('nav.history.label'), subtitle: t('nav.history.subtitle'), icon: <HistoryRoundedIcon />, group: 'browse' },
    { key: 'store', label: t('nav.store.label'), subtitle: t('nav.store.subtitle'), icon: <LocalMallRoundedIcon />, group: 'tools' },
    { key: 'sniff', label: t('nav.sniff.label'), subtitle: t('nav.sniff.subtitle'), icon: <ExploreRoundedIcon />, group: 'tools' },
    { key: 'generate', label: t('nav.generate.label'), subtitle: t('nav.generate.subtitle'), icon: <WidgetsRoundedIcon />, group: 'tools' },
    { key: 'settings', label: t('nav.settings.label'), subtitle: t('nav.settings.subtitle'), icon: <SettingsRoundedIcon />, group: 'tools' },
    { key: 'about', label: t('nav.about.label'), subtitle: t('nav.about.subtitle'), icon: <InfoRoundedIcon />, group: 'info' },
  ], [t]);

  useEffect(() => {
    void loadBootstrap();
  }, []);

  useEffect(() => {
    onThemeChange(themePreviewDocument ?? activeThemeDocument, { cache: themePreviewDocument == null });
  }, [activeThemeDocument, onThemeChange, themePreviewDocument]);

  useEffect(() => {
    if (!boot) {
      return;
    }

    const timer = window.setInterval(() => {
      void syncCurrentWallpaper(false);
    }, 20000);

    return () => window.clearInterval(timer);
  }, [boot, currentWallpaper?.local_path, currentWallpaper?.exists]);

  useEffect(() => {
    if (!debugLogDialogOpen) {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchDebugLog();
    }, 2000);

    return () => window.clearInterval(timer);
  }, [debugLogDialogOpen]);

  useEffect(() => {
    if (selectedFavoriteFolderId === '__all__') {
      return;
    }
    const folders = boot?.favorites?.folders ?? [];
    if (!folders.some((folder) => folder.id === selectedFavoriteFolderId)) {
      setSelectedFavoriteFolderId('__all__');
    }
  }, [boot?.favorites?.folders, selectedFavoriteFolderId]);

  const sources = boot?.sources ?? [];
  const validSources = sources.filter((source) => !source.invalid);
  const invalidSources = sources.filter((source) => source.invalid);
  const favorites = boot?.favorites?.items ?? [];
  const favoriteFolders = useMemo<FavoriteFolder[]>(() => {
    const folders = boot?.favorites?.folders ?? [];
    const order = boot?.favorites?.folder_order ?? folders.map((folder) => folder.id);
    const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
    const ordered = order
      .map((folderId) => folderMap.get(folderId))
      .filter((folder): folder is FavoriteFolder => Boolean(folder));
    folders.forEach((folder) => {
      if (!ordered.some((candidate) => candidate.id === folder.id)) {
        ordered.push(folder);
      }
    });
    return ordered;
  }, [boot?.favorites]);
  const history = boot?.history ?? [];
  const homeBing = bingDailyGallery;
  const homeSpotlight = spotlightLocalGallery;
  const quote = boot?.home?.quote;
  const activeRoute = navigation.find((item) => item.key === route) ?? navigation[0];
  const selectedFavoriteFolder = favoriteFolders.find((folder) => folder.id === selectedFavoriteFolderId) ?? null;
  const deferredFavoriteSearch = useDeferredValue(favoriteSearchQuery.trim().toLowerCase());
  const deferredIntelligentMarketSearch = useDeferredValue(intelligentMarketSearch.trim().toLowerCase());
  const selectedFavoriteFolderItems = useMemo<FavoriteItem[]>(() => {
    if (selectedFavoriteFolderId === '__all__') {
      return favorites;
    }
    return favorites.filter((item) => item.folder_id === selectedFavoriteFolderId);
  }, [favorites, selectedFavoriteFolderId]);
  const visibleFavorites = useMemo<FavoriteItem[]>(() => {
    return selectedFavoriteFolderItems.filter((item) => {
      const localized = Boolean(item.localized || item.localization_status === 'completed');
      const failed = item.localization_status === 'failed';
      const canLocalize = item.can_localize !== false;

      if (favoriteFilter === 'localized' && !localized) {
        return false;
      }
      if (favoriteFilter === 'remote' && (!canLocalize || localized)) {
        return false;
      }
      if (favoriteFilter === 'failed' && !failed) {
        return false;
      }
      if (!deferredFavoriteSearch) {
        return true;
      }

      const haystack = [
        item.title,
        item.source_name,
        item.description,
        item.tags?.join(' '),
      ]
        .filter((segment): segment is string => Boolean(segment))
        .join(' ')
        .toLowerCase();
      return haystack.includes(deferredFavoriteSearch);
    });
  }, [deferredFavoriteSearch, favoriteFilter, selectedFavoriteFolderItems]);
  const favoriteLocalizedCount = useMemo(
    () => favorites.filter((item) => item.localized || item.localization_status === 'completed').length,
    [favorites],
  );
  const favoriteEmptyDescription =
    favoriteSearchQuery.trim() || favoriteFilter !== 'all'
      ? t('favorites.emptySearchDescription')
      : selectedFavoriteFolderId === '__all__'
        ? t('favorites.emptyDescription')
        : t('favorites.emptyFolderDescription');
  const storageEntries = storageOverview?.items ?? [];
  const storageClearTarget = useMemo(
    () => storageEntries.find((item) => item.id === storageClearTargetId) ?? null,
    [storageClearTargetId, storageEntries],
  );
  const storageOptimizableTargets = useMemo(
    () => storageEntries.filter((item) => item.optimize_supported),
    [storageEntries],
  );
  const currentDownloadDirectory = storageOverview?.download_directory ?? String(storageSettings.download_directory ?? '');
  const defaultDownloadDirectory = storageOverview?.default_download_directory ?? currentDownloadDirectory;

  const selectedSource = useMemo(
    () => validSources.find((source) => source.identifier === selectedSourceId) ?? validSources[0] ?? null,
    [selectedSourceId, validSources],
  );
  const intelligentMarketCategories = useMemo(
    () => Array.from(new Set(intelligentMarketSources.map((source) => source.category))).sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [intelligentMarketSources],
  );
  const filteredIntelligentMarketSources = useMemo(
    () => intelligentMarketSources.filter((source) => {
      if (selectedIntelligentMarketCategory !== INTELLIGENT_MARKET_ALL_CATEGORY && source.category !== selectedIntelligentMarketCategory) {
        return false;
      }
      return intelligentMarketSourceMatches(source, deferredIntelligentMarketSearch);
    }),
    [deferredIntelligentMarketSearch, intelligentMarketSources, selectedIntelligentMarketCategory],
  );
  const selectedIntelligentMarketSource = useMemo(
    () => intelligentMarketSources.find((source) => source.id === selectedIntelligentMarketSourceId) ?? filteredIntelligentMarketSources[0] ?? intelligentMarketSources[0] ?? null,
    [filteredIntelligentMarketSources, intelligentMarketSources, selectedIntelligentMarketSourceId],
  );
  const intelligentMarketListLoading = intelligentMarketLoading && intelligentMarketSources.length === 0;
  const intelligentMarketHealthSummary = useMemo(
    () => filteredIntelligentMarketSources.reduce(
      (summary, source) => {
        const status = source.health_status;
        if (status === 'healthy') {
          summary.healthy += 1;
        } else if (status === 'unhealthy') {
          summary.unhealthy += 1;
        } else {
          summary.unknown += 1;
        }
        return summary;
      },
      { healthy: 0, unhealthy: 0, unknown: 0 },
    ),
    [filteredIntelligentMarketSources],
  );

  useEffect(() => {
    if (route === 'store') {
      void loadStore();
    }
  }, [route, storeTab]);

  useEffect(() => {
    if (route === 'resource' && resourceTab === 3 && !intelligentMarketLoaded && !intelligentMarketLoading) {
      void loadIntelligentMarketSources();
    }
  }, [intelligentMarketLoaded, intelligentMarketLoading, resourceTab, route]);

  useEffect(() => {
    if (!selectedSource) {
      if (selectedSourceId) {
        setSelectedSourceId('');
      }
      return;
    }
    if (selectedSourceId !== selectedSource.identifier) {
      setSelectedSourceId(selectedSource.identifier);
    }
  }, [selectedSource, selectedSourceId]);

  useEffect(() => {
    if (!selectedSource) {
      setSelectedSourceApi('');
      return;
    }
    const apiNames = ((selectedSource.apis ?? []) as Array<{ name?: string }>)
      .map((api) => api.name ?? '')
      .filter(Boolean);
    if (!apiNames.includes(selectedSourceApi)) {
      setSelectedSourceApi(apiNames[0] ?? '');
    }
  }, [selectedSource, selectedSourceApi]);

  useEffect(() => {
    if (!selectedIntelligentMarketSource) {
      if (selectedIntelligentMarketSourceId) {
        setSelectedIntelligentMarketSourceId('');
      }
      return;
    }
    if (selectedIntelligentMarketSourceId !== selectedIntelligentMarketSource.id) {
      setSelectedIntelligentMarketSourceId(selectedIntelligentMarketSource.id);
    }
  }, [selectedIntelligentMarketSource, selectedIntelligentMarketSourceId]);

  useEffect(() => {
    if (!selectedIntelligentMarketSource) {
      setIntelligentMarketParameterValues({});
      return;
    }
    setIntelligentMarketParameterValues((current) => {
      const nextValues: Record<string, unknown> = {};
      selectedIntelligentMarketSource.parameters.forEach((param, index) => {
        const key = param.key || param.name || `__param_${index}`;
        nextValues[key] = key in current ? current[key] : getIntelligentMarketParameterDefaultValue(param);
      });
      return nextValues;
    });
  }, [selectedIntelligentMarketSource]);

  useEffect(() => {
    if (route !== 'resource') {
      return;
    }
    if (resourceTab === 0) {
      setGallery(bingCollectionTab === 'daily' ? bingDailyGallery : bingRecentGallery);
      return;
    }
    if (resourceTab === 1) {
      setGallery(spotlightCollectionTab === 'local' ? spotlightLocalGallery : spotlightOnlineGallery);
    }
  }, [route, resourceTab, bingCollectionTab, spotlightCollectionTab, bingDailyGallery, bingRecentGallery, spotlightLocalGallery, spotlightOnlineGallery]);

  useEffect(() => {
    if (route !== 'resource') {
      return;
    }
    if (resourceTab === 0) {
      const activeBingGallery = bingCollectionTab === 'daily' ? bingDailyGallery : bingRecentGallery;
      const activeBingLoaded = bingCollectionTab === 'daily' ? bingDailyLoaded : bingRecentLoaded;
      if (!activeBingLoaded || !matchesBingQuality(activeBingGallery, bingQuality)) {
        void fetchBingGallery(bingCollectionTab);
      }
      return;
    }
    if (resourceTab === 1) {
      if (spotlightCollectionTab === 'local' && !spotlightLocalLoaded) {
        void fetchSpotlightGallery('local');
      }
      if (spotlightCollectionTab === 'online' && !spotlightOnlineLoaded) {
        void fetchSpotlightGallery('online');
      }
    }
  }, [route, resourceTab, bingCollectionTab, spotlightCollectionTab, bingQuality, bingDailyGallery, bingRecentGallery, bingDailyLoaded, bingRecentLoaded, spotlightLocalLoaded, spotlightOnlineLoaded]);

  async function loadBootstrap() {
    try {
      setLoading(true);
      const [payload, storage] = await Promise.all([
        desktopApi.bootstrap(),
        desktopApi.getStorageOverview(),
      ]);
      setBoot(payload);
      setStorageOverview(storage);
      setPlugins(payload.plugins);
      setRuntime(payload.runtime);
      setBingDailyGallery(payload.home.bing);
      setSpotlightLocalGallery(payload.home.spotlight);
      setBingDailyLoaded(true);
      setSpotlightLocalLoaded(true);
      setBingRecentLoaded(false);
      setSpotlightOnlineLoaded(false);
      setGallery(payload.home.bing);
      void recordAndRefreshHistory();
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.initFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function recordAndRefreshHistory() {
    try {
      await desktopApi.recordCurrentWallpaper();
      const updatedHistory = await desktopApi.listHistory();
      setBoot((current) => (current ? { ...current, history: updatedHistory } : current));
    } catch {
      // silent
    }
  }

  async function syncCurrentWallpaper(showFeedback: boolean) {
    try {
      const payload: CurrentWallpaperInfo | null = await desktopApi.getCurrentWallpaper();
      let changed = false;

      setBoot((current) => {
        if (!current) {
          return current;
        }

        const previous = current.home.current_wallpaper ?? null;
        const nextPath = payload?.local_path ?? null;
        const prevPath = previous?.local_path ?? null;
        const nextExists = payload?.exists ?? null;
        const prevExists = previous?.exists ?? null;

        if (prevPath === nextPath && prevExists === nextExists && previous?.preview_url === payload?.preview_url) {
          return current;
        }

        changed = true;
        return {
          ...current,
          home: {
            ...current.home,
            current_wallpaper: payload,
          },
        };
      });

      if (showFeedback) {
        setSnackbar(changed ? t('snackbar.currentWallpaperRefreshed') : t('snackbar.currentWallpaperNoChange'));
      }
    } catch (error) {
      if (showFeedback) {
        setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.refreshCurrentWallpaperFailed'));
      }
    }
  }

  async function copyCurrentWallpaperPath() {
    if (!currentWallpaper?.local_path) {
      setSnackbar(t('snackbar.noWallpaperPath'));
      return;
    }

    try {
      await copyText(currentWallpaper.local_path);
      setSnackbar(t('snackbar.wallpaperPathCopied'));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.copyWallpaperPathFailed'));
    }
  }

  async function fetchBingGallery(kind: BingCollectionTab, options?: { showBusy?: boolean; quality?: BingQuality; count?: number }) {
    const showBusy = options?.showBusy ?? true;
    const quality = options?.quality ?? bingQuality;
    const requestedCount = options?.count ?? (kind === 'daily' ? 1 : 12);
    try {
      if (showBusy) {
        setWorking(true);
      }
      const items = await desktopApi.queryBing(kind, bingMarket, requestedCount, quality);
      if (kind === 'daily') {
        setBingDailyGallery(items);
        setBingDailyLoaded(true);
      } else {
        setBingRecentGallery(items);
        setBingRecentLoaded(true);
      }
      if (route === 'resource' && resourceTab === 0 && bingCollectionTab === kind) {
        setGallery(items);
      }
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.bingLoadFailed'));
    } finally {
      if (showBusy) {
        setWorking(false);
      }
    }
  }

  async function fetchSpotlightGallery(kind: SpotlightCollectionTab, options?: { showBusy?: boolean; count?: number }) {
    const showBusy = options?.showBusy ?? true;
    try {
      if (showBusy) {
        setWorking(true);
      }
      const items = await desktopApi.querySpotlight(kind, options?.count ?? 18, spotlightMarket);
      if (kind === 'local') {
        setSpotlightLocalGallery(items);
        setSpotlightLocalLoaded(true);
      } else {
        setSpotlightOnlineGallery(items);
        setSpotlightOnlineLoaded(true);
      }
      if (route === 'resource' && resourceTab === 1 && spotlightCollectionTab === kind) {
        setGallery(items);
      }
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.spotlightLoadFailed'));
    } finally {
      if (showBusy) {
        setWorking(false);
      }
    }
  }

  async function handleBingQualityChange(nextQuality: BingQuality) {
    setBingQuality(nextQuality);
  }

  async function runBuiltinResource() {
    if (resourceTab === 0) {
      await fetchBingGallery(bingCollectionTab);
      return;
    }
    if (resourceTab === 1) {
      await fetchSpotlightGallery(spotlightCollectionTab);
    }
  }

  async function runSourceQuery() {
    if (!selectedSourceId || !selectedSourceApi) {
      setSnackbar(t('snackbar.selectSourceApi'));
      return;
    }
    try {
      setWorking(true);
      setGallery(await desktopApi.executeSource(selectedSourceId, selectedSourceApi, {}));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.sourceRequestFailed'));
    } finally {
      setWorking(false);
    }
  }

  function focusIntelligentMarketDetail() {
    window.requestAnimationFrame(() => {
      intelligentMarketDetailRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  function handleIntelligentMarketSourceSelect(sourceId: string) {
    setSelectedIntelligentMarketSourceId(sourceId);
    focusIntelligentMarketDetail();
  }

  async function startIntelligentMarketHealthChecks(sources: IntelligentMarketSource[], force = false) {
    const requestId = intelligentMarketHealthRequestIdRef.current + 1;
    intelligentMarketHealthRequestIdRef.current = requestId;

    const sourceIds = sources.map((source) => source.id);
    for (let index = 0; index < sourceIds.length; index += INTELLIGENT_MARKET_HEALTH_BATCH_SIZE) {
      if (intelligentMarketHealthRequestIdRef.current !== requestId) {
        return;
      }

      const batchIds = sourceIds.slice(index, index + INTELLIGENT_MARKET_HEALTH_BATCH_SIZE);
      if (batchIds.length === 0) {
        continue;
      }

      try {
        const updates = await desktopApi.checkIntelligentMarketSourcesHealth(batchIds, force);
        if (intelligentMarketHealthRequestIdRef.current !== requestId) {
          return;
        }
        setIntelligentMarketSources((current) => mergeIntelligentMarketHealthUpdates(current, updates));
      } catch {
        if (intelligentMarketHealthRequestIdRef.current !== requestId) {
          return;
        }
      }
    }
  }

  async function loadIntelligentMarketSources(force = false) {
    try {
      intelligentMarketHealthRequestIdRef.current += 1;
      setIntelligentMarketLoading(true);
      const sources = await desktopApi.listIntelligentMarketSources(force);
      setIntelligentMarketSources(sources);
      setIntelligentMarketLoaded(true);
      void startIntelligentMarketHealthChecks(sources, force);
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.intelligentMarketLoadFailed'));
    } finally {
      setIntelligentMarketLoading(false);
    }
  }

  async function updateIntelligentMarketMirrorPreference(value: string) {
    try {
      const settings = await desktopApi.updateSettings({ 'im.mirror_preference': value });
      setBoot((current) => (current ? { ...current, settings } : current));
      setIntelligentMarketLoaded(false);
      await loadIntelligentMarketSources(true);
      setSnackbar(t('snackbar.intelligentMarketMirrorUpdated'));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.settingsUpdateFailed'));
    }
  }

  async function runIntelligentMarketQuery() {
    if (!selectedIntelligentMarketSource) {
      setSnackbar(t('snackbar.intelligentMarketSourceRequired'));
      return;
    }
    try {
      setWorking(true);
      const payload = Object.fromEntries(
        selectedIntelligentMarketSource.parameters.map((param, index) => {
          const key = param.key || param.name || `__param_${index}`;
          return [key, normalizeIntelligentMarketParameterValue(param, intelligentMarketParameterValues[key])];
        }),
      );
      const items = await desktopApi.executeIntelligentMarketSource(selectedIntelligentMarketSource.id, payload);
      setGallery(items);
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.intelligentMarketExecuteFailed'));
    } finally {
      setWorking(false);
    }
  }

  function updateFavoritesPayload(nextFavorites: BootstrapPayload['favorites']) {
    setBoot((current) => (current ? { ...current, favorites: nextFavorites } : current));
  }

  function openCreateFavoriteFolderDialog() {
    setFavoriteFolderDialogMode('create');
    setFavoriteFolderName('');
    setFavoriteFolderDescription('');
  }

  function openRenameFavoriteFolderDialog() {
    if (!selectedFavoriteFolder || selectedFavoriteFolder.id === '__all__') {
      return;
    }
    setFavoriteFolderDialogMode('rename');
    setFavoriteFolderName(selectedFavoriteFolder.name);
    setFavoriteFolderDescription(selectedFavoriteFolder.description ?? '');
  }

  function closeFavoriteFolderDialog() {
    setFavoriteFolderDialogMode(null);
    setFavoriteFolderName('');
    setFavoriteFolderDescription('');
  }

  function openDeleteFavoriteFolderDialog() {
    if (!selectedFavoriteFolder || selectedFavoriteFolder.id === 'default') {
      return;
    }
    setFavoriteDeleteMoveTargetId('default');
    setFavoriteDeleteDialogOpen(true);
  }

  async function submitFavoriteFolderDialog() {
    const normalizedName = favoriteFolderName.trim();
    if (!normalizedName) {
      setSnackbar(t('favorites.folderNameRequired'));
      return;
    }
    try {
      setWorking(true);
      if (favoriteFolderDialogMode === 'create') {
        const result = await desktopApi.createFavoriteFolder(normalizedName, favoriteFolderDescription.trim() || undefined);
        updateFavoritesPayload(result.favorites);
        if (result.folder?.id) {
          setSelectedFavoriteFolderId(result.folder.id);
        }
        setSnackbar(t('snackbar.favoriteFolderCreated', { name: normalizedName }));
      } else if (favoriteFolderDialogMode === 'rename' && selectedFavoriteFolder) {
        const result = await desktopApi.renameFavoriteFolder(
          selectedFavoriteFolder.id,
          normalizedName,
          favoriteFolderDescription.trim() || undefined,
        );
        updateFavoritesPayload(result.favorites);
        setSnackbar(t('snackbar.favoriteFolderRenamed', { name: normalizedName }));
      }
      closeFavoriteFolderDialog();
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.favoriteFolderSaveFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function deleteFavoriteFolder() {
    if (!selectedFavoriteFolder || selectedFavoriteFolder.id === 'default') {
      return;
    }
    try {
      setWorking(true);
      const result = await desktopApi.deleteFavoriteFolder(selectedFavoriteFolder.id, favoriteDeleteMoveTargetId);
      updateFavoritesPayload(result.favorites);
      setSelectedFavoriteFolderId(favoriteDeleteMoveTargetId || '__all__');
      setFavoriteDeleteDialogOpen(false);
      setSnackbar(t('snackbar.favoriteFolderDeleted', { name: selectedFavoriteFolder.name }));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.favoriteFolderDeleteFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function moveFavoriteItem(itemId: string, folderId: string) {
    try {
      const result = await desktopApi.moveFavoriteItem(itemId, folderId);
      updateFavoritesPayload(result.favorites);
      setSnackbar(t('snackbar.favoriteMoved'));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.favoriteMoveFailed'));
    }
  }

  async function addLocalImagesToFavorites() {
    try {
      setWorking(true);
      const targetFolderId = selectedFavoriteFolderId !== '__all__' ? selectedFavoriteFolderId : undefined;
      const result = await desktopApi.addLocalImagesToFavorites(targetFolderId);
      if (!result) {
        return;
      }
      updateFavoritesPayload(result.favorites);
      setSnackbar(t('snackbar.favoriteLocalImagesAdded', { count: result.added_count }));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.favoriteLocalImagesAddFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function localizeFavoriteItem(itemId: string) {
    try {
      setWorking(true);
      const result = await desktopApi.localizeFavoriteItem(itemId);
      updateFavoritesPayload(result.favorites);
      setSnackbar(t('snackbar.favoriteLocalized'));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.favoriteLocalizationFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function resetFavoriteLocalization(itemId: string) {
    try {
      setWorking(true);
      const result = await desktopApi.resetFavoriteLocalization(itemId);
      updateFavoritesPayload(result.favorites);
      setSnackbar(t('snackbar.favoriteLocalizationReset'));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.favoriteLocalizationResetFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function importFavorites() {
    try {
      setWorking(true);
      const result = await desktopApi.importFavorites();
      if (!result) {
        return;
      }
      updateFavoritesPayload(result.favorites);
      setRoute('favorite');
      setSelectedFavoriteFolderId('__all__');
      setSnackbar(t('snackbar.favoriteImportSuccess', { folders: result.created_folders, items: result.imported_items }));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.favoriteImportFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function exportFavorites() {
    try {
      setWorking(true);
      const folderIds = selectedFavoriteFolderId === '__all__' ? ['__all__'] : [selectedFavoriteFolderId];
      const result = await desktopApi.exportFavorites(folderIds, undefined, true);
      if (!result) {
        return;
      }
      updateFavoritesPayload(result.favorites);
      setSnackbar(t('snackbar.favoriteExportSuccess', { path: result.saved_path }));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.favoriteExportFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function toggleFavorite(item: WallpaperItem) {
    try {
      const targetFolderId = selectedFavoriteFolderId !== '__all__' ? selectedFavoriteFolderId : undefined;
      const payload = await desktopApi.toggleFavorite(item, targetFolderId);
      updateFavoritesPayload(payload.favorites);
      setSnackbar(payload.liked ? t('snackbar.favoriteAdded') : t('snackbar.favoriteRemoved'));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.favoriteFailed'));
    }
  }

  async function setWallpaper(item: WallpaperItem) {
    try {
      setWorking(true);
      const result = await desktopApi.setWallpaper(item);
      const updatedHistory = await desktopApi.listHistory();
      setBoot((current) => (current ? { ...current, history: updatedHistory } : current));
      await syncCurrentWallpaper(false);
      setSnackbar(localizeBackendMessage(result.message, t));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.setWallpaperFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function downloadWallpaper(item: WallpaperItem) {
    try {
      const result = await desktopApi.downloadWallpaper(item);
      setSnackbar(t('snackbar.downloadedTo', { path: result.local_path }));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.downloadFailed'));
    }
  }

  async function loadStore() {
    const typeMap: Record<number, string> = { 0: 'theme', 1: 'resources', 2: 'plugins' };
    const resourceType = typeMap[storeTab] ?? 'theme';
    try {
      setStoreLoading(true);
      const legacyData = await desktopApi.loadStore();
      setStoreData(legacyData);
      const resources = await desktopApi.listStoreResources(resourceType);
      setStoreResources(resources);
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.storeLoadFailed'));
    } finally {
      setStoreLoading(false);
    }
  }

  async function runSniff() {
    try {
      setWorking(true);
      setGallery(await desktopApi.sniffImages(sniffUrl));
      setRoute('sniff');
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.sniffFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function importSource() {
    try {
      const imported = await desktopApi.importSource();
      if (!imported) {
        return;
      }
      const updatedSources = await desktopApi.listSources();
      setBoot((current) => (current ? { ...current, sources: updatedSources } : current));
      setSelectedSourceId(imported.identifier);
      setRoute('resource');
      setResourceTab(2);
      setSnackbar(t('snackbar.importedSource', { name: imported.name }));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.importSourceFailed'));
    }
  }

  async function togglePlugin(pluginId: string, enabled: boolean) {
    try {
      const nextPlugins = await desktopApi.setPluginEnabled(pluginId, enabled);
      setPlugins(nextPlugins);
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.pluginToggleFailed'));
    }
  }

  async function updateLanguage(value: SupportedLocale) {
    const nextT = createTranslator(value);
    try {
      const settings = await desktopApi.updateSettings({ 'ui.language': value });
      setBoot((current) => (current ? { ...current, settings } : current));
      setBingDailyLoaded(false);
      setBingRecentLoaded(false);
      setSpotlightOnlineLoaded(false);
      await loadBootstrap();
      setSnackbar(nextT('snackbar.languageUpdated'));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, nextT) : nextT('snackbar.settingsUpdateFailed'));
    }
  }

  async function updateBingMarket(value: string) {
    try {
      const settings = await desktopApi.updateSettings({ 'wallpaper.bing.market': value });
      setBoot((current) => (current ? { ...current, settings } : current));
      setBingDailyLoaded(false);
      setBingRecentLoaded(false);
      await loadBootstrap();
      setSnackbar(t('snackbar.bingMarketUpdated'));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.settingsUpdateFailed'));
    }
  }

  async function toggleHideOnClose(value: boolean) {
    try {
      const settings = await desktopApi.updateSettings({ 'ui.hide_on_close': value });
      setBoot((current) => (current ? { ...current, settings } : current));
      setRuntime((current) => (current ? { ...current, window: { ...current.window, hide_on_close: value } } : current));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.settingsUpdateFailed'));
    }
  }

  async function toggleMinimizeToTray(value: boolean) {
    try {
      const settings = await desktopApi.updateSettings({ 'ui.minimize_to_tray': value });
      setBoot((current) => (current ? { ...current, settings } : current));
      setRuntime((current) => (current ? { ...current, window: { ...current.window, minimize_to_tray: value } } : current));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.settingsUpdateFailed'));
    }
  }

  async function updateStartupSetting(path: string, value: boolean | number) {
    try {
      const settings = await desktopApi.updateSettings({ [path]: value });
      const runtimePayload = await desktopApi.runtimeSnapshot();
      setBoot((current) => (current ? { ...current, settings } : current));
      setRuntime(runtimePayload);
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.startupUpdateFailed'));
    }
  }

  async function updateAutoChange(updates: Record<string, unknown>) {
    try {
      setWorking(true);
      const settings = await desktopApi.updateSettings(updates);
      const runtimePayload = await desktopApi.runtimeSnapshot();
      setBoot((current) => (current ? { ...current, settings } : current));
      setRuntime(runtimePayload);
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.autoChangeConfigUpdateFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function updateDebugSettings(updates: Record<string, unknown>, successMessage?: string) {
    try {
      setWorking(true);
      const settings = await desktopApi.updateSettings(updates);
      const runtimePayload = await desktopApi.runtimeSnapshot();
      setBoot((current) => (current ? { ...current, settings } : current));
      setRuntime(runtimePayload);
      if (successMessage) {
        setSnackbar(successMessage);
      }
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.debugSettingsUpdateFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function persistThemeLibrary(nextCustomThemes: ThemeDocument[], nextActiveThemeId: string, successMessage?: string) {
    try {
      setWorking(true);
      const settings = await desktopApi.updateSettings({
        'ui.custom_themes': nextCustomThemes,
        'ui.theme_profile': nextActiveThemeId,
      });
      setBoot((current) => (current ? { ...current, settings } : current));
      setThemePreviewDocument(null);
      if (successMessage) {
        setSnackbar(successMessage);
      }
      return true;
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('themeManager.snackbar.saveFailed'));
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function applyTheme(themeId: string) {
    const nextTheme = themeCatalog.find((item) => item.id === themeId)?.document;
    try {
      setWorking(true);
      const settings = await desktopApi.updateSettings({ 'ui.theme_profile': themeId });
      setBoot((current) => (current ? { ...current, settings } : current));
      setThemePreviewDocument(null);
      setSnackbar(t('themeManager.snackbar.applied', { name: nextTheme?.metadata.name ?? themeId }));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('themeManager.snackbar.applyFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function saveThemeDocument(themeDocument: ThemeDocument) {
    const normalized = normalizeThemeDocument(themeDocument, themeDocument.metadata.name || t('themeManager.untitled'));
    const existingIds = themeCatalog
      .map((item) => item.id)
      .filter((itemId) => itemId !== normalized.metadata.id);
    const nextThemeDocument = ensureUniqueThemeId(normalized, existingIds);
    const existingIndex = customThemes.findIndex((item) => item.metadata.id === normalized.metadata.id);
    const nextCustomThemes = existingIndex >= 0
      ? customThemes.map((item, index) => (index === existingIndex ? nextThemeDocument : item))
      : [...customThemes, nextThemeDocument];

    return await persistThemeLibrary(
      nextCustomThemes,
      nextThemeDocument.metadata.id,
      t('themeManager.snackbar.saved', { name: nextThemeDocument.metadata.name }),
    );
  }

  async function deleteTheme(themeId: string) {
    const targetTheme = customThemes.find((item) => item.metadata.id === themeId);
    if (!targetTheme) {
      return;
    }
    const nextCustomThemes = customThemes.filter((item) => item.metadata.id !== themeId);
    const nextActiveId = activeThemeId === themeId ? DEFAULT_THEME_ID : activeThemeId;
    await persistThemeLibrary(
      nextCustomThemes,
      nextActiveId,
      t('themeManager.snackbar.deleted', { name: targetTheme.metadata.name }),
    );
  }

  async function importThemeDocument() {
    try {
      setWorking(true);
      const importedTheme = await desktopApi.importTheme();
      if (!importedTheme) {
        return;
      }
      const normalizedTheme = ensureUniqueThemeId(
        normalizeThemeDocument(importedTheme, t('themeManager.importFallbackName')),
        themeCatalog.map((item) => item.id),
      );
      const nextCustomThemes = [...customThemes, normalizedTheme];
      const settings = await desktopApi.updateSettings({ 'ui.custom_themes': nextCustomThemes });
      setBoot((current) => (current ? { ...current, settings } : current));
      setThemePreviewDocument(null);
      const riskFlags = getThemeRiskFlags(normalizedTheme);
      setSnackbar(
        riskFlags.hasCustomCss || riskFlags.hasRemoteAsset
          ? t('themeManager.snackbar.importedRisky', { name: normalizedTheme.metadata.name })
          : t('themeManager.snackbar.imported', { name: normalizedTheme.metadata.name }),
      );
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('themeManager.snackbar.importFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function exportThemeDocument(themeDocument: ThemeDocument) {
    try {
      setWorking(true);
      const result = await desktopApi.exportTheme(themeDocument, themeDocument.metadata.name);
      if (!result) {
        return;
      }
      setSnackbar(t('themeManager.snackbar.exported', { path: result.saved_path }));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('themeManager.snackbar.exportFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function pickThemeAsset(assetKind: 'image' | 'video' | 'poster') {
    try {
      const result = await desktopApi.pickThemeAsset(assetKind);
      return result?.path ?? null;
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('themeManager.snackbar.pickAssetFailed'));
      return null;
    }
  }

  async function openDebugLogDirectory() {
    try {
      const result = await desktopApi.openDebugLogDirectory();
      setSnackbar(t('snackbar.openedPath', { path: result.opened_path }));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.openLogDirectoryFailed'));
    }
  }

  async function openDebugLogFile() {
    try {
      const result = await desktopApi.openDebugLogFile();
      setSnackbar(t('snackbar.openedPath', { path: result.opened_path }));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.openLogFileFailed'));
    }
  }

  async function refreshStorageOverview() {
    try {
      const payload = await desktopApi.getStorageOverview();
      setStorageOverview(payload);
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.storageOverviewFailed'));
    }
  }

  async function applyDownloadDirectory(directory: string | undefined, successMessage: string) {
    try {
      setWorking(true);
      const result = await desktopApi.setDownloadDirectory(directory);
      setBoot((current) => (current ? { ...current, settings: result.settings } : current));
      setStorageOverview(result.storage);
      setSnackbar(successMessage);
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.downloadDirectoryUpdateFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function chooseDownloadDirectory() {
    try {
      const result = await desktopApi.pickDownloadDirectory();
      if (!result?.path) {
        return;
      }
      await applyDownloadDirectory(result.path, t('snackbar.downloadDirectoryUpdated'));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.downloadDirectoryUpdateFailed'));
    }
  }

  async function resetDownloadDirectory() {
    await applyDownloadDirectory('', t('snackbar.downloadDirectoryReset'));
  }

  async function openStorageTarget(targetId: string) {
    try {
      const result = await desktopApi.openStorageTarget(targetId);
      setSnackbar(t('snackbar.openedPath', { path: result.opened_path }));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.openStorageTargetFailed'));
    }
  }

  async function clearStorageTarget() {
    if (!storageClearTargetId) {
      return;
    }
    try {
      setWorking(true);
      const result = await desktopApi.clearStorageTargets([storageClearTargetId]);
      setStorageOverview(result.storage);
      if (storageClearTargetId === 'favorite_localizations') {
        const favoritesPayload = await desktopApi.listFavorites();
        setBoot((current) => (current ? { ...current, favorites: favoritesPayload } : current));
      }
      if (storageClearTargetId === 'wallpaper_history') {
        const historyPayload = await desktopApi.listHistory();
        setBoot((current) => (current ? { ...current, history: historyPayload } : current));
      }
      const cleanup = result.results[0];
      setSnackbar(t('snackbar.storageCleared', {
        name: getStorageTargetTitle(storageClearTargetId, t),
        size: formatFileSize(cleanup?.freed_bytes) ?? '0 B',
      }));
      setStorageClearTargetId(null);
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.storageClearFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function optimizeStorageTargets() {
    if (storageOptimizeTargets.length === 0) {
      setSnackbar(t('settings.storage.optimize.noTargets'));
      return;
    }
    try {
      setWorking(true);
      const result = await desktopApi.optimizeStorageTargets(storageOptimizeTargets, storageOptimizeQuality);
      setStorageOverview(result.storage);
      if (storageOptimizeTargets.includes('favorite_localizations')) {
        const favoritesPayload = await desktopApi.listFavorites();
        setBoot((current) => (current ? { ...current, favorites: favoritesPayload } : current));
      }
      setSnackbar(t('snackbar.storageOptimized', { count: result.converted_count }));
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.storageOptimizeFailed'));
    } finally {
      setWorking(false);
    }
  }

  async function fetchDebugLog(options?: { showBusy?: boolean; openDialog?: boolean }) {
    const showBusy = options?.showBusy ?? false;
    const openDialog = options?.openDialog ?? false;
    try {
      if (showBusy) {
        setWorking(true);
      }
      const payload = await desktopApi.readDebugLog(320);
      setDebugLog(payload);
      if (openDialog) {
        setDebugLogDialogOpen(true);
      }
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.readLogFailed'));
    } finally {
      if (showBusy) {
        setWorking(false);
      }
    }
  }

  async function showDebugLog() {
    await fetchDebugLog({ showBusy: true, openDialog: true });
  }

  async function triggerAutoChangeNow() {
    try {
      setWorking(true);
      const autoChange = await desktopApi.triggerAutoChangeNow();
      const runtimePayload = await desktopApi.runtimeSnapshot();
      const updatedHistory = await desktopApi.listHistory();
      const currentWallpaperPayload = await desktopApi.getCurrentWallpaper();
      setRuntime(runtimePayload);
      setBoot((current) => (
        current
          ? {
              ...current,
              history: updatedHistory,
              home: {
                ...current.home,
                current_wallpaper: currentWallpaperPayload,
              },
            }
          : current
      ));
      if (autoChange.last_result?.message) {
        setSnackbar(localizeBackendMessage(autoChange.last_result.message, t));
      }
    } catch (error) {
      setSnackbar(error instanceof Error ? localizeBackendMessage(error.message, t) : t('snackbar.autoChangeNowFailed'));
    } finally {
      setWorking(false);
    }
  }

  function goToRoute(next: NavKey) {
    setRoute(next);
    setDrawerOpen(false);
  }

  function handleStoreInstall(resource: StoreResource) {
    setSnackbar(t('store.detail.installSuccess', { name: resource.name }));
  }

  const isFavorite = (item: WallpaperItem) => favorites.some((favorite) => favorite.id === item.id);

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar sx={{ px: 2.5, py: 1.5, alignItems: 'center' }}>
        <Avatar src={appLogoSrc} variant="rounded" sx={{ bgcolor: 'background.paper', width: 40, height: 40 }} />
        <Box sx={{ ml: 1.5, minWidth: 0 }}>
          <Typography variant="subtitle1" noWrap>
            {t('app.name')}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {t('app.subtitle')}
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <Box sx={{ px: 1.5, py: 1.5, overflowY: 'auto' }}>
        <List
          subheader={
            <ListSubheader component="div" disableSticky sx={{ bgcolor: 'transparent' }}>
              {t('nav.group.browse')}
            </ListSubheader>
          }
        >
          {navigation
            .filter((item) => item.group === 'browse')
            .map((item) => (
              <ListItemButton key={item.key} selected={route === item.key} onClick={() => goToRoute(item.key)} sx={{ borderRadius: 2 }}>
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} secondary={item.subtitle} secondaryTypographyProps={{ noWrap: true }} />
              </ListItemButton>
            ))}
        </List>
        <List
          subheader={
            <ListSubheader component="div" disableSticky sx={{ bgcolor: 'transparent' }}>
              {t('nav.group.tools')}
            </ListSubheader>
          }
        >
          {navigation
            .filter((item) => item.group === 'tools')
            .map((item) => (
              <ListItemButton key={item.key} selected={route === item.key} onClick={() => goToRoute(item.key)} sx={{ borderRadius: 2 }}>
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} secondary={item.subtitle} secondaryTypographyProps={{ noWrap: true }} />
              </ListItemButton>
            ))}
        </List>
        {navigation.some((item) => item.group === 'info') && (
          <List
            subheader={
              <ListSubheader component="div" disableSticky sx={{ bgcolor: 'transparent' }}>
                {t('nav.group.info')}
              </ListSubheader>
            }
          >
            {navigation
              .filter((item) => item.group === 'info')
              .map((item) => (
                <ListItemButton key={item.key} selected={route === item.key} onClick={() => goToRoute(item.key)} sx={{ borderRadius: 2 }}>
                  <ListItemIcon>{item.icon}</ListItemIcon>
                  <ListItemText primary={item.label} secondary={item.subtitle} secondaryTypographyProps={{ noWrap: true }} />
                </ListItemButton>
              ))}
          </List>
        )}
      </Box>
      <Box sx={{ p: 2 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">{t('drawer.currentStatus')}</Typography>
            <Chip
              size="small"
              color={runtime?.auto_change.enabled ? 'success' : 'default'}
              label={runtime?.auto_change.enabled ? t('drawer.autoChangeOn') : t('drawer.autoChangeOff')}
              sx={{ alignSelf: 'flex-start' }}
            />
            <Typography variant="body2" color="text.secondary">
              {t('drawer.summary', { sourceCount: validSources.length, favoriteCount: favorites.length })}
            </Typography>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );

  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', backgroundColor: 'transparent' }}>
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography variant="h6">{t('loading.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('loading.subtitle')}
          </Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box data-ltw-app-shell="true" sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'transparent' }}>
      {mobile ? (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{ 'data-ltw-nav-drawer': 'true' }}
          sx={{ '& .MuiDrawer-paper': { width: drawerWidth } }}
        >
          {drawer}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          open
          PaperProps={{ 'data-ltw-nav-drawer': 'true' }}
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
              borderRight: '1px solid rgba(0, 0, 0, 0.08)',
            },
          }}
        >
          {drawer}
        </Drawer>
      )}

      <Box data-ltw-page-surface="true" sx={{ flex: 1, minWidth: 0 }}>
        <AppBar data-ltw-top-bar="true" position="sticky">
          <Toolbar sx={{ gap: 2 }}>
            {mobile && (
              <IconButton edge="start" onClick={() => setDrawerOpen(true)}>
                <MenuRoundedIcon />
              </IconButton>
            )}
            <Avatar
              src={appLogoSrc}
              variant="rounded"
              sx={{
                width: 36,
                height: 36,
                bgcolor: 'background.paper',
                border: `1px solid ${alpha(theme.palette.common.black, 0.08)}`,
              }}
            >
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" noWrap>
                {activeRoute.label}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {activeRoute.subtitle}
              </Typography>
            </Box>
            {!mobile && runtime?.auto_change.enabled && <Chip color="success" size="small" label={t('toolbar.autoChangeRunning')} />}
            <Tooltip title={t('toolbar.triggerNow')}>
              <span>
                <IconButton onClick={() => void triggerAutoChangeNow()} disabled={!runtime?.auto_change.enabled && route !== 'home'}>
                  <BoltRoundedIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('toolbar.refreshData')}>
              <IconButton onClick={() => void loadBootstrap()}>
                <RefreshRoundedIcon />
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>

        <Container maxWidth={false} sx={{ px: { xs: 2, md: 4 }, py: 3 }}>
          {route === 'home' && (
            <Stack spacing={3}>
              <Paper
                sx={{
                  p: { xs: 3, md: 4 },
                  backgroundColor: alpha(theme.palette.primary.main, 0.05),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
                }}
              >
                <Grid container spacing={3} alignItems="center">
                  <Grid size={{ xs: 12, lg: 7 }}>
                    <Stack spacing={2}>
                      <Chip color="primary" variant="outlined" label={t('home.heroChip')} sx={{ alignSelf: 'flex-start' }} />
                      <Typography variant="h4">{t('home.heroTitle')}</Typography>
                      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 720 }}>
                        {t('home.heroDescription')}
                      </Typography>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                        <Button variant="contained" startIcon={<WallpaperRoundedIcon />} onClick={() => goToRoute('resource')}>
                          {t('home.browseWallpapers')}
                        </Button>
                        <Button variant="outlined" startIcon={<FavoriteRoundedIcon />} onClick={() => goToRoute('favorite')}>
                          {t('home.openFavorites')}
                        </Button>
                        <Button variant="outlined" startIcon={<TuneRoundedIcon />} onClick={() => goToRoute('settings')}>
                          {t('home.adjustAutoChange')}
                        </Button>
                      </Stack>
                    </Stack>
                  </Grid>
                  <Grid size={{ xs: 12, lg: 5 }}>
                    <Stack spacing={2}>
                      <Card>
                        <CardContent>
                          <Typography variant="overline" color="text.secondary">
                            {t('home.quoteLabel')}
                          </Typography>
                          <Typography variant="h5" sx={{ mt: 1 }}>
                            “{quote?.text ?? t('home.quoteDefaultText')}”
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                            {quote?.author ?? t('home.quoteDefaultAuthor')} · {quote?.source ?? t('common.none')}
                          </Typography>
                        </CardContent>
                      </Card>
                      <Card>
                        {currentWallpaper?.preview_url ? (
                          <CardMedia component="img" height="188" image={resolveImageSource(currentWallpaper.preview_url)} alt={currentWallpaperName} />
                        ) : (
                          <Box
                            sx={{
                              height: 188,
                              display: 'grid',
                              placeItems: 'center',
                              bgcolor: alpha(theme.palette.primary.main, 0.05),
                              color: 'text.secondary',
                              px: 3,
                              textAlign: 'center',
                            }}
                          >
                            <Stack spacing={1} alignItems="center">
                              <WallpaperRoundedIcon color="disabled" />
                              <Typography variant="body2">
                                {currentWallpaper?.exists === false ? t('home.currentWallpaperMissingFile') : t('home.currentWallpaperPreviewUnavailable')}
                              </Typography>
                            </Stack>
                          </Box>
                        )}
                        <CardContent>
                          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                            <Typography variant="overline" color="text.secondary">
                              {t('home.currentWallpaperLabel')}
                            </Typography>
                            <Tooltip title={t('home.currentWallpaperRefresh')}>
                              <span>
                                <IconButton size="small" onClick={() => void syncCurrentWallpaper(true)}>
                                  <RefreshRoundedIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Stack>
                          <Typography variant="subtitle1" sx={{ mt: 0.5 }} noWrap>
                            {currentWallpaperName}
                          </Typography>
                          <Tooltip title={currentWallpaper?.local_path ? t('home.currentWallpaperCopyPath') : t('home.currentWallpaperUnavailable')}>
                            <Box
                              component="button"
                              type="button"
                              onClick={() => void copyCurrentWallpaperPath()}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  void copyCurrentWallpaperPath();
                                }
                              }}
                              disabled={!currentWallpaper?.local_path}
                              sx={{
                                mt: 1,
                                p: 0,
                                border: 0,
                                background: 'transparent',
                                color: 'text.secondary',
                                cursor: currentWallpaper?.local_path ? 'copy' : 'default',
                                textAlign: 'left',
                                width: '100%',
                              }}
                            >
                              <Typography
                                variant="body2"
                                sx={{
                                  fontFamily: 'Consolas, Monaco, monospace',
                                  wordBreak: 'break-all',
                                  textDecoration: currentWallpaper?.local_path ? 'underline dotted transparent' : 'none',
                                  textUnderlineOffset: '0.18em',
                                  '&:hover': {
                                    textDecorationColor: currentWallpaper?.local_path ? 'currentColor' : 'transparent',
                                  },
                                }}
                              >
                                {currentWallpaper?.local_path ? truncateMiddle(currentWallpaper.local_path) : t('home.currentWallpaperUnavailable')}
                              </Typography>
                            </Box>
                          </Tooltip>
                          {currentWallpaper && !currentWallpaper.exists && (
                            <Alert severity="warning" sx={{ mt: 1.5 }}>
                              {t('home.currentWallpaperMissingAlert')}
                            </Alert>
                          )}
                          {currentWallpaper?.refreshed_at && (
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
                              {t('home.currentWallpaperCheckedAt', { time: currentWallpaper.refreshed_at })}
                            </Typography>
                          )}
                        </CardContent>
                      </Card>
                    </Stack>
                  </Grid>
                </Grid>
              </Paper>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
                  <StatCard icon={<CollectionsBookmarkRoundedIcon color="primary" />} title={t('stats.favorites.title')} value={String(favorites.length)} description={t('stats.favorites.description')} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
                  <StatCard icon={<PhotoLibraryRoundedIcon color="primary" />} title={t('stats.sources.title')} value={String(validSources.length)} description={t('stats.sources.description')} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
                  <StatCard icon={<HistoryRoundedIcon color="primary" />} title={t('stats.history.title')} value={String(history.length)} description={t('stats.history.description')} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
                  <StatCard
                    icon={<AutoAwesomeRoundedIcon color="primary" />}
                    title={t('stats.autoChange.title')}
                    value={runtime?.auto_change.enabled ? t('stats.autoChange.on') : t('stats.autoChange.off')}
                    description={runtime?.auto_change.next_run_at ? t('stats.autoChange.nextRun', { time: runtime.auto_change.next_run_at }) : t('stats.autoChange.defaultDescription')}
                  />
                </Grid>
              </Grid>

              <Grid container spacing={3}>
                <Grid size={{ xs: 12, xl: 8 }}>
                  <SectionHeader
                    title={t('home.recommended.title')}
                    subtitle={t('home.recommended.subtitle')}
                    action={
                      <Button
                        onClick={() => {
                          setResourceTab(0);
                          setBingCollectionTab('daily');
                          setGallery(homeBing);
                          goToRoute('resource');
                        }}
                      >
                        {t('common.viewAll')}
                      </Button>
                    }
                  />
                  {homeBing.length === 1 ? (
                    <FeaturedWallpaperCard t={t} item={homeBing[0]} onPreview={setPreview} onSetWallpaper={setWallpaper} onDownload={downloadWallpaper} onToggleFavorite={toggleFavorite} isFavorite={isFavorite} />
                  ) : (
                    <WallpaperGallery t={t} items={homeBing} onPreview={setPreview} onSetWallpaper={setWallpaper} onDownload={downloadWallpaper} onToggleFavorite={toggleFavorite} isFavorite={isFavorite} />
                  )}
                </Grid>
                <Grid size={{ xs: 12, xl: 4 }}>
                  <SectionHeader title={t('home.spotlight.title')} subtitle={t('home.spotlight.subtitle')} />
                  <WallpaperGallery t={t} items={homeSpotlight} onPreview={setPreview} onSetWallpaper={setWallpaper} onDownload={downloadWallpaper} onToggleFavorite={toggleFavorite} isFavorite={isFavorite} compact />
                </Grid>
              </Grid>
            </Stack>
          )}

          {route === 'resource' && (
            <Stack spacing={3}>
              <Paper sx={{ p: 1 }}>
                <Tabs value={resourceTab} onChange={(_, next) => setResourceTab(next)} variant="scrollable" scrollButtons="auto" aria-label={t('nav.resource.label')}>
                  <Tab label={t('resource.tab.bing')} />
                  <Tab label={t('resource.tab.spotlight')} />
                  <Tab label={t('resource.tab.sources')} />
                  <Tab label={t('resource.tab.im')} />
                </Tabs>
              </Paper>

              {resourceTab < 2 ? (
                <Card>
                  <CardContent>
                    {resourceTab === 0 ? (
                      <Stack spacing={2}>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="h5">{t('resource.bing.title')}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                              {bingCollectionTab === 'daily' ? t('resource.bing.subtitle.daily') : t('resource.bing.subtitle.recent')}
                            </Typography>
                          </Box>
                          <TextField
                            select
                            label={t('resource.bing.quality')}
                            value={bingQuality}
                            onChange={(event) => void handleBingQualityChange(event.target.value as BingQuality)}
                            sx={{ minWidth: { xs: '100%', md: 220 } }}
                          >
                            <MenuItem value="highDef">{t('resource.bing.quality.highDef')}</MenuItem>
                            <MenuItem value="ultraHighDef">{t('resource.bing.quality.ultraHighDef')}</MenuItem>
                            <MenuItem value={screenResolution.quality}>{t('resource.bing.quality.screen', { width: screenResolution.width, height: screenResolution.height })}</MenuItem>
                          </TextField>
                          <Button variant="contained" startIcon={<RefreshRoundedIcon />} onClick={() => void runBuiltinResource()}>
                            {t('resource.refreshList')}
                          </Button>
                        </Stack>
                        <Tabs value={bingCollectionTab} onChange={(_, next) => setBingCollectionTab(next)} aria-label={t('resource.bing.title')}>
                          <Tab value="daily" label={t('resource.bing.subtab.daily')} />
                          <Tab value="recent" label={t('resource.bing.subtab.recent')} />
                        </Tabs>
                      </Stack>
                    ) : (
                      <Stack spacing={2}>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="h5">{t('resource.spotlight.title')}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                              {spotlightCollectionTab === 'local' ? t('resource.spotlight.subtitle.local') : t('resource.spotlight.subtitle.online')}
                            </Typography>
                          </Box>
                          <Button variant="contained" startIcon={<RefreshRoundedIcon />} onClick={() => void runBuiltinResource()}>
                            {t('resource.refreshList')}
                          </Button>
                        </Stack>
                        <Tabs value={spotlightCollectionTab} onChange={(_, next) => setSpotlightCollectionTab(next)} aria-label={t('resource.spotlight.title')}>
                          <Tab value="local" label={t('resource.spotlight.subtab.local')} />
                          <Tab value="online" label={t('resource.spotlight.subtab.online')} />
                        </Tabs>
                      </Stack>
                    )}
                  </CardContent>
                </Card>
              ) : resourceTab === 2 ? (
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, lg: 7 }}>
                    <Card>
                      <CardContent>
                        <Stack spacing={2}>
                          <Typography variant="h5">{t('resource.import.title')}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {t('resource.import.description')}
                          </Typography>
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                            <TextField
                              select
                              label={t('resource.import.sourceLabel')}
                              value={selectedSourceId}
                              onChange={(event) => setSelectedSourceId(event.target.value)}
                              fullWidth
                              disabled={validSources.length === 0}
                            >
                              {validSources.map((source) => (
                                <MenuItem key={source.identifier} value={source.identifier}>
                                  {source.name}
                                </MenuItem>
                              ))}
                            </TextField>
                            <TextField
                              select
                              label={t('resource.import.apiLabel')}
                              value={selectedSourceApi}
                              onChange={(event) => setSelectedSourceApi(event.target.value)}
                              fullWidth
                              disabled={!selectedSource}
                            >
                              {((selectedSource?.apis ?? []) as Array<{ name?: string }>).map((api) => (
                                <MenuItem key={api.name} value={api.name}>
                                  {api.name}
                                </MenuItem>
                              ))}
                            </TextField>
                          </Stack>
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                            <Button variant="contained" startIcon={<SearchRoundedIcon />} onClick={() => void runSourceQuery()} disabled={!selectedSource || !selectedSourceApi}>
                              {t('common.query')}
                            </Button>
                            <Button variant="outlined" startIcon={<CloudDownloadRoundedIcon />} onClick={() => void importSource()}>
                              {t('resource.import.importNewSource')}
                            </Button>
                          </Stack>
                          {validSources.length === 0 && <Alert severity="info">{t('resource.import.noValidSources')}</Alert>}
                          {invalidSources.length > 0 && <Alert severity="warning">{t('resource.import.invalidSources', { count: invalidSources.length })}</Alert>}
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid size={{ xs: 12, lg: 5 }}>
                    <SourceSummaryCard t={t} source={selectedSource} />
                  </Grid>
                </Grid>
              ) : (
                <Stack spacing={2.5}>
                  <Card>
                    <CardContent>
                      <Stack spacing={2.5}>
                        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ lg: 'center' }}>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="h5">{t('resource.im.title')}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                              {t('resource.im.subtitle')}
                            </Typography>
                          </Box>
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                            <TextField
                              select
                              size="small"
                              label={t('resource.im.mirrorLabel')}
                              value={intelligentMarketMirrorPreference}
                              onChange={(event) => void updateIntelligentMarketMirrorPreference(event.target.value)}
                              sx={{ minWidth: { xs: '100%', sm: 220 } }}
                            >
                              {INTELLIGENT_MARKET_MIRROR_OPTIONS.map((option) => (
                                <MenuItem key={option.value} value={option.value}>{t(option.labelKey)}</MenuItem>
                              ))}
                            </TextField>
                            <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => void loadIntelligentMarketSources(true)} disabled={intelligentMarketLoading}>
                              {t('resource.im.reload')}
                            </Button>
                          </Stack>
                        </Stack>

                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
                          <TextField
                            label={t('resource.im.searchLabel')}
                            value={intelligentMarketSearch}
                            onChange={(event) => setIntelligentMarketSearch(event.target.value)}
                            placeholder={t('resource.im.searchPlaceholder')}
                            fullWidth
                            InputProps={{
                              startAdornment: (
                                <InputAdornment position="start">
                                  <SearchRoundedIcon fontSize="small" />
                                </InputAdornment>
                              ),
                            }}
                          />
                          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            <Chip size="small" color="success" label={t('resource.im.health.summaryHealthy', { count: intelligentMarketHealthSummary.healthy })} />
                            <Chip size="small" color="error" label={t('resource.im.health.summaryUnhealthy', { count: intelligentMarketHealthSummary.unhealthy })} />
                            <Chip size="small" color="warning" label={t('resource.im.health.summaryUnknown', { count: intelligentMarketHealthSummary.unknown })} />
                          </Stack>
                        </Stack>

                        <Stack spacing={1.25}>
                          <Typography variant="subtitle2" color="text.secondary">
                            {t('resource.im.categoryLabel')}
                          </Typography>
                          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            <Chip
                              clickable
                              color={selectedIntelligentMarketCategory === INTELLIGENT_MARKET_ALL_CATEGORY ? 'primary' : 'default'}
                              variant={selectedIntelligentMarketCategory === INTELLIGENT_MARKET_ALL_CATEGORY ? 'filled' : 'outlined'}
                              label={t('resource.im.category.all')}
                              onClick={() => setSelectedIntelligentMarketCategory(INTELLIGENT_MARKET_ALL_CATEGORY)}
                            />
                            {intelligentMarketCategories.map((category) => {
                              const count = intelligentMarketSources.filter((source) => source.category === category).length;
                              const selected = selectedIntelligentMarketCategory === category;
                              return (
                                <Chip
                                  key={category}
                                  clickable
                                  color={selected ? 'primary' : 'default'}
                                  variant={selected ? 'filled' : 'outlined'}
                                  label={t('resource.im.category.withCount', { category, count })}
                                  onClick={() => setSelectedIntelligentMarketCategory(category)}
                                />
                              );
                            })}
                          </Stack>
                        </Stack>

                        {intelligentMarketLoading && !intelligentMarketListLoading && (
                          <Alert severity="info">{t('resource.im.loading')}</Alert>
                        )}
                        {!intelligentMarketLoading && intelligentMarketLoaded && filteredIntelligentMarketSources.length === 0 && (
                          <Alert severity="info">{t('resource.im.noSourcesInFilter')}</Alert>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>

                  {intelligentMarketListLoading && (
                    <Card>
                      <CardContent sx={{ py: 7 }}>
                        <Stack spacing={2} alignItems="center" justifyContent="center">
                          <CircularProgress />
                          <Typography variant="subtitle1">{t('resource.im.loading')}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {t('resource.im.subtitle')}
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  )}

                  {filteredIntelligentMarketSources.length > 0 && (
                    <Grid container spacing={2}>
                      {filteredIntelligentMarketSources.map((source) => (
                        <Grid key={source.id} size={{ xs: 12, sm: 6, xl: 4 }}>
                          <IntelligentMarketSourceCard
                            source={source}
                            selected={selectedIntelligentMarketSource?.id === source.id}
                            t={t}
                            onSelect={() => handleIntelligentMarketSourceSelect(source.id)}
                          />
                        </Grid>
                      ))}
                    </Grid>
                  )}

                  {selectedIntelligentMarketSource && (
                    <Grid ref={intelligentMarketDetailRef} container spacing={2}>
                      <Grid size={{ xs: 12, lg: 7 }}>
                        <Card>
                          <CardContent>
                            <Stack spacing={2.5}>
                              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                                <Box sx={{ flex: 1 }}>
                                  <Typography variant="h6">{selectedIntelligentMarketSource.friendly_name}</Typography>
                                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                    {t('resource.im.parametersSubtitle')}
                                  </Typography>
                                </Box>
                                <Button variant="contained" startIcon={<TuneRoundedIcon />} onClick={() => void runIntelligentMarketQuery()} disabled={intelligentMarketLoading}>
                                  {t('resource.im.execute')}
                                </Button>
                              </Stack>

                              {selectedIntelligentMarketSource.parameters.filter((param) => param.enabled !== false).length === 0 ? (
                                <Alert severity="success">{t('resource.im.noParameters')}</Alert>
                              ) : (
                                <Grid container spacing={2}>
                                  {selectedIntelligentMarketSource.parameters.filter((param) => param.enabled !== false).map((param, index) => {
                                    const key = param.key || param.name || `__param_${index}`;
                                    const label = getIntelligentMarketParameterLabel(param, index, t);
                                    const type = String(param.type ?? 'string').toLowerCase();
                                    if (type === 'boolean') {
                                      return (
                                        <Grid key={key} size={{ xs: 12, md: 6 }}>
                                          <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                                            <FormControlLabel
                                              control={<Switch checked={Boolean(intelligentMarketParameterValues[key])} onChange={(event) => setIntelligentMarketParameterValues((current) => ({ ...current, [key]: event.target.checked }))} />}
                                              label={label}
                                            />
                                          </Paper>
                                        </Grid>
                                      );
                                    }
                                    if (type === 'enum') {
                                      return (
                                        <Grid key={key} size={{ xs: 12, md: 6 }}>
                                          <TextField
                                            select
                                            fullWidth
                                            label={label}
                                            value={String(intelligentMarketParameterValues[key] ?? '')}
                                            onChange={(event) => setIntelligentMarketParameterValues((current) => ({ ...current, [key]: event.target.value }))}
                                          >
                                            {(param.options ?? []).map((option, optionIndex) => (
                                              <MenuItem key={`${key}-${String(option)}`} value={String(option)}>
                                                {param.friendly_options?.[optionIndex] || String(option)}
                                              </MenuItem>
                                            ))}
                                          </TextField>
                                        </Grid>
                                      );
                                    }
                                    return (
                                      <Grid key={key} size={{ xs: 12, md: type === 'list' ? 12 : 6 }}>
                                        <TextField
                                          fullWidth
                                          multiline={type === 'list'}
                                          minRows={type === 'list' ? 3 : undefined}
                                          label={label}
                                          value={String(intelligentMarketParameterValues[key] ?? '')}
                                          onChange={(event) => setIntelligentMarketParameterValues((current) => ({ ...current, [key]: event.target.value }))}
                                          helperText={type === 'list' ? t('resource.im.listHelper', { separator: param.split_str || t('resource.im.listDefaultSeparator') }) : undefined}
                                        />
                                      </Grid>
                                    );
                                  })}
                                </Grid>
                              )}
                            </Stack>
                          </CardContent>
                        </Card>
                      </Grid>
                      <Grid size={{ xs: 12, lg: 5 }}>
                        <IntelligentMarketSummaryCard t={t} source={selectedIntelligentMarketSource} />
                      </Grid>
                    </Grid>
                  )}
                </Stack>
              )}

              <SectionHeader
                title={t('resource.results.title')}
                subtitle={t('resource.results.subtitle', { count: gallery.length })}
                action={
                  resourceTab === 0 ? (
                    <Chip size="small" label={t('resource.results.quality.current', { value: formatBingQualityLabel(bingQuality, t) })} />
                  ) : resourceTab === 1 ? (
                    <Chip size="small" label={spotlightCollectionTab === 'local' ? t('resource.results.spotlight.local') : t('resource.results.spotlight.online')} />
                  ) : resourceTab === 2 && validSources.length > 0 ? (
                    <Chip size="small" label={t('resource.results.sourceCount', { count: validSources.length })} />
                  ) : resourceTab === 3 ? (
                    <Chip size="small" label={t('resource.results.imSourceCount', { count: filteredIntelligentMarketSources.length })} />
                  ) : undefined
                }
              />
              {resourceTab === 0 && bingCollectionTab === 'daily' && gallery.length === 1 ? (
                <FeaturedWallpaperCard t={t} item={gallery[0]} onPreview={setPreview} onSetWallpaper={setWallpaper} onDownload={downloadWallpaper} onToggleFavorite={toggleFavorite} isFavorite={isFavorite} />
              ) : (
                <WallpaperGallery t={t} items={gallery} onPreview={setPreview} onSetWallpaper={setWallpaper} onDownload={downloadWallpaper} onToggleFavorite={toggleFavorite} isFavorite={isFavorite} />
              )}
            </Stack>
          )}

          {route === 'favorite' && (
            <Stack spacing={3}>
              <SectionHeader
                title={t('favorites.title')}
                subtitle={t('favorites.subtitle')}
                action={
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <Button variant="outlined" startIcon={<PhotoLibraryRoundedIcon />} onClick={() => void importFavorites()}>
                      {t('favorites.importAction')}
                    </Button>
                    <Button variant="outlined" startIcon={<AddPhotoAlternateRoundedIcon />} onClick={() => void addLocalImagesToFavorites()}>
                      {t('favorites.addLocalAction')}
                    </Button>
                    <Button variant="outlined" startIcon={<CloudDownloadRoundedIcon />} onClick={() => void exportFavorites()}>
                      {selectedFavoriteFolderId === '__all__' ? t('favorites.exportAllAction') : t('favorites.exportCurrentAction')}
                    </Button>
                    <Button variant="contained" onClick={openCreateFavoriteFolderDialog}>
                      {t('favorites.newFolderAction')}
                    </Button>
                  </Stack>
                }
              />
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, lg: 3 }}>
                  <Card>
                    <CardContent>
                      <Stack spacing={2}>
                        <Box>
                          <Typography variant="h6">{t('favorites.folderPanelTitle')}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {t('favorites.folderPanelSubtitle')}
                          </Typography>
                        </Box>
                        <List sx={{ py: 0 }}>
                          <ListItem disablePadding>
                            <ListItemButton selected={selectedFavoriteFolderId === '__all__'} onClick={() => setSelectedFavoriteFolderId('__all__')} sx={{ borderRadius: 2 }}>
                              <ListItemText primary={t('favorites.allFolders')} secondary={t('favorites.allFoldersSubtitle', { count: favorites.length })} />
                            </ListItemButton>
                          </ListItem>
                          {favoriteFolders.map((folder) => (
                            <ListItem key={folder.id} disablePadding sx={{ mt: 0.5 }}>
                              <ListItemButton selected={selectedFavoriteFolderId === folder.id} onClick={() => setSelectedFavoriteFolderId(folder.id)} sx={{ borderRadius: 2 }}>
                                <ListItemText primary={folder.name} secondary={folder.description || t('favorites.folderCount', { count: folder.item_count ?? 0 })} />
                                <Chip size="small" label={folder.item_count ?? 0} />
                              </ListItemButton>
                            </ListItem>
                          ))}
                        </List>
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 12, lg: 9 }}>
                  <Stack spacing={2}>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        borderColor: alpha(theme.palette.primary.main, 0.18),
                        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.light, 0.12)}, ${alpha(theme.palette.background.paper, 0.9)})`,
                      }}
                    >
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="h6">{selectedFavoriteFolder?.name ?? t('favorites.allFolders')}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {selectedFavoriteFolder?.description || t('favorites.currentFolderSummaryDetailed', { total: selectedFavoriteFolderItems.length, visible: visibleFavorites.length })}
                          </Typography>
                        </Box>
                        {selectedFavoriteFolder && selectedFavoriteFolder.id !== 'default' && (
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <Button variant="outlined" onClick={openRenameFavoriteFolderDialog}>
                              {t('favorites.renameFolderAction')}
                            </Button>
                            <Button color="error" variant="outlined" onClick={openDeleteFavoriteFolderDialog}>
                              {t('favorites.deleteFolderAction')}
                            </Button>
                          </Stack>
                        )}
                      </Stack>
                    </Paper>
                    <Paper variant="outlined" sx={{ p: 2.5 }}>
                      <Stack spacing={2.5}>
                        <Grid container spacing={1.5}>
                          <Grid size={{ xs: 12, sm: 4 }}>
                            <Box sx={{ p: 1.75, borderRadius: 3, backgroundColor: alpha(theme.palette.primary.main, 0.08) }}>
                              <Typography variant="overline" color="text.secondary">
                                {t('favorites.summaryFolders')}
                              </Typography>
                              <Typography variant="h5">{favoriteFolders.length}</Typography>
                            </Box>
                          </Grid>
                          <Grid size={{ xs: 12, sm: 4 }}>
                            <Box sx={{ p: 1.75, borderRadius: 3, backgroundColor: alpha(theme.palette.success.main, 0.1) }}>
                              <Typography variant="overline" color="text.secondary">
                                {t('favorites.summaryLocalized')}
                              </Typography>
                              <Typography variant="h5">{favoriteLocalizedCount}</Typography>
                            </Box>
                          </Grid>
                          <Grid size={{ xs: 12, sm: 4 }}>
                            <Box sx={{ p: 1.75, borderRadius: 3, backgroundColor: alpha(theme.palette.warning.main, 0.1) }}>
                              <Typography variant="overline" color="text.secondary">
                                {t('favorites.summaryVisible')}
                              </Typography>
                              <Typography variant="h5">{visibleFavorites.length}</Typography>
                            </Box>
                          </Grid>
                        </Grid>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                          <TextField
                            fullWidth
                            value={favoriteSearchQuery}
                            onChange={(event) => setFavoriteSearchQuery(event.target.value)}
                            label={t('favorites.searchLabel')}
                            placeholder={t('favorites.searchPlaceholder')}
                            InputProps={{
                              startAdornment: (
                                <InputAdornment position="start">
                                  <SearchRoundedIcon fontSize="small" />
                                </InputAdornment>
                              ),
                            }}
                          />
                          <TextField
                            select
                            sx={{ minWidth: { md: 220 } }}
                            value={favoriteFilter}
                            onChange={(event) => setFavoriteFilter(event.target.value as FavoriteLocalizationFilter)}
                            label={t('favorites.filterLabel')}
                          >
                            <MenuItem value="all">{t('favorites.filter.all')}</MenuItem>
                            <MenuItem value="localized">{t('favorites.filter.localized')}</MenuItem>
                            <MenuItem value="remote">{t('favorites.filter.remote')}</MenuItem>
                            <MenuItem value="failed">{t('favorites.filter.failed')}</MenuItem>
                          </TextField>
                        </Stack>
                      </Stack>
                    </Paper>
                    <FavoritesGallery
                      t={t}
                      items={visibleFavorites}
                      folders={favoriteFolders}
                      onPreview={setPreview}
                      onSetWallpaper={setWallpaper}
                      onDownload={downloadWallpaper}
                      onToggleFavorite={toggleFavorite}
                      onMoveItem={moveFavoriteItem}
                      onLocalizeItem={localizeFavoriteItem}
                      onResetLocalization={resetFavoriteLocalization}
                      isFavorite={isFavorite}
                      emptyTitle={t('favorites.emptyTitle')}
                      emptyDescription={favoriteEmptyDescription}
                      emptyAction={<Button variant="contained" onClick={() => goToRoute('resource')}>{t('favorites.emptyAction')}</Button>}
                    />
                  </Stack>
                </Grid>
              </Grid>
            </Stack>
          )}

          {route === 'store' && (
            <Stack spacing={3}>
              <Card>
                <CardContent>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="h5">{t('store.title')}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {t('store.subtitle')}
                      </Typography>
                    </Box>
                    <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => void loadStore()} disabled={storeLoading}>
                      {t('store.reload')}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>

              <Paper sx={{ p: 1 }}>
                <Tabs value={storeTab} onChange={(_, next) => setStoreTab(next)} aria-label={t('store.title')}>
                  <Tab label={t('store.tab.themes')} />
                  <Tab label={t('store.tab.sources')} />
                  <Tab label={t('store.tab.plugins')} />
                </Tabs>
              </Paper>

              <StorePanel
                t={t}
                tab={storeTab}
                payload={storeData?.payload as Record<string, unknown> | undefined}
                resources={storeResources}
                loading={storeLoading}
                onInstall={handleStoreInstall}
                onDetail={setStoreDetailResource}
              />
            </Stack>
          )}

          {route === 'generate' && (
            <WallpaperCreator language={language} displayResolution={displayResolution} onSetWallpaper={setWallpaper} onDownload={downloadWallpaper} />
          )}

          {route === 'sniff' && (
            <Stack spacing={3}>
              <Card>
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h5">{t('sniff.title')}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('sniff.subtitle')}
                    </Typography>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                      <TextField
                        label={t('sniff.urlLabel')}
                        fullWidth
                        value={sniffUrl}
                        onChange={(event) => setSniffUrl(event.target.value)}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <LinkRoundedIcon />
                            </InputAdornment>
                          ),
                        }}
                      />
                      <Button variant="contained" startIcon={<SearchRoundedIcon />} onClick={() => void runSniff()}>
                        {t('sniff.start')}
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
              <WallpaperGallery
                t={t}
                items={gallery}
                onPreview={setPreview}
                onSetWallpaper={setWallpaper}
                onDownload={downloadWallpaper}
                onToggleFavorite={toggleFavorite}
                isFavorite={isFavorite}
                emptyTitle={t('sniff.emptyTitle')}
                emptyDescription={t('sniff.emptyDescription')}
              />
            </Stack>
          )}

          {route === 'history' && (
            <Stack spacing={3}>
              <SectionHeader title={t('history.title')} subtitle={t('history.subtitle')} />
              {history.length === 0 ? (
                <EmptyState title={t('history.emptyTitle')} description={t('history.emptyDescription')} />
              ) : (
                <Card>
                  <List>
                    {history.map((item, index) => {
                      const entry = item as Record<string, unknown>;
                      const title = String(entry.title ?? t('history.unnamed'));
                      const sourceName = localizeSourceName(String(entry.source_id ?? ''), String(entry.source_name ?? t('history.unknownSource')), t);
                      const appliedAt = String(entry.applied_at ?? t('history.unknownTime'));
                      const previewUrl = String(entry.preview_url ?? entry.image_url ?? '');
                      return (
                        <Box key={String(entry.id ?? index)}>
                          {index > 0 && <Divider component="li" />}
                          <ListItem
                            alignItems="flex-start"
                            secondaryAction={<Button variant="text" onClick={() => setPreview(entry as unknown as WallpaperItem)}>{t('history.preview')}</Button>}
                          >
                            <ListItemAvatar>
                              <Avatar variant="rounded" src={previewUrl} sx={{ width: 64, height: 64 }}>
                                <WallpaperRoundedIcon />
                              </Avatar>
                            </ListItemAvatar>
                            <ListItemText primary={title} secondary={`${sourceName} · ${appliedAt}`} />
                          </ListItem>
                        </Box>
                      );
                    })}
                  </List>
                </Card>
              )}
            </Stack>
          )}

          {route === 'settings' && (
            <Stack spacing={3}>
              <Paper sx={{ p: 1 }}>
                <Tabs value={settingsTab} onChange={(_, next) => setSettingsTab(next)} variant="scrollable" scrollButtons="auto" aria-label={t('nav.settings.label')}>
                  <Tab label={t('settings.tab.ui')} />
                  <Tab label={t('settings.tab.autoChange')} />
                  <Tab label={t('settings.tab.sources')} />
                  <Tab label={t('settings.tab.extensions')} />
                  <Tab label={t('settings.tab.updates')} />
                  <Tab label={t('settings.tab.debug')} />
                  <Tab label={t('settings.tab.storage')} />
                </Tabs>
              </Paper>

              {settingsTab === 0 && (
                <Stack spacing={2}>
                  <ThemeManagerPanel
                    t={t}
                    activeThemeId={activeThemeId}
                    activeThemeDocument={activeThemeDocument}
                    themes={themeCatalog}
                    appVersion={APP_VERSION}
                    onApplyTheme={applyTheme}
                    onSaveTheme={saveThemeDocument}
                    onDeleteTheme={deleteTheme}
                    onImportTheme={importThemeDocument}
                    onExportTheme={exportThemeDocument}
                    onPickThemeAsset={pickThemeAsset}
                    onPreviewTheme={setThemePreviewDocument}
                  />
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, lg: 7 }}>
                    <Card>
                      <CardContent>
                        <Stack spacing={2}>
                          <Typography variant="h5">{t('settings.ui.title')}</Typography>
                          <Paper variant="outlined" sx={{ p: 2 }}>
                            <Stack spacing={1.5}>
                              <Typography variant="subtitle1">{t('settings.ui.languageLabel')}</Typography>
                              <Typography variant="body2" color="text.secondary">
                                {t('settings.ui.languageDescription')}
                              </Typography>
                              <TextField select value={language} onChange={(event) => void updateLanguage(event.target.value as SupportedLocale)} sx={{ maxWidth: 260 }}>
                                <MenuItem value="zh-CN">{t('settings.ui.language.zhCN')}</MenuItem>
                                <MenuItem value="en-US">{t('settings.ui.language.enUS')}</MenuItem>
                              </TextField>
                            </Stack>
                          </Paper>
                          <Paper variant="outlined" sx={{ p: 2 }}>
                            <Stack spacing={1.5}>
                              <Typography variant="subtitle1">{t('settings.ui.bingMarketLabel')}</Typography>
                              <Typography variant="body2" color="text.secondary">
                                {t('settings.ui.bingMarketDescription')}
                              </Typography>
                              <TextField select value={bingMarketSetting} onChange={(event) => void updateBingMarket(event.target.value)} sx={{ maxWidth: 280 }}>
                                {BING_MARKET_OPTIONS.map((option) => (
                                  <MenuItem key={option.value} value={option.value}>{t(option.labelKey)}</MenuItem>
                                ))}
                              </TextField>
                              <Typography variant="caption" color="text.secondary">
                                {t('settings.ui.bingMarketResolved', { market: bingMarket })}
                              </Typography>
                            </Stack>
                          </Paper>
                          <SettingsSwitchRow title={t('settings.ui.hideOnClose.title')} description={t('settings.ui.hideOnClose.description')} checked={Boolean(uiSettings.hide_on_close)} onChange={toggleHideOnClose} />
                          <SettingsSwitchRow title={t('settings.ui.minimizeToTray.title')} description={t('settings.ui.minimizeToTray.description')} checked={Boolean(runtime?.window.minimize_to_tray)} onChange={toggleMinimizeToTray} />
                          <SettingsSwitchRow title={t('settings.ui.hideOnLaunch.title')} description={t('settings.ui.hideOnLaunch.description')} checked={Boolean(startupSettings.hide_on_launch)} onChange={(value) => void updateStartupSetting('startup.hide_on_launch', value)} />
                          <SettingsSwitchRow title={t('settings.ui.startupChange.title')} description={t('settings.ui.startupChange.description')} checked={Boolean(startupSettings.wallpaper_change)} onChange={(value) => void updateStartupSetting('startup.wallpaper_change', value)} />
                          <TextField
                            type="number"
                            label={t('settings.ui.startupDelay')}
                            value={Number(startupSettings.wallpaper_change_delay_seconds ?? 10)}
                            onChange={(event) => void updateStartupSetting('startup.wallpaper_change_delay_seconds', Number(event.target.value || 10))}
                            sx={{ maxWidth: 240 }}
                          />
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                    <Grid size={{ xs: 12, lg: 5 }}>
                      <Card>
                        <CardContent>
                          <Stack spacing={1.5}>
                            <Typography variant="h6">{t('settings.ui.windowBehavior')}</Typography>
                            <Chip label={runtime?.window.hide_on_close ? t('settings.ui.windowBehavior.hideOn') : t('settings.ui.windowBehavior.hideOff')} size="small" color={runtime?.window.hide_on_close ? 'success' : 'default'} sx={{ alignSelf: 'flex-start' }} />
                            <Chip label={runtime?.window.minimize_to_tray ? t('settings.ui.windowBehavior.minimizeOn') : t('settings.ui.windowBehavior.minimizeOff')} size="small" color={runtime?.window.minimize_to_tray ? 'success' : 'default'} sx={{ alignSelf: 'flex-start' }} />
                            <Typography variant="body2" color="text.secondary">
                              {t('settings.ui.windowBehavior.description')}
                            </Typography>
                          </Stack>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>
                </Stack>
              )}

              {settingsTab === 1 && (
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, lg: 7 }}>
                    <Card>
                      <CardContent>
                        <Stack spacing={2}>
                          <Typography variant="h5">{t('settings.auto.title')}</Typography>
                          <SettingsSwitchRow
                            title={t('settings.auto.enable.title')}
                            description={t('settings.auto.enable.description')}
                            checked={Boolean(runtime?.auto_change.enabled)}
                            onChange={(value) =>
                              void updateAutoChange({
                                'wallpaper.auto_change.enabled': value,
                                'wallpaper.auto_change.mode': value ? (runtime?.auto_change.mode === 'off' ? 'interval' : runtime?.auto_change.mode) : 'off',
                              })
                            }
                          />
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                            <TextField select label={t('settings.auto.mode')} value={runtime?.auto_change.mode ?? 'off'} onChange={(event) => void updateAutoChange({ 'wallpaper.auto_change.mode': event.target.value })} fullWidth>
                              <MenuItem value="off">{t('settings.auto.mode.off')}</MenuItem>
                              <MenuItem value="interval">{t('settings.auto.mode.interval')}</MenuItem>
                              <MenuItem value="schedule">{t('settings.auto.mode.schedule')}</MenuItem>
                            </TextField>
                            <TextField
                              type="number"
                              label={t('settings.auto.interval')}
                              value={runtime?.auto_change.interval ?? 3600}
                              onChange={(event) => void updateAutoChange({ 'wallpaper.auto_change.interval': Number(event.target.value || 3600) })}
                              fullWidth
                              disabled={runtime?.auto_change.mode !== 'interval'}
                            />
                          </Stack>
                          <TextField
                            select
                            SelectProps={{ multiple: true }}
                            label={t('settings.auto.sources')}
                            value={runtime?.auto_change.sources ?? ['favorites', 'bing']}
                            onChange={(event) => void updateAutoChange({ 'wallpaper.auto_change.slideshow.sources': event.target.value as unknown as string[] })}
                            fullWidth
                          >
                            <MenuItem value="favorites">{t('settings.auto.source.favorites')}</MenuItem>
                            <MenuItem value="bing">{t('settings.auto.source.bing')}</MenuItem>
                            <MenuItem value="spotlight">{t('settings.auto.source.spotlight')}</MenuItem>
                          </TextField>
                          <TextField select label={t('settings.auto.strategy')} value={runtime?.auto_change.strategy ?? 'random'} onChange={(event) => void updateAutoChange({ 'wallpaper.auto_change.slideshow.strategy': event.target.value })} fullWidth>
                            <MenuItem value="random">{t('settings.auto.strategy.random')}</MenuItem>
                            <MenuItem value="sequential">{t('settings.auto.strategy.sequential')}</MenuItem>
                            <MenuItem value="non_repeat_random">{t('settings.auto.strategy.nonRepeatRandom')}</MenuItem>
                          </TextField>
                          <Button variant="contained" startIcon={<WallpaperRoundedIcon />} onClick={() => void triggerAutoChangeNow()}>
                            {t('settings.auto.triggerNow')}
                          </Button>
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid size={{ xs: 12, lg: 5 }}>
                    <Card>
                      <CardContent>
                        <Stack spacing={1.5}>
                          <Typography variant="h6">{t('settings.auto.status')}</Typography>
                          <Chip size="small" color={runtime?.auto_change.running ? 'success' : 'default'} label={runtime?.auto_change.running ? t('common.running') : t('common.stopped')} sx={{ alignSelf: 'flex-start' }} />
                          <Typography variant="body2" color="text.secondary">{t('settings.auto.lastRun', { value: runtime?.auto_change.last_run_at ?? t('common.none') })}</Typography>
                          <Typography variant="body2" color="text.secondary">{t('settings.auto.lastWallpaper', { value: runtime?.auto_change.last_item_title ?? t('common.none') })}</Typography>
                          <Typography variant="body2" color="text.secondary">{t('settings.auto.nextRun', { value: runtime?.auto_change.next_run_at ?? t('common.none') })}</Typography>
                          {runtime?.auto_change.last_error && <Alert severity="warning">{localizeBackendMessage(runtime.auto_change.last_error, t)}</Alert>}
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              )}

              {settingsTab === 2 && (
                <Grid container spacing={2}>
                  {sources.length === 0 ? (
                    <Grid size={{ xs: 12 }}>
                      <EmptyState title={t('settings.sources.emptyTitle')} description={t('settings.sources.emptyDescription')} />
                    </Grid>
                  ) : (
                    sources.map((source) => (
                      <Grid key={source.identifier} size={{ xs: 12, lg: 6 }}>
                        <Card>
                          <CardContent>
                            <Stack spacing={1.5}>
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Typography variant="h6">{localizeSourceName(source.identifier, source.name, t)}</Typography>
                                <Chip size="small" label={`v${source.version}`} />
                                <Chip size="small" color={source.invalid ? 'warning' : 'success'} label={source.invalid ? t('settings.sources.status.invalid') : t('settings.sources.status.available')} />
                              </Stack>
                              <Typography variant="body2" color="text.secondary">{source.description || source.details || t('settings.sources.descriptionFallback')}</Typography>
                              <Typography variant="body2" color="text.secondary">{t('settings.sources.identifier', { value: source.identifier })}</Typography>
                              <Typography variant="body2" color="text.secondary">{t('settings.sources.apiCount', { count: ((source.apis ?? []) as Array<Record<string, unknown>>).length })}</Typography>
                              {source.error && <Alert severity="warning">{localizeBackendMessage(source.error, t)}</Alert>}
                            </Stack>
                          </CardContent>
                        </Card>
                      </Grid>
                    ))
                  )}
                </Grid>
              )}

              {settingsTab === 3 && (
                <Stack spacing={2}>
                  {plugins.length === 0 ? (
                    <EmptyState title={t('settings.plugins.emptyTitle')} description={t('settings.plugins.emptyDescription')} />
                  ) : (
                    plugins.map((plugin) => (
                      <Card key={String(plugin.identifier)}>
                        <CardContent>
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="h6">{String(plugin.name)}</Typography>
                              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                {String(plugin.description ?? t('store.noDescription'))}
                              </Typography>
                            </Box>
                            <FormControlLabel control={<Switch checked={Boolean(plugin.enabled)} onChange={(event) => void togglePlugin(String(plugin.identifier), event.target.checked)} />} label={Boolean(plugin.enabled) ? t('settings.plugins.enabled') : t('settings.plugins.disabled')} />
                          </Stack>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </Stack>
              )}

              {settingsTab === 4 && (
                <Card>
                  <CardContent>
                    <Stack spacing={2}>
                      <Typography variant="h5">{t('settings.updates.title')}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('settings.updates.description')}
                      </Typography>
                      <Chip size="small" label={t('settings.updates.connected')} color="info" sx={{ alignSelf: 'flex-start' }} />
                    </Stack>
                  </CardContent>
                </Card>
              )}

              {settingsTab === 5 && (
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, lg: 7 }}>
                    <Card>
                      <CardContent>
                        <Stack spacing={2}>
                          <Typography variant="h5">{t('settings.debug.title')}</Typography>
                          <SettingsSwitchRow
                            title={t('settings.debug.enable.title')}
                            description={t('settings.debug.enable.description')}
                            checked={Boolean(runtime?.debug.enabled)}
                            onChange={(value) =>
                              void updateDebugSettings(
                                { 'debug.enabled': value },
                                value ? t('settings.debug.enableSavedOn') : t('settings.debug.enableSavedOff'),
                              )
                            }
                          />
                          <SettingsSwitchRow
                            title={t('settings.debug.autoOpen.title')}
                            description={t('settings.debug.autoOpen.description')}
                            checked={Boolean(debugSettings.open_devtools_on_start ?? true)}
                            onChange={(value) =>
                              void updateDebugSettings(
                                { 'debug.open_devtools_on_start': value },
                                t('settings.debug.autoOpenUpdated'),
                              )
                            }
                          />
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
                            <Button variant="contained" onClick={() => void showDebugLog()}>
                              {t('settings.debug.viewRecentLogs')}
                            </Button>
                            <Button variant="outlined" onClick={() => void openDebugLogFile()}>
                              {t('settings.debug.openLogFile')}
                            </Button>
                            <Button variant="outlined" onClick={() => void openDebugLogDirectory()}>
                              {t('settings.debug.openLogDirectory')}
                            </Button>
                          </Stack>
                          <Typography variant="body2" color="text.secondary">
                            {t('settings.debug.logFile', { path: truncateMiddle(runtime?.debug.log_file ?? 'app.log') })}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {t('settings.debug.logDirectory', { path: truncateMiddle(runtime?.debug.log_directory ?? '') })}
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid size={{ xs: 12, lg: 5 }}>
                    <Card>
                      <CardContent>
                        <Stack spacing={1.5}>
                          <Typography variant="h6">{t('settings.debug.currentStatus')}</Typography>
                          <Chip
                            size="small"
                            color={runtime?.debug.session_enabled ? 'success' : 'default'}
                            label={runtime?.debug.session_enabled ? t('settings.debug.sessionOn') : t('settings.debug.sessionOff')}
                            sx={{ alignSelf: 'flex-start' }}
                          />
                          <Chip
                            size="small"
                            color={runtime?.debug.enabled ? 'info' : 'default'}
                            label={runtime?.debug.enabled ? t('settings.debug.nextStartupOn') : t('settings.debug.nextStartupOff')}
                            sx={{ alignSelf: 'flex-start' }}
                          />
                          {runtime && runtime.debug.enabled !== runtime.debug.session_enabled && (
                            <Alert severity="info">
                              {t('settings.debug.restartInfo')}
                            </Alert>
                          )}
                          <Typography variant="body2" color="text.secondary">
                            {t('settings.debug.runtimeInfo')}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {t('settings.debug.terminalInfo')}
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              )}

              {settingsTab === 6 && (
                <Stack spacing={2}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, lg: 7 }}>
                      <Card>
                        <CardContent>
                          <Stack spacing={2}>
                            <Typography variant="h5">{t('settings.storage.title')}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {t('settings.storage.subtitle')}
                            </Typography>
                            <Paper variant="outlined" sx={{ p: 2 }}>
                              <Stack spacing={1.5}>
                                <Typography variant="subtitle1">{t('settings.storage.downloadDirectory.title')}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {t('settings.storage.downloadDirectory.description')}
                                </Typography>
                                <TextField
                                  label={t('settings.storage.downloadDirectory.currentLabel')}
                                  value={currentDownloadDirectory}
                                  fullWidth
                                  InputProps={{ readOnly: true }}
                                />
                                <Typography variant="caption" color="text.secondary">
                                  {t('settings.storage.downloadDirectory.defaultHint', { path: truncateMiddle(defaultDownloadDirectory, 88) })}
                                </Typography>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
                                  <Button variant="contained" startIcon={<CloudDownloadRoundedIcon />} onClick={() => void chooseDownloadDirectory()}>
                                    {t('settings.storage.downloadDirectory.browse')}
                                  </Button>
                                  <Button variant="outlined" onClick={() => void resetDownloadDirectory()} disabled={currentDownloadDirectory === defaultDownloadDirectory}>
                                    {t('settings.storage.downloadDirectory.reset')}
                                  </Button>
                                  <Button variant="outlined" startIcon={<FolderOpenRoundedIcon />} onClick={() => void openStorageTarget('downloads')}>
                                    {t('settings.storage.downloadDirectory.open')}
                                  </Button>
                                </Stack>
                              </Stack>
                            </Paper>
                          </Stack>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid size={{ xs: 12, lg: 5 }}>
                      <Card>
                        <CardContent>
                          <Stack spacing={1.5}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                              <Typography variant="h6">{t('settings.storage.summary.title')}</Typography>
                              <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={() => void refreshStorageOverview()}>
                                {t('settings.storage.summary.refresh')}
                              </Button>
                            </Stack>
                            <Chip size="small" color="info" label={t('settings.storage.summary.total', { size: formatFileSize(storageOverview?.total_size_bytes) ?? '0 B' })} sx={{ alignSelf: 'flex-start' }} />
                            <Chip size="small" label={t('settings.storage.summary.data', { size: formatFileSize(storageOverview?.data_size_bytes) ?? '0 B' })} sx={{ alignSelf: 'flex-start' }} />
                            <Chip size="small" color="warning" label={t('settings.storage.summary.cache', { size: formatFileSize(storageOverview?.cache_size_bytes) ?? '0 B' })} sx={{ alignSelf: 'flex-start' }} />
                          </Stack>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>

                  <Card>
                    <CardContent>
                      <Stack spacing={2}>
                        <Typography variant="h6">{t('settings.storage.optimize.title')}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {t('settings.storage.optimize.description')}
                        </Typography>
                        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ lg: 'center' }}>
                          <Box sx={{ flex: 1 }}>
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                              {storageOptimizableTargets.map((item) => (
                                <FormControlLabel
                                  key={item.id}
                                  control={(
                                    <Checkbox
                                      checked={storageOptimizeTargets.includes(item.id)}
                                      onChange={(event) => setStorageOptimizeTargets((current) => (
                                        event.target.checked
                                          ? [...current, item.id].filter((value, index, array) => array.indexOf(value) === index)
                                          : current.filter((value) => value !== item.id)
                                      ))}
                                    />
                                  )}
                                  label={getStorageTargetTitle(item.id, t)}
                                />
                              ))}
                            </Stack>
                          </Box>
                          <Box sx={{ width: { xs: '100%', lg: 280 } }}>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                              {t('settings.storage.optimize.quality')}: {storageOptimizeQuality}
                            </Typography>
                            <Slider
                              value={storageOptimizeQuality}
                              min={40}
                              max={95}
                              step={1}
                              valueLabelDisplay="auto"
                              onChange={(_, value) => setStorageOptimizeQuality(Number(value))}
                            />
                          </Box>
                          <Button variant="contained" startIcon={<AutoFixHighRoundedIcon />} onClick={() => void optimizeStorageTargets()} disabled={storageOptimizableTargets.length === 0}>
                            {t('settings.storage.optimize.action')}
                          </Button>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {t('settings.storage.optimize.hint')}
                        </Typography>
                      </Stack>
                    </CardContent>
                  </Card>

                  <Grid container spacing={2}>
                    {storageEntries.map((item: StorageEntry) => (
                      <Grid key={item.id} size={{ xs: 12, md: 6, xl: 4 }}>
                        <Card>
                          <CardContent>
                            <Stack spacing={1.5}>
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Typography variant="h6">{getStorageTargetTitle(item.id, t)}</Typography>
                                <Chip size="small" color={getStorageScopeColor(item.scope)} label={getStorageScopeLabel(item.scope, t)} />
                                {item.optimize_supported && <Chip size="small" variant="outlined" label={t('settings.storage.item.optimizable')} />}
                              </Stack>
                              <Typography variant="body2" color="text.secondary">
                                {getStorageTargetDescription(item.id, t)}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                {formatFileSize(item.size_bytes) ?? '0 B'} · {t('settings.storage.item.fileCount', { count: item.file_count })}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {truncateMiddle(item.path, 88)}
                              </Typography>
                              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                                <Button variant="outlined" startIcon={<FolderOpenRoundedIcon />} onClick={() => void openStorageTarget(item.id)}>
                                  {t('settings.storage.item.open')}
                                </Button>
                                <Button color="error" variant="outlined" startIcon={<DeleteSweepRoundedIcon />} onClick={() => setStorageClearTargetId(item.id)}>
                                  {t('settings.storage.item.clear')}
                                </Button>
                              </Stack>
                            </Stack>
                          </CardContent>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                </Stack>
              )}
            </Stack>
          )}

          {route === 'about' && (
            <Stack spacing={3} sx={{ maxWidth: 800, mx: 'auto' }}>
              <Paper
                sx={{
                  p: { xs: 4, md: 6 },
                  textAlign: 'center',
                  background: `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.06)} 0%, ${alpha(theme.palette.background.paper, 1)} 100%)`,
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
                }}
              >
                <Stack spacing={2} alignItems="center">
                  <Avatar src={appLogoSrc} variant="rounded" sx={{ width: 80, height: 80, bgcolor: 'background.paper', boxShadow: 2 }} />
                  <Box>
                    <Typography variant="h4" fontWeight={700}>{t('about.appName')}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {t('about.version')}: {APP_VERSION}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>
                    {t('about.tagline')}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {t('about.copyright')}
                  </Typography>
                </Stack>
              </Paper>

              <Card>
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h6">{t('about.developer.title')}</Typography>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <Avatar src={studioLogoSrc} variant="rounded" sx={{ width: 48, height: 48, bgcolor: 'background.paper' }} />
                      <Box>
                        <Typography variant="subtitle1" fontWeight={600}>{t('about.developer.name')}</Typography>
                        <Typography variant="body2" color="text.secondary">{t('about.developer.role')}</Typography>
                      </Box>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {t('about.developer.bio')}
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h6">{t('about.acknowledgements.title')}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('about.acknowledgements.description')}
                    </Typography>
                    <List disablePadding>
                      {([
                        { name: 'pywebview', desc: t('about.ack.pywebview') },
                        { name: 'React', desc: t('about.ack.react') },
                        { name: 'Material UI', desc: t('about.ack.mui') },
                        { name: 'Vite', desc: t('about.ack.vite') },
                        { name: 'Python', desc: t('about.ack.python') },
                        { name: 'Bing Wallpaper API', desc: t('about.ack.bing') },
                        { name: 'Windows Spotlight', desc: t('about.ack.spotlight') },
                      ] as const).map((item) => (
                        <ListItem key={item.name} disablePadding sx={{ py: 0.5 }}>
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            <AutoAwesomeRoundedIcon color="primary" fontSize="small" />
                          </ListItemIcon>
                          <ListItemText
                            primary={item.name}
                            secondary={item.desc}
                            primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
                            secondaryTypographyProps={{ variant: 'caption' }}
                          />
                        </ListItem>
                      ))}
                    </List>
                  </Stack>
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h6">{t('about.sponsors.title')}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('about.sponsors.description')}
                    </Typography>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2.5,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: 80,
                        backgroundColor: alpha(theme.palette.warning.main, 0.04),
                        borderColor: alpha(theme.palette.warning.main, 0.15),
                      }}
                    >
                      <Stack spacing={1} alignItems="center">
                        <FavoriteRoundedIcon color="warning" />
                        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                          {t('about.sponsors.empty')}
                        </Typography>
                      </Stack>
                    </Paper>
                  </Stack>
                </CardContent>
              </Card>

              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card>
                    <CardContent>
                      <Stack spacing={2}>
                        <Typography variant="h6">{t('about.links.title')}</Typography>
                        <Stack spacing={1}>
                          <Button variant="outlined" startIcon={<LinkRoundedIcon />} fullWidth sx={{ justifyContent: 'flex-start' }} onClick={() => window.open('https://github.com/Kilo-Org', '_blank')}>
                            {t('about.links.homepage')}
                          </Button>
                          <Button variant="outlined" startIcon={<LinkRoundedIcon />} fullWidth sx={{ justifyContent: 'flex-start' }} onClick={() => window.open('https://github.com/Kilo-Org/kilocode/issues', '_blank')}>
                            {t('about.links.feedback')}
                          </Button>
                          <Button variant="outlined" startIcon={<LinkRoundedIcon />} fullWidth sx={{ justifyContent: 'flex-start' }} onClick={() => window.open('https://github.com/Kilo-Org', '_blank')}>
                            {t('about.links.repository')}
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card>
                    <CardContent>
                      <Stack spacing={2}>
                        <Typography variant="h6">{t('about.license.title')}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {t('about.license.description')}
                        </Typography>
                        <Paper variant="outlined" sx={{ p: 1.5, fontFamily: 'Consolas, Monaco, monospace', fontSize: 13, bgcolor: alpha(theme.palette.background.default, 1) }}>
                          MIT License
                        </Paper>
                        <Typography variant="caption" color="text.disabled">
                          {t('about.license.note')}
                        </Typography>
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
              <Paper
                variant="outlined"
                sx={{ p: 2, borderColor: alpha(theme.palette.divider, 0.5) }}
              >
                <Stack spacing={1}>
                  <Typography variant="caption" color="text.disabled" sx={{ textAlign: 'center' }}>
                    {t('about.runtime.display')}: {displayResolution ? `${displayResolution.width}×${displayResolution.height}` : t('common.none')}  ·  {t('about.runtime.sources')}: {validSources.length}  ·  {t('about.runtime.favorites')}: {favorites.length}  ·  {t('about.runtime.autoChange')}: {runtime?.auto_change.enabled ? t('common.running') : t('common.stopped')}
                  </Typography>
                </Stack>
              </Paper>

              <Box sx={{ textAlign: 'center', py: 2 }}>
                <Typography variant="caption" color="text.disabled">
                  {t('about.footer')}
                </Typography>
              </Box>
            </Stack>
          )}
        </Container>
      </Box>

      <Dialog open={favoriteFolderDialogMode !== null} onClose={closeFavoriteFolderDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {favoriteFolderDialogMode === 'create' ? t('favorites.createFolderDialogTitle') : t('favorites.renameFolderDialogTitle')}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <TextField
              label={t('favorites.folderNameLabel')}
              value={favoriteFolderName}
              onChange={(event) => setFavoriteFolderName(event.target.value)}
              autoFocus
              fullWidth
            />
            <TextField
              label={t('favorites.folderDescriptionLabel')}
              value={favoriteFolderDescription}
              onChange={(event) => setFavoriteFolderDescription(event.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeFavoriteFolderDialog}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void submitFavoriteFolderDialog()}>
            {favoriteFolderDialogMode === 'create' ? t('favorites.createFolderConfirm') : t('favorites.renameFolderConfirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={favoriteDeleteDialogOpen} onClose={() => setFavoriteDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('favorites.deleteFolderDialogTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t('favorites.deleteFolderDialogDescription', { name: selectedFavoriteFolder?.name ?? '' })}
            </Typography>
            <TextField
              select
              fullWidth
              label={t('favorites.deleteMoveTargetLabel')}
              value={favoriteDeleteMoveTargetId}
              onChange={(event) => setFavoriteDeleteMoveTargetId(event.target.value)}
            >
              {favoriteFolders
                .filter((folder) => folder.id !== selectedFavoriteFolder?.id)
                .map((folder) => (
                  <MenuItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </MenuItem>
                ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFavoriteDeleteDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => void deleteFavoriteFolder()}>
            {t('favorites.deleteFolderConfirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(storeDetailResource)} onClose={() => setStoreDetailResource(null)} maxWidth="md" fullWidth>
        <DialogTitle>{t('store.detail.title')}</DialogTitle>
        <DialogContent dividers>
          {storeDetailResource && (
            <Stack spacing={2}>
              <Stack direction="row" spacing={2} alignItems="center">
                {storeDetailResource.icon_url ? (
                  <Avatar variant="rounded" src={storeDetailResource.icon_url} sx={{ width: 64, height: 64 }}>
                    <WidgetsRoundedIcon />
                  </Avatar>
                ) : (
                  <Avatar variant="rounded" sx={{ width: 64, height: 64, bgcolor: 'primary.50', color: 'primary.main' }}>
                    {storeDetailResource.type === 'theme' ? <PaletteRoundedIcon /> : storeDetailResource.type === 'wallpaper_source' ? <WallpaperRoundedIcon /> : <WidgetsRoundedIcon />}
                  </Avatar>
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="h5" noWrap>{storeDetailResource.name}</Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={`v${storeDetailResource.version}`} />
                    {storeDetailResource.author && <Chip size="small" variant="outlined" label={`${t('store.detail.author')}: ${storeDetailResource.author.name}`} />}
                    {storeDetailResource.license && <Chip size="small" variant="outlined" label={`${t('store.detail.license')}: ${storeDetailResource.license}`} />}
                  </Stack>
                </Box>
              </Stack>
              <Divider />
              <Typography variant="body1">{storeDetailResource.summary}</Typography>
              {storeDetailResource.description_md && (
                <Paper variant="outlined" sx={{ p: 2, maxHeight: 320, overflow: 'auto' }}>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {storeDetailResource.description_md}
                  </Typography>
                </Paper>
              )}
              {storeDetailResource.tags && storeDetailResource.tags.length > 0 && (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" color="text.secondary">{t('store.detail.tags')}:</Typography>
                  {storeDetailResource.tags.map((tag) => (
                    <Chip key={tag} size="small" label={tag} />
                  ))}
                </Stack>
              )}
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {storeDetailResource.homepage_url && (
                  <Button size="small" startIcon={<LinkRoundedIcon />} onClick={() => window.open(storeDetailResource.homepage_url!, '_blank')}>
                    {t('store.detail.homepage')}
                  </Button>
                )}
                {storeDetailResource.repository_url && (
                  <Button size="small" startIcon={<LinkRoundedIcon />} onClick={() => window.open(storeDetailResource.repository_url!, '_blank')}>
                    {t('store.detail.repository')}
                  </Button>
                )}
                {storeDetailResource.changelog_url && (
                  <Button size="small" startIcon={<LinkRoundedIcon />} onClick={() => window.open(storeDetailResource.changelog_url!, '_blank')}>
                    {t('store.detail.changelog')}
                  </Button>
                )}
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStoreDetailResource(null)}>{t('common.close')}</Button>
          {storeDetailResource && (
            <Button variant="contained" onClick={() => { handleStoreInstall(storeDetailResource); setStoreDetailResource(null); }}>
              {t('common.install')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} maxWidth="lg" fullWidth>
        <DialogTitle>{preview?.title}</DialogTitle>
        <DialogContent dividers>
          {preview && (
            <Stack spacing={2}>
              <Box component="img" src={resolvePreviewDialogSource(preview)} alt={preview.title} sx={{ width: '100%', maxHeight: '72vh', objectFit: 'contain', borderRadius: 2, bgcolor: 'background.default' }} />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={localizeSourceName(preview.source_id, preview.source_name, t)} />
                {preview.width && preview.height && <Chip size="small" label={`${preview.width} × ${preview.height}`} />}
              </Stack>
              {preview.description && (
                <Typography variant="body2" color="text.secondary">
                  {preview.description}
                </Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)}>{t('common.close')}</Button>
          {preview && <Button onClick={() => void downloadWallpaper(preview)}>{t('common.download')}</Button>}
          {preview && <Button variant="contained" onClick={() => void setWallpaper(preview)}>{t('gallery.setWallpaper')}</Button>}
        </DialogActions>
      </Dialog>

      <Dialog open={debugLogDialogOpen} onClose={() => setDebugLogDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>{t('preview.logTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {debugLog?.path ?? runtime?.debug.log_file ?? 'app.log'}
            </Typography>
            {debugLog?.truncated && (
              <Alert severity="info">{t('preview.logTruncated', { count: debugLog.lines })}</Alert>
            )}
            <TextField
              value={debugLog?.content ?? ''}
              multiline
              minRows={18}
              maxRows={24}
              fullWidth
              InputProps={{
                readOnly: true,
                sx: {
                  alignItems: 'stretch',
                  '& textarea': {
                    fontFamily: 'Consolas, Monaco, monospace',
                    fontSize: 13,
                    lineHeight: 1.5,
                  },
                },
              }}
              placeholder={t('preview.logPlaceholder')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => void openDebugLogFile()}>{t('settings.debug.openLogFile')}</Button>
          <Button onClick={() => void fetchDebugLog({ showBusy: true })}>{t('common.refresh')}</Button>
          <Button onClick={() => setDebugLogDialogOpen(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(storageClearTarget)} onClose={() => setStorageClearTargetId(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('settings.storage.clearDialog.title')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t('settings.storage.clearDialog.description', { name: storageClearTarget ? getStorageTargetTitle(storageClearTarget.id, t) : '' })}
            </Typography>
            {storageClearTarget && (
              <Typography variant="caption" color="text.secondary">
                {truncateMiddle(storageClearTarget.path, 96)}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStorageClearTargetId(null)}>{t('common.cancel')}</Button>
          <Button color="error" variant="contained" startIcon={<DeleteSweepRoundedIcon />} onClick={() => void clearStorageTarget()}>
            {t('settings.storage.clearDialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(snackbar)} autoHideDuration={3200} onClose={() => setSnackbar('')}>
        <Alert onClose={() => setSnackbar('')} severity="info" variant="filled">
          {snackbar}
        </Alert>
      </Snackbar>

      <Backdrop open={working} sx={{ color: '#fff', zIndex: (currentTheme) => currentTheme.zIndex.modal + 1 }}>
        <Stack spacing={2} alignItems="center">
          <CircularProgress color="inherit" />
          <Typography>{t('common.processing')}</Typography>
        </Stack>
      </Backdrop>
    </Box>
  );
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ mb: 0.5 }}>
      <Box sx={{ flex: 1 }}>
        <Typography variant="h5">{title}</Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
  );
}

function StatCard({ icon, title, value, description }: { icon: React.ReactNode; title: string; value: string; description: string }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Avatar sx={{ bgcolor: 'primary.50', color: 'primary.main' }}>{icon}</Avatar>
            <Box>
              <Typography variant="body2" color="text.secondary">
                {title}
              </Typography>
              <Typography variant="h5">{value}</Typography>
            </Box>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

function SourceSummaryCard({ source, t }: { source: WallpaperSource | null; t: TranslateFn }) {
  if (!source) {
    return <EmptyState title={t('sourceSummary.emptyTitle')} description={t('sourceSummary.emptyDescription')} compact />;
  }

  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h6">{localizeSourceName(source.identifier, source.name, t)}</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`v${source.version}`} />
            <Chip size="small" label={t('sourceSummary.apiCount', { count: ((source.apis ?? []) as Array<Record<string, unknown>>).length })} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {source.description || source.details || t('sourceSummary.noDetails')}
          </Typography>
          <Typography variant="body2" color="text.secondary">{t('sourceSummary.identifier', { value: source.identifier })}</Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

function IntelligentMarketSourceCard({
  source,
  selected,
  t,
  onSelect,
}: {
  source: IntelligentMarketSource;
  selected: boolean;
  t: TranslateFn;
  onSelect: () => void;
}) {
  const healthColor = getIntelligentMarketHealthColor(source.health_status);
  const healthLabel = getIntelligentMarketHealthLabel(source.health_status, t);

  return (
    <Card
      onClick={onSelect}
      sx={{
        height: '100%',
        cursor: 'pointer',
        borderColor: selected
          ? 'primary.main'
          : source.health_status === 'unhealthy'
            ? 'error.light'
            : 'divider',
        boxShadow: selected
          ? (theme) => `0 20px 40px ${alpha(theme.palette.primary.main, 0.18)}`
          : 'none',
        background: (theme) => source.health_status === 'unhealthy'
          ? `linear-gradient(180deg, ${alpha(theme.palette.error.light, 0.08)}, ${alpha(theme.palette.background.paper, 0.94)})`
          : `linear-gradient(180deg, ${alpha(theme.palette.primary.light, selected ? 0.14 : 0.06)}, ${alpha(theme.palette.background.paper, 0.96)})`,
        transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: (theme) => `0 18px 36px ${alpha(theme.palette.common.black, 0.12)}`,
        },
      }}
    >
      <CardContent sx={{ height: '100%' }}>
        <Stack spacing={1.75} sx={{ height: '100%' }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            {source.icon ? (
              <Avatar variant="rounded" src={source.icon} sx={{ width: 52, height: 52 }}>
                <WallpaperRoundedIcon />
              </Avatar>
            ) : (
              <Avatar variant="rounded" sx={{ width: 52, height: 52, bgcolor: 'primary.50', color: 'primary.main' }}>
                <WallpaperRoundedIcon />
              </Avatar>
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" noWrap>{source.friendly_name}</Typography>
              <Typography variant="body2" color="text.secondary" noWrap>{source.category}</Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color={healthColor}
              icon={source.health_status === 'healthy'
                ? <CheckCircleRoundedIcon />
                : source.health_status === 'unhealthy'
                  ? <ErrorOutlineRoundedIcon />
                  : <HelpOutlineRoundedIcon />}
              label={healthLabel}
            />
            <Chip size="small" variant="outlined" label={source.method} />
            <Chip size="small" variant="outlined" label={t('resource.im.summary.parameters', { count: source.parameters.filter((param) => param.enabled !== false).length })} />
          </Stack>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              minHeight: 64,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {source.intro || t('resource.im.summary.noIntro')}
          </Typography>

          <Box sx={{ mt: 'auto' }}>
            <Typography
              variant="caption"
              color={source.health_status === 'unhealthy' ? 'error.main' : 'text.secondary'}
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {source.health_message || t('resource.im.health.messageFallback')}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function IntelligentMarketSummaryCard({ source, t }: { source: IntelligentMarketSource | null; t: TranslateFn }) {
  if (!source) {
    return <EmptyState title={t('resource.im.emptyTitle')} description={t('resource.im.emptyDescription')} compact />;
  }

  const healthColor = getIntelligentMarketHealthColor(source.health_status);
  const healthLabel = getIntelligentMarketHealthLabel(source.health_status, t);

  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            {source.icon ? (
              <Avatar variant="rounded" src={source.icon} sx={{ width: 52, height: 52 }}>
                <WallpaperRoundedIcon />
              </Avatar>
            ) : (
              <Avatar variant="rounded" sx={{ width: 52, height: 52, bgcolor: 'primary.50', color: 'primary.main' }}>
                <WallpaperRoundedIcon />
              </Avatar>
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6">{source.friendly_name}</Typography>
              <Typography variant="body2" color="text.secondary">{source.file_path}</Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={source.category} />
            <Chip size="small" color={healthColor} label={healthLabel} />
            <Chip size="small" variant="outlined" label={`${source.method} · APICORE ${source.api_core_version}`} />
            <Chip size="small" variant="outlined" label={t('resource.im.summary.parameters', { count: source.parameters.filter((param) => param.enabled !== false).length })} />
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {source.intro || t('resource.im.summary.noIntro')}
          </Typography>

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack spacing={0.75}>
              <Typography variant="subtitle2">{t('resource.im.health.title')}</Typography>
              <Typography variant="body2" color={source.health_status === 'unhealthy' ? 'error.main' : 'text.secondary'}>
                {source.health_message || t('resource.im.health.messageFallback')}
              </Typography>
              {source.health_checked_at && (
                <Typography variant="caption" color="text.secondary">
                  {t('resource.im.health.checkedAt', { time: source.health_checked_at })}
                </Typography>
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle2">{t('resource.im.summary.endpoint')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                {source.link}
              </Typography>
            </Stack>
          </Paper>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            {source.html_url && (
              <Button component="a" href={source.html_url} target="_blank" rel="noreferrer" variant="outlined" size="small">
                {t('resource.im.summary.openConfig')}
              </Button>
            )}
            {source.raw_url && (
              <Button component="a" href={source.raw_url} target="_blank" rel="noreferrer" variant="text" size="small">
                {t('resource.im.summary.openRaw')}
              </Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function SettingsSwitchRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void | Promise<void> }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1">{title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </Box>
        <Switch checked={checked} onChange={(event) => void onChange(event.target.checked)} />
      </Stack>
    </Paper>
  );
}

function EmptyState({ title, description, action, compact = false }: { title: string; description: string; action?: React.ReactNode; compact?: boolean }) {
  return (
    <Card>
      <CardContent sx={{ py: compact ? 4 : 6 }}>
        <Stack spacing={1.5} alignItems="flex-start">
          <Typography variant={compact ? 'h6' : 'h5'}>{title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
          {action}
        </Stack>
      </CardContent>
    </Card>
  );
}

function FeaturedWallpaperCard({
  t,
  item,
  onPreview,
  onSetWallpaper,
  onDownload,
  onToggleFavorite,
  isFavorite,
}: {
  t: TranslateFn;
  item: WallpaperItem;
  onPreview: (item: WallpaperItem) => void;
  onSetWallpaper: (item: WallpaperItem) => void;
  onDownload: (item: WallpaperItem) => void;
  onToggleFavorite: (item: WallpaperItem) => void;
  isFavorite: (item: WallpaperItem) => boolean;
}) {
  const theme = useTheme();
  const qualityLabel = typeof item.metadata?.quality === 'string' ? formatBingQualityLabel(item.metadata.quality, t) : null;

  return (
    <Card sx={{ overflow: 'hidden' }}>
      <Grid container>
        <Grid size={{ xs: 12, lg: 7 }}>
          <CardActionArea onClick={() => onPreview(item)} sx={{ height: '100%' }}>
            <CardMedia
              component="img"
              image={resolveImageSource(item.preview_url || item.image_url)}
              alt={item.title}
              sx={{
                minHeight: { xs: 260, md: 360, lg: '100%' },
                maxHeight: { xs: 360, lg: 520 },
                objectFit: 'cover',
              }}
            />
          </CardActionArea>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <CardContent sx={{ height: '100%', p: { xs: 2.5, md: 3 }, display: 'flex' }}>
            <Stack spacing={2.5} sx={{ width: '100%' }}>
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Chip size="small" color="primary" variant="outlined" label={localizeSourceName(item.source_id, item.source_name, t)} />
                  <IconButton color={isFavorite(item) ? 'secondary' : 'default'} onClick={() => onToggleFavorite(item)}>
                    <FavoriteRoundedIcon />
                  </IconButton>
                </Stack>
                <Typography variant="h4" sx={{ lineHeight: 1.1 }}>
                  {item.title}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  {item.description || t('featuredWallpaper.fallbackDescription')}
                </Typography>
              </Stack>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {item.width && item.height && <Chip size="small" label={`${item.width} × ${item.height}`} />}
                {qualityLabel && <Chip size="small" label={qualityLabel} variant="outlined" />}
                <Chip size="small" label={t('featuredWallpaper.todayLabel')} variant="outlined" sx={{ borderColor: alpha(theme.palette.primary.main, 0.28) }} />
              </Stack>

              <Box sx={{ flex: 1 }} />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <Button variant="contained" size="large" onClick={() => onSetWallpaper(item)}>
                  {t('gallery.setWallpaper')}
                </Button>
                <Button variant="outlined" size="large" onClick={() => onDownload(item)}>
                  {t('gallery.download')}
                </Button>
                <Button size="large" onClick={() => onPreview(item)}>
                  {t('common.preview')}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Grid>
      </Grid>
    </Card>
  );
}

function WallpaperGallery({
  t,
  items,
  onPreview,
  onSetWallpaper,
  onDownload,
  onToggleFavorite,
  isFavorite,
  compact = false,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  t: TranslateFn;
  items: WallpaperItem[];
  onPreview: (item: WallpaperItem) => void;
  onSetWallpaper: (item: WallpaperItem) => void;
  onDownload: (item: WallpaperItem) => void;
  onToggleFavorite: (item: WallpaperItem) => void;
  isFavorite: (item: WallpaperItem) => boolean;
  compact?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle ?? t('gallery.emptyTitle')} description={emptyDescription ?? t('gallery.emptyDescription')} action={emptyAction} compact />;
  }

  return (
    <Grid container spacing={2}>
      {items.map((item) => (
        <Grid key={item.id} size={{ xs: 12, sm: compact ? 12 : 6, xl: compact ? 12 : 4 }}>
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardActionArea onClick={() => onPreview(item)}>
              <CardMedia component="img" height={compact ? 180 : 220} image={resolveImageSource(item.preview_url || item.image_url)} alt={item.title} sx={{ objectFit: 'cover' }} />
              <CardContent>
                <Stack spacing={1.25}>
                  <Typography variant="h6" noWrap>
                    {item.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {localizeSourceName(item.source_id, item.source_name, t)}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {item.width && item.height && <Chip size="small" label={`${item.width} × ${item.height}`} />}
                    {item.description && <Chip size="small" label={t('gallery.hasDescription')} variant="outlined" />}
                  </Stack>
                </Stack>
              </CardContent>
            </CardActionArea>
            <CardActions sx={{ px: 2, pb: 2, pt: 0 }}>
              <Button size="small" variant="contained" onClick={() => onSetWallpaper(item)}>
                {t('gallery.setWallpaper')}
              </Button>
              <Button size="small" onClick={() => onDownload(item)}>
                {t('gallery.download')}
              </Button>
              <Box sx={{ flex: 1 }} />
              <IconButton color={isFavorite(item) ? 'secondary' : 'default'} onClick={() => onToggleFavorite(item)}>
                <FavoriteRoundedIcon />
              </IconButton>
            </CardActions>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}

function FavoritesGallery({
  t,
  items,
  folders,
  onPreview,
  onSetWallpaper,
  onDownload,
  onToggleFavorite,
  onMoveItem,
  onLocalizeItem,
  onResetLocalization,
  isFavorite,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  t: TranslateFn;
  items: FavoriteItem[];
  folders: FavoriteFolder[];
  onPreview: (item: WallpaperItem) => void;
  onSetWallpaper: (item: WallpaperItem) => void;
  onDownload: (item: WallpaperItem) => void;
  onToggleFavorite: (item: WallpaperItem) => void;
  onMoveItem: (itemId: string, folderId: string) => void;
  onLocalizeItem: (itemId: string) => void;
  onResetLocalization: (itemId: string) => void;
  isFavorite: (item: WallpaperItem) => boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}) {
  const theme = useTheme();

  if (items.length === 0) {
    return <EmptyState title={emptyTitle ?? t('favorites.emptyTitle')} description={emptyDescription ?? t('favorites.emptyDescription')} action={emptyAction} compact />;
  }

  return (
    <Grid container spacing={2}>
      {items.map((item) => {
        const localized = Boolean(item.localized || item.localization_status === 'completed');
        const localizedFileSize = formatFileSize(item.localization_file_size);
        const canLocalize = item.can_localize !== false;

        return (
        <Grid key={item.id} size={{ xs: 12, md: 6, xl: 4 }}>
          <Card
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
              background: localized
                ? `linear-gradient(180deg, ${alpha(theme.palette.success.light, 0.12)}, ${alpha(theme.palette.background.paper, 0.92)})`
                : theme.palette.background.paper,
            }}
          >
            <CardActionArea onClick={() => onPreview(item)}>
              <CardMedia component="img" height={220} image={resolveImageSource(item.preview_url || item.image_url)} alt={item.title} sx={{ objectFit: 'cover' }} />
              <CardContent>
                <Stack spacing={1.25}>
                  <Typography variant="h6" noWrap>
                    {item.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {localizeSourceName(item.source_id, item.source_name, t)}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {item.width && item.height && <Chip size="small" label={`${item.width} × ${item.height}`} />}
                    {localized && <Chip size="small" color="success" variant="outlined" label={t('favorites.localizedTag')} />}
                    {item.localization_status === 'pending' && <Chip size="small" color="warning" variant="outlined" label={t('favorites.localizationPendingTag')} />}
                    {item.localization_status === 'failed' && <Chip size="small" color="error" variant="outlined" label={t('favorites.localizationFailedTag')} />}
                    {item.tags && item.tags.length > 0 && <Chip size="small" variant="outlined" label={t('favorites.tagsCount', { count: item.tags.length })} />}
                  </Stack>
                  {item.local_path && (
                    <Typography variant="caption" color="text.secondary">
                      {t('favorites.localizationSource')}: {truncateMiddle(item.local_path, 42)}
                    </Typography>
                  )}
                  {item.localization_updated_at && (
                    <Typography variant="caption" color="text.secondary">
                      {t('favorites.localizationUpdatedAt', { time: formatTimestamp(item.localization_updated_at) ?? item.localization_updated_at })}
                    </Typography>
                  )}
                  {localizedFileSize && (
                    <Typography variant="caption" color="text.secondary">
                      {t('favorites.localizationFileSize', { size: localizedFileSize })}
                    </Typography>
                  )}
                  {item.localization_status === 'failed' && item.localization_message && (
                    <Typography variant="caption" color="error.main">
                      {t('favorites.localizationFailedMessage', { message: item.localization_message })}
                    </Typography>
                  )}
                </Stack>
              </CardContent>
            </CardActionArea>
            <CardActions sx={{ px: 2, pb: 2, pt: 0 }}>
              <Stack spacing={1.25} sx={{ width: '100%' }}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={t('favorites.folderLabel')}
                  value={item.folder_id}
                  onChange={(event) => void onMoveItem(item.id, event.target.value)}
                >
                  {folders.map((folder) => (
                    <MenuItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </MenuItem>
                  ))}
                </TextField>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Button size="small" variant="contained" onClick={() => onSetWallpaper(item)}>
                    {t('gallery.setWallpaper')}
                  </Button>
                  {canLocalize && (
                    <Button size="small" variant="outlined" onClick={() => onLocalizeItem(item.id)}>
                      {localized ? t('favorites.relocalizeAction') : t('favorites.localizeAction')}
                    </Button>
                  )}
                  {canLocalize && localized && (
                    <Button size="small" color="warning" onClick={() => onResetLocalization(item.id)}>
                      {t('favorites.resetLocalizationAction')}
                    </Button>
                  )}
                  <Button size="small" onClick={() => onDownload(item)}>
                    {t('gallery.download')}
                  </Button>
                  <Box sx={{ flex: 1 }} />
                  <IconButton color={isFavorite(item) ? 'secondary' : 'default'} onClick={() => onToggleFavorite(item)}>
                    <FavoriteRoundedIcon />
                  </IconButton>
                </Stack>
              </Stack>
            </CardActions>
          </Card>
        </Grid>
        );
      })}
    </Grid>
  );
}

function StorePanel({ tab, payload, resources, loading, onInstall, onDetail, t }: {
  tab: number;
  payload: Record<string, unknown> | undefined;
  resources: StoreResource[];
  loading: boolean;
  onInstall: (resource: StoreResource) => void;
  onDetail: (resource: StoreResource) => void;
  t: TranslateFn;
}) {
  if (loading) {
    return (
      <Stack spacing={2} alignItems="center" sx={{ py: 6 }}>
        <CircularProgress />
        <Typography color="text.secondary">{t('store.loading')}</Typography>
      </Stack>
    );
  }

  if (resources.length > 0) {
    return (
      <Grid container spacing={2}>
        {resources.map((resource) => {
          const iconUrl = resource.icon_url || null;
          return (
            <Grid key={resource.id} size={{ xs: 12, md: 6, xl: 4 }}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flex: 1 }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      {iconUrl ? (
                        <Avatar variant="rounded" src={iconUrl} sx={{ width: 48, height: 48 }}>
                          <WidgetsRoundedIcon />
                        </Avatar>
                      ) : (
                        <Avatar variant="rounded" sx={{ width: 48, height: 48, bgcolor: 'primary.50', color: 'primary.main' }}>
                          {resource.type === 'theme' ? <PaletteRoundedIcon /> : resource.type === 'wallpaper_source' ? <WallpaperRoundedIcon /> : <WidgetsRoundedIcon />}
                        </Avatar>
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="h6" noWrap>{resource.name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          v{resource.version}{resource.author ? ` · ${resource.author.name}` : ''}
                        </Typography>
                      </Box>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {resource.summary || t('store.noDescription')}
                    </Typography>
                    {resource.tags && resource.tags.length > 0 && (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {resource.tags.slice(0, 3).map((tag) => (
                          <Chip key={tag} size="small" variant="outlined" label={tag} />
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </CardContent>
                <CardActions sx={{ px: 2, pb: 2, pt: 0 }}>
                  <Button size="small" variant="contained" onClick={() => onInstall(resource)}>
                    {t('common.install')}
                  </Button>
                  <Button size="small" onClick={() => onDetail(resource)}>
                    {t('store.detail.title')}
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    );
  }

  if (!payload) {
    return <EmptyState title={t('store.waitingTitle')} description={t('store.waitingDescription')} compact />;
  }

  return <EmptyState title={t('store.emptyTitle')} description={t('store.emptyDescription')} compact />;
}
