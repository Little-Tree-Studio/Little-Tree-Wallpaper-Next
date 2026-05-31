import { useState, useEffect } from 'react';
import { Card, Button, Tabs, Spinner } from '@heroui/react';
import { Image as ImageIcon, Download, Heart, Copy, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getBingWallpaper, getSpotlightWallpapers, setWallpaper,
  downloadFile, copyToClipboard, addFavorite,
} from '@/api/backend';
import type { BingWallpaper, SpotlightImage } from '@/types';

export default function Resource() {
  const [activeTab, setActiveTab] = useState('bing');
  const [bing, setBing] = useState<BingWallpaper | null>(null);
  const [spotlights, setSpotlights] = useState<SpotlightImage[]>([]);
  const [spotlightIndex, setSpotlightIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'bing') {
      setLoading(true);
      getBingWallpaper().then((b) => { setBing(b); setLoading(false); });
    } else if (activeTab === 'spotlight') {
      setLoading(true);
      getSpotlightWallpapers().then((s) => { setSpotlights(s || []); setLoading(false); });
    }
  }, [activeTab]);

  const handleSetWallpaper = async (url: string, filename: string) => {
    const path = await downloadFile(url, filename);
    if (path) await setWallpaper(path);
  };

  const handleFavorite = async (url: string, title: string) => {
    await addFavorite({
      folder_id: 'default', title, description: '', tags: [],
      preview_url: url, local_path: null,
      source_type: activeTab, source_url: url,
    });
  };

  const currentSpotlight = spotlights[spotlightIndex];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">资源</h1>

      <Tabs selectedKey={activeTab} onSelectionChange={(k) => setActiveTab(String(k))}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="资源来源">
            <Tabs.Tab id="bing">Bing 每日<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="spotlight">Windows 聚焦<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="sources">壁纸源<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="bing">
          {loading ? <div className="py-10"><Spinner size="sm" /></div> : bing ? (
            <Card className="overflow-hidden">
              <div className="flex gap-4 p-4">
                <img src={bing.url} alt={bing.title} className="h-[140px] w-[250px] rounded-lg object-cover" />
                <div className="flex flex-col gap-2">
                  <div className="font-medium">{bing.title}</div>
                  <div className="text-sm text-muted">{bing.copyright}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onPress={() => handleSetWallpaper(bing.url, 'bing_today.jpg')}><ImageIcon size={14} /> 设为壁纸</Button>
                    <Button size="sm" variant="secondary" onPress={() => handleFavorite(bing.url, bing.title)}><Heart size={14} /> 收藏</Button>
                    <Button size="sm" variant="secondary" onPress={() => downloadFile(bing.url, 'bing_today.jpg')}><Download size={14} /> 下载</Button>
                    <Button size="sm" variant="ghost" onPress={() => copyToClipboard(bing.url)}><Copy size={14} /> 复制链接</Button>
                  </div>
                </div>
              </div>
            </Card>
          ) : <div className="text-muted">加载失败</div>}
        </Tabs.Panel>

        <Tabs.Panel id="spotlight">
          {loading ? <div className="py-10"><Spinner size="sm" /></div> : currentSpotlight ? (
            <Card className="overflow-hidden">
              <div className="flex gap-4 p-4">
                <img src={currentSpotlight.url} alt={currentSpotlight.title} className="h-[180px] w-[320px] rounded-lg object-cover" />
                <div className="flex flex-col gap-2">
                  <div className="font-medium">{currentSpotlight.title || 'Windows 聚焦'}</div>
                  <div className="text-sm text-muted">{currentSpotlight.copyright}</div>
                  <div className="text-xs text-muted">{spotlightIndex + 1} / {spotlights.length}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onPress={() => handleSetWallpaper(currentSpotlight.url, `spotlight_${spotlightIndex}.jpg`)}><ImageIcon size={14} /> 设为壁纸</Button>
                    <Button size="sm" variant="secondary" onPress={() => handleFavorite(currentSpotlight.url, currentSpotlight.title || 'Windows 聚焦')}><Heart size={14} /> 收藏</Button>
                    <Button size="sm" variant="ghost" onPress={() => setSpotlightIndex(Math.max(0, spotlightIndex - 1))} isDisabled={spotlightIndex === 0}><ChevronLeft size={14} /> 上一张</Button>
                    <Button size="sm" variant="ghost" onPress={() => setSpotlightIndex(Math.min(spotlights.length - 1, spotlightIndex + 1))} isDisabled={spotlightIndex >= spotlights.length - 1}>下一张 <ChevronRight size={14} /></Button>
                  </div>
                </div>
              </div>
            </Card>
          ) : <div className="text-muted">无数据</div>}
        </Tabs.Panel>

        <Tabs.Panel id="sources">
          <div className="text-muted">壁纸源功能需要导入 .ltws 文件。请在设置 {'>'} 内容中管理壁纸源。</div>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
