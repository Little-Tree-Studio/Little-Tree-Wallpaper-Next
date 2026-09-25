import { useState, useEffect, useEffectEvent, useRef, useMemo, Fragment, type ReactNode } from 'react';
import { Card, Button, Skeleton, EmptyState, ScrollShadow, toast } from '@heroui/react';
import { RefreshCw, History, ImageIcon, Copy, Heart, FolderOutput, Monitor, Download, Save, Eye, Shuffle, Undo2 } from 'lucide-react';
import {
  getCurrentWallpaper, getSentence, getBingWallpaper,
  copyToClipboard, addFavorite,
  recordCurrentWallpaper, getBootstrapCache,
  downloadWithProgress, saveAsWithProgress, setWallpaperWithProgress,
  getSettings, getDisplayResolutions, type DisplayResolution,
  querySpotlight, getHistory, getFavorites, localFileUrl, localPreviewUrl,
  FAVORITES_CHANGED_EVENT, HISTORY_CHANGED_EVENT, WALLPAPER_CHANGED_EVENT, notifyFavoritesChanged,
  type HistoryItem,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import type { BingWallpaper, Hitokoto, WallpaperInfo, FavoriteItem } from '@/types';
import { safeNameForFile } from '@/lib/download';
import {
  BUILTIN_HOME_CARDS,
  resolveHomeCards,
  type HomePageCardConfig,
  type HomePageCardId,
} from '@/lib/homeCards';
import PluginRenderer, { safePluginClassName } from '@/plugins/PluginRenderer';
import { usePlugins } from '@/plugins/context';
import { useThemeContext } from '@/components/ThemeProvider';
import HomeImage from '@/components/HomeImage';
import { favoriteImageUrl, nextFavoriteIndex, previousWallpaper, sameWallpaperPath } from '@/lib/homeWallpaper';
import { DEFAULT_WALLPAPER_MARKET, resolveWallpaperMarket } from '@/lib/wallpaperMarkets';

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
};

// 自动记录模式下，首页与历史检测使用同一轮询节奏，保证壁纸更换后首页同步更新。
const resolveWallpaperRefreshSeconds = (settings: any) => {
  const homeInterval = clampNumber(settings?.home_page?.wallpaper_refresh_seconds, 30, 10, 600);
  if ((settings?.wallpaper?.history?.record_mode ?? 'manual') !== 'auto') return homeInterval;
  return clampNumber(settings?.wallpaper?.history?.auto_record_interval_seconds, 30, 5, 3600);
};

