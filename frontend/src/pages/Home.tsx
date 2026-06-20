import { useState, useEffect, useRef } from 'react';
import { Card, Button, Skeleton } from '@heroui/react';
import { RefreshCw, History, ImageIcon, Copy, Heart, FolderOutput, Monitor, Download, Save } from 'lucide-react';
import {
  getCurrentWallpaper, setWallpaper, getSentence, getBingWallpaper,
  copyToClipboard, addFavorite,
  recordCurrentWallpaper, getBootstrapCache,
  downloadWithProgress, saveAsWithProgress,
  getSettings,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import type { Hitokoto } from '@/types';

export default function Home() {
  const [wallpaper, setWallpaperInfo] = useState<{ path: string; filename: string; preview_url?: string } | null>(null);
  const [bing, setBing] = useState<any>(null);
  const [hitokoto, setHitokoto] = useState<Hitokoto | null>(null);
  const [showAuthor, setShowAuthor] = useState(true);
  const [showSource, setShowSource] = useState(true);
  const [wpLoading, setWpLoading] = useState(true);
  const [bingLoading, setBingLoading] = useState(true);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const mountedRef = useRef(false);
  const { openViewer } = useImageViewer();

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
    }

    getCurrentWallpaper().then((wp) => {
      if (wp) setWallpaperInfo(wp);
      setWpLoading(false);
    }).catch(() => setWpLoading(false));

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
    }).catch(() => { /* ignore */ });
  }, []);

  // Auto-refresh current wallpaper every 30 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const wp = await getCurrentWallpaper();
        setWallpaperInfo(wp);
      } catch {
        // ignore auto-refresh errors
      }
    }, 30000);
    return () => clearInterval(interval);
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
      const h = await getSentence();
      if (h) setHitokoto(h);
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleSetBing = async () => {
    if (!bing?.image_url) return;
    const path = await downloadWithProgress(bing.image_url, 'bing_today.jpg');
    if (path) {
      await setWallpaper(path);
      await refreshWallpaper();
    }
  };

  const handleDownloadBing = async () => {
    if (!bing?.image_url) return;
    const safeName = (bing.title || 'bing').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
    await downloadWithProgress(bing.image_url, `${safeName}.jpg`);
  };

  const handleSaveAsBing = async () => {
    if (!bing?.image_url) return;
    const safeName = (bing.title || 'bing').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
    await saveAsWithProgress(bing.image_url, `${safeName}.jpg`);
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
    if (!bing?.image_url) return;
    openViewer([{
      src: bing.image_url,
      title: bing.title || 'Bing 每日壁纸',
      description: bing.description || '',
      source_url: bing.image_url,
      preview_url: bing.preview_url || bing.image_url,
      source_type: 'bing',
    }], 0, { disableSetWallpaper: true });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">当前壁纸</h1>

      <Card className="overflow-hidden">
        <div className="flex gap-6 p-6">
          <div
            className="relative h-[200px] w-[320px] shrink-0 overflow-hidden rounded-xl bg-surface-secondary cursor-pointer"
            onClick={handleOpenCurrentViewer}
          >
            {wpLoading ? (
              <Skeleton className="h-full w-full rounded-xl" />
            ) : previewSrc ? (
              <img src={previewSrc} alt="当前壁纸" className="h-full w-full object-cover hover:scale-105 transition-transform"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted">无法获取壁纸</div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-sm text-muted">
              {wpLoading ? (
                <Skeleton className="h-4 w-48 rounded" />
              ) : (
                <>文件名: <span className="cursor-pointer text-foreground hover:underline" onClick={() => wallpaper?.path && copyToClipboard(wallpaper.path)}>
                  {wallpaper?.filename || '未知'}
                </span></>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onPress={handleExport}><FolderOutput size={16} /> 复制路径</Button>
              <Button size="sm" variant="secondary" onPress={refreshWallpaper}><RefreshCw size={16} /> 刷新</Button>
              <Button size="sm" variant="secondary" onPress={handleFavoriteCurrent}><Heart size={16} /> 收藏</Button>
              <Button size="sm" variant="secondary" onPress={handleRecordCurrent}><Monitor size={16} /> 记录</Button>
              <Button size="sm" variant="ghost" onPress={() => window.location.hash = '#/history'}><History size={16} /> 历史</Button>
            </div>

            {bingLoading ? (
              <div className="mt-2 rounded-lg bg-surface-secondary p-3 space-y-2">
                <Skeleton className="h-4 w-3/5 rounded" />
                <Skeleton className="h-3 w-full rounded" />
                <div className="mt-2 flex gap-2">
                  <Skeleton className="h-8 w-20 rounded" />
                  <Skeleton className="h-8 w-20 rounded" />
                  <Skeleton className="h-8 w-24 rounded" />
                </div>
              </div>
            ) : bing && (
              <div className="mt-2 rounded-lg bg-surface-secondary p-3">
                <div className="text-sm font-medium cursor-pointer hover:underline" onClick={handleOpenBingViewer}>{bing.title}</div>
                <div className="text-xs text-muted">{bing.description}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onPress={handleSetBing}><ImageIcon size={14} /> 设为壁纸</Button>
                  <Button size="sm" variant="secondary" onPress={handleOpenBingViewer}><ImageIcon size={14} /> 查看</Button>
                  <Button size="sm" variant="secondary" onPress={handleDownloadBing}><Download size={14} /> 下载</Button>
                  <Button size="sm" variant="secondary" onPress={handleSaveAsBing}><Save size={14} /> 另存为</Button>
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
          <Button size="sm" variant="ghost" onPress={refreshSentence}><RefreshCw size={14} /> 刷新语句</Button>
        </Card.Content>
      </Card>
    </div>
  );
}
