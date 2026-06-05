import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import {
  Card, Button, Tabs, Skeleton, Chip, ComboBox, Input, Label, ListBox, Select, Switch, SearchField,
} from '@heroui/react';
import {
  Image as ImageIcon, Download, Heart, Copy, ChevronLeft, ChevronRight, RefreshCw, Save,
  ExternalLink, SlidersHorizontal, Link as LinkIcon,
} from 'lucide-react';
import {
  queryBing, querySpotlight, setWallpaper,
  downloadFile, copyToClipboard, addFavorite,
  downloadWithProgress, saveAsWithProgress, openUrl,
  listIntelligentMarketSources, checkIntelligentMarketSourcesHealth,
  executeIntelligentMarketSource, updateSettings,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import type { IntelligentMarketSource, IntelligentMarketParameter } from '@/types';

function formatBingDate(item: any, category: string): string {
  if (category === 'daily') return '今日';
  const raw = item?.isoDate ?? item?.startdate ?? item?.date;
  if (typeof raw === 'string') {
    if (/^\d{8}$/.test(raw)) {
      const month = parseInt(raw.slice(4, 6), 10);
      const day = parseInt(raw.slice(6, 8), 10);
      return `${month}月${day}日`;
    }
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return `${d.getMonth() + 1}月${d.getDate()}日`;
    }
  }
  return '';
}

function getBingUrlForQuality(url: string, quality: '1080p' | 'uhd'): string {
  return quality === 'uhd' ? url.replace('1920x1080', 'UHD') : url;
}

function absoluteBingUrl(url: string | undefined): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `https://www.bing.com${url.startsWith('/') ? '' : '/'}${url}`;
}

function BingSkeleton({ category }: { category: string }) {
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex gap-4 p-4">
          <Skeleton className="h-[160px] w-[280px] shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Skeleton className="h-5 w-3/5 rounded" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-4/5 rounded" />
            <div className="mt-2 flex flex-wrap gap-2">
              <Skeleton className="h-8 w-20 rounded" />
              <Skeleton className="h-8 w-20 rounded" />
              <Skeleton className="h-8 w-20 rounded" />
              <Skeleton className="h-8 w-20 rounded" />
            </div>
          </div>
        </div>
      </Card>
      {category !== 'daily' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[80px] w-full rounded-lg" />
          ))}
        </div>
      )}
    </div>
  );
}

function SpotlightSkeleton() {
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex gap-4 p-4">
          <Skeleton className="h-[180px] w-[320px] shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-3">
            <Skeleton className="h-5 w-3/5 rounded" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-4/5 rounded" />
            <Skeleton className="h-3 w-24 rounded" />
            <div className="mt-2 flex flex-wrap gap-2">
              <Skeleton className="h-8 w-20 rounded" />
              <Skeleton className="h-8 w-20 rounded" />
              <Skeleton className="h-8 w-20 rounded" />
              <Skeleton className="h-8 w-20 rounded" />
            </div>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[80px] w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

const IM_ALL_CATEGORY = '__all__';
const IM_MIRROR_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'github', label: 'GitHub' },
  { value: 'jsdelivr', label: 'jsDelivr' },
  { value: 'ghproxy', label: 'gh-proxy' },
];
const IM_HEALTH_BATCH_SIZE = 6;

function getIMParameterLabel(param: IntelligentMarketParameter, index: number): string {
  return param.friendly_name?.trim() || param.name?.trim() || `参数 ${index + 1}`;
}

function getIMParameterDefaultValue(param: IntelligentMarketParameter): string | boolean {
  const type = String(param.type ?? 'string').toLowerCase();
  if (type === 'boolean') return Boolean(param.default_value);
  if (type === 'list') {
    if (Array.isArray(param.default_value)) {
      const separator = param.split_str || '\n';
      return param.default_value.map((item) => String(item)).join(separator);
    }
    return String(param.default_value ?? '');
  }
  return String(param.default_value ?? '');
}

function normalizeIMParameterValue(param: IntelligentMarketParameter, value: unknown): unknown {
  const type = String(param.type ?? 'string').toLowerCase();
  if (type === 'boolean') return Boolean(value);
  if (type === 'list') {
    const raw = String(value ?? '').trim();
    if (!raw) return [];
    if (param.split_str) return raw.split(param.split_str).map((item) => item.trim()).filter(Boolean);
    return raw.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
  }
  return value;
}

