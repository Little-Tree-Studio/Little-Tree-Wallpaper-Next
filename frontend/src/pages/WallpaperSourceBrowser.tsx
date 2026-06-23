import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Card, Button, ComboBox, Input, Label, ListBox, Switch, TextField, Spinner, TagGroup, Tag, Description,
} from '@heroui/react';
import {
  Image as ImageIcon, Heart, Copy, Play,
} from 'lucide-react';
import {
  getWallpaperSources, executeWallpaperSource,
  downloadFile, setWallpaper, addFavorite, copyToClipboard, localPreviewUrl,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import { logError } from '@/lib/log';
import type { WallpaperSource, WallpaperSourceApiParameter } from '@/api/backend';

function getSourceParameterDefaultValue(param: WallpaperSourceApiParameter): string | boolean {
  const type = String(param.type ?? 'text').toLowerCase();
  if (type === 'boolean') return Boolean(param.default);
  if (type === 'list') {
    if (Array.isArray(param.default)) return param.default.map((item) => String(item)).join('\n');
    return String(param.default ?? '');
  }
  return String(param.default ?? '');
}

function normalizeSourceParameterValue(param: WallpaperSourceApiParameter, value: unknown): unknown {
  const type = String(param.type ?? 'text').toLowerCase();
  if (type === 'boolean') return Boolean(value);
  if (type === 'list') {
    return String(value ?? '').split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
  }
  if (type === 'number') {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw;
  }
  return value;
}

interface CategoryNode {
  name: string;
  subcategories: {
    name: string;
    subsubcategories: string[];
  }[];
}

function aggregateCategories(sources: WallpaperSource[]): CategoryNode[] {
  const root = new Map<string, Map<string, Set<string>>>();
  let hasUncategorized = false;

  for (const source of sources) {
    const cats = source.categories;
    if (!cats || cats.length === 0) {
      hasUncategorized = true;
      continue;
    }
    for (const c of cats) {
      const category = c.category || '未分类';
      const subMap = root.get(category) ?? new Map<string, Set<string>>();
      root.set(category, subMap);
      const subcategory = c.subcategory || '';
      if (!subcategory) continue;
      const ssSet = subMap.get(subcategory) ?? new Set<string>();
      subMap.set(subcategory, ssSet);
      const subsubcategory = c.subsubcategory || '';
      if (subsubcategory) ssSet.add(subsubcategory);
    }
  }

  const nodes: CategoryNode[] = Array.from(root.entries()).map(([name, subMap]) => ({
    name,
    subcategories: Array.from(subMap.entries()).map(([subName, ssSet]) => ({
      name: subName,
      subsubcategories: Array.from(ssSet),
    })),
  }));

  if (hasUncategorized) {
    nodes.unshift({ name: '未分类', subcategories: [] });
  }

  return nodes;
}

function sourceMatchesCategory(
  source: WallpaperSource,
  category?: string,
  subcategory?: string,
  subsubcategory?: string,
): boolean {
  if (!category) return true;
  if (category === '未分类') return !source.categories || source.categories.length === 0;
  const cats = source.categories ?? [];
  return cats.some((c) => {
    if ((c.category || '未分类') !== category) return false;
    if (subcategory && (c.subcategory || '') !== subcategory) return false;
    if (subsubcategory && (c.subsubcategory || '') !== subsubcategory) return false;
    return true;
  });
}

function normalizeLocalImage(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('/api/preview?') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  if (url.startsWith('/api/preview')) return url;
  if (url.startsWith('file://')) return localPreviewUrl(decodeURIComponent(url.slice(7)));
  if (/^[a-zA-Z]:\\|^\//.test(url)) return localPreviewUrl(url);
  return url;
}

const MIN_PANEL_HEIGHT = 180;

export default function WallpaperSourceBrowser() {
  const [sources, setSources] = useState<WallpaperSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubcategory, setSelectedSubcategory] = useState('');
  const [selectedSubsubcategory, setSelectedSubsubcategory] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedApiName, setSelectedApiName] = useState('');
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({});
  const [results, setResults] = useState<any[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [panelHeight, setPanelHeight] = useState(260);
  const containerRef = useRef<HTMLDivElement>(null);
  const { openViewer } = useImageViewer();

  const categories = useMemo(() => aggregateCategories(sources), [sources]);

  const currentCategory = useMemo(
    () => categories.find((c) => c.name === selectedCategory),
    [categories, selectedCategory],
  );

  const currentSubcategory = useMemo(
    () => currentCategory?.subcategories.find((s) => s.name === selectedSubcategory),
    [currentCategory, selectedSubcategory],
  );

  const filteredSources = useMemo(
    () => sources.filter((s) => sourceMatchesCategory(s, selectedCategory || undefined, selectedSubcategory || undefined, selectedSubsubcategory || undefined)),
    [sources, selectedCategory, selectedSubcategory, selectedSubsubcategory],
  );

  const selectedSource = useMemo(
    () => sources.find((s) => s.identifier === selectedSourceId),
    [sources, selectedSourceId],
  );

  const selectedApi = useMemo(
    () => selectedSource?.apis?.find((a) => a.name === selectedApiName),
    [selectedSource, selectedApiName],
  );

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getWallpaperSources();
      setSources(list);
    } catch (e) {
      logError('Failed to load wallpaper sources', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  useEffect(() => {
    if (categories.length === 0) {
      setSelectedCategory('');
      return;
    }
    if (!selectedCategory || !categories.some((c) => c.name === selectedCategory)) {
      setSelectedCategory(categories[0].name);
      setSelectedSubcategory('');
      setSelectedSubsubcategory('');
    }
  }, [categories, selectedCategory]);

  useEffect(() => {
    if (filteredSources.length === 0) {
      setSelectedSourceId('');
      return;
    }
    if (!selectedSourceId || !filteredSources.some((s) => s.identifier === selectedSourceId)) {
      setSelectedSourceId(filteredSources[0].identifier);
    }
  }, [filteredSources, selectedSourceId]);

  useEffect(() => {
    const source = sources.find((s) => s.identifier === selectedSourceId);
    if (!source) {
      setSelectedApiName('');
      setParameterValues({});
      return;
    }
    const api = source.apis?.find((a) => a.name === selectedApiName) ?? source.apis?.[0];
    if (api) {
      if (selectedApiName !== api.name) setSelectedApiName(api.name);
      setParameterValues((prev) => {
        const next: Record<string, unknown> = {};
        api.parameters?.forEach((param, i) => {
          const key = param.key || `__param_${i}`;
          next[key] = key in prev ? prev[key] : getSourceParameterDefaultValue(param);
        });
        return next;
      });
    } else {
      setSelectedApiName('');
      setParameterValues({});
    }
  }, [selectedSourceId, sources, selectedApiName]);

  const handleExecute = useCallback(async () => {
    if (!selectedSourceId || !selectedApiName) return;
    const source = sources.find((s) => s.identifier === selectedSourceId);
    const api = source?.apis?.find((a) => a.name === selectedApiName);
    if (!api) return;
    setResultsLoading(true);
    setResults([]);
    try {
      const payload: Record<string, unknown> = {};
      api.parameters?.forEach((param, i) => {
        const key = param.key || `__param_${i}`;
        payload[key] = normalizeSourceParameterValue(param, parameterValues[key]);
      });
      const items = await executeWallpaperSource(selectedSourceId, selectedApiName, payload);
      setResults(items || []);
    } catch (e) {
      logError('Execute source failed', e);
    } finally {
      setResultsLoading(false);
    }
  }, [selectedSourceId, selectedApiName, sources, parameterValues]);

  const handleSetWallpaper = useCallback(async (url: string, title: string) => {
    const safeName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || 'wallpaper';
    const path = await downloadFile(url, `${safeName}.jpg`);
    if (path) await setWallpaper(path);
  }, []);

  const handleFavorite = useCallback(async (item: any) => {
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
  }, []);

  const openResultViewer = useCallback((startIndex = 0) => {
    openViewer(results.map((item) => {
      const imageUrl = normalizeLocalImage(item.image_url);
      const previewUrl = normalizeLocalImage(item.preview_url || imageUrl);
      return {
        src: imageUrl,
        title: item.title || '壁纸',
        description: item.description || '',
        source_url: imageUrl,
        preview_url: previewUrl,
        source_type: item.source_id || 'source',
        copyright: item.copyright || '',
      };
    }), startIndex);
  }, [results, openViewer]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startHeight = panelHeight;

    const onMove = (ev: PointerEvent) => {
      const maxHeight = containerRef.current?.clientHeight ?? window.innerHeight;
      const delta = startY - ev.clientY;
      setPanelHeight(Math.max(MIN_PANEL_HEIGHT, Math.min(maxHeight, startHeight + delta)));
    };

    const onUp = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  }, [panelHeight]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2">
        <Spinner size="sm" />
        <span className="text-sm text-muted">加载壁纸源...</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-[calc(100vh-12rem)] min-h-[480px] flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 pb-4">
          {categories.length > 0 && (
            <div className="space-y-2 pl-1">
              <TagGroup
                selectionMode="single"
                selectedKeys={new Set(selectedCategory ? [selectedCategory] : [])}
                onSelectionChange={(keys) => {
                  const arr = Array.from(keys);
                  setSelectedCategory(String(arr[0] || ''));
                  setSelectedSubcategory('');
                  setSelectedSubsubcategory('');
                }}
              >
                <TagGroup.List>
                  {categories.map((c) => (
                    <Tag key={c.name} id={c.name} textValue={c.name}>
                      {c.name}
                    </Tag>
                  ))}
                </TagGroup.List>
              </TagGroup>

              {currentCategory && currentCategory.subcategories.length > 0 && (
                <TagGroup
                  selectionMode="single"
                  selectedKeys={new Set(selectedSubcategory ? [selectedSubcategory] : [])}
                  onSelectionChange={(keys) => {
                    const arr = Array.from(keys);
                    setSelectedSubcategory(String(arr[0] || ''));
                    setSelectedSubsubcategory('');
                  }}
                >
                  <TagGroup.List>
                    {currentCategory.subcategories.map((s) => (
                      <Tag key={s.name} id={s.name} textValue={s.name}>
                        {s.name}
                      </Tag>
                    ))}
                  </TagGroup.List>
                </TagGroup>
              )}

              {currentSubcategory && currentSubcategory.subsubcategories.length > 0 && (
                <TagGroup
                  selectionMode="single"
                  selectedKeys={new Set(selectedSubsubcategory ? [selectedSubsubcategory] : [])}
                  onSelectionChange={(keys) => {
                    const arr = Array.from(keys);
                    setSelectedSubsubcategory(String(arr[0] || ''));
                  }}
                >
                  <TagGroup.List>
                    {currentSubcategory.subsubcategories.map((ss) => (
                      <Tag key={ss} id={ss} textValue={ss}>
                        {ss}
                      </Tag>
                    ))}
                  </TagGroup.List>
                </TagGroup>
              )}
            </div>
          )}

          {filteredSources.length === 0 ? (
            <div className="py-6 text-center text-muted">该分类下暂无壁纸源</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 px-1 sm:grid-cols-3 md:grid-cols-4">
              {filteredSources.map((s) => (
                <Card
                  key={s.identifier}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedSourceId(s.identifier)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedSourceId(s.identifier);
                    }
                  }}
                  className={`space-y-2 p-3 transition-colors ${
                    selectedSourceId === s.identifier
                      ? 'ring-2 ring-primary bg-surface'
                      : 'hover:bg-surface'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {s.logo && (
                      <img src={s.logo} alt="" className="h-8 w-8 rounded object-cover" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.name}</div>
                    </div>
                  </div>
                  {s.description && (
                    <div className="text-xs text-muted">{s.description}</div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        className="z-10 flex shrink-0 flex-col rounded-t-2xl border-t border-border bg-surface shadow-lg"
        style={{ height: panelHeight }}
      >
        <div
          className="flex shrink-0 cursor-ns-resize touch-none items-center justify-center py-2"
          onPointerDown={handlePointerDown}
        >
          <div className="h-1.5 w-12 rounded-full bg-muted" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          {selectedSource ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex shrink-0 items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {selectedSource.logo && (
                    <img src={selectedSource.logo} alt="" className="h-6 w-6 rounded object-cover" />
                  )}
                  <div className="font-medium">{selectedSource.name}</div>
                  {selectedSource.apis && selectedSource.apis.length === 1 && (
                    <span className="text-xs text-muted">{selectedSource.apis[0].name}</span>
                  )}
                </div>
                {selectedSource.apis && selectedSource.apis.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedSource.apis.map((api) => (
                      <Button
                        key={api.name}
                        size="sm"
                        variant={selectedApiName === api.name ? 'primary' : 'ghost'}
                        onPress={() => setSelectedApiName(api.name)}
                      >
                        {api.name}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              {selectedApi && selectedApi.parameters && selectedApi.parameters.length > 0 && (
                <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {selectedApi.parameters.map((param, i) => {
                    if (param.hidden) return null;
                    const key = param.key || `__param_${i}`;
                    const label = param.label || param.key;
                    const type = param.type || 'text';
                    return (
                      <TextField key={key}>
                        <Label className="text-xs text-muted">{label}</Label>
                        {type === 'choice' && param.choices ? (
                          <ComboBox
                            selectedKey={String(parameterValues[key] || '')}
                            onSelectionChange={(k) =>
                              setParameterValues((p) => ({ ...p, [key]: String(k || '') }))
                            }
                          >
                            <ComboBox.InputGroup>
                              <Input className="h-8 text-sm" />
                              <ComboBox.Trigger />
                            </ComboBox.InputGroup>
                            <ComboBox.Popover>
                              <ListBox>
                                {param.choices.map((c) => (
                                  <ListBox.Item key={c} id={c} textValue={c}>
                                    {c}
                                  </ListBox.Item>
                                ))}
                              </ListBox>
                            </ComboBox.Popover>
                          </ComboBox>
                        ) : type === 'boolean' ? (
                          <Switch
                            isSelected={Boolean(parameterValues[key])}
                            onChange={(v) => setParameterValues((p) => ({ ...p, [key]: v }))}
                          >
                            <Switch.Control>
                              <Switch.Thumb />
                            </Switch.Control>
                          </Switch>
                        ) : (
                          <Input
                            className="h-8 text-sm"
                            value={String(parameterValues[key] || '')}
                            onChange={(e) =>
                              setParameterValues((p) => ({ ...p, [key]: e.target.value }))
                            }
                            placeholder={param.placeholder || ''}
                          />
                        )}
                        {param.description && (
                          <Description className="text-xs text-muted">{param.description}</Description>
                        )}
                      </TextField>
                    );
                  })}
                </div>
              )}

              <Button
                size="sm"
                className="w-fit shrink-0"
                onPress={handleExecute}
                isDisabled={resultsLoading || !selectedApi}
              >
                <Play size={14} />
                {resultsLoading ? '获取中...' : '获取壁纸'}
              </Button>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {resultsLoading ? (
                  <div className="flex h-full items-center justify-center gap-2">
                    <Spinner size="sm" />
                    <span className="text-sm text-muted">获取中...</span>
                  </div>
                ) : results.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {results.map((item, idx) => {
                      const imageUrl = normalizeLocalImage(item.image_url);
                      const previewUrl = normalizeLocalImage(item.preview_url || imageUrl);
                      return (
                        <div
                          key={item.id || idx}
                          className="group relative cursor-pointer overflow-hidden rounded-lg"
                          onClick={() => openResultViewer(idx)}
                        >
                          <img
                            src={previewUrl}
                            alt={item.title}
                            className="h-[120px] w-full object-cover transition-transform group-hover:scale-105"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            <div className="truncate text-xs text-white">{item.title}</div>
                            <div className="mt-1 flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-white"
                                onPress={() => handleSetWallpaper(imageUrl, item.title)}
                              >
                                <ImageIcon size={12} />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-white"
                                onPress={() => handleFavorite(item)}
                              >
                                <Heart size={12} />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-white"
                                onPress={() => copyToClipboard(imageUrl)}
                              >
                                <Copy size={12} />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-white"
                                onPress={() => openResultViewer(idx)}
                              >
                                <ImageIcon size={12} />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted">
                    点击“获取壁纸”查看结果
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              请选择壁纸源
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