const formatBytes = (bytes?: number) => {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

/** 将壁纸分辨率与主屏分辨率对比，给出是否需要拉伸的提示。 */
const resolutionHint = (width?: number, height?: number, display?: DisplayResolution) => {
  if (!display || !width || !height) return null;
  if (width === display.width && height === display.height) {
    return { text: '匹配主屏', className: 'text-success' };
  }
  if (width >= display.width && height >= display.height) {
    return { text: '高于主屏', className: 'text-muted' };
  }
  return { text: '低于主屏，可能模糊', className: 'text-warning' };
};

interface HomeSpotlightItem {
  image_url: string;
  preview_url?: string;
  title?: string;
  description?: string;
  copyright?: string;
  metadata?: { original_image_url?: string; copyright?: string };
}

const HISTORY_REASON_TEXT: Record<string, string> = {
  startup: '启动更换',
  refresh: '手动刷新',
  set: '手动设置',
  record: '手动记录',
  external: '外部更换',
  dynamic: '动态壁纸画面',
};

const relativeTime = (iso: string) => {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString();
};

export default function Home() {
  const [wallpaper, setWallpaperInfo] = useState<WallpaperInfo | null>(null);
  const [displays, setDisplays] = useState<DisplayResolution[]>([]);
  const [bing, setBing] = useState<BingWallpaper | null>(null);
  const [hitokoto, setHitokoto] = useState<Hitokoto | null>(null);
  const [showAuthor, setShowAuthor] = useState(true);
  const [showSource, setShowSource] = useState(true);
  const [wallpaperRefreshSeconds, setWallpaperRefreshSeconds] = useState(30);
  const [wpLoading, setWpLoading] = useState(true);
  const [bingLoading, setBingLoading] = useState(true);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [persistedCards, setPersistedCards] = useState<{ id: string; visible?: boolean }[] | null>(null);
  const [spotlightItems, setSpotlightItems] = useState<HomeSpotlightItem[]>([]);
  const [spotlightIndex, setSpotlightIndex] = useState(0);
  const [spotlightLoading, setSpotlightLoading] = useState(true);
  const [spotlightMarket, setSpotlightMarket] = useState(DEFAULT_WALLPAPER_MARKET);
  const [spotlightMarketReady, setSpotlightMarketReady] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [favoritePool, setFavoritePool] = useState<FavoriteItem[]>([]);
  const [favoriteIndex, setFavoriteIndex] = useState(0);
  const [favoriteLoading, setFavoriteLoading] = useState(true);
  const mountedRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const actionRef = useRef(false);
  const historyRequestRef = useRef(0);
  const favoritesRequestRef = useRef(0);
  const wallpaperRequestRef = useRef(0);
  const [historyError, setHistoryError] = useState(false);
  const [favoriteError, setFavoriteError] = useState(false);
  const { openViewer } = useImageViewer();
  const { contributions } = usePlugins();
  const { effectiveTheme } = useThemeContext();

  // 模糊样式需要把 backdrop-filter 写成内联样式：构建管线（Tailwind v4 的
  // Lightning CSS 目标含旧 Safari）会把 CSS 里的标准 backdrop-filter 改写成
  // Chromium 不支持的 -webkit- 前缀，导致模糊失效（导航栏同样以此方式绕过）。
  const homeCardsTheme = effectiveTheme.home_cards;
  const homeCardBlurStyle: React.CSSProperties | undefined = homeCardsTheme?.background_style === 'blur'
    ? { backdropFilter: `blur(${homeCardsTheme.backdrop_blur ?? 16}px)` }
    : undefined;

  // 插件贡献的主页卡片，id 形如 pluginId:cardId，排在内置卡片之后。
  const pluginCardEntries = useMemo(
    () => contributions.home_cards.map((card) => ({
      key: `${card.pluginId}:${card.id}`,
      card,
    })),
    [contributions.home_cards],
  );
  const availableCardIds = useMemo(
    () => [
      ...BUILTIN_HOME_CARDS.map((descriptor) => descriptor.id),
      ...pluginCardEntries.map((entry) => entry.key),
    ],
    [pluginCardEntries],
  );

  // 卡片列表与顺序来自设置 → 主页；插件启用状态变化时可用卡片随之增减。
  const cards = useMemo<HomePageCardConfig[]>(
    () => resolveHomeCards(persistedCards, availableCardIds),
    [persistedCards, availableCardIds],
  );
  const availableIds = useMemo(() => new Set(availableCardIds), [availableCardIds]);
  const visibleCards = cards.filter((card) => card.visible && availableIds.has(card.id));

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const cache = getBootstrapCache();
    if (cache?.home) {
      const cw = cache.home.current_wallpaper;
      if (cw) {
        setWallpaperInfo({ path: cw.path || '', filename: cw.filename || '壁纸', preview_url: cw.preview_url });
        setWpLoading(false);
      }
      const b = cache.home.bing?.[0];
      if (b) {
        setBing(b);
        setBingLoading(false);
      }
      const q = cache.home.quote;
      if (q) {
        setHitokoto({ hitokoto: q.text || '', from: q.source || '', from_who: q.author || '' });
        setQuoteLoading(false);
      }
    }
    if (cache?.settings?.home_page) {
      setShowAuthor(cache.settings.home_page.show_author ?? true);
      setShowSource(cache.settings.home_page.show_source ?? true);
      setWallpaperRefreshSeconds(resolveWallpaperRefreshSeconds(cache.settings));
      setPersistedCards(cache.settings.home_page.cards ?? null);
    }

    void refreshWallpaper();

    getBingWallpaper().then((b) => {
      if (b) setBing(b);
      setBingLoading(false);
    }).catch(() => setBingLoading(false));

    getSentence().then((h) => {
      if (h) setHitokoto(h);
      setQuoteLoading(false);
    }).catch(() => setQuoteLoading(false));

    getSettings().then((s) => {
      setShowAuthor(s.home_page.show_author ?? true);
      setShowSource(s.home_page.show_source ?? true);
      setWallpaperRefreshSeconds(resolveWallpaperRefreshSeconds(s));
      setPersistedCards(s.home_page.cards ?? null);
      setSpotlightMarket(resolveWallpaperMarket(s.wallpaper?.spotlight?.market));
    }).catch(() => { /* ignore */ }).finally(() => setSpotlightMarketReady(true));

    getDisplayResolutions().then(setDisplays).catch(() => { /* ignore */ });
  }, []);

  // 新增卡片的数据只在卡片可见时加载；设置未返回前按默认可见处理
  // （与 Bing/语句卡一致），首次加载后不会因可见性变化重复请求。
  const spotlightVisible = visibleCards.some((card) => card.id === 'spotlight');
  const historyCardVisible = visibleCards.some((card) => card.id === 'recent_history');
  const favoriteCardVisible = visibleCards.some((card) => card.id === 'random_favorite');
  const currentCardVisible = visibleCards.some((card) => card.id === 'current_wallpaper');
  const spotlightLoadedRef = useRef(false);
  const historyLoadedRef = useRef(false);
  const favoritesLoadedRef = useRef(false);

  const loadSpotlight = async (forceRefresh = false) => {
    setSpotlightLoading(true);
    try {
      const items = (await querySpotlight('online', 12, spotlightMarket, forceRefresh)) as HomeSpotlightItem[];
      setSpotlightItems(items || []);
      setSpotlightIndex(items?.length ? Math.floor(Math.random() * items.length) : 0);
    } catch {
      toast.danger('聚焦图片加载失败，请重试');
    } finally {
      setSpotlightLoading(false);
    }
  };

  const loadHistoryItems = async () => {
    const request = ++historyRequestRef.current;
    try {
      const items = await getHistory();
      if (request !== historyRequestRef.current) return;
      setHistoryItems((items || []).filter((item) => item.path));
      setHistoryError(false);
    } catch {
      if (request === historyRequestRef.current) setHistoryError(true);
    } finally {
      if (request === historyRequestRef.current) setHistoryLoading(false);
    }
  };

  const loadFavorites = async () => {
    const request = ++favoritesRequestRef.current;
    const selectedId = favoritePool[favoriteIndex]?.id;
    try {
      const data = await getFavorites();
      if (request !== favoritesRequestRef.current) return;
      const items = (data.items || []).filter((item) => item.local_path || item.preview_url || item.source_url);
      setFavoritePool(items);
      const selectedIndex = items.findIndex((item) => item.id === selectedId);
      setFavoriteIndex(selectedIndex >= 0 ? selectedIndex : items.length ? Math.floor(Math.random() * items.length) : 0);
      setFavoriteError(false);
    } catch {
      if (request === favoritesRequestRef.current) setFavoriteError(true);
    } finally {
      if (request === favoritesRequestRef.current) setFavoriteLoading(false);
    }
  };

  useEffect(() => {
    if (spotlightVisible && spotlightMarketReady && !spotlightLoadedRef.current) {
      spotlightLoadedRef.current = true;
      void loadSpotlight();
    }
    if ((historyCardVisible || currentCardVisible) && !historyLoadedRef.current) {
      historyLoadedRef.current = true;
      void loadHistoryItems();
    }
    if (favoriteCardVisible && !favoritesLoadedRef.current) {
      favoritesLoadedRef.current = true;
      void loadFavorites();
    }
  }, [spotlightVisible, spotlightMarketReady, historyCardVisible, favoriteCardVisible, currentCardVisible]);

  const refreshWallpaper = async (reportError = false) => {
    const request = ++wallpaperRequestRef.current;
    try {
      const wp = await getCurrentWallpaper();
      if (request === wallpaperRequestRef.current) setWallpaperInfo(wp);
    } catch {
      if (reportError) toast.danger('壁纸信息刷新失败，请重试');
    } finally {
      if (request === wallpaperRequestRef.current) setWpLoading(false);
    }
  };

  const syncWallpaper = useEffectEvent(() => refreshWallpaper());
  const syncHistory = useEffectEvent(() => loadHistoryItems());
  const syncFavorites = useEffectEvent(() => loadFavorites());

  useEffect(() => {
    const onWallpaper = () => { if (currentCardVisible) void syncWallpaper(); };
    const onHistory = () => { if (currentCardVisible || historyCardVisible) void syncHistory(); };
    const onFavorites = () => { if (favoriteCardVisible) void syncFavorites(); };
    window.addEventListener(WALLPAPER_CHANGED_EVENT, onWallpaper);
    window.addEventListener(HISTORY_CHANGED_EVENT, onHistory);
    window.addEventListener(FAVORITES_CHANGED_EVENT, onFavorites);
    return () => {
      window.removeEventListener(WALLPAPER_CHANGED_EVENT, onWallpaper);
      window.removeEventListener(HISTORY_CHANGED_EVENT, onHistory);
      window.removeEventListener(FAVORITES_CHANGED_EVENT, onFavorites);
    };
  }, [currentCardVisible, historyCardVisible, favoriteCardVisible]);

  useEffect(() => {
    if (!currentCardVisible && !historyCardVisible) return;
    let stopped = false;
    let running = false;
    const refresh = async () => {
      if (stopped || running || document.hidden) return;
      running = true;
      try {
        await Promise.all([
          currentCardVisible ? syncWallpaper() : Promise.resolve(),
          syncHistory(),
        ]);
      } finally {
        running = false;
      }
    };
    const interval = setInterval(() => void refresh(), wallpaperRefreshSeconds * 1000);
    const onVisible = () => { void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [currentCardVisible, historyCardVisible, wallpaperRefreshSeconds]);

  const runAction = async (name: string, action: () => Promise<unknown>) => {
    if (actionRef.current) return;
    actionRef.current = true;
    setPendingAction(name);
    try {
      await action();
    } catch (error) {
      toast.danger('操作失败', { description: error instanceof Error ? error.message : '请稍后重试' });
    } finally {
      actionRef.current = false;
      setPendingAction(null);
    }
  };

  const refreshSentence = async () => {
    setQuoteLoading(true);
    try {
      const h = await getSentence();
      if (!h) throw new Error('暂无语句');
      setHitokoto(h);
    } catch {
      toast.danger('语句刷新失败，请重试');
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleSetBing = async () => {
    if (!bing?.url) return;
    await runAction('bing', () => setWallpaperWithProgress(bing.url, 'bing_today.jpg'));
  };

  const handleDownloadBing = async () => {
    if (!bing?.url) return;
    const safeName = safeNameForFile(bing.title, 'bing');
    await downloadWithProgress(bing.url, `${safeName}.jpg`);
  };

  const handleSaveAsBing = async () => {
    if (!bing?.url) return;
    const safeName = safeNameForFile(bing.title, 'bing');
    await saveAsWithProgress(bing.url, `${safeName}.jpg`);
  };

  const handleExport = async () => {
    if (!wallpaper?.path) return;
    await copyToClipboard(wallpaper.path);
  };

  const handleFavoriteCurrent = async () => {
    if (!wallpaper?.path) return;
    await runAction('favorite', async () => {
      const data = await getFavorites();
      if (data.items.some((item) => sameWallpaperPath(item.local_path || '', wallpaper.path))) {
        toast.success('这张壁纸已在收藏夹中');
        return;
      }
      await addFavorite({
      folder_id: 'default',
      title: wallpaper.filename,
      description: '从首页收藏的壁纸',
      tags: [],
      preview_url: wallpaper.preview_url || '',
      local_path: wallpaper.path,
      source_type: 'system',
      source_url: '',
      });
      notifyFavoritesChanged();
      toast.success('已收藏当前壁纸');
    });
  };

  const handleRecordCurrent = async () => {
    await runAction('record', async () => {
      const recorded = await recordCurrentWallpaper();
      if (!recorded?.path) throw new Error('无法获取当前壁纸');
      toast.success('已记录当前壁纸');
      await refreshWallpaper();
    });
  };

  const currentSpotlight = spotlightItems[spotlightIndex];

  const cycleSpotlight = () => {
    if (spotlightItems.length < 2) return;
    setSpotlightIndex((i) => (i + 1) % spotlightItems.length);
  };

  const handleSetSpotlight = async () => {
    if (!currentSpotlight?.image_url) return;
    const safeName = safeNameForFile(currentSpotlight.title, 'spotlight');
    // 在线聚焦下载 image_url（1920 全尺寸）应用；若条目带本地路径则优先本地应用。
    await runAction('spotlight', () => setWallpaperWithProgress(
      currentSpotlight.image_url, `${safeName}.jpg`, currentSpotlight.metadata?.original_image_url || null,
    ));
  };

  const openSpotlightViewer = () => {
    if (!spotlightItems.length) return;
    openViewer(spotlightItems.map((item) => {
      const original = item.metadata?.original_image_url || '';
      return {
        src: item.image_url,
        title: item.title || '聚焦图片',
        description: item.description || item.metadata?.copyright || '',
        copyright: item.copyright || item.metadata?.copyright || '',
        source_url: original || item.image_url,
        preview_url: item.preview_url || item.image_url,
        local_path: original || undefined,
        source_type: 'spotlight',
      };
    }), spotlightIndex);
  };

  const openHistoryViewer = (startIndex: number) => {
    if (!historyItems.length) return;
    openViewer(historyItems.slice(0, 8).map((item) => ({
      src: localFileUrl(item.path),
      title: item.title || '壁纸',
      description: `${HISTORY_REASON_TEXT[item.reason] || item.reason} · ${new Date(item.time).toLocaleString()}`,
      local_path: item.path,
      preview_url: item.preview_url || localPreviewUrl(item.path, 320),
      source_type: 'history',
    })), startIndex);
  };

  const handleRestoreHistory = async (item: HistoryItem) => {
    if (!item.path) return;
    const safeName = safeNameForFile(item.title, 'wallpaper');
    await runAction('restore', () => setWallpaperWithProgress('', `${safeName}.jpg`, item.path));
  };

  const previous = previousWallpaper(historyItems, wallpaper?.path || '');
  const handlePreviousWallpaper = () => runAction('previous', async () => {
    // Re-read before restoring: another page or automation may have changed the desktop.
    const [current, items] = await Promise.all([getCurrentWallpaper(), getHistory()]);
    const target = previousWallpaper(items, current?.path || '');
    if (!target) throw new Error('没有可切回的历史壁纸');
    await setWallpaperWithProgress('', `${safeNameForFile(target.title, 'wallpaper')}.jpg`, target.path);
  });

  const currentFavorite = favoritePool[favoriteIndex];

  const favoriteSrc = (item: FavoriteItem) => (
    item.local_path ? localPreviewUrl(item.local_path, 320) : favoriteImageUrl(item, true)
  );

  const shuffleFavorite = () => {
    if (favoritePool.length < 2) return;
    setFavoriteIndex((index) => nextFavoriteIndex(favoritePool.length, index));
  };

  const handleSetFavorite = async () => {
    if (!currentFavorite) return;
    const src = favoriteImageUrl(currentFavorite);
    if (!src && !currentFavorite.local_path) return;
    const safeName = safeNameForFile(currentFavorite.title, 'favorite');
    await runAction('set-favorite', () => setWallpaperWithProgress(
      currentFavorite.local_path ? '' : src, `${safeName}.jpg`, currentFavorite.local_path,
    ));
  };

  const openFavoriteViewer = () => {
    if (!favoritePool.length) return;
    openViewer(favoritePool.map((item) => {
      return {
        src: (item.local_path && localFileUrl(item.local_path)) || favoriteImageUrl(item),
        title: item.title || '收藏图片',
        description: item.description || '',
        source_url: item.source_url,
        local_path: item.local_path || undefined,
        preview_url: item.local_path ? localPreviewUrl(item.local_path, 320) : favoriteImageUrl(item, true),
        source_type: item.source_type || 'favorite',
        tags: item.tags,
      };
    }), favoriteIndex);
  };

  const previewSrc = wallpaper?.preview_url || '';
  const primaryDisplay = displays.find((d) => d.is_primary) ?? displays[0];

  // Bing 接口返回的 startdate 是 YYYYMMDD（可能带时间后缀），展示为 YYYY-MM-DD。
  const formatBingDate = (value: string) => (
    value.length >= 8 ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : ''
  );

  const handleOpenCurrentViewer = () => {
    if (!previewSrc) return;
    openViewer([{
      src: previewSrc,
      title: wallpaper?.filename || '当前壁纸',
      local_path: wallpaper?.path,
      preview_url: previewSrc,
      source_type: 'system',
    }], 0, { disableSetWallpaper: true });
  };

  const handleOpenBingViewer = () => {
    if (!bing?.url) return;
    openViewer([{
      src: bing.url,
      title: bing.title || 'Bing 每日壁纸',
      description: bing.copyright || '',
      source_url: bing.url,
      preview_url: bing.preview_url || bing.url,
      source_type: 'bing',
    }], 0, { disableSetWallpaper: true });
  };

  const cardNodes: Record<HomePageCardId, ReactNode> = {
    current_wallpaper: (
      <Card className="theme-home-card overflow-hidden" style={homeCardBlurStyle}>
        <div className="flex flex-col gap-6 p-6 sm:flex-row">
          <div
            className="relative h-[200px] w-full shrink-0 cursor-pointer overflow-hidden rounded-xl bg-surface-secondary sm:w-[320px]"
            onClick={handleOpenCurrentViewer}
          >
            {wpLoading ? (
              <Skeleton className="h-full w-full rounded-xl" />
            ) : previewSrc ? (
              <HomeImage src={previewSrc} alt="当前壁纸" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-muted">无法获取壁纸</div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="space-y-1.5 text-sm">
              <div className="text-muted">
                {wpLoading ? (
                  <Skeleton className="h-4 w-48 rounded" />
                ) : (
                  <>文件名: <span className="cursor-pointer text-foreground hover:underline" onClick={() => wallpaper?.path && copyToClipboard(wallpaper.path)}>
                    {wallpaper?.filename || '未知'}
                  </span></>
                )}
              </div>
              {wpLoading ? (
                <Skeleton className="h-4 w-56 rounded" />
              ) : wallpaper?.width && wallpaper?.height ? (
                <div className="text-muted">
                  分辨率: <span className="text-foreground">{wallpaper.width} × {wallpaper.height}</span>
                  {(() => {
                    const hint = resolutionHint(wallpaper.width, wallpaper.height, primaryDisplay);
                    return hint ? <span className={`ml-2 text-xs ${hint.className}`}>{hint.text}</span> : null;
                  })()}
                </div>
              ) : null}
              {wpLoading ? (
                <Skeleton className="h-4 w-32 rounded" />
              ) : wallpaper && formatBytes(wallpaper.size_bytes) ? (
                <div className="text-muted">
                  大小: <span className="text-foreground">{formatBytes(wallpaper.size_bytes)}</span>
                </div>
              ) : null}
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" isDisabled={!wallpaper?.path || !!pendingAction} onPress={() => runAction('copy', handleExport)}><FolderOutput size={16} /> 复制路径</Button>
              <Button size="sm" variant="secondary" isDisabled={!!pendingAction} isPending={pendingAction === 'refresh'} onPress={() => runAction('refresh', async () => { await Promise.all([refreshWallpaper(true), loadHistoryItems()]); })}><RefreshCw size={16} /> 刷新</Button>
              <Button size="sm" variant="secondary" isDisabled={!wallpaper?.path || !!pendingAction} isPending={pendingAction === 'favorite'} onPress={handleFavoriteCurrent}><Heart size={16} /> 收藏</Button>
              <Button size="sm" variant="secondary" isDisabled={!wallpaper?.path || !!pendingAction} isPending={pendingAction === 'record'} onPress={handleRecordCurrent}><Monitor size={16} /> 记录</Button>
              <Button size="sm" variant="secondary" isDisabled={!previous || !!pendingAction} isPending={pendingAction === 'previous'} onPress={handlePreviousWallpaper}><Undo2 size={16} /> 上一张</Button>
              <Button size="sm" variant="ghost" onPress={() => window.location.hash = '#/history'}><History size={16} /> 历史</Button>
            </div>
            <p className="text-xs text-muted">{historyError ? '历史读取失败，刷新后可重试切回' : previous ? `上一张：${previous.title || '历史壁纸'}` : '暂无可切回的历史壁纸'}</p>
          </div>
        </div>
      </Card>
    ),

    bing_daily: (
      <Card className="theme-home-card" style={homeCardBlurStyle}>
        <Card.Header>
          <Card.Title>Bing 每日壁纸</Card.Title>
          <Card.Description>
            {bing ? `${formatBingDate(bing.startdate) || '今日'} · 来自必应的每日精选图片` : '来自必应的每日精选图片'}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {bingLoading ? (
            <div className="flex gap-4">
              <Skeleton className="h-[108px] w-[192px] shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-4 w-3/5 rounded" />
                <Skeleton className="h-3 w-full rounded" />
                <div className="pt-2"><Skeleton className="h-8 w-72 rounded-lg" /></div>
              </div>
            </div>
          ) : bing ? (
            <div className="flex flex-col gap-4 sm:flex-row">
              <div
                className="group relative h-[108px] w-[192px] shrink-0 cursor-pointer overflow-hidden rounded-xl bg-surface-secondary transition-transform duration-150 ease-out active:scale-[0.98]"
                onClick={handleOpenBingViewer}
              >
                <HomeImage
                  src={bing.preview_url || bing.url}
                  alt={bing.title || 'Bing 每日壁纸'}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="cursor-pointer text-sm font-medium hover:underline" onClick={handleOpenBingViewer}>
                  {bing.title || 'Bing 每日壁纸'}
                </div>
                <div className="line-clamp-2 text-xs text-muted">{bing.copyright}</div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" isDisabled={!!pendingAction} isPending={pendingAction === 'bing'} onPress={handleSetBing}><ImageIcon size={14} /> 设为壁纸</Button>
                  <Button size="sm" variant="secondary" onPress={handleOpenBingViewer}><Eye size={14} /> 查看</Button>
                  <Button size="sm" variant="secondary" isDisabled={!!pendingAction} isPending={pendingAction === 'download'} onPress={() => runAction('download', handleDownloadBing)}><Download size={14} /> 下载</Button>
                  <Button size="sm" variant="secondary" isDisabled={!!pendingAction} isPending={pendingAction === 'save'} onPress={() => runAction('save', handleSaveAsBing)}><Save size={14} /> 另存为</Button>
                  <Button size="sm" variant="ghost" onPress={() => copyToClipboard(bing.url)}><Copy size={14} /> 复制链接</Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-muted">加载失败</p>
              <Button size="sm" variant="secondary" isDisabled={!!pendingAction} onPress={() => runAction('bing-retry', async () => {
                setBingLoading(true);
                try {
                  const result = await getBingWallpaper();
                  if (!result) throw new Error('暂无 Bing 壁纸，请稍后重试');
                  setBing(result);
                } finally { setBingLoading(false); }
              })}>重试</Button>
            </div>
          )}
        </Card.Content>
      </Card>
    ),

    daily_quote: (
      <Card className="theme-home-card" style={homeCardBlurStyle}>
        <Card.Header><Card.Title>每日语句</Card.Title></Card.Header>
        <Card.Content className="space-y-2">
          {quoteLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-full rounded" />
              <Skeleton className="h-5 w-4/5 rounded" />
              <Skeleton className="h-4 w-1/3 rounded" />
            </div>
          ) : hitokoto?.hitokoto ? (
            <>
              <p className="text-lg leading-relaxed">{hitokoto.hitokoto}</p>
              {(showAuthor && hitokoto.from_who) || (showSource && hitokoto.from) ? (
                <p className="text-sm text-muted">
                  ——{showAuthor && hitokoto.from_who ? ` ${hitokoto.from_who}` : ''}
                  {showSource && hitokoto.from ? `《${hitokoto.from}》` : ''}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-muted">加载失败</p>
          )}
          <Button size="sm" variant="ghost" isPending={quoteLoading} onPress={refreshSentence}><RefreshCw size={14} /> 刷新语句</Button>
        </Card.Content>
      </Card>
    ),

    spotlight: (
      <Card className="theme-home-card" style={homeCardBlurStyle}>
        <Card.Header>
          <Card.Title>Windows 聚焦</Card.Title>
          <Card.Description>
            {spotlightItems.length ? `聚焦在线图库 · 共 ${spotlightItems.length} 张` : '来自 Windows 聚焦在线图库的图片'}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {spotlightLoading ? (
            <div className="flex gap-4">
              <Skeleton className="h-[108px] w-[192px] shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-4 w-2/5 rounded" />
                <Skeleton className="h-3 w-full rounded" />
                <div className="pt-2"><Skeleton className="h-8 w-56 rounded-lg" /></div>
              </div>
            </div>
          ) : currentSpotlight ? (
            <div className="flex flex-col gap-4 sm:flex-row">
              <div
                className="group relative h-[108px] w-[192px] shrink-0 cursor-pointer overflow-hidden rounded-xl bg-surface-secondary transition-transform duration-150 ease-out active:scale-[0.98]"
                onClick={openSpotlightViewer}
              >
                <HomeImage
                  src={currentSpotlight.preview_url || currentSpotlight.image_url}
                  alt={currentSpotlight.title || '聚焦图片'}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="cursor-pointer text-sm font-medium hover:underline" onClick={openSpotlightViewer}>
                  {currentSpotlight.title || `聚焦图片 ${spotlightIndex + 1} / ${spotlightItems.length}`}
                </div>
                <div className="line-clamp-2 text-xs text-muted">
                  {currentSpotlight.description || currentSpotlight.metadata?.copyright || '来自 Windows 聚焦在线图库的精选图片'}
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" isDisabled={!!pendingAction} isPending={pendingAction === 'spotlight'} onPress={handleSetSpotlight}><ImageIcon size={14} /> 设为壁纸</Button>
                  <Button size="sm" variant="secondary" onPress={openSpotlightViewer}><Eye size={14} /> 查看</Button>
                  <Button size="sm" variant="secondary" isDisabled={spotlightItems.length < 2} onPress={cycleSpotlight}><Shuffle size={14} /> 换一张</Button>
                  <Button size="sm" variant="ghost" isPending={spotlightLoading} onPress={() => loadSpotlight(true)}><RefreshCw size={14} /> 刷新</Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-muted">聚焦图片加载失败或暂无内容</p>
              <Button size="sm" variant="secondary" onPress={() => loadSpotlight(true)}><RefreshCw size={14} /> 重试</Button>
            </div>
          )}
        </Card.Content>
      </Card>
    ),

    recent_history: (
      <Card className="theme-home-card" style={homeCardBlurStyle}>
        <Card.Header>
          <Card.Title>最近历史</Card.Title>
          <Card.Description>最近使用过的壁纸，点击回看，悬停可快速恢复</Card.Description>
        </Card.Header>
        <Card.Content className="space-y-3">
          {historyError && <p role="status" className="text-sm text-warning">历史刷新失败，已保留上次内容</p>}
          {historyLoading ? (
            <div className="flex gap-3 overflow-hidden">
              {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[90px] w-[160px] shrink-0 rounded-lg" />)}
            </div>
          ) : historyItems.length ? (
            <ScrollShadow orientation="horizontal" className="-mx-1 px-1 pb-2">
              <div className="flex gap-3">
                {historyItems.slice(0, 8).map((item, idx) => (
                  <div
                    key={`${item.path}-${idx}`}
                    className="group relative h-[90px] w-[160px] shrink-0 cursor-pointer overflow-hidden rounded-lg bg-surface-secondary transition-transform duration-150 ease-out active:scale-[0.98]"
                    onClick={() => openHistoryViewer(idx)}
                    title={item.title}
                  >
                      <HomeImage
                        src={item.preview_url || localPreviewUrl(item.path, 320)}
                        alt={item.title}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                    <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-3 text-[10px] text-white">
                      {relativeTime(item.time) || new Date(item.time).toLocaleDateString()} · {HISTORY_REASON_TEXT[item.reason] || item.reason}
                    </div>
                    <div className="absolute right-1 top-1 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100" title="恢复此壁纸" onClick={(e) => e.stopPropagation()}>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        isDisabled={!!pendingAction}
                        isPending={pendingAction === 'restore'}
                        aria-label="恢复此壁纸"
                        className="rounded bg-black/50 p-1 text-white hover:bg-black/70 hover:text-white"
                        onPress={() => handleRestoreHistory(item)}
                      >
                        <Undo2 size={12} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollShadow>
          ) : (
            <p className="text-muted">暂无历史记录，更换壁纸后会出现在这里</p>
          )}
          <div>
            <Button size="sm" variant="ghost" onPress={() => { window.location.hash = '#/history'; }}><History size={14} /> 全部历史</Button>
            <Button size="sm" variant="ghost" isDisabled={!!pendingAction} isPending={pendingAction === 'history-refresh'} onPress={() => runAction('history-refresh', loadHistoryItems)}><RefreshCw size={14} /> 刷新历史</Button>
          </div>
        </Card.Content>
      </Card>
    ),

    random_favorite: (
      <Card className="theme-home-card" style={homeCardBlurStyle}>
        <Card.Header>
          <Card.Title>随机收藏</Card.Title>
          <Card.Description>
            {favoritePool.length ? `收藏夹 · 共 ${favoritePool.length} 张` : '从收藏夹随机展示一张壁纸'}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {favoriteError && <p role="status" className="text-sm text-warning">收藏刷新失败，已保留上次内容</p>}
          {favoriteLoading ? (
            <div className="flex gap-4">
              <Skeleton className="h-[108px] w-[192px] shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-4 w-2/5 rounded" />
                <Skeleton className="h-3 w-full rounded" />
                <div className="pt-2"><Skeleton className="h-8 w-56 rounded-lg" /></div>
              </div>
            </div>
          ) : currentFavorite ? (
            <div className="flex flex-col gap-4 sm:flex-row">
              <div
                className="group relative h-[108px] w-[192px] shrink-0 cursor-pointer overflow-hidden rounded-xl bg-surface-secondary transition-transform duration-150 ease-out active:scale-[0.98]"
                onClick={openFavoriteViewer}
              >
                <HomeImage
                  src={favoriteSrc(currentFavorite)}
                  alt={currentFavorite.title || '收藏图片'}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="cursor-pointer text-sm font-medium hover:underline" onClick={openFavoriteViewer}>
                  {currentFavorite.title || '收藏图片'}
                </div>
                <div className="line-clamp-2 text-xs text-muted">
                  {[
                    currentFavorite.description || currentFavorite.source_name || '来自收藏夹',
                    currentFavorite.created_at ? `收藏于 ${new Date(currentFavorite.created_at).toLocaleDateString()}` : '',
                  ].filter(Boolean).join(' · ')}
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" isDisabled={!!pendingAction} isPending={pendingAction === 'set-favorite'} onPress={handleSetFavorite}><ImageIcon size={14} /> 设为壁纸</Button>
                  <Button size="sm" variant="secondary" onPress={openFavoriteViewer}><Eye size={14} /> 查看</Button>
                  <Button size="sm" variant="secondary" isDisabled={favoritePool.length < 2} onPress={shuffleFavorite}><Shuffle size={14} /> 换一张</Button>
                  <Button size="sm" variant="ghost" onPress={() => { window.location.hash = '#/favorite'; }}><Heart size={14} /> 前往收藏</Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted">{favoriteError ? '暂时无法读取收藏夹' : '还没有收藏，收藏壁纸后会随机出现在这里'}</p>
          )}
          <Button size="sm" variant="ghost" isDisabled={!!pendingAction} isPending={pendingAction === 'favorites-refresh'} onPress={() => runAction('favorites-refresh', loadFavorites)}><RefreshCw size={14} /> 刷新收藏</Button>
        </Card.Content>
      </Card>
    ),
  };

  const pluginCardByKey = new Map(pluginCardEntries.map((entry) => [entry.key, entry.card]));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">
        {visibleCards.some((card) => card.id === 'current_wallpaper') ? '当前壁纸' : '主页'}
      </h1>
      {visibleCards.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <EmptyState>所有主页卡片均已隐藏</EmptyState>
          <Button size="sm" variant="secondary" onPress={() => { window.location.hash = '#/settings/home'; }}>
            前往设置开启
          </Button>
        </Card>
      ) : (
        visibleCards.map((card) => {
          const pluginCard = pluginCardByKey.get(card.id);
          if (pluginCard) {
            const pluginClass = safePluginClassName(pluginCard.className);
            return (
              <Card
                key={card.id}
                className={`theme-home-card ${pluginClass}`.trim()}
                style={homeCardBlurStyle}
              >
                <Card.Header>
                  <Card.Title>{pluginCard.label}</Card.Title>
                  {pluginCard.description && <Card.Description>{pluginCard.description}</Card.Description>}
                </Card.Header>
                <Card.Content>
                  <PluginRenderer
                    pluginId={pluginCard.pluginId}
                    pluginName={pluginCard.plugin.name}
                    packageHash={pluginCard.packageHash}
                    blocks={pluginCard.blocks}
                    dense
                  />
                </Card.Content>
              </Card>
            );
          }
          const coreNode = cardNodes[card.id as HomePageCardId];
          return coreNode ? <Fragment key={card.id}>{coreNode}</Fragment> : null;
        })
      )}
    </div>
  );
}
