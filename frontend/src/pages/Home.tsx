import { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Spinner,
} from '@heroui/react';
import {
  RefreshCw, History, ImageIcon, Copy,
  Heart, FolderOutput,
} from 'lucide-react';
import {
  getCurrentWallpaper, setWallpaper, getBingWallpaper,
  getHitokoto, copyToClipboard, downloadFile, addFavorite,
} from '@/api/backend';
import type { BingWallpaper, Hitokoto } from '@/types';

export default function Home() {
  const [wallpaper, setWallpaperInfo] = useState<{ path: string; filename: string } | null>(null);
  const [bing, setBing] = useState<BingWallpaper | null>(null);
  const [hitokoto, setHitokoto] = useState<Hitokoto | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentenceLoading, setSentenceLoading] = useState(false);

  const refreshWallpaper = useCallback(async () => {
    setLoading(true);
    try {
      const wp = await getCurrentWallpaper();
      setWallpaperInfo(wp);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSentence = useCallback(async () => {
    setSentenceLoading(true);
    try {
      const h = await getHitokoto();
      setHitokoto(h);
    } finally {
      setSentenceLoading(false);
    }
  }, []);

  const refreshBing = useCallback(async () => {
    try {
      const b = await getBingWallpaper();
      setBing(b);
    } catch {}
  }, []);

  useEffect(() => {
    refreshWallpaper();
    refreshBing();
    refreshSentence();
  }, [refreshWallpaper, refreshBing, refreshSentence]);

  const handleSetBing = async () => {
    if (!bing?.url) return;
    const path = await downloadFile(bing.url, 'bing_today.jpg');
    if (path) {
      await setWallpaper(path);
      await refreshWallpaper();
    }
  };

  const handleExport = async () => {
    if (!wallpaper?.path) return;
    // Simplified: copy path to clipboard
    await copyToClipboard(wallpaper.path);
  };

  const handleFavoriteCurrent = async () => {
    if (!wallpaper?.path) return;
    await addFavorite({
      folder_id: 'default',
      title: wallpaper.filename,
      description: '从首页收藏的壁纸',
      tags: [],
      preview_url: `file://${wallpaper.path}`,
      local_path: wallpaper.path,
      source_type: 'system',
      source_url: '',
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">当前壁纸</h1>

      <Card className="overflow-hidden">
        <div className="flex gap-6 p-6">
          <div className="relative h-[200px] w-[320px] shrink-0 overflow-hidden rounded-xl bg-surface-secondary">
            {loading ? (
              <div className="flex h-full items-center justify-center"><Spinner /></div>
            ) : wallpaper?.path ? (
              <img
                src={`file://${wallpaper.path}`}
                alt="当前壁纸"
                className="h-full w-full object-cover"
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
              <Button size="sm" variant="secondary" onPress={handleExport}><FolderOutput size={16} /> 导出</Button>
              <Button size="sm" variant="secondary" onPress={refreshWallpaper}><RefreshCw size={16} /> 刷新</Button>
              <Button size="sm" variant="secondary" onPress={handleFavoriteCurrent}><Heart size={16} /> 收藏</Button>
              <Button size="sm" variant="secondary" onPress={() => window.location.hash = '#/history'}><History size={16} /> 历史</Button>
            </div>
            {bing && (
              <div className="mt-2 rounded-lg bg-surface-secondary p-3">
                <div className="text-sm font-medium">Bing 每日壁纸</div>
                <div className="text-xs text-muted">{bing.title}</div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onPress={handleSetBing}><ImageIcon size={14} /> 设为壁纸</Button>
                  <Button size="sm" variant="ghost" onPress={() => copyToClipboard(bing.url)}><Copy size={14} /> 复制链接</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>每日语句</Card.Title>
        </Card.Header>
        <Card.Content className="space-y-2">
          {sentenceLoading ? (
            <Spinner size="sm" />
          ) : hitokoto ? (
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
