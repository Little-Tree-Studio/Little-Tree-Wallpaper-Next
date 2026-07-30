import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Card, Button, Input, Spinner, Chip, Select, Label, ListBox, Tooltip, Checkbox, toast,
  Toolbar, ButtonGroup, Separator,
} from '@heroui/react';
import {
  Search, ImageIcon, Heart, Download, Copy, Eye, X,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  searchBaiduImages, searchPexelsImages, searchPixivImages, copyToClipboard, addFavorite, getSettings,
  downloadWithProgress, setWallpaperWithProgress, downloadManyWithProgress,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import { logError } from '@/lib/log';
import type { SniffedImage } from '@/types';

interface SearchEngine {
  id: string;
  name: string;
  sourceType: string;
  search: (query: string, index: number, signal?: AbortSignal) => Promise<SniffedImage[]>;
}

const PIXIV_SEARCH_APIS = [
  { id: '1', name: '搜索源1' },
  { id: '2', name: '搜索源2' },
];

const SIZE = 30;

async function fetchBaiduImages(query: string, index: number, signal?: AbortSignal): Promise<SniffedImage[]> {
  const items = await searchBaiduImages(query, index, SIZE, signal);
  return items
    .map((item: any, idx: number) => ({
      id: `baidu-${index}-${idx}`,
      url: item.ori || item.src || item.url || '',
      filename: item.title ? `${item.title}.jpg` : `image-${index}-${idx}.jpg`,
      content_type: '',
    }))
    .filter((img) => img.url);
}

async function fetchPexelsImages(query: string, index: number, signal?: AbortSignal): Promise<SniffedImage[]> {
  return searchPexelsImages(query, Math.floor(index / SIZE) + 1, 24, signal);
}

const engines: SearchEngine[] = [
  {
    id: 'baidu-images',
    name: '百度图片',
    sourceType: 'search',
    search: fetchBaiduImages,
  },
  {
    id: 'pexels',
    name: 'Pexels',
    sourceType: 'builtin.pexels',
    search: fetchPexelsImages,
  },
];

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const requestedSource = searchParams.get('source');
  const [engineId, setEngineId] = useState(
    requestedSource === 'pixiv' || engines.some((item) => item.id === requestedSource)
      ? requestedSource!
      : engines[0].id,
  );
  const [pixivApiId, setPixivApiId] = useState(searchParams.get('api') || '1');
  const [images, setImages] = useState<SniffedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const [index, setIndex] = useState(0);
  const [allowNSFW, setAllowNSFW] = useState(false);
  const searchController = useRef<AbortController | null>(null);
  const searchRequestId = useRef(0);
  const { openViewer } = useImageViewer();

  useEffect(() => {
    getSettings()
      .then((settings) => setAllowNSFW(settings.wallpaper.allow_NSFW))
      .catch((error) => logError('Load search settings failed', error));
    return () => {
      searchRequestId.current += 1;
      searchController.current?.abort();
      searchController.current = null;
    };
  }, []);

  const engine = engines.find((e) => e.id === engineId) || engines[0];
  const isPixiv = engineId === 'pixiv';
  const isPagedPixiv = isPixiv && pixivApiId === '2';
  const sourceType = isPixiv ? 'builtin.pixivel' : engine.sourceType;
  const sourceName = isPixiv ? 'Pixiv' : engine.name;

  const handleSearch = async (nextIndex = 0, queryOverride = query) => {
    const searchTerm = queryOverride.trim();
    if (!searchTerm) return;
    searchController.current?.abort();
    const controller = new AbortController();
    const requestId = ++searchRequestId.current;
    searchController.current = controller;
    setLoading(true);
    setImages([]);
    setSelected(new Set());
    setHasSearched(true);
    try {
      const result = isPixiv
        ? await searchPixivImages(
            searchTerm, Number(pixivApiId), false, allowNSFW ? 2 : 0, 15, Math.floor(nextIndex / SIZE) + 1,
            controller.signal,
          )
        : await engine.search(searchTerm, nextIndex, controller.signal);
      if (controller.signal.aborted || requestId !== searchRequestId.current) return;
      setImages(result);
      setIndex(isPixiv && !isPagedPixiv ? 0 : nextIndex);
    } catch (e) {
      if (controller.signal.aborted || requestId !== searchRequestId.current) return;
      logError('Search failed', e);
      toast.danger('搜索失败', {
        description: e instanceof Error ? e.message : '请稍后重试',
        timeout: 0,
      });
    } finally {
      if (requestId === searchRequestId.current) {
        searchController.current = null;
        setLoading(false);
      }
    }
  };

  const clearSearch = () => {
    searchRequestId.current += 1;
    searchController.current?.abort();
    searchController.current = null;
    setLoading(false);
    setQuery('');
    setImages([]);
    setSelected(new Set());
    setHasSearched(false);
    setIndex(0);
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
    void handleSearch(index - SIZE);
  };

  const nextPage = () => {
    void handleSearch(index + SIZE);
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
      title: i.title || i.filename,
      description: i.author ? `作者：${i.author}` : '',
      source_url: i.source_url || i.url,
      source_page_url: i.source_page_url,
      source_type: sourceType,
      source_name: sourceName,
      preview_url: i.preview_url,
      copyright: sourceName === 'Pexels' ? (i.author ? `摄影：${i.author} / Pexels` : 'Pexels') : undefined,
      tags: isPixiv ? (i.tags || []) : [],
    }));
    openViewer(items, startIndex);
  };

  const handleFavoriteSelected = async () => {
    try {
      for (const img of selectedImages) {
        await addFavorite({
          folder_id: 'default', title: img.title || img.filename, description: img.author ? `作者：${img.author}` : '',
          tags: isPixiv ? ['Pixiv', ...new Set(img.tags || [])] : [],
          preview_url: img.preview_url || img.url, local_path: null,
          source_type: sourceType, source_name: sourceName,
          source_url: img.source_url || img.url,
          source_page_url: img.source_page_url,
        });
      }
      toast.success(`已收藏 ${selectedImages.length} 张图片`, { timeout: 3000 });
      setSelected(new Set());
    } catch (error) {
      logError('Batch favorite failed', error);
      toast.danger('收藏失败', { description: error instanceof Error ? error.message : '请稍后重试', timeout: 0 });
    }
  };

  const handleCopySelectedUrls = async () => {
    const urls = selectedImages.map((i) => i.source_url || i.url).join('\n');
    try {
      await copyToClipboard(urls);
      toast.success(`已复制 ${selectedImages.length} 个链接`, { timeout: 2500 });
    } catch (error) {
      logError('Copy selected URLs failed', error);
      toast.danger('复制链接失败', { timeout: 0 });
    }
  };

  const handleFavoriteOne = async (img: SniffedImage) => {
    try {
      await addFavorite({
        folder_id: 'default', title: img.title || img.filename,
        description: img.author ? `作者：${img.author}` : '',
        tags: isPixiv ? ['Pixiv', ...new Set(img.tags || [])] : [],
        preview_url: img.preview_url || img.url, local_path: null,
        source_type: sourceType, source_name: sourceName,
        source_url: img.source_url || img.url,
        source_page_url: img.source_page_url,
      });
      toast.success('已添加到收藏', { timeout: 2500 });
    } catch (error) {
      logError('Favorite image failed', error);
      toast.danger('收藏失败', { description: error instanceof Error ? error.message : '请稍后重试', timeout: 0 });
    }
  };

  const handleDownloadSelected = () =>
    downloadManyWithProgress(
      selectedImages.map((img) => ({ url: img.url, filename: img.filename }))
    );

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
              onClick={() => { setQuery(tag); void handleSearch(0, tag); }}
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
                if (!id || id === engineId) return;
                searchRequestId.current += 1;
                searchController.current?.abort();
                searchController.current = null;
                setLoading(false);
                setEngineId(id);
                setImages([]);
                setSelected(new Set());
                setHasSearched(false);
                setIndex(0);
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
                  <ListBox.Item id="pixiv" textValue="Pixiv">
                    Pixiv
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
          {isPixiv && (
            <div className="flex flex-col gap-1 sm:w-40">
              <Label className="text-xs text-muted-foreground">搜索 API</Label>
              <Select
                selectedKey={pixivApiId}
                onSelectionChange={(key) => {
                  if (!key) return;
                  setPixivApiId(String(key));
                  setImages([]);
                  setSelected(new Set());
                  setHasSearched(false);
                  setIndex(0);
                }}
                aria-label="Pixiv 搜索 API"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {PIXIV_SEARCH_APIS.map((api) => (
                      <ListBox.Item key={api.id} id={api.id} textValue={api.name}>
                        {api.name}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          )}
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
          <Button onPress={() => void handleSearch()} isPending={loading}><Search size={16} /> 搜索</Button>
          <Button variant="ghost" onPress={clearSearch}>清空</Button>
        </div>
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
                src={img.preview_url || img.url}
                alt={img.filename}
                className="aspect-square w-full object-cover"
                loading="lazy"
                onError={() => removeImage(img.id)}
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

      {(!isPixiv || isPagedPixiv) && !loading && images.length > 0 && (
        <div className="flex items-center justify-center gap-3 py-2">
          <Button variant="ghost" isDisabled={index <= 0} onPress={prev}><ChevronLeft size={16} /> 上一页</Button>
          <span className="text-sm text-muted">第 {Math.floor(index / SIZE) + 1} 页</span>
          <Button variant="ghost" onPress={nextPage}>下一页 <ChevronRight size={16} /></Button>
        </div>
      )}

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
