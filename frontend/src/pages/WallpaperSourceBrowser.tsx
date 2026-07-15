import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Button, ComboBox, Input, Label, ListBox, Switch, TextField, Spinner, TagGroup, Tag, Description,
  SearchField, Autocomplete, EmptyState, useFilter,
} from '@heroui/react';
import {
  Image as ImageIcon, Heart, Copy, Play, SlidersHorizontal, ChevronRight,
} from 'lucide-react';
import type { Key } from '@heroui/react';
import {
  getWallpaperSources, executeWallpaperSource, getSettings,
  addFavorite, copyToClipboard, localPreviewUrl,
  setWallpaperWithProgress,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import SourceIcon from '@/components/SourceIcon';
import { logError } from '@/lib/log';
import { safeNameForFile } from '@/lib/download';
import type { WallpaperSource, WallpaperSourceApi, WallpaperSourceApiParameter } from '@/api/backend';

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
  icon?: string;
  subcategories: {
    name: string;
    icon?: string;
    subsubcategories: {
      name: string;
      icon?: string;
    }[];
  }[];
}

function aggregateCategories(sources: WallpaperSource[]): CategoryNode[] {
  const root = new Map<
    string,
    {
      icon?: string;
      subMap: Map<
        string,
        {
          icon?: string;
          ssMap: Map<string, string | undefined>;
        }
      >;
    }
  >();
  let hasUncategorized = false;

  for (const source of sources) {
    const cats = source.categories;
    if (!cats || cats.length === 0) {
      hasUncategorized = true;
      continue;
    }
    for (const c of cats) {
      const category = c.category || '未分类';
      const subcategory = (c.subcategory && c.subcategory !== source.name) ? c.subcategory : '';
      const subsubcategory = c.subsubcategory || '';
      const icon = c.icon?.trim() || undefined;

      const entry = root.get(category) ?? { subMap: new Map<string, { icon?: string; ssMap: Map<string, string | undefined> }>() };
      if (icon && !entry.icon) entry.icon = icon;
      root.set(category, entry);

      if (!subcategory) continue;

      const subEntry = entry.subMap.get(subcategory) ?? { ssMap: new Map<string, string | undefined>() };
      if (icon && !subEntry.icon) subEntry.icon = icon;
      entry.subMap.set(subcategory, subEntry);

      if (subsubcategory) {
        if (icon && !subEntry.ssMap.has(subsubcategory)) subEntry.ssMap.set(subsubcategory, icon);
        else if (!subEntry.ssMap.has(subsubcategory)) subEntry.ssMap.set(subsubcategory, undefined);
      }
    }
  }

  const nodes: CategoryNode[] = Array.from(root.entries()).map(([name, { icon, subMap }]) => ({
    name,
    icon,
    subcategories: Array.from(subMap.entries()).map(([subName, { icon: subIcon, ssMap }]) => ({
      name: subName,
      icon: subIcon,
      subsubcategories: Array.from(ssMap.entries()).map(([ssName, ssIcon]) => ({ name: ssName, icon: ssIcon })),
    })),
  }));

  if (hasUncategorized) {
    nodes.unshift({ name: '未分类', subcategories: [] });
  }

  return nodes;
}

interface ApiItem {
  source: WallpaperSource;
  api: WallpaperSourceApi;
  categoryPaths: { category: string; subcategory: string; subsubcategory: string }[];
}

function buildSourceCategoryMap(source: WallpaperSource): Map<string, { category: string; subcategory: string; subsubcategory: string }> {
  const map = new Map<string, { category: string; subcategory: string; subsubcategory: string }>();
  for (const c of source.categories ?? []) {
    map.set(c.id, {
      category: c.category || '未分类',
      subcategory: (c.subcategory && c.subcategory !== source.name) ? c.subcategory : '',
      subsubcategory: c.subsubcategory || '',
    });
  }
  return map;
}

function flattenApis(sources: WallpaperSource[]): ApiItem[] {
  const items: ApiItem[] = [];
  for (const source of sources) {
    if (!source.apis || source.apis.length === 0) continue;
    const catMap = buildSourceCategoryMap(source);
    for (const api of source.apis) {
      const paths: { category: string; subcategory: string; subsubcategory: string }[] = [];
      if (api.categories && api.categories.length > 0) {
        for (const catId of api.categories) {
          const path = catMap.get(catId);
          if (path) paths.push(path);
        }
      }
      if (paths.length === 0) {
        paths.push({ category: '未分类', subcategory: '', subsubcategory: '' });
      }
      items.push({ source, api, categoryPaths: paths });
    }
  }
  return items;
}

