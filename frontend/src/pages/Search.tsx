import { useState } from 'react';
import { Card, Button, Input, Spinner, Chip, Select, Label, ListBox, Tooltip } from '@heroui/react';
import {
  Search, ImageIcon, Heart, Download, Copy, CheckSquare, Square, Eye,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { searchBaiduImages, setWallpaper, downloadFile, copyToClipboard, addFavorite } from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import type { SniffedImage } from '@/types';

interface SearchEngine {
  id: string;
  name: string;
  search: (query: string, index: number) => Promise<SniffedImage[]>;
}

const SIZE = 30;

async function fetchBaiduImages(query: string, index: number): Promise<SniffedImage[]> {
  const items = await searchBaiduImages(query, index, SIZE);
  return items
    .map((item: any, idx: number) => ({
      id: `baidu-${index}-${idx}`,
      url: item.ori || item.src || item.url || '',
      filename: item.title ? `${item.title}.jpg` : `image-${index}-${idx}.jpg`,
      content_type: '',
    }))
    .filter((img) => img.url);
}

const engines: SearchEngine[] = [
  {
    id: 'baidu-images',
    name: '百度图片',
    search: fetchBaiduImages,
  },
];

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [engineId, setEngineId] = useState(engines[0].id);
  const [images, setImages] = useState<SniffedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const [index, setIndex] = useState(0);
  const { openViewer } = useImageViewer();

  const engine = engines.find((e) => e.id === engineId) || engines[0];

  const handleSearch = async (nextIndex = 0) => {
    if (!query.trim()) return;
    setLoading(true);
    setImages([]);
    setSelected(new Set());
    setHasSearched(true);
    try {
      const result = await engine.search(query.trim(), nextIndex);
      setImages(result);
      setIndex(nextIndex);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const prev = () => {
    if (index <= 0) return;
    handleSearch(index - SIZE);
  };

  const nextPage = () => {
    handleSearch(index + SIZE);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectedImages = images.filter((img) => selected.has(img.id));

  const handleSetWallpaper = async (img: SniffedImage) => {
    const path = await downloadFile(img.url, img.filename);
    if (path) await setWallpaper(path);
  };

  const handleView = (startIndex: number) => {
    const items = images.map((i) => ({
      src: i.url,
      title: i.filename,
      source_url: i.url,
      source_type: 'search',
    }));
    openViewer(items, startIndex);
  };

  const handleFavoriteSelected = async () => {
    for (const img of selectedImages) {
      await addFavorite({
        folder_id: 'default', title: img.filename, description: '', tags: [engine.name, query],
        preview_url: img.url, local_path: null,
        source_type: 'search', source_url: img.url,
      });
    }
    setSelected(new Set());
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">搜索</h1>
      <p className="text-sm text-muted">从多个搜索引擎查找图片</p>

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">热门搜索：</span>
          {['风景', '动漫', '星空', '极简', '萌宠', '汽车'].map((tag) => (
            <Chip
              key={tag}
              className="cursor-pointer"
              onClick={() => { setQuery(tag); handleSearch(0); }}
            >
              {tag}
            </Chip>
          ))}
        </div>

        <div className="flex flex-col gap-1 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1 sm:w-40">
            <Label className="text-xs text-muted-foreground">搜索引擎</Label>
            <Select
              selectedKey={engineId}
              onSelectionChange={(key) => {
                const id = String(key || '');
                if (id) setEngineId(id);
              }}
              aria-label="搜索引擎"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {engines.map((e) => (
                    <ListBox.Item key={e.id} id={e.id} textValue={e.name}>
                      {e.name}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label className="text-xs text-muted-foreground">搜索内容</Label>
            <Input
              placeholder="输入搜索内容..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              fullWidth
            />
          </div>
          <Button onPress={() => handleSearch()} isPending={loading}><Search size={16} /> 搜索</Button>
          <Button variant="ghost" onPress={() => { setQuery(''); setImages([]); setSelected(new Set()); setHasSearched(false); setIndex(0); }}>清空</Button>
        </div>
      </div>

      {selected.size > 0 && (
        <Card className="p-3">
          <div className="flex items-center gap-4">
            <Chip className="shrink-0 whitespace-nowrap">已选择 {selected.size} 张</Chip>
            <Button size="sm" variant="secondary" onPress={handleFavoriteSelected}><Heart size={14} /> 批量收藏</Button>
            <Button size="sm" variant="ghost" onPress={() => {
              const urls = selectedImages.map((i) => i.url).join('\n');
              copyToClipboard(urls);
            }}><Copy size={14} /> 复制链接</Button>
          </div>
        </Card>
      )}

      {loading && <div className="flex justify-center py-10"><Spinner size="sm" /></div>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {images.map((img, idx) => {
          const isSel = selected.has(img.id);
          return (
            <div
              key={img.id}
              className={`group relative cursor-pointer overflow-hidden rounded-xl border-2 transition-all ${isSel ? 'border-primary' : 'border-transparent'}`}
              onClick={() => toggleSelect(img.id)}
            >
              <img
                src={img.url}
                alt={img.filename}
                className="aspect-square w-full object-cover"
                loading="lazy"
                onError={() => removeImage(img.id)}
              />
              <div className="absolute top-2 left-2 flex h-5 w-5 items-center justify-center rounded-sm bg-white/30 backdrop-blur-sm">
                {isSel ? <CheckSquare className="text-white drop-shadow" size={14} /> : <Square className="text-white drop-shadow" size={14} />}
              </div>
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
                    <Button isIconOnly size="sm" variant="tertiary" className="h-7 w-7 min-w-0 px-0" onPress={() => addFavorite({ folder_id: 'default', title: img.filename, description: '', tags: [engine.name, query], preview_url: img.url, local_path: null, source_type: 'search', source_url: img.url })} aria-label="收藏"><Heart size={14} /></Button>
                    <Tooltip.Content><p>收藏</p></Tooltip.Content>
                  </Tooltip>
                </span>
                <span onClick={(e) => { e.stopPropagation(); }}>
                  <Tooltip delay={0}>
                    <Button isIconOnly size="sm" variant="tertiary" className="h-7 w-7 min-w-0 px-0" onPress={() => downloadFile(img.url, img.filename)} aria-label="下载"><Download size={14} /></Button>
                    <Tooltip.Content><p>下载</p></Tooltip.Content>
                  </Tooltip>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {!loading && images.length > 0 && (
        <div className="flex items-center justify-center gap-3 py-2">
          <Button variant="ghost" isDisabled={index <= 0} onPress={prev}><ChevronLeft size={16} /> 上一页</Button>
          <span className="text-sm text-muted">第 {Math.floor(index / SIZE) + 1} 页</span>
          <Button variant="ghost" onPress={nextPage}>下一页 <ChevronRight size={16} /></Button>
        </div>
      )}

      {!loading && images.length === 0 && hasSearched && (
        <div className="py-10 text-center text-muted">未找到图片</div>
      )}
    </div>
  );
}
