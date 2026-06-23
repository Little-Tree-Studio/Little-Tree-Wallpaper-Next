import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Button, Tabs, Skeleton, Chip, ComboBox, Input, Label, ListBox,
} from '@heroui/react';
import {
  Image as ImageIcon, Download, Heart, Copy, ChevronLeft, ChevronRight, RefreshCw, Save,
  ExternalLink, SlidersHorizontal,
} from 'lucide-react';
import {
  queryBing, querySpotlight, setWallpaper,
  downloadFile, copyToClipboard, addFavorite,
  downloadWithProgress, saveAsWithProgress, openUrl,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import { logError } from '@/lib/log';
import IntelliMarketsPanel from '@/components/IntelliMarketsPanel';
import WallpaperSourceBrowser from './WallpaperSourceBrowser';

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

function getBingUrlForQuality(item: any, quality: '1080p' | 'uhd'): string {
  const base = item?.image_url || '';
  const qualities = item?.metadata?.available_qualities;
  if (qualities && typeof qualities === 'object') {
    const key = quality === 'uhd' ? 'ultraHighDef' : 'highDef';
    const chosen = qualities[key] || qualities.ultraHighDef || qualities.highDef;
    if (chosen) return chosen;
  }
  return quality === 'uhd' ? base.replace('1920x1080', 'UHD') : base;
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

export default function Resource() {
  const navigate = useNavigate();
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

  const fetchBing = useCallback(async (category: string = 'daily', forceRefresh: boolean = false) => {
    setBingLoading(true);
    setBingGallery([]);
    setSelectedBingIndex(0);
    try {
      const items = await queryBing(category, 'zh-CN', category === 'daily' ? 1 : 12, 'highDef', forceRefresh);
      setBingGallery(items || []);
      setBingLoadedFor(category);
    } catch (e) {
      logError('Bing load failed', e);
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
      logError('Spotlight load failed', e);
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
  }, [activeTab, bingTab, spotlightTab, bingLoadedFor, spotlightLoadedFor, bingLoading, spotlightLoading, fetchBing, fetchSpotlight]);

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
                      <Button size="sm" onPress={() => handleSetWallpaper(getBingUrlForQuality(currentBing, bingQuality), currentBing.title)}><ImageIcon size={14} /> 设为壁纸</Button>
                      <Button size="sm" variant="secondary" onPress={() => handleFavorite(currentBing)}><Heart size={14} /> 收藏</Button>
                      <Button size="sm" variant="secondary" onPress={() => downloadWithProgress(getBingUrlForQuality(currentBing, bingQuality), `${currentBing.title?.slice(0,30) || 'bing'}.jpg`)}><Download size={14} /> 下载</Button>
                      <Button size="sm" variant="secondary" onPress={() => saveAsWithProgress(getBingUrlForQuality(currentBing, bingQuality), `${currentBing.title?.slice(0,30) || 'bing'}.jpg`)}><Save size={14} /> 另存为</Button>
                      <Button size="sm" variant="secondary" onPress={() => {
                        const link = absoluteBingUrl(currentBing.metadata?.click_url);
                        if (link) openUrl(link);
                      }}><ExternalLink size={14} /> 查看详情</Button>
                      <Button size="sm" variant="ghost" onPress={() => copyToClipboard(getBingUrlForQuality(currentBing, bingQuality))}><Copy size={14} /> 复制链接</Button>
                      <Button size="sm" variant="ghost" onPress={() => openBingViewer(selectedBingIndex)}><ImageIcon size={14} /> 查看</Button>
                      {bingGallery.length > 1 && (
                        <>
                          <Button size="sm" variant="ghost" onPress={() => setSelectedBingIndex(Math.max(0, selectedBingIndex - 1))} isDisabled={selectedBingIndex === 0}><ChevronLeft size={14} /> 上一张</Button>
                          <Button size="sm" variant="ghost" onPress={() => setSelectedBingIndex(Math.min(bingGallery.length - 1, selectedBingIndex + 1))} isDisabled={selectedBingIndex >= bingGallery.length - 1}>下一张 <ChevronRight size={14} /></Button>
                        </>
                      )}
                    </div>
                    {(bingTab === 'daily' || bingTab === 'recent') && (
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
                    )}
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
          <div className="h-full">
            <IntelliMarketsPanel />
          </div>
        </Tabs.Panel>

        <Tabs.Panel id="sources">
          <div className="mb-3 flex items-center justify-end">
            <Button size="sm" variant="secondary" onPress={() => navigate('/resource/source-management')}>
              <SlidersHorizontal size={14} /> 管理壁纸源
            </Button>
          </div>
          <WallpaperSourceBrowser />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
