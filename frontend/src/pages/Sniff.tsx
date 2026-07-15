import { useState } from 'react';
import {
  Card, Button, Input, Spinner, Tooltip, Checkbox, toast,
  Toolbar, ButtonGroup, Separator,
} from '@heroui/react';
import {
  Search, ImageIcon, Heart, Download, Copy, Eye, X,
} from 'lucide-react';
import {
  sniffImages, copyToClipboard, addFavorite,
  downloadWithProgress, setWallpaperWithProgress, downloadManyWithProgress,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import { logError } from '@/lib/log';
import type { SniffedImage } from '@/types';

export default function Sniff() {
  const [url, setUrl] = useState('');
  const [images, setImages] = useState<SniffedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const { openViewer } = useImageViewer();

  const handleSniff = async () => {
    if (!url.trim()) return;
    let target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      target = 'http://' + target;
    }
    setLoading(true);
    setSelected(new Set());
    setHasSearched(true);
    try {
      const result = await sniffImages(target);
      setImages(result);
      if (result.length > 0) {
        toast.success(`已提取 ${result.length} 张图片`, { timeout: 2500 });
      }
    } catch (error) {
      logError('Sniff failed', error);
      toast.danger('嗅探失败', {
        description: error instanceof Error ? error.message : '请检查网址后重试',
        timeout: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectedImages = images.filter((img) => selected.has(img.id));
  const allSelected = images.length > 0 && selected.size === images.length;
  const someSelected = selected.size > 0 && selected.size < images.length;

  const sourceUrl = (image: SniffedImage) => image.source_url || image.url;
  const sourcePageUrl = (image: SniffedImage) => image.source_page_url || image.referer || '';

  const toggleSelectAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(images.map((i) => i.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const handleSetWallpaper = (img: SniffedImage) =>
    setWallpaperWithProgress(img.url, img.filename);

  const handleView = (startIndex: number) => {
    const items = images.map((i) => ({
      src: i.url,
      title: i.filename,
      preview_url: i.url,
      source_url: sourceUrl(i),
      source_type: 'sniff',
      source_name: '网页嗅探',
    }));
    openViewer(items, startIndex);
  };

  const handleFavoriteSelected = async () => {
    try {
      for (const img of selectedImages) {
        await addFavorite({
          folder_id: 'default', title: img.filename, description: '', tags: [],
          preview_url: img.url, local_path: null,
          source_type: 'sniff', source_url: sourceUrl(img), source_page_url: sourcePageUrl(img),
        });
      }
      toast.success(`已收藏 ${selectedImages.length} 张图片`, { timeout: 3000 });
      setSelected(new Set());
    } catch (error) {
      logError('Batch sniff favorite failed', error);
      toast.danger('收藏失败', { description: error instanceof Error ? error.message : '请稍后重试', timeout: 0 });
    }
  };

  const handleCopySelectedUrls = async () => {
    const urls = selectedImages.map((i) => sourceUrl(i)).join('\n');
    try {
      await copyToClipboard(urls);
      toast.success(`已复制 ${selectedImages.length} 个链接`, { timeout: 2500 });
    } catch (error) {
      logError('Copy sniff URLs failed', error);
      toast.danger('复制链接失败', { timeout: 0 });
    }
  };

  const handleFavoriteOne = async (img: SniffedImage) => {
    try {
        await addFavorite({
          folder_id: 'default', title: img.filename, description: '', tags: [],
          preview_url: img.url, local_path: null,
          source_type: 'sniff', source_url: sourceUrl(img), source_page_url: sourcePageUrl(img),
        });
      toast.success('已添加到收藏', { timeout: 2500 });
    } catch (error) {
      logError('Favorite sniffed image failed', error);
      toast.danger('收藏失败', { description: error instanceof Error ? error.message : '请稍后重试', timeout: 0 });
    }
  };

  const handleDownloadSelected = () =>
    downloadManyWithProgress(
      selectedImages.map((img) => ({ url: img.url, filename: img.filename })),
      { concurrency: 3 }
    );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">嗅探</h1>
      <p className="text-sm text-muted">从网页中提取图片</p>

      <div className="flex gap-2">
        <Input
          placeholder="输入 URL..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSniff()}
          fullWidth
        />
        <Button onPress={handleSniff} isPending={loading}><Search size={16} /> 开始嗅探</Button>
        <Button variant="ghost" onPress={() => { setUrl(''); setImages([]); setSelected(new Set()); setHasSearched(false); }}>清空</Button>
      </div>

      {loading && <div className="flex justify-center py-10"><Spinner size="sm" /></div>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {images.map((img, idx) => {
          const isSel = selected.has(img.id);
          return (
            <Card
              key={img.id}
              className="group relative cursor-pointer overflow-hidden rounded-md p-0"
              onClick={() => toggleSelect(img.id)}
            >
              <div className="absolute top-2 left-2 z-10">
                <Checkbox isSelected={isSel} onChange={() => toggleSelect(img.id)} aria-label={`选择 ${img.filename}`}>
                  <Checkbox.Content>
                    <Checkbox.Control className="size-5 bg-surface shadow-sm">
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                  </Checkbox.Content>
                </Checkbox>
              </div>
              <img
                src={img.url}
                alt={img.filename}
                className="aspect-square w-full object-cover"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; }}
              />
              <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                <span onClick={(e) => { e.stopPropagation(); }}>
                  <Tooltip delay={0}>
                    <Button isIconOnly size="sm" variant="tertiary" className="h-7 w-7 min-w-0 px-0" onPress={() => handleView(idx)} aria-label="查看"><Eye size={14} /></Button>
                    <Tooltip.Content><p>查看</p></Tooltip.Content>
                  </Tooltip>
                </span>
                <span onClick={(e) => { e.stopPropagation(); }}>
                  <Tooltip delay={0}>
                    <Button isIconOnly size="sm" variant="tertiary" className="h-7 w-7 min-w-0 px-0" onPress={() => handleSetWallpaper(img)} aria-label="设为壁纸"><ImageIcon size={14} /></Button>
                    <Tooltip.Content><p>设为壁纸</p></Tooltip.Content>
                  </Tooltip>
                </span>
                <span onClick={(e) => { e.stopPropagation(); }}>
                  <Tooltip delay={0}>
                    <Button isIconOnly size="sm" variant="tertiary" className="h-7 w-7 min-w-0 px-0" onPress={() => handleFavoriteOne(img)} aria-label="收藏"><Heart size={14} /></Button>
                    <Tooltip.Content><p>收藏</p></Tooltip.Content>
                  </Tooltip>
                </span>
                <span onClick={(e) => { e.stopPropagation(); }}>
                  <Tooltip delay={0}>
                    <Button isIconOnly size="sm" variant="tertiary" className="h-7 w-7 min-w-0 px-0" onPress={() => downloadWithProgress(img.url, img.filename)} aria-label="下载"><Download size={14} /></Button>
                    <Tooltip.Content><p>下载</p></Tooltip.Content>
                  </Tooltip>
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      {!loading && images.length === 0 && hasSearched && (
        <div className="py-10 text-center text-muted">未找到图片</div>
      )}

      {selected.size > 0 && (
        <Toolbar
          isAttached
          aria-label="批量操作"
          className="fixed bottom-16 left-1/2 z-[100] -translate-x-1/2 flex-wrap shadow-lg"
        >
          <ButtonGroup variant="tertiary">
            <Checkbox isSelected={allSelected} isIndeterminate={someSelected} onChange={toggleSelectAll} aria-label={allSelected ? '取消全选' : '全选'}>
              <Checkbox.Content>
                <Checkbox.Control className="size-5 ml-2">
                  <Checkbox.Indicator />
                </Checkbox.Control>
              </Checkbox.Content>
            </Checkbox>
            <Button size="sm" variant="ghost" isDisabled className="text-muted">
              已选 {selected.size} / {images.length}
            </Button>
          </ButtonGroup>
          <Separator orientation="vertical" />
          <ButtonGroup variant="tertiary">
            <Button size="sm" variant="secondary" onPress={handleFavoriteSelected}>
              <Heart size={14} /> 收藏
            </Button>
            <Button size="sm" variant="secondary" onPress={handleCopySelectedUrls}>
              <Copy size={14} /> 复制链接
            </Button>
            <Button size="sm" variant="secondary" onPress={handleDownloadSelected}>
              <Download size={14} /> 下载
            </Button>
          </ButtonGroup>
          <Separator orientation="vertical" />
          <ButtonGroup variant="tertiary">
            <Button size="sm" variant="ghost" onPress={clearSelection}>
              <X size={14} /> 清空
            </Button>
          </ButtonGroup>
        </Toolbar>
      )}
    </div>
  );
}
