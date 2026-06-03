import { useState, useEffect, useRef } from 'react';
import { Card, Button, Spinner } from '@heroui/react';
import { RefreshCw, History, ImageIcon, Copy, Heart, FolderOutput, Monitor } from 'lucide-react';
import {
  getCurrentWallpaper, setWallpaper, getHitokoto,
  copyToClipboard, downloadFile, addFavorite,
  recordCurrentWallpaper, bootstrapCached, getBootstrapCache,
} from '@/api/backend';
import type { Hitokoto } from '@/types';

export default function Home() {
  const [wallpaper, setWallpaperInfo] = useState<{ path: string; filename: string; preview_url?: string } | null>(null);
  const [bing, setBing] = useState<any>(null);
  const [hitokoto, setHitokoto] = useState<Hitokoto | null>(null);
  const [wpLoading, setWpLoading] = useState(true);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const cache = getBootstrapCache();
    if (cache) {
      const cw = cache.home?.current_wallpaper;
      if (cw) {
        setWallpaperInfo({ path: cw.path || '', filename: cw.filename || '壁纸', preview_url: cw.preview_url });
      }
      setWpLoading(false);
      const b = cache.home?.bing?.[0];
      if (b) setBing(b);
      const q = cache.home?.quote;
      if (q) {
        setHitokoto({ hitokoto: q.text || '', from: q.source || '', from_who: q.author || '' });
        setQuoteLoading(false);
        return;
      }
    }

    bootstrapCached().then((data) => {
      const cw = data?.home?.current_wallpaper;
      if (cw) {
        setWallpaperInfo({ path: cw.path || '', filename: cw.filename || '壁纸', preview_url: cw.preview_url });
      }
      setWpLoading(false);
      const b = data?.home?.bing?.[0];
      if (b) setBing(b);
      const q = data?.home?.quote;
      if (q) {
        setHitokoto({ hitokoto: q.text || '', from: q.source || '', from_who: q.author || '' });
      }
      setQuoteLoading(false);
    });
  }, []);

  const refreshWallpaper = async () => {
    setWpLoading(true);
    try {
      const wp = await getCurrentWallpaper();
      setWallpaperInfo(wp);
    } finally {
      setWpLoading(false);
    }
  };

  const refreshSentence = async () => {
    setQuoteLoading(true);
    try {
      const h = await getHitokoto();
      setHitokoto(h);
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleSetBing = async () => {
    if (!bing?.image_url) return;
    const path = await downloadFile(bing.image_url, 'bing_today.jpg');
    if (path) {
      await setWallpaper(path);
      await refreshWallpaper();
    }
  };

  const handleExport = async () => {
    if (!wallpaper?.path) return;
    await copyToClipboard(wallpaper.path);
  };

  const handleFavoriteCurrent = async () => {
    if (!wallpaper?.path) return;
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
  };

  const handleRecordCurrent = async () => {
    await recordCurrentWallpaper();
    await refreshWallpaper();
  };

  const previewSrc = wallpaper?.preview_url || '';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">当前壁纸</h1>

      <Card className="overflow-hidden">
        <div className="flex gap-6 p-6">
          <div className="relative h-[200px] w-[320px] shrink-0 overflow-hidden rounded-xl bg-surface-secondary">
            {wpLoading ? (
              <div className="flex h-full items-center justify-center"><Spinner /></div>
            ) : previewSrc ? (
              <img src={previewSrc} alt="当前壁纸" className="h-full w-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted">无法获取壁纸</div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-sm text-muted">
              文件名: <span className="cursor-pointer text-foreground hover:underline" onClick={() => wallpaper?.path && copyToClipboard(wallpaper.path)}>
                {wallpaper?.filename || '未知'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onPress={handleExport}><FolderOutput size={16} /> 复制路径</Button>
              <Button size="sm" variant="secondary" onPress={refreshWallpaper}><RefreshCw size={16} /> 刷新</Button>
              <Button size="sm" variant="secondary" onPress={handleFavoriteCurrent}><Heart size={16} /> 收藏</Button>
              <Button size="sm" variant="secondary" onPress={handleRecordCurrent}><Monitor size={16} /> 记录</Button>
              <Button size="sm" variant="ghost" onPress={() => window.location.hash = '#/history'}><History size={16} /> 历史</Button>
            </div>

            {bing && (
              <div className="mt-2 rounded-lg bg-surface-secondary p-3">
                <div className="text-sm font-medium">Bing 每日壁纸</div>
                <div className="text-xs text-muted">{bing.title}</div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onPress={handleSetBing}><ImageIcon size={14} /> 设为壁纸</Button>
                  <Button size="sm" variant="ghost" onPress={() => copyToClipboard(bing.image_url)}><Copy size={14} /> 复制链接</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <Card.Header><Card.Title>每日语句</Card.Title></Card.Header>
        <Card.Content className="space-y-2">
          {quoteLoading ? (
            <Spinner size="sm" />
          ) : hitokoto?.hitokoto ? (
            <>
              <p className="text-lg leading-relaxed">{hitokoto.hitokoto}</p>
              <p className="text-sm text-muted">
                —— {hitokoto.from_who || '佚名'}
                {hitokoto.from && `《${hitokoto.from}》`}
              </p>
            </>
          ) : (
            <p className="text-muted">加载失败</p>
          )}
          <Button size="sm" variant="ghost" onPress={refreshSentence}><RefreshCw size={14} /> 刷新语句</Button>
        </Card.Content>
      </Card>
    </div>
  );
}