function getIMHealthColor(status?: string | null): 'success' | 'danger' | 'warning' | 'default' {
  if (status === 'healthy') return 'success';
  if (status === 'unhealthy') return 'danger';
  if (status === 'unknown') return 'warning';
  return 'default';
}

function getIMHealthLabel(status?: string | null): string {
  if (status === 'healthy') return '可用';
  if (status === 'unhealthy') return '不可用';
  return '未知';
}

function mergeIMHealthUpdates(
  sources: IntelligentMarketSource[],
  updates: { id: string; health_status?: string; health_message?: string | null; health_checked_at?: string | null; health_status_code?: number | null; health_probe_url?: string | null }[]
): IntelligentMarketSource[] {
  const map = new Map(updates.map((u) => [u.id, u]));
  return sources.map((s) => {
    const u = map.get(s.id);
    return u ? { ...s, ...u } : s;
  });
}

function imSourceMatches(source: IntelligentMarketSource, searchText: string, category: string): boolean {
  if (category !== IM_ALL_CATEGORY && source.category !== category) return false;
  if (!searchText) return true;
  const term = searchText.toLowerCase();
  return (
    source.friendly_name.toLowerCase().includes(term) ||
    source.category.toLowerCase().includes(term) ||
    (source.intro || '').toLowerCase().includes(term)
  );
}

