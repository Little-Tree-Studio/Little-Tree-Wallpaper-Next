import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Card, Button, Chip, Select, Switch, Input, Label, ListBox, ScrollShadow, SearchField, Spinner, Separator, Alert,
} from '@heroui/react';
import {
  Image as ImageIcon, RefreshCw, SlidersHorizontal, Play, Link as LinkIcon, AlertCircle, ExternalLink, X,
} from 'lucide-react';
import {
  listIntelligentMarketSources,
  checkIntelligentMarketSourcesHealth,
  executeIntelligentMarketSource,
  updateSettings,
  getSettings,
  openUrl,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import { logError, warn } from '@/lib/log';
import type { IntelligentMarketSource, IntelligentMarketParameter } from '@/types';

const ALL_CATEGORY = '__all__';
const MIRROR_OPTIONS = [
  { id: 'auto', name: '自动' },
  { id: 'github', name: 'GitHub' },
  { id: 'jsdelivr', name: 'jsDelivr' },
  { id: 'ghproxy', name: 'gh-proxy' },
];
const HEALTH_BATCH = 8;

function getParamDefault(param: IntelligentMarketParameter): string | boolean {
  const type = String(param.type ?? 'string').toLowerCase();
  if (type === 'boolean') return Boolean(param.default_value);
  if (type === 'enum' && Array.isArray(param.default_value)) {
    return String(param.default_value[0] ?? '');
  }
  if (type === 'list' && Array.isArray(param.default_value)) {
    return param.default_value.map(String).join(param.split_str || '\n');
  }
  return String(param.default_value ?? '');
}

function normalizeParamValue(param: IntelligentMarketParameter, value: unknown): unknown {
  const type = String(param.type ?? 'string').toLowerCase();
  if (type === 'boolean') return Boolean(value);
  if (type === 'list') {
    const raw = String(value ?? '').trim();
    if (!raw) return [];
    if (param.split_str) return raw.split(param.split_str).map((s) => s.trim()).filter(Boolean);
    return raw.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
  }
  return value;
}

function healthDotClass(status?: string | null): string {
  if (status === 'healthy') return 'bg-success';
  if (status === 'unhealthy') return 'bg-danger';
  return 'bg-warning';
}

function mergeHealth(
  sources: IntelligentMarketSource[],
  updates: { id: string; health_status?: string; health_message?: string | null; health_checked_at?: string | null; health_status_code?: number | null }[]
) {
  const map = new Map(updates.map((u) => [u.id, u]));
  return sources.map((s) => {
    const u = map.get(s.id);
    return u ? { ...s, ...u } : s;
  });
}

function SourceIcon({ src, size = 32 }: { src?: string | null; size?: number }) {
  const [err, setErr] = useState(false);
  const cls = `rounded-lg object-cover shrink-0`;
  const style = { width: size, height: size };
  if (!src || err) {
    return (
      <div className={`flex items-center justify-center bg-surface-secondary text-muted ${cls}`} style={style}>
        <ImageIcon size={size * 0.5} />
      </div>
    );
  }
  return <img src={src} alt="" className={cls} style={style} onError={() => setErr(true)} />;
}

function GalleryImage({
  src,
  fallbackSrc,
  alt,
  className,
  onError,
}: {
  src: string;
  fallbackSrc?: string;
  alt?: string;
  className?: string;
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  if (failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-surface-secondary text-muted ${className || ''}`}>
        <ImageIcon size={24} />
        <span className="text-xs">加载失败</span>
      </div>
    );
  }

  return (
    <img
      src={usingFallback && fallbackSrc ? fallbackSrc : src}
      alt={alt}
      className={className}
      onError={(e) => {
        if (!usingFallback && fallbackSrc && fallbackSrc !== src) {
          setUsingFallback(true);
        } else {
          setFailed(true);
        }
        onError?.(e);
      }}
    />
  );
}

function SourceItem({
  source,
  selected,
  onSelect,
}: {
  source: IntelligentMarketSource;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${
        selected
          ? 'border-primary bg-primary/5'
          : 'border-transparent hover:bg-surface-secondary'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <SourceIcon src={source.icon} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{source.friendly_name}</div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="truncate">{source.category}</span>
            <span className="shrink-0">· {source.parameters.filter((p) => p.enabled !== false).length} 参数</span>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full ${healthDotClass(source.health_status)}`}
          style={{ width: 8, height: 8 }}
          title={source.health_message || '等待预检'}
        />
      </div>
    </button>
  );
}

export default function IntelliMarketsPanel() {
  const [sources, setSources] = useState<IntelligentMarketSource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});
  const [gallery, setGallery] = useState<any[]>([]);
  const [executing, setExecuting] = useState(false);
  const [mirror, setMirror] = useState('auto');
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [autoHealthCheck, setAutoHealthCheck] = useState(true);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const healthReqId = useRef(0);
  const { openViewer } = useImageViewer();

  useEffect(() => {
    getSettings().then((s) => {
      const configuredMirror = String(s?.im?.mirror_preference || 'auto');
      setMirror(MIRROR_OPTIONS.some((option) => option.id === configuredMirror) ? configuredMirror : 'auto');
      if (s?.im?.show_disclaimer === false) {
        setShowDisclaimer(false);
      }
      setAutoHealthCheck(s?.im?.auto_health_check !== false);
    }).catch((e) => logError('Failed to load settings', e))
      .finally(() => setPreferencesLoaded(true));
  }, []);

  const selected = useMemo(
    () => sources.find((s) => s.id === selectedId) ?? null,
    [sources, selectedId]
  );

  const categories = useMemo(
    () => Array.from(new Set(sources.map((s) => s.category))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [sources]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sources.filter((s) => {
      if (category !== ALL_CATEGORY && s.category !== category) return false;
      if (!term) return true;
      return (
        s.friendly_name.toLowerCase().includes(term) ||
        s.category.toLowerCase().includes(term) ||
        (s.intro || '').toLowerCase().includes(term)
      );
    });
  }, [sources, search, category]);

  const summary = useMemo(() => {
    return sources.reduce(
      (acc, s) => {
        if (s.health_status === 'healthy') acc.ok++;
        else if (s.health_status === 'unhealthy') acc.bad++;
        else acc.unknown++;
        return acc;
      },
      { ok: 0, bad: 0, unknown: 0, total: sources.length }
    );
  }, [sources]);

  useEffect(() => {
    if (preferencesLoaded && !loaded && !loading) {
      void load();
    }
  }, [preferencesLoaded, loaded, loading]);

  useEffect(() => {
    if (!selected) return;
    const defaults: Record<string, unknown> = {};
    selected.parameters.forEach((param, idx) => {
      const key = param.key || param.name || `__param_${idx}`;
      defaults[key] = getParamDefault(param);
    });
    setParamValues(defaults);
    setGallery([]);
  }, [selected?.id]);

  async function load(force = false) {
    try {
      healthReqId.current += 1;
      setLoading(true);
      const list = await listIntelligentMarketSources(force);
      setSources(list);
      setLoaded(true);
      if (autoHealthCheck || force) void checkHealth(list, force);
    } catch (e) {
      logError('IM load failed', e);
    } finally {
      setLoading(false);
    }
  }

  async function checkHealth(list: IntelligentMarketSource[], force = false) {
    const reqId = healthReqId.current + 1;
    healthReqId.current = reqId;
    const ids = list.map((s) => s.id);
    for (let i = 0; i < ids.length; i += HEALTH_BATCH) {
      if (healthReqId.current !== reqId) return;
      const batch = ids.slice(i, i + HEALTH_BATCH);
      try {
        const updates = await checkIntelligentMarketSourcesHealth(batch, force);
        if (healthReqId.current !== reqId) return;
        setSources((cur) => mergeHealth(cur, updates));
      } catch (e) {
        if (healthReqId.current !== reqId) return;
        logError('IM health check failed', e);
      }
    }
  }

  async function changeMirror(value: string) {
    setMirror(value);
    try {
      await updateSettings({ 'im.mirror_preference': value });
      setLoaded(false);
      await load(true);
    } catch (e) {
      logError('mirror update failed', e);
    }
  }

  async function run() {
    if (!selected) return;
    try {
      setExecuting(true);
      const payload = Object.fromEntries(
        selected.parameters.map((param, idx) => {
          const key = param.key || param.name || `__param_${idx}`;
          return [key, normalizeParamValue(param, paramValues[key])];
        })
      );
      const items = await executeIntelligentMarketSource(selected.id, payload);
      const list = items || [];
      setGallery(list);
    } catch (e) {
      logError('execute failed', e);
    } finally {
      setExecuting(false);
    }
  }

  function openResultViewer(start = 0) {
    const items = gallery.map((item) => {
      const src = item.preview_url || item.image_url || '';
      if (!src) warn('openResultViewer: empty src for %s', item.id);
      return {
        src,
        title: item.title || selected?.friendly_name || 'IntelliMarkets',
        description: item.description || '',
        source_url: item.metadata?.original_url || item.image_url,
        preview_url: item.preview_url || item.image_url,
        source_type: item.source_id || 'intelligent_market',
        source_name: selected?.friendly_name || item.source_name || 'IntelliMarkets',
        copyright: item.copyright || '',
      };
    });
    openViewer(items, start);
  }

  return (
    <div className="intellimarkets-panel flex flex-col h-full gap-4">
      {showDisclaimer && (
        <Alert status="warning" className="shrink-0 items-center py-2.5">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              IntelliMarkets 由 SR思锐团队 提供和维护，图片内容责任由接口方承担
            </Alert.Description>
          </Alert.Content>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onPress={() => {
                setShowDisclaimer(false);
                updateSettings({ 'im.show_disclaimer': false }).catch(() => {});
              }}
            >
              不再显示
            </Button>
            <Button isIconOnly size="sm" variant="ghost" onPress={() => openUrl('https://github.com/IntelliMarkets/Wallpaper_API_Index')}>
              <ExternalLink size={14} />
            </Button>
            <Button isIconOnly size="sm" variant="ghost" onPress={() => setShowDisclaimer(false)}>
              <X size={14} />
            </Button>
          </div>
        </Alert>
      )}
      <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 lg:grid-cols-12">
      <Card className="lg:col-span-4 flex flex-col overflow-hidden h-full">
        <div className="flex flex-col gap-3 p-4 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold">IntelliMarkets</span>
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />{summary.ok}
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-danger" />{summary.bad}
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />{summary.unknown}
              </div>
            </div>
            <Button isIconOnly variant="ghost" onPress={() => load(true)} isDisabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>

          <Select
            className="w-full"
            selectedKey={mirror}
            onSelectionChange={(k) => k && changeMirror(String(k))}
          >
            <Label className="text-xs text-muted">镜像偏好</Label>
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                {MIRROR_OPTIONS.map((opt) => (
                  <ListBox.Item key={opt.id} id={opt.id} textValue={opt.name}>
                    {opt.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <SearchField value={search} onChange={setSearch}>
            <Label className="sr-only">搜索</Label>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="搜索源…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <ScrollShadow orientation="horizontal" hideScrollBar className="-mx-1 px-1">
            <div className="flex gap-1.5 pb-1">
              <Chip
                size="sm"
                onClick={() => setCategory(ALL_CATEGORY)}
                color={category === ALL_CATEGORY ? 'accent' : 'default'}
                variant={category === ALL_CATEGORY ? 'primary' : 'secondary'}
                className="cursor-pointer shrink-0"
              >全部</Chip>
              {categories.map((cat) => {
                const active = category === cat;
                return (
                  <Chip
                    key={cat}
                    size="sm"
                    onClick={() => setCategory(cat)}
                    color={active ? 'accent' : 'default'}
                    variant={active ? 'primary' : 'secondary'}
                    className="cursor-pointer shrink-0"
                  >{cat}</Chip>
                );
              })}
            </div>
          </ScrollShadow>

          <Separator />
        </div>

        <ScrollShadow className="flex-1">
          <div className="flex flex-col gap-1 px-4 pb-4">
            {loading && sources.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted">
                <Spinner size="sm" />
                正在加载图片源…
              </div>
            )}
            {filtered.map((source) => (
              <SourceItem
                key={source.id}
                source={source}
                selected={selected?.id === source.id}
                onSelect={() => setSelectedId(source.id)}
              />
            ))}
            {!loading && filtered.length === 0 && (
              <div className="py-8 text-center text-sm text-muted">没有匹配的图片源</div>
            )}
          </div>
        </ScrollShadow>
      </Card>

      <div className="lg:col-span-8 flex flex-col gap-4 min-h-0 h-full">
        {!selected ? (
          <Card className="flex flex-1 items-center justify-center">
            <Card.Content className="flex flex-col items-center gap-3 text-muted">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-secondary">
                <SlidersHorizontal size={24} />
              </div>
              <div className="text-sm">从左侧选择一个图片源以开始</div>
            </Card.Content>
          </Card>
        ) : (
          <>
            <Card className="shrink-0">
              <Card.Content className="flex flex-col gap-4">
                <div className="flex items-start gap-4">
                  <SourceIcon src={selected.icon} size={56} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold">{selected.friendly_name}</span>
                      <Chip size="sm">{selected.category}</Chip>
                      <Chip
                        size="sm"
                        color={selected.health_status === 'healthy' ? 'success' : selected.health_status === 'unhealthy' ? 'danger' : 'warning'}
                        variant="soft"
                      >
                        {selected.health_status === 'healthy' ? '可用' : selected.health_status === 'unhealthy' ? '不可用' : '未知'}
                      </Chip>
                    </div>
                    <div className="mt-1 text-sm text-muted">{selected.intro || '暂无简介'}</div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                      <span>{selected.method}</span>
                      <span>·</span>
                      <span>APICORE {selected.api_core_version}</span>
                      <span>·</span>
                      <span>{selected.parameters.filter((p) => p.enabled !== false).length} 参数</span>
                      {selected.health_checked_at && (
                        <>
                          <span>·</span>
                          <span>预检 {selected.health_checked_at}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Button onPress={run} isDisabled={executing || loading} className="shrink-0">
                    <Play size={16} /> 执行
                  </Button>
                </div>

                {selected.parameters.filter((p) => p.enabled !== false).length > 0 && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {selected.parameters.filter((p) => p.enabled !== false).map((param, idx) => {
                      const key = param.key || param.name || `__param_${idx}`;
                      const label = param.friendly_name?.trim() || param.name?.trim() || `参数 ${idx + 1}`;
                      const type = String(param.type ?? 'string').toLowerCase();
                      if (type === 'boolean') {
                        return (
                          <div key={key} className="flex items-center rounded-xl border border-border bg-surface px-3 py-2">
                            <Switch
                              isSelected={Boolean(paramValues[key])}
                              onChange={(v) => setParamValues((c) => ({ ...c, [key]: v }))}
                            >
                              <Switch.Control><Switch.Thumb /></Switch.Control>
                              <Switch.Content><Label className="text-sm">{label}</Label></Switch.Content>
                            </Switch>
                          </div>
                        );
                      }
                      if (type === 'enum') {
                        const options = param.options ?? [];
                        return (
                          <Select
                            key={key}
                            selectedKey={String(paramValues[key] ?? '')}
                            onSelectionChange={(k) => {
                              const val = k ? String(k) : '';
                              setParamValues((c) => ({ ...c, [key]: val }));
                            }}
                          >
                            <Label className="text-xs text-muted">{label}</Label>
                            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                {options.map((opt, i) => (
                                  <ListBox.Item
                                    key={String(opt)}
                                    id={String(opt)}
                                    textValue={param.friendly_options?.[i] || String(opt)}
                                  >
                                    {param.friendly_options?.[i] || String(opt)}
                                    <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                ))}
                              </ListBox>
                            </Select.Popover>
                          </Select>
                        );
                      }
                      return (
                        <div key={key} className="flex flex-col gap-1">
                          <Label className="text-xs text-muted">{label}</Label>
                          <Input
                            aria-label={label}
                            value={String(paramValues[key] ?? '')}
                            onChange={(e) => setParamValues((c) => ({ ...c, [key]: e.target.value }))}
                            placeholder={label}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {selected.health_status === 'unhealthy' && selected.health_message && (
                  <div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                    <AlertCircle size={16} />
                    {selected.health_message}
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  {selected.html_url && (
                    <a
                      href={selected.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <LinkIcon size={12} /> 仓库配置
                    </a>
                  )}
                  {selected.raw_url && (
                    <a
                      href={selected.raw_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <LinkIcon size={12} /> 原始 JSON
                    </a>
                  )}
                </div>
              </Card.Content>
            </Card>

            <Card className="flex flex-1 min-h-0 flex-col overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between shrink-0">
                <div className="text-sm font-medium">执行结果</div>
                {gallery.length > 0 && <div className="text-xs text-muted">共 {gallery.length} 张</div>}
              </div>
              <Separator />
              <ScrollShadow className="flex-1">
                {gallery.length === 0 ? (
                  <div className="py-4 text-center text-sm text-muted">
                    {executing ? (
                      <div className="flex items-center justify-center gap-2">
                        <Spinner size="sm" />
                        <span>正在执行…</span>
                      </div>
                    ) : (
                      '点击"执行"获取壁纸结果'
                    )}
                  </div>
                ) : (
                  <div className="p-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {gallery.map((item, idx) => {
                      const imgSrc = item.preview_url || item.image_url || '';
                      const hasSrc = typeof imgSrc === 'string' && imgSrc.length > 0;
                      return (
                        <Button
                          key={item.id || idx}
                          variant="ghost"
                          onPress={() => openResultViewer(idx)}
                          className="relative overflow-hidden rounded-xl p-0 transition-opacity hover:opacity-100 opacity-90"
                          style={{ minHeight: 120 }}
                        >
                          <div className="relative w-full bg-surface-secondary" style={{ aspectRatio: '4 / 3' }}>
                            {hasSrc ? (
                              <>
                                <GalleryImage
                                  src={imgSrc}
                                  fallbackSrc={item.image_url !== imgSrc ? item.image_url : undefined}
                                  alt={item.title}
                                  className="block h-full w-full object-cover"
                                  onError={(e) => {
                                    logError(`[IM] img onError: ${item.id} ${imgSrc.slice(0, 80)}`, e);
                                  }}
                                />
                              </>
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted">
                                <ImageIcon size={24} />
                                <span className="text-xs">无预览</span>
                              </div>
                            )}
                          </div>
                          {item.title && (
                            <div className="absolute bottom-0 left-0 right-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-xs text-white">
                              {item.title}
                            </div>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </ScrollShadow>
            </Card>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