function apiMatchesCategory(
  item: ApiItem,
  category?: string,
  subcategory?: string,
  subsubcategory?: string,
): boolean {
  if (!category) return true;
  if (category === '未分类') {
    return item.categoryPaths.some((p) => p.category === '未分类');
  }
  return item.categoryPaths.some((p) => {
    if (p.category !== category) return false;
    if (subcategory && p.subcategory !== subcategory) return false;
    if (subsubcategory && p.subsubcategory !== subsubcategory) return false;
    return true;
  });
}

function formatCategoryPath(path: { category: string; subcategory: string; subsubcategory: string }): string {
  const parts = [path.category, path.subcategory, path.subsubcategory]
    .filter((p) => p && p !== '未分类');
  return parts.join(' › ');
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
  const navigate = useNavigate();
  const [sources, setSources] = useState<WallpaperSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [mergeDisplay, setMergeDisplay] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<Key[]>([]);
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
  const { contains: containsFilter } = useFilter({ sensitivity: 'base' });

  const effectiveSources = useMemo(() => {
    if (mergeDisplay || selectedSourceIds.length === 0) return sources;
    const idSet = new Set(selectedSourceIds.map(String));
    return sources.filter((s) => idSet.has(s.identifier));
  }, [sources, mergeDisplay, selectedSourceIds]);

  const categories = useMemo(() => aggregateCategories(effectiveSources), [effectiveSources]);

  const currentCategory = useMemo(
    () => categories.find((c) => c.name === selectedCategory),
    [categories, selectedCategory],
  );

  const currentSubcategory = useMemo(
    () => currentCategory?.subcategories.find((s) => s.name === selectedSubcategory),
    [currentCategory, selectedSubcategory],
  );

  const allApis = useMemo(() => flattenApis(effectiveSources), [effectiveSources]);

  const filteredApis = useMemo(
    () => allApis.filter((item) => apiMatchesCategory(item, selectedCategory || undefined, selectedSubcategory || undefined, selectedSubsubcategory || undefined)),
    [allApis, selectedCategory, selectedSubcategory, selectedSubsubcategory],
  );

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allApis.filter((item) =>
      item.api.name.toLowerCase().includes(q) ||
      item.source.name.toLowerCase().includes(q) ||
      item.source.identifier.toLowerCase().includes(q) ||
      item.categoryPaths.some((p) =>
        [p.category, p.subcategory, p.subsubcategory].some((v) => v && v.toLowerCase().includes(q)),
      ),
    );
  }, [allApis, searchQuery]);

  const selectedItem = useMemo(
    () => allApis.find((item) => item.source.identifier === selectedSourceId && item.api.name === selectedApiName),
    [allApis, selectedSourceId, selectedApiName],
  );

  const selectedSource = selectedItem?.source;
  const selectedApi = selectedItem?.api;

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const [list, settings] = await Promise.all([getWallpaperSources(), getSettings()]);
      setSources(list);
      setMergeDisplay(settings.wallpaper?.sources?.merge_display ?? true);
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
    if (filteredApis.length === 0) {
      return;
    }
    if (!selectedSourceId || !selectedApiName || !filteredApis.some((item) => item.source.identifier === selectedSourceId && item.api.name === selectedApiName)) {
      const first = filteredApis[0];
      setSelectedSourceId(first.source.identifier);
      setSelectedApiName(first.api.name);
    }
  }, [filteredApis, selectedSourceId, selectedApiName]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (value.trim()) {
      setSelectedCategory('');
      setSelectedSubcategory('');
      setSelectedSubsubcategory('');
    }
  }, []);

  useEffect(() => {
    if (!selectedApi) {
      setParameterValues({});
      return;
    }
    setParameterValues((prev) => {
      const next: Record<string, unknown> = {};
      selectedApi.parameters?.forEach((param, i) => {
        const key = param.key || `__param_${i}`;
        next[key] = key in prev ? prev[key] : getSourceParameterDefaultValue(param);
      });
      return next;
    });
  }, [selectedApi]);

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

  const handleSetWallpaper = useCallback((url: string, title: string) => {
    const safeName = safeNameForFile(title, 'wallpaper');
    return setWallpaperWithProgress(url, `${safeName}.jpg`);
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
      source_name: selectedApi?.name || item.source_name || '',
      source_url: item.image_url,
    });
  }, [selectedApi]);

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
        source_name: selectedApi?.name || item.source_name || '',
        copyright: item.copyright || '',
      };
    }), startIndex);
  }, [results, openViewer, selectedApi]);

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
        {/* ── 搜索栏 + 管理 ── */}
        <div className="flex items-center gap-2 px-2 pt-2">
          <SearchField value={searchQuery} onChange={handleSearchChange} fullWidth>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="搜索接口、壁纸源或分类..." />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Button size="sm" variant="secondary" className="shrink-0" onPress={() => navigate('/resource/source-management')}>
            <SlidersHorizontal size={14} /> 管理壁纸源
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-4 pt-2">
          {/* ── 拆分模式：壁纸源选择 ── */}
          {!mergeDisplay && (
            <Autocomplete
              fullWidth
              selectionMode="multiple"
              value={selectedSourceIds}
              onChange={(keys) => setSelectedSourceIds(keys as Key[])}
              placeholder="选择壁纸源（留空显示全部）"
            >
              <Autocomplete.Trigger>
                <Autocomplete.Value />
                <Autocomplete.ClearButton />
                <Autocomplete.Indicator />
              </Autocomplete.Trigger>
              <Autocomplete.Popover>
                <Autocomplete.Filter filter={containsFilter}>
                  <SearchField autoFocus name="src-search" variant="secondary">
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder="搜索壁纸源..." />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                  <ListBox renderEmptyState={() => <EmptyState>无匹配壁纸源</EmptyState>}>
                    {sources.map((s) => (
                      <ListBox.Item key={s.identifier} id={s.identifier} textValue={s.name}>
                        <span className="flex items-center gap-2">
                          <SourceIcon src={s.logo} name={s.name} size="xs" />
                          {s.name}
                        </span>
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Autocomplete.Filter>
              </Autocomplete.Popover>
            </Autocomplete>
          )}

          {/* ── 分类筛选（可选） ── */}
          {!searchQuery.trim() && categories.length > 0 && (
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
                      <span className="flex items-center gap-1">
                        {c.icon && <SourceIcon src={c.icon} name={c.name} size="xs" />}
                        {c.name}
                      </span>
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
                        <span className="flex items-center gap-1">
                          {s.icon && <SourceIcon src={s.icon} name={s.name} size="xs" />}
                          {s.name}
                        </span>
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
                      <Tag key={ss.name} id={ss.name} textValue={ss.name}>
                        <span className="flex items-center gap-1">
                          {ss.icon && <SourceIcon src={ss.icon} name={ss.name} size="xs" />}
                          {ss.name}
                        </span>
                      </Tag>
                    ))}
                  </TagGroup.List>
                </TagGroup>
              )}
            </div>
          )}

          {/* ── 搜索结果 ── */}
          {searchQuery.trim() ? (
            searchResults.length === 0 ? (
              <div className="py-6 text-center text-muted">未找到匹配的接口</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 px-2 sm:grid-cols-3 md:grid-cols-4">
                {searchResults.map((item) => {
                  const catLabel = formatCategoryPath(item.categoryPaths[0] || { category: '', subcategory: '', subsubcategory: '' });
                  return (
                    <Card
                      key={`search-${item.source.identifier}:${item.api.name}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedSourceId(item.source.identifier);
                        setSelectedApiName(item.api.name);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedSourceId(item.source.identifier);
                          setSelectedApiName(item.api.name);
                        }
                      }}
                      className={`space-y-1 p-3 transition-colors ${
                        selectedSourceId === item.source.identifier && selectedApiName === item.api.name
                          ? 'ring-2 ring-primary bg-surface'
                          : 'hover:bg-surface'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <SourceIcon src={item.api.logo || item.source.logo} name={item.api.name} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-sm">{item.api.name}</div>
                          <div className="truncate text-xs text-muted">{item.source.name}</div>
                        </div>
                      </div>
                      {catLabel && (
                        <div className="flex items-center gap-0.5 text-[10px] text-muted">
                          <ChevronRight size={10} />
                          <span className="truncate">{catLabel}</span>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )
          ) : filteredApis.length === 0 ? (
            <div className="py-6 text-center text-muted">
              {selectedCategory ? '该分类下暂无接口' : '暂无可用接口'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 px-2 sm:grid-cols-3 md:grid-cols-4">
              {filteredApis.map((item) => (
                <Card
                  key={`${item.source.identifier}:${item.api.name}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedSourceId(item.source.identifier);
                    setSelectedApiName(item.api.name);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedSourceId(item.source.identifier);
                      setSelectedApiName(item.api.name);
                    }
                  }}
                  className={`space-y-2 p-3 transition-colors ${
                    selectedSourceId === item.source.identifier && selectedApiName === item.api.name
                      ? 'ring-2 ring-primary bg-surface'
                      : 'hover:bg-surface'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <SourceIcon src={item.api.logo || item.source.logo} name={item.api.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{item.api.name}</div>
                      <div className="truncate text-xs text-muted">{item.source.name}</div>
                    </div>
                  </div>
                  {item.api.description && (
                    <div className="text-xs text-muted">{item.api.description}</div>
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
          {selectedApi ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex shrink-0 items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <SourceIcon src={selectedApi.logo || selectedSource?.logo} name={selectedApi.name} size="sm" />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{selectedApi.name}</div>
                    {selectedSource && (
                      <div className="text-xs text-muted truncate">{selectedSource.name}</div>
                    )}
                  </div>
                  {selectedApi.description && (
                    <span className="text-xs text-muted truncate">{selectedApi.description}</span>
                  )}
                </div>
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
              请选择 API
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