export default function Resource() {
  const [activeTab, setActiveTab] = useState('bing');
  const [bingTab, setBingTab] = useState('daily');
  const [spotlightTab, setSpotlightTab] = useState('local');
  const [bingGallery, setBingGallery] = useState<any[]>([]);
  const [spotlightGallery, setSpotlightGallery] = useState<any[]>([]);
  const [bingLoading, setBingLoading] = useState(false);
  const [spotlightLoading, setSpotlightLoading] = useState(false);
  const [bingLoadedFor, setBingLoadedFor] = useState<string | null>(null);
  const [spotlightLoadedFor, setSpotlightLoadedFor] = useState<string | null>(null);
  const [selectedBingIndex, setSelectedBingIndex] = useState(0);
  const [selectedSpotlightIndex, setSelectedSpotlightIndex] = useState(0);
  const [bingQuality, setBingQuality] = useState<'1080p' | 'uhd'>('1080p');
  const mountedRef = useRef(false);
  const { openViewer } = useImageViewer();

  const [imSources, setImSources] = useState<IntelligentMarketSource[]>([]);
  const [imLoaded, setImLoaded] = useState(false);
  const [imLoading, setImLoading] = useState(false);
  const [imSearch, setImSearch] = useState('');
  const [imCategory, setImCategory] = useState(IM_ALL_CATEGORY);
  const [imSelectedId, setImSelectedId] = useState<string | null>(null);
  const [imParameterValues, setImParameterValues] = useState<Record<string, unknown>>({});
  const [imGallery, setImGallery] = useState<any[]>([]);
  const [imExecuting, setImExecuting] = useState(false);
  const deferredImSearch = useDeferredValue(imSearch.trim().toLowerCase());
  const imHealthRequestIdRef = useRef(0);
  const imDetailRef = useRef<HTMLDivElement | null>(null);

  const imCategories = useMemo(
    () => Array.from(new Set(imSources.map((s) => s.category))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [imSources]
  );
  const filteredImSources = useMemo(
    () => imSources.filter((s) => imSourceMatches(s, deferredImSearch, imCategory)),
    [imSources, deferredImSearch, imCategory]
  );
  const selectedImSource = useMemo(
    () => imSources.find((s) => s.id === imSelectedId) ?? filteredImSources[0] ?? imSources[0] ?? null,
    [imSources, filteredImSources, imSelectedId]
  );
  const imListLoading = imLoading && imSources.length === 0;
  const imHealthSummary = useMemo(
    () => filteredImSources.reduce(
      (acc, s) => {
        if (s.health_status === 'healthy') acc.healthy += 1;
        else if (s.health_status === 'unhealthy') acc.unhealthy += 1;
        else acc.unknown += 1;
        return acc;
      },
      { healthy: 0, unhealthy: 0, unknown: 0 }
    ),
    [filteredImSources]
  );

  const fetchBing = useCallback(async (category: string = 'daily', forceRefresh: boolean = false) => {
    setBingLoading(true);
    setBingGallery([]);
    setSelectedBingIndex(0);
    try {
      const items = await queryBing(category, 'zh-CN', category === 'daily' ? 1 : 12, 'highDef', forceRefresh);
      setBingGallery(items || []);
      setBingLoadedFor(category);
    } catch (e) {
      console.error('Bing load failed', e);
      setBingGallery([]);
      setBingLoadedFor(category);
    } finally {
      setBingLoading(false);
    }
  }, []);

  const fetchSpotlight = useCallback(async (source: string = 'local', forceRefresh: boolean = false) => {
    setSpotlightLoading(true);
    setSpotlightGallery([]);
    setSelectedSpotlightIndex(0);
    try {
      const items = await querySpotlight(source, 18, 'zh-CN', forceRefresh);
      setSpotlightGallery(items || []);
      setSpotlightLoadedFor(source);
    } catch (e) {
      console.error('Spotlight load failed', e);
      setSpotlightGallery([]);
      setSpotlightLoadedFor(source);
    } finally {
      setSpotlightLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    fetchBing('daily');
  }, [fetchBing]);

  useEffect(() => {
    if (activeTab === 'bing' && bingTab !== bingLoadedFor && !bingLoading) {
      fetchBing(bingTab);
    }
    if (activeTab === 'spotlight' && spotlightTab !== spotlightLoadedFor && !spotlightLoading) {
      fetchSpotlight(spotlightTab);
    }
    if (activeTab === 'intellimarkets' && !imLoaded && !imLoading) {
      void loadIntelligentMarketSources();
    }
  }, [activeTab, bingTab, spotlightTab, bingLoadedFor, spotlightLoadedFor, bingLoading, spotlightLoading, imLoaded, imLoading, fetchBing, fetchSpotlight]);

  async function loadIntelligentMarketSources(force = false) {
    try {
      imHealthRequestIdRef.current += 1;
      setImLoading(true);
      const sources = await listIntelligentMarketSources(force);
      setImSources(sources);
      setImLoaded(true);
      void startImHealthChecks(sources, force);
    } catch (e) {
      console.error('IntelligentMarket load failed', e);
    } finally {
      setImLoading(false);
    }
  }

  async function startImHealthChecks(sources: IntelligentMarketSource[], force = false) {
    const requestId = imHealthRequestIdRef.current + 1;
    imHealthRequestIdRef.current = requestId;
    const sourceIds = sources.map((s) => s.id);
    for (let i = 0; i < sourceIds.length; i += IM_HEALTH_BATCH_SIZE) {
      if (imHealthRequestIdRef.current !== requestId) return;
      const batch = sourceIds.slice(i, i + IM_HEALTH_BATCH_SIZE);
      if (batch.length === 0) continue;
      try {
        const updates = await checkIntelligentMarketSourcesHealth(batch, force);
        if (imHealthRequestIdRef.current !== requestId) return;
        setImSources((current) => mergeIMHealthUpdates(current, updates));
      } catch {
        if (imHealthRequestIdRef.current !== requestId) return;
      }
    }
  }

  async function updateImMirrorPreference(value: string) {
    try {
      await updateSettings({ 'im.mirror_preference': value });
      setImLoaded(false);
      await loadIntelligentMarketSources(true);
    } catch (e) {
      console.error('update mirror preference failed', e);
    }
  }

  async function runIntelligentMarketQuery() {
    if (!selectedImSource) return;
    try {
      setImExecuting(true);
      const payload = Object.fromEntries(
        selectedImSource.parameters.map((param, index) => {
          const key = param.key || param.name || `__param_${index}`;
          return [key, normalizeIMParameterValue(param, imParameterValues[key])];
        })
      );
      const items = await executeIntelligentMarketSource(selectedImSource.id, payload);
      setImGallery(items || []);
    } catch (e) {
      console.error('execute IM source failed', e);
    } finally {
      setImExecuting(false);
    }
  }

  function handleSelectImSource(sourceId: string) {
    setImSelectedId(sourceId);
    window.requestAnimationFrame(() => {
      const el = imDetailRef.current;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  useEffect(() => {
    if (!selectedImSource) return;
    const defaults: Record<string, unknown> = {};
    selectedImSource.parameters.forEach((param, index) => {
      const key = param.key || param.name || `__param_${index}`;
      defaults[key] = getIMParameterDefaultValue(param);
    });
    setImParameterValues(defaults);
  }, [selectedImSource?.id]);

  const handleSetWallpaper = async (url: string, title: string) => {
    const safeName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || 'wallpaper';
    const path = await downloadFile(url, `${safeName}.jpg`);
    if (path) await setWallpaper(path);
  };

  const handleFavorite = async (item: any) => {
    await addFavorite({
      folder_id: 'default',
      title: item.title || '未命名',
      description: item.description || '',
      tags: [],
      preview_url: item.preview_url || item.image_url,
      local_path: null,
      source_type: item.source_id || 'unknown',
      source_url: item.image_url,
    });
  };

  const currentBing = bingGallery[selectedBingIndex];
  const currentSpotlight = spotlightGallery[selectedSpotlightIndex];

  const bingEmpty = bingLoadedFor === bingTab && !bingLoading && bingGallery.length === 0;
  const spotlightEmpty = spotlightLoadedFor === spotlightTab && !spotlightLoading && spotlightGallery.length === 0;

  const openBingViewer = (startIndex = 0) => {
    const items = bingGallery.map((item) => ({
      src: item.image_url,
      title: item.title || 'Bing 壁纸',
      description: item.description || '',
      source_url: item.image_url,
      preview_url: item.preview_url || item.image_url,
      source_type: 'bing',
    }));
    openViewer(items, startIndex);
  };

  const openSpotlightViewer = (startIndex = 0) => {
    const items = spotlightGallery.map((item) => ({
      src: item.image_url,
      title: item.title || 'Windows 聚焦',
      description: item.description || '',
      source_url: item.image_url,
      preview_url: item.preview_url || item.image_url,
      source_type: 'spotlight',
    }));
    openViewer(items, startIndex);
  };

  const openImViewer = (startIndex = 0) => {
    const items = imGallery.map((item) => ({
      src: item.image_url,
      title: item.title || 'IntelliMarkets',
      description: item.description || '',
      source_url: item.metadata?.original_url || item.image_url,
      preview_url: item.preview_url || item.image_url,
      source_type: item.source_id || 'intelligent_market',
    }));
    openViewer(items, startIndex);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">资源</h1>

      <Tabs selectedKey={activeTab} onSelectionChange={(k) => setActiveTab(String(k))}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="资源来源">
            <Tabs.Tab id="bing">Bing 壁纸<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="spotlight">Windows 聚焦<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="intellimarkets">IntelliMarkets<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="sources">壁纸源<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="bing">
          <div className="mb-3 flex items-center gap-2">
            <Button size="sm" variant={bingTab === 'daily' ? 'primary' : 'ghost'} onPress={() => setBingTab('daily')}>每日</Button>
            <Button size="sm" variant={bingTab === 'recent' ? 'primary' : 'ghost'} onPress={() => setBingTab('recent')}>近期</Button>
            <Button size="sm" variant="ghost" onPress={() => fetchBing(bingTab, true)} isDisabled={bingLoading}><RefreshCw size={14} className={bingLoading ? 'animate-spin' : ''} /></Button>
          </div>

          {bingLoading ? (
            <BingSkeleton category={bingTab} />
          ) : bingEmpty ? (
            <div className="py-10 text-center text-muted">加载失败，请稍后重试</div>
          ) : currentBing ? (
            <div className="space-y-4">
              <Card className="overflow-hidden">
                <div className="flex gap-4 p-4">
                  <div className="relative shrink-0 cursor-pointer" onClick={() => openBingViewer(selectedBingIndex)}>
                    <img
                      src={currentBing.preview_url || currentBing.image_url}
                      alt={currentBing.title}
                      className="h-[160px] w-[280px] rounded-lg object-cover hover:scale-105 transition-transform"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    {(() => {
                      const dateLabel = formatBingDate(currentBing.metadata, bingTab);
                      if (!dateLabel) return null;
                      return (
                        <Chip
                          size="sm"
                          color="default"
                          variant="primary"
                          className="absolute top-2 right-2 max-w-[calc(100%-1rem)]"
                        >
                          <Chip.Label className="truncate">{dateLabel}</Chip.Label>
                        </Chip>
                      );
                    })()}
                  </div>
                  <div className="flex flex-col gap-2 min-w-0">
                    <div className="font-medium">{currentBing.title}</div>
                    <div className="text-sm text-muted">{currentBing.description}</div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onPress={() => handleSetWallpaper(getBingUrlForQuality(currentBing.image_url, bingQuality), currentBing.title)}><ImageIcon size={14} /> 设为壁纸</Button>
                      <Button size="sm" variant="secondary" onPress={() => handleFavorite(currentBing)}><Heart size={14} /> 收藏</Button>
                      <Button size="sm" variant="secondary" onPress={() => downloadWithProgress(getBingUrlForQuality(currentBing.image_url, bingQuality), `${currentBing.title?.slice(0,30) || 'bing'}.jpg`)}><Download size={14} /> 下载</Button>
                      <Button size="sm" variant="secondary" onPress={() => saveAsWithProgress(getBingUrlForQuality(currentBing.image_url, bingQuality), `${currentBing.title?.slice(0,30) || 'bing'}.jpg`)}><Save size={14} /> 另存为</Button>
                      <Button size="sm" variant="secondary" onPress={() => {
                        const link = absoluteBingUrl(currentBing.metadata?.click_url);
                        if (link) openUrl(link);
                      }}><ExternalLink size={14} /> 查看详情</Button>
                      <Button size="sm" variant="ghost" onPress={() => copyToClipboard(getBingUrlForQuality(currentBing.image_url, bingQuality))}><Copy size={14} /> 复制链接</Button>
                      <Button size="sm" variant="ghost" onPress={() => openBingViewer(selectedBingIndex)}><ImageIcon size={14} /> 查看</Button>
                      {bingGallery.length > 1 && (
                        <>
                          <Button size="sm" variant="ghost" onPress={() => setSelectedBingIndex(Math.max(0, selectedBingIndex - 1))} isDisabled={selectedBingIndex === 0}><ChevronLeft size={14} /> 上一张</Button>
                          <Button size="sm" variant="ghost" onPress={() => setSelectedBingIndex(Math.min(bingGallery.length - 1, selectedBingIndex + 1))} isDisabled={selectedBingIndex >= bingGallery.length - 1}>下一张 <ChevronRight size={14} /></Button>
                        </>
                      )}
                    </div>
                    <ComboBox
                      className="mt-1 w-40"
                      menuTrigger="focus"
                      selectedKey={bingQuality}
                      onSelectionChange={(k) => k && setBingQuality(k as '1080p' | 'uhd')}
                    >
                      <Label className="sr-only">画质</Label>
                      <ComboBox.InputGroup>
                        <Input placeholder="选择画质" />
                        <ComboBox.Trigger />
                      </ComboBox.InputGroup>
                      <ComboBox.Popover>
                        <ListBox>
                          <ListBox.Item id="1080p" textValue="1080P">1080P<ListBox.ItemIndicator /></ListBox.Item>
                          <ListBox.Item id="uhd" textValue="原图">原图<ListBox.ItemIndicator /></ListBox.Item>
                        </ListBox>
                      </ComboBox.Popover>
                    </ComboBox>
                  </div>
                </div>
              </Card>

              {bingGallery.length > 1 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {bingGallery.map((item, idx) => (
                    <Button
                      key={item.id || idx}
                      variant="ghost"
                      onPress={() => { setSelectedBingIndex(idx); openBingViewer(idx); }}
                      className={`relative h-auto overflow-hidden rounded-lg p-0 transition-all ${selectedBingIndex === idx ? 'ring-2 ring-primary' : 'opacity-70 hover:opacity-100'}`}
                    >
                      <img
                        src={item.preview_url || item.image_url}
                        alt={item.title}
                        className="h-[80px] w-full object-cover"
                        loading="lazy"
                      />
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </Tabs.Panel>

        <Tabs.Panel id="spotlight">
          <div className="mb-3 flex items-center gap-2">
            <Button size="sm" variant={spotlightTab === 'local' ? 'primary' : 'ghost'} onPress={() => setSpotlightTab('local')}>本地</Button>
            <Button size="sm" variant={spotlightTab === 'online' ? 'primary' : 'ghost'} onPress={() => setSpotlightTab('online')}>在线</Button>
            <Button size="sm" variant="ghost" onPress={() => fetchSpotlight(spotlightTab, true)} isDisabled={spotlightLoading}><RefreshCw size={14} className={spotlightLoading ? 'animate-spin' : ''} /></Button>
          </div>

          {spotlightLoading ? (
            <SpotlightSkeleton />
          ) : spotlightEmpty ? (
            <div className="py-10 text-center text-muted">无数据</div>
          ) : currentSpotlight ? (
            <div className="space-y-4">
              <Card className="overflow-hidden">
                <div className="flex gap-4 p-4">
                  <div className="shrink-0 cursor-pointer" onClick={() => openSpotlightViewer(selectedSpotlightIndex)}>
                    <img
                      src={currentSpotlight.preview_url || currentSpotlight.image_url}
                      alt={currentSpotlight.title}
                      className="h-[180px] w-[320px] rounded-lg object-cover hover:scale-105 transition-transform"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="font-medium">{currentSpotlight.title || 'Windows 聚焦'}</div>
                    <div className="text-sm text-muted">{currentSpotlight.description}</div>
                    <div className="text-xs text-muted">{selectedSpotlightIndex + 1} / {spotlightGallery.length}</div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onPress={() => handleSetWallpaper(currentSpotlight.image_url, currentSpotlight.title || 'spotlight')}><ImageIcon size={14} /> 设为壁纸</Button>
                      <Button size="sm" variant="secondary" onPress={() => handleFavorite(currentSpotlight)}><Heart size={14} /> 收藏</Button>
                      <Button size="sm" variant="secondary" onPress={() => downloadWithProgress(currentSpotlight.image_url, `${currentSpotlight.title?.slice(0,30) || 'spotlight'}.jpg`)}><Download size={14} /> 下载</Button>
                      <Button size="sm" variant="secondary" onPress={() => saveAsWithProgress(currentSpotlight.image_url, `${currentSpotlight.title?.slice(0,30) || 'spotlight'}.jpg`)}><Save size={14} /> 另存为</Button>
                      <Button size="sm" variant="ghost" onPress={() => copyToClipboard(currentSpotlight.image_url)}><Copy size={14} /> 复制链接</Button>
                      <Button size="sm" variant="ghost" onPress={() => openSpotlightViewer(selectedSpotlightIndex)}><ImageIcon size={14} /> 查看</Button>
                      <Button size="sm" variant="ghost" onPress={() => setSelectedSpotlightIndex(Math.max(0, selectedSpotlightIndex - 1))} isDisabled={selectedSpotlightIndex === 0}><ChevronLeft size={14} /> 上一张</Button>
                      <Button size="sm" variant="ghost" onPress={() => setSelectedSpotlightIndex(Math.min(spotlightGallery.length - 1, selectedSpotlightIndex + 1))} isDisabled={selectedSpotlightIndex >= spotlightGallery.length - 1}>下一张 <ChevronRight size={14} /></Button>
                    </div>
                  </div>
                </div>
              </Card>

              {spotlightGallery.length > 1 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {spotlightGallery.map((item, idx) => (
                    <Button
                      key={item.id || idx}
                      variant="ghost"
                      onPress={() => { setSelectedSpotlightIndex(idx); openSpotlightViewer(idx); }}
                      className={`relative h-auto overflow-hidden rounded-lg p-0 transition-all ${selectedSpotlightIndex === idx ? 'ring-2 ring-primary' : 'opacity-70 hover:opacity-100'}`}
                    >
                      <img
                        src={item.preview_url || item.image_url}
                        alt={item.title}
                        className="h-[80px] w-full object-cover"
                        loading="lazy"
                      />
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </Tabs.Panel>

        <Tabs.Panel id="intellimarkets">
          <div className="space-y-4">
            <Card>
              <Card.Content className="flex flex-col gap-4">
                <div className="flex flex-col lg:flex-row gap-4 lg:items-center">
                  <div className="flex-1">
                    <div className="text-lg font-semibold">IntelliMarkets</div>
                    <div className="text-sm text-muted">浏览 IntelliMarkets 图片源市场中的 APICORE 配置，按参数执行并直接把结果带回壁纸图库。</div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Select
                      className="min-w-[180px]"
                      selectedKey={String((typeof window !== 'undefined' && (window as any).pywebview?.api) ? 'auto' : 'auto')}
                      onSelectionChange={(key) => key && updateImMirrorPreference(String(key))}
                    >
                      <Label>镜像偏好</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {IM_MIRROR_OPTIONS.map((opt) => (
                            <ListBox.Item key={opt.value} id={opt.value} textValue={opt.label}>
                              {opt.label}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <Button variant="secondary" onPress={() => loadIntelligentMarketSources(true)} isDisabled={imLoading}><RefreshCw size={16} /> 刷新</Button>
                  </div>
                </div>
                <div className="flex flex-col md:flex-row gap-3 md:items-center">
                  <SearchField
                    value={imSearch}
                    onChange={setImSearch}
                    className="flex-1"
                  >
                    <Label className="sr-only">搜索</Label>
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder="搜索源名称、分类或简介" />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                  <div className="flex flex-wrap gap-2">
                    <Chip size="sm" color="success">可用 {imHealthSummary.healthy}</Chip>
                    <Chip size="sm" color="danger">不可用 {imHealthSummary.unhealthy}</Chip>
                    <Chip size="sm" color="warning">未知 {imHealthSummary.unknown}</Chip>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="text-sm font-medium text-muted">分类</div>
                  <div className="flex flex-wrap gap-2">
                    <Chip
                      onClick={() => setImCategory(IM_ALL_CATEGORY)}
                      color={imCategory === IM_ALL_CATEGORY ? 'accent' : 'default'}
                      variant={imCategory === IM_ALL_CATEGORY ? 'primary' : 'secondary'}
                      className="cursor-pointer"
                    >全部</Chip>
                    {imCategories.map((category) => {
                      const count = imSources.filter((s) => s.category === category).length;
                      const selected = imCategory === category;
                      return (
                        <Chip
                          key={category}
                          onClick={() => setImCategory(category)}
                          color={selected ? 'accent' : 'default'}
                          variant={selected ? 'primary' : 'secondary'}
                          className="cursor-pointer"
                        >{category} ({count})</Chip>
                      );
                    })}
                  </div>
                </div>
                {imLoading && !imListLoading && <div className="text-sm text-muted">正在同步 IntelliMarkets 图片源列表…</div>}
                {!imLoading && imLoaded && filteredImSources.length === 0 && <div className="text-sm text-muted">没有符合条件的图片源</div>}
              </Card.Content>
            </Card>

            {imListLoading && (
              <Card>
                <Card.Content className="py-14 flex flex-col items-center gap-4">
                  <div className="text-sm text-muted">正在同步 IntelliMarkets 图片源列表…</div>
                </Card.Content>
              </Card>
            )}

            {filteredImSources.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredImSources.map((source) => {
                  const healthColor = getIMHealthColor(source.health_status);
                  const healthLabel = getIMHealthLabel(source.health_status);
                  const selected = selectedImSource?.id === source.id;
                  return (
                    <Card
                      key={source.id}
                      onClick={() => handleSelectImSource(source.id)}
                      className={`cursor-pointer transition-all ${selected ? 'ring-2 ring-primary' : source.health_status === 'unhealthy' ? 'border-danger/40' : ''}`}
                    >
                      <Card.Content className="flex flex-col gap-3">
                        <div className="flex items-center gap-3">
                          {source.icon ? (
                            <img src={source.icon} alt="" className="h-12 w-12 rounded-lg object-cover" />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <ImageIcon size={20} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{source.friendly_name}</div>
                            <div className="text-sm text-muted truncate">{source.category}</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Chip size="sm" color={healthColor}>{healthLabel}</Chip>
                          <Chip size="sm" variant="secondary">{source.method}</Chip>
                          <Chip size="sm" variant="secondary">参数 {source.parameters.filter((p) => p.enabled !== false).length}</Chip>
                        </div>
                        <div className="text-sm text-muted line-clamp-3 min-h-[48px]">{source.intro || '暂无简介'}</div>
                        <div className={`text-xs line-clamp-2 ${source.health_status === 'unhealthy' ? 'text-danger' : 'text-muted'}`}>
                          {source.health_message || '等待预检'}
                        </div>
                      </Card.Content>
                    </Card>
                  );
                })}
              </div>
            )}

            {selectedImSource && (
              <div ref={imDetailRef} className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7">
                  <Card>
                    <Card.Content className="flex flex-col gap-4">
                      <div className="flex flex-col md:flex-row gap-4 md:items-center">
                        <div className="flex-1">
                          <div className="text-lg font-semibold">{selectedImSource.friendly_name}</div>
                          <div className="text-sm text-muted">填写参数后执行，获取该源返回的壁纸结果。</div>
                        </div>
                        <Button onPress={() => runIntelligentMarketQuery()} isDisabled={imExecuting || imLoading}>
                          <SlidersHorizontal size={16} /> 执行
                        </Button>
                      </div>
                      {selectedImSource.parameters.filter((p) => p.enabled !== false).length === 0 ? (
                        <div className="text-sm text-success">这个图片源不需要额外参数，可以直接执行。</div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {selectedImSource.parameters.filter((p) => p.enabled !== false).map((param, index) => {
                            const key = param.key || param.name || `__param_${index}`;
                            const label = getIMParameterLabel(param, index);
                            const type = String(param.type ?? 'string').toLowerCase();
                            if (type === 'boolean') {
                              return (
                                <Card key={key} variant="default">
                                  <Card.Content>
                                    <Switch
                                      isSelected={Boolean(imParameterValues[key])}
                                      onChange={(v) => setImParameterValues((c) => ({ ...c, [key]: v }))}
                                    >
                                      <Switch.Control><Switch.Thumb /></Switch.Control>
                                      <Switch.Content><Label className="text-sm">{label}</Label></Switch.Content>
                                    </Switch>
                                  </Card.Content>
                                </Card>
                              );
                            }
                            if (type === 'enum') {
                              const options = param.options ?? [];
                              return (
                                <Select
                                  key={key}
                                  className="w-full"
                                  selectedKey={String(imParameterValues[key] ?? '')}
                                  onSelectionChange={(keys) => {
                                    const val = keys ? Array.from(keys as unknown as Iterable<string>)[0] : undefined;
                                    setImParameterValues((c) => ({ ...c, [key]: val }));
                                  }}
                                >
                                  <Label>{label}</Label>
                                  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                                  <Select.Popover>
                                    <ListBox>
                                      {options.map((opt, i) => (
                                        <ListBox.Item key={String(opt)} id={String(opt)} textValue={param.friendly_options?.[i] || String(opt)}>
                                          {param.friendly_options?.[i] || String(opt)}
                                          <ListBox.ItemIndicator />
                                        </ListBox.Item>
                                      ))}
                                    </ListBox>
                                  </Select.Popover>
                                </Select>
                              );
                            }
                            return (
                              <Input
                                key={key}
                                aria-label={label}
                                value={String(imParameterValues[key] ?? '')}
                                onChange={(e) => setImParameterValues((c) => ({ ...c, [key]: e.target.value }))}
                                placeholder={label}
                              />
                            );
                          })}
                        </div>
                      )}
                    </Card.Content>
                  </Card>
                </div>
                <div className="lg:col-span-5">
                  <Card>
                    <Card.Content className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        {selectedImSource.icon ? (
                          <img src={selectedImSource.icon} alt="" className="h-14 w-14 rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <ImageIcon size={24} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-lg font-semibold">{selectedImSource.friendly_name}</div>
                          <div className="text-sm text-muted truncate">{selectedImSource.file_path}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Chip size="sm">{selectedImSource.category}</Chip>
                        <Chip size="sm" color={getIMHealthColor(selectedImSource.health_status)}>{getIMHealthLabel(selectedImSource.health_status)}</Chip>
                        <Chip size="sm" variant="secondary">{selectedImSource.method} · APICORE {selectedImSource.api_core_version}</Chip>
                        <Chip size="sm" variant="secondary">参数 {selectedImSource.parameters.filter((p) => p.enabled !== false).length}</Chip>
                      </div>
                      <div className="text-sm text-muted">{selectedImSource.intro || '暂无简介'}</div>
                      <Card variant="secondary">
                        <Card.Content className="flex flex-col gap-1.5">
                          <div className="font-medium text-sm">健康状态</div>
                          <div className={`text-sm ${selectedImSource.health_status === 'unhealthy' ? 'text-danger' : 'text-muted'}`}>
                            {selectedImSource.health_message || '等待预检'}
                          </div>
                          {selectedImSource.health_checked_at && (
                            <div className="text-xs text-muted">检查于 {selectedImSource.health_checked_at}</div>
                          )}
                        </Card.Content>
                      </Card>
                      <Card variant="secondary">
                        <Card.Content className="flex flex-col gap-1">
                          <div className="font-medium text-sm">接口地址</div>
                          <div className="text-sm text-muted break-all">{selectedImSource.link}</div>
                        </Card.Content>
                      </Card>
                      <div className="flex flex-col sm:flex-row gap-2">
                        {selectedImSource.html_url && (
                          <a href={selectedImSource.html_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <LinkIcon size={14} /> 查看配置
                          </a>
                        )}
                        {selectedImSource.raw_url && (
                          <a href={selectedImSource.raw_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <LinkIcon size={14} /> 查看原始配置
                          </a>
                        )}
                      </div>
                    </Card.Content>
                  </Card>
                </div>
              </div>
            )}

            {imGallery.length > 0 && (
              <div className="space-y-3">
                <div className="font-medium">执行结果 ({imGallery.length})</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {imGallery.map((item, idx) => (
                    <Button
                      key={item.id || idx}
                      variant="ghost"
                      onPress={() => openImViewer(idx)}
                      className="relative h-auto overflow-hidden rounded-lg p-0 transition-all opacity-90 hover:opacity-100"
                    >
                      <img
                        src={item.preview_url || item.image_url}
                        alt={item.title}
                        className="h-[100px] w-full object-cover"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <div className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-2 py-1 text-xs text-white">
                        {item.title || `第 ${idx + 1} 张`}
                      </div>
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Tabs.Panel>

        <Tabs.Panel id="sources">
          <div className="text-muted">壁纸源功能需要导入 .ltws 文件。请在设置 {'>'} 内容中管理壁纸源。</div>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
