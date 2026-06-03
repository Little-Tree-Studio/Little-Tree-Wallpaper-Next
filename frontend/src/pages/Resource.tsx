import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Button, Tabs, Spinner, Badge } from '@heroui/react';
import { Image as ImageIcon, Download, Heart, Copy, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import {
  queryBing, querySpotlight, setWallpaper,
  downloadFile, copyToClipboard, addFavorite,
} from '@/api/backend';

const QUALITY_LABELS: Record<string, string> = {
  highDef: '1920×1080',
  ultraHighDef: '3840×2160 (UHD)',
};

export default function Resource() {
  const [activeTab, setActiveTab] = useState('bing');
  const [bingTab, setBingTab] = useState('daily');
  const [spotlightTab, setSpotlightTab] = useState('local');
  const [bingGallery, setBingGallery] = useState<any[]>([]);
  const [spotlightGallery, setSpotlightGallery] = useState<any[]>([]);
  const [bingLoaded, setBingLoaded] = useState(false);
  const [spotlightLoaded, setSpotlightLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedBingIndex, setSelectedBingIndex] = useState(0);
  const [selectedSpotlightIndex, setSelectedSpotlightIndex] = useState(0);
  const mountedRef = useRef(false);

  const fetchBing = useCallback(async (category: string = 'daily') => {
    setLoading(true);
    try {
      const items = await queryBing(category, 'zh-CN', category === 'daily' ? 1 : 12, 'highDef');
      setBingGallery(items || []);
      setBingLoaded(true);
      setSelectedBingIndex(0);
    } catch (e) {
      console.error('Bing load failed', e);
      setBingGallery([]);
      setBingLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSpotlight = useCallback(async (source: string = 'local') => {
    setLoading(true);
    try {
      const items = await querySpotlight(source, 18, 'zh-CN');
      setSpotlightGallery(items || []);
      setSpotlightLoaded(true);
      setSelectedSpotlightIndex(0);
    } catch (e) {
      console.error('Spotlight load failed', e);
      setSpotlightGallery([]);
      setSpotlightLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    fetchBing('daily');
  }, [fetchBing]);

  useEffect(() => {
    if (activeTab === 'bing' && bingTab === 'recent' && !bingLoaded) {
      fetchBing('recent');
    }
    if (activeTab === 'spotlight' && !spotlightLoaded) {
      fetchSpotlight(spotlightTab);
    }
  }, [activeTab, bingTab, spotlightTab, bingLoaded, spotlightLoaded, fetchBing, fetchSpotlight]);

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

  const bingEmpty = bingLoaded && bingGallery.length === 0;
  const spotlightEmpty = spotlightLoaded && spotlightGallery.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">资源</h1>

      <Tabs selectedKey={activeTab} onSelectionChange={(k) => setActiveTab(String(k))}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="资源来源">
            <Tabs.Tab id="bing">Bing 壁纸<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="spotlight">Windows 聚焦<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="sources">壁纸源<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="bing">
          <div className="mb-3 flex items-center gap-2">
            <Button size="sm" variant={bingTab === 'daily' ? 'primary' : 'ghost'} onPress={() => setBingTab('daily')}>每日</Button>
            <Button size="sm" variant={bingTab === 'recent' ? 'primary' : 'ghost'} onPress={() => setBingTab('recent')}>近期</Button>
            <Button size="sm" variant="ghost" onPress={() => fetchBing(bingTab)}><RefreshCw size={14} /></Button>
          </div>

          {loading && !bingLoaded ? (
            <div className="py-10 text-center"><Spinner size="sm" /></div>
          ) : bingEmpty ? (
            <div className="py-10 text-center text-muted">加载失败，请稍后重试</div>
          ) : currentBing ? (
            <div className="space-y-4">
              <Card className="overflow-hidden">
                <div className="flex gap-4 p-4">
                  <div className="relative shrink-0">
                    <img
                      src={currentBing.preview_url || currentBing.image_url}
                      alt={currentBing.title}
                      className="h-[160px] w-[280px] rounded-lg object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    {currentBing.metadata?.quality && (
                      <Badge size="sm" variant="secondary" className="absolute top-2 right-2 max-w-[calc(100%-1rem)] truncate">{QUALITY_LABELS[currentBing.metadata.quality] || currentBing.metadata.quality}</Badge>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 min-w-0">
                    <div className="font-medium">{currentBing.title}</div>
                    <div className="text-sm text-muted">{currentBing.description}</div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onPress={() => handleSetWallpaper(currentBing.image_url, currentBing.title)}><ImageIcon size={14} /> 设为壁纸</Button>
                      <Button size="sm" variant="secondary" onPress={() => handleFavorite(currentBing)}><Heart size={14} /> 收藏</Button>
                      <Button size="sm" variant="secondary" onPress={() => downloadFile(currentBing.image_url, `${currentBing.title?.slice(0,30) || 'bing'}.jpg`)}><Download size={14} /> 下载</Button>
                      <Button size="sm" variant="ghost" onPress={() => copyToClipboard(currentBing.image_url)}><Copy size={14} /> 复制链接</Button>
                    </div>
                  </div>
                </div>
              </Card>

              {bingGallery.length > 1 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {bingGallery.map((item, idx) => (
                    <button
                      key={item.id || idx}
                      onClick={() => setSelectedBingIndex(idx)}
                      className={`relative overflow-hidden rounded-lg transition-all ${selectedBingIndex === idx ? 'ring-2 ring-primary' : 'opacity-70 hover:opacity-100'}`}
                    >
                      <img
                        src={item.preview_url || item.image_url}
                        alt={item.title}
                        className="h-[80px] w-full object-cover"
                        loading="lazy"
                      />
                    </button>
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
            <Button size="sm" variant="ghost" onPress={() => fetchSpotlight(spotlightTab)}><RefreshCw size={14} /></Button>
          </div>

          {loading && !spotlightLoaded ? (
            <div className="py-10 text-center"><Spinner size="sm" /></div>
          ) : spotlightEmpty ? (
            <div className="py-10 text-center text-muted">无数据</div>
          ) : currentSpotlight ? (
            <div className="space-y-4">
              <Card className="overflow-hidden">
                <div className="flex gap-4 p-4">
                  <img
                    src={currentSpotlight.preview_url || currentSpotlight.image_url}
                    alt={currentSpotlight.title}
                    className="h-[180px] w-[320px] rounded-lg object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="flex flex-col gap-2">
                    <div className="font-medium">{currentSpotlight.title || 'Windows 聚焦'}</div>
                    <div className="text-sm text-muted">{currentSpotlight.description}</div>
                    <div className="text-xs text-muted">{selectedSpotlightIndex + 1} / {spotlightGallery.length}</div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onPress={() => handleSetWallpaper(currentSpotlight.image_url, currentSpotlight.title || 'spotlight')}><ImageIcon size={14} /> 设为壁纸</Button>
                      <Button size="sm" variant="secondary" onPress={() => handleFavorite(currentSpotlight)}><Heart size={14} /> 收藏</Button>
                      <Button size="sm" variant="ghost" onPress={() => setSelectedSpotlightIndex(Math.max(0, selectedSpotlightIndex - 1))} isDisabled={selectedSpotlightIndex === 0}><ChevronLeft size={14} /> 上一张</Button>
                      <Button size="sm" variant="ghost" onPress={() => setSelectedSpotlightIndex(Math.min(spotlightGallery.length - 1, selectedSpotlightIndex + 1))} isDisabled={selectedSpotlightIndex >= spotlightGallery.length - 1}>下一张 <ChevronRight size={14} /></Button>
                    </div>
                  </div>
                </div>
              </Card>

              {spotlightGallery.length > 1 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {spotlightGallery.map((item, idx) => (
                    <button
                      key={item.id || idx}
                      onClick={() => setSelectedSpotlightIndex(idx)}
                      className={`relative overflow-hidden rounded-lg transition-all ${selectedSpotlightIndex === idx ? 'ring-2 ring-primary' : 'opacity-70 hover:opacity-100'}`}
                    >
                      <img
                        src={item.preview_url || item.image_url}
                        alt={item.title}
                        className="h-[80px] w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </Tabs.Panel>

        <Tabs.Panel id="sources">
          <div className="text-muted">壁纸源功能需要导入 .ltws 文件。请在设置 {'>'} 内容中管理壁纸源。</div>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
