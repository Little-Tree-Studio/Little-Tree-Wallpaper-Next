import { useState, useEffect, useMemo } from 'react';
import {
  Card, Button, Tabs, ComboBox, Input, Label, ListBox,
  Drawer, Switch, TextArea, TextField, FieldError, Modal,
} from '@heroui/react';
import {
  Image as ImageIcon, Heart, Copy, RefreshCw,
  Plus, Trash2, Upload,
  Play, AlertCircle, Wand2,
} from 'lucide-react';
import {
  getWallpaperSources, setWallpaperSourceEnabled, deleteWallpaperSource,
  executeWallpaperSource, pickAndImportSource, createWallpaperSource,
  downloadFile, setWallpaper, addFavorite, copyToClipboard,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import type {
  WallpaperSource, WallpaperSourceApiParameter,
  WallpaperSourceCreatorPayload,
} from '@/api/backend';

interface WallpaperSourcesPanelProps {
  onExecute?: (items: any[]) => void;
}

function getSourceParameterDefaultValue(param: WallpaperSourceApiParameter): string | boolean {
  const type = String(param.type ?? 'text').toLowerCase();
  if (type === 'boolean') {
    return Boolean(param.default);
  }
  if (type === 'list') {
    if (Array.isArray(param.default)) {
      return param.default.map((item) => String(item)).join('\n');
    }
    return String(param.default ?? '');
  }
  return String(param.default ?? '');
}

function normalizeSourceParameterValue(param: WallpaperSourceApiParameter, value: unknown): unknown {
  const type = String(param.type ?? 'text').toLowerCase();
  if (type === 'boolean') {
    return Boolean(value);
  }
  if (type === 'list') {
    return String(value ?? '')
      .split(/[\r\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (type === 'number') {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw;
  }
  return value;
}

const ITEMS_PATH_TEMPLATES = [
  { label: '通用列表', value: '$.data.list' },
  { label: '数组通配', value: '$.data[*]' },
  { label: 'Items', value: '$.items' },
  { label: 'Results', value: '$.results' },
  { label: '根节点', value: '$' },
  { label: '嵌套数据', value: '$.response.data' },
];

const IMAGE_PATH_TEMPLATES = [
  { label: 'url', value: '$.url' },
  { label: 'image_url', value: '$.image_url' },
  { label: 'image', value: '$.image' },
  { label: 'img', value: '$.img' },
  { label: 'src', value: '$.src' },
  { label: 'download_url', value: '$.download_url' },
  { label: 'links.download', value: '$.links.download' },
];

export default function WallpaperSourcesPanel({ onExecute }: WallpaperSourcesPanelProps) {
  const [sources, setSources] = useState<WallpaperSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedApiName, setSelectedApiName] = useState('');
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({});
  const [results, setResults] = useState<any[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [showCreator, setShowCreator] = useState(false);
  const [creatorTab, setCreatorTab] = useState('basic');
  const [creatorPayload, setCreatorPayload] = useState<WallpaperSourceCreatorPayload>({
    source: { identifier: '', name: '', version: '1.0.0' },
    config: { request: { global_interval_seconds: 1800, timeout_seconds: 20, max_concurrent: 2, skip_ssl_verify: false, user_agent: 'LittleTreeWallpaper/2.0' } },
    categories: { categories: [{ id: 'default', name: '默认分类' }] },
    apis: [],
  });
  const [pathGenOpen, setPathGenOpen] = useState(false);
  const [pathGenTarget, setPathGenTarget] = useState<{ type: 'items' | 'image'; apiIndex: number } | null>(null);
  const [pathGenValue, setPathGenValue] = useState('');
  const [showValidation, setShowValidation] = useState(false);
  const { openViewer } = useImageViewer();

  const rawValidation = useMemo(() => {
    const errors: {
      basic: Record<string, string>;
      categories: string;
      apis: Record<number, Record<string, string>>;
      apisGeneral: string;
    } = {
      basic: {},
      categories: '',
      apis: {},
      apisGeneral: '',
    };

    if (!creatorPayload.source.identifier.trim()) {
      errors.basic.identifier = '标识符为必填项';
    } else if (!/^[a-z0-9._]+$/.test(creatorPayload.source.identifier)) {
      errors.basic.identifier = '只能包含小写字母、数字、点和下划线';
    }
    if (!creatorPayload.source.name.trim()) {
      errors.basic.name = '名称为必填项';
    }
    if (!creatorPayload.source.version.trim()) {
      errors.basic.version = '版本为必填项';
    } else if (!/^\d+\.\d+\.\d+/.test(creatorPayload.source.version)) {
      errors.basic.version = '版本格式应为 主.次.修订';
    }

    const cats = creatorPayload.categories?.categories || [];
    if (cats.length === 0) {
      errors.categories = '请至少添加一个分类';
    } else {
      const hasEmpty = cats.some((c) => !c.id.trim() || !c.name.trim());
      if (hasEmpty) {
        errors.categories = '每个分类的 ID 和名称都必须填写';
      }
    }

    const apis = creatorPayload.apis || [];
    if (apis.length === 0) {
      errors.apisGeneral = '请至少添加一个 API';
    } else {
      apis.forEach((api, idx) => {
        const apiErrors: Record<string, string> = {};
        if (!api.name.trim()) apiErrors.name = 'API 名称为必填项';
        if (!api.categories || api.categories.length === 0 || api.categories.some((c) => !c.trim())) {
          apiErrors.category = '必须绑定至少一个分类';
        }
        if (!api.request?.url?.trim()) apiErrors.url = '请求 URL 为必填项';
        if (!api.response?.format?.trim()) apiErrors.format = '响应格式为必填项';
        if (Object.keys(apiErrors).length > 0) {
          errors.apis[idx] = apiErrors;
        }
      });
    }

    const hasBasicErrors = Object.keys(errors.basic).length > 0;
    const hasCategoryErrors = !!errors.categories;
    const hasApiErrors = !!errors.apisGeneral || Object.keys(errors.apis).length > 0;

    return {
      errors,
      isValid: !hasBasicErrors && !hasCategoryErrors && !hasApiErrors,
      tabErrors: {
        basic: hasBasicErrors,
        categories: hasCategoryErrors,
        api: hasApiErrors,
      },
    };
  }, [creatorPayload]);

  const validation = useMemo(() => {
    if (showValidation) return rawValidation;
    return {
      errors: { basic: {}, categories: '', apis: {}, apisGeneral: '' },
      isValid: true,
      tabErrors: { basic: false, categories: false, api: false },
    };
  }, [rawValidation, showValidation]);

  useEffect(() => {
    loadSources();
  }, []);

  useEffect(() => {
    const source = sources.find((s) => s.identifier === selectedSourceId);
    if (!source) {
      setSelectedApiName('');
      setParameterValues({});
      return;
    }
    const api = source.apis?.find((a) => a.name === selectedApiName) ?? source.apis?.[0];
    if (api) {
      if (selectedApiName !== api.name) {
        setSelectedApiName(api.name);
      }
      const nextValues: Record<string, unknown> = {};
      api.parameters?.forEach((param, index) => {
        const key = param.key || `__param_${index}`;
        nextValues[key] = key in parameterValues ? parameterValues[key] : getSourceParameterDefaultValue(param);
      });
      setParameterValues(nextValues);
    } else {
      setSelectedApiName('');
      setParameterValues({});
    }
  }, [selectedSourceId, sources]);

  const loadSources = async () => {
    setLoading(true);
    try {
      const list = await getWallpaperSources();
      setSources(list);
      if (list.length > 0 && !selectedSourceId) {
        const firstValid = list.find((s) => !s.invalid && s.enabled !== false);
        if (firstValid) {
          setSelectedSourceId(firstValid.identifier);
        }
      }
    } catch (e) {
      console.error('Failed to load wallpaper sources', e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSource = async (source: WallpaperSource) => {
    try {
      await setWallpaperSourceEnabled(source.identifier, !source.enabled);
      await loadSources();
    } catch (e) {
      console.error('Failed to toggle source', e);
    }
  };

  const handleDeleteSource = async (source: WallpaperSource) => {
    if (!confirm(`确定要删除壁纸源 "${source.name}" 吗？`)) return;
    try {
      await deleteWallpaperSource(source.identifier);
      if (selectedSourceId === source.identifier) {
        setSelectedSourceId('');
      }
      await loadSources();
    } catch (e) {
      console.error('Failed to delete source', e);
    }
  };

  const handleExecute = async () => {
    if (!selectedSourceId || !selectedApiName) return;
    const source = sources.find((s) => s.identifier === selectedSourceId);
    const api = source?.apis?.find((a) => a.name === selectedApiName);
    if (!api) return;

    setResultsLoading(true);
    setResults([]);
    try {
      const payload: Record<string, unknown> = {};
      api.parameters?.forEach((param, index) => {
        const key = param.key || `__param_${index}`;
        payload[key] = normalizeSourceParameterValue(param, parameterValues[key]);
      });
      const items = await executeWallpaperSource(selectedSourceId, selectedApiName, payload);
      setResults(items || []);
      onExecute?.(items || []);
    } catch (e) {
      console.error('Execute source failed', e);
    } finally {
      setResultsLoading(false);
    }
  };

  const handleImport = async () => {
    try {
      const imported = await pickAndImportSource();
      if (imported) {
        await loadSources();
        setSelectedSourceId(imported.identifier);
      }
    } catch (e) {
      console.error('Import failed', e);
    }
  };

  const selectedSource = useMemo(() => sources.find((s) => s.identifier === selectedSourceId), [sources, selectedSourceId]);
  const selectedApi = useMemo(() => selectedSource?.apis?.find((a) => a.name === selectedApiName), [selectedSource, selectedApiName]);

  const validSources = sources.filter((s) => !s.invalid);
  const invalidSources = sources.filter((s) => s.invalid);

  const handleSetWallpaper = async (url: string, title: string) => {
    const safeName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || 'wallpaper';
    const path = await downloadFile(url, `${safeName}.jpg`);
    if (path) await setWallpaper(path);
  };

  const handleFavorite = async (item: any) => {
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
  };

  const openResultViewer = (startIndex = 0) => {
    const items = results.map((item) => ({
      src: item.image_url,
      title: item.title || '壁纸',
      description: item.description || '',
      source_url: item.image_url,
      preview_url: item.preview_url || item.image_url,
      source_type: item.source_id || 'source',
    }));
    openViewer(items, startIndex);
  };

  const openPathGen = (type: 'items' | 'image', apiIndex: number) => {
    setPathGenTarget({ type, apiIndex });
    const api = creatorPayload.apis?.[apiIndex];
    if (type === 'items') {
      setPathGenValue(api?.mapping?.items || '');
    } else {
      setPathGenValue(api?.mapping?.item_mapping?.find((m) => m.key === 'image')?.value || '');
    }
    setPathGenOpen(true);
  };

  const applyPathGen = () => {
    if (!pathGenTarget) return;
    const { type, apiIndex } = pathGenTarget;
    const next = [...(creatorPayload.apis || [])];
    if (type === 'items') {
      next[apiIndex] = { ...next[apiIndex], mapping: { ...next[apiIndex].mapping, items: pathGenValue } };
    } else {
      const mapping = [...(next[apiIndex].mapping?.item_mapping || [])];
      const existing = mapping.find((m) => m.key === 'image');
      if (existing) {
        existing.value = pathGenValue;
      } else {
        mapping.push({ key: 'image', value: pathGenValue });
      }
      next[apiIndex] = { ...next[apiIndex], mapping: { ...next[apiIndex].mapping, item_mapping: mapping } };
    }
    setCreatorPayload((prev) => ({ ...prev, apis: next }));
    setPathGenOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="secondary" onPress={handleImport}>
          <Upload size={14} /> 导入
        </Button>
        <Button size="sm" variant="secondary" onPress={() => { setShowValidation(false); setShowCreator(true); }}>
          <Plus size={14} /> 创建
        </Button>
        <Button size="sm" variant="ghost" onPress={loadSources} isDisabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新
        </Button>
      </div>

      {validSources.length === 0 && invalidSources.length === 0 && !loading && (
        <div className="py-10 text-center text-muted">
          暂无壁纸源，点击"导入"添加 .ltws 文件
        </div>
      )}

      {validSources.length > 0 && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {validSources.map((source) => (
              <Button
                key={source.identifier}
                size="sm"
                variant={selectedSourceId === source.identifier ? 'primary' : 'ghost'}
                onPress={() => setSelectedSourceId(source.identifier)}
                className="flex items-center gap-1"
              >
                {source.logo && <img src={source.logo} alt="" className="h-4 w-4 rounded" />}
                {source.name}
                {!source.enabled && <span className="text-xs opacity-60">(已禁用)</span>}
              </Button>
            ))}
          </div>

          {selectedSource && (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedSource.logo && (
                    <img src={selectedSource.logo} alt="" className="h-8 w-8 rounded" />
                  )}
                  <div>
                    <div className="font-medium">{selectedSource.name}</div>
                    <div className="text-xs text-muted">{selectedSource.identifier} &middot; v{selectedSource.version}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    isSelected={selectedSource.enabled !== false}
                    onChange={() => handleToggleSource(selectedSource)}
                  >
                    <Switch.Control><Switch.Thumb /></Switch.Control>
                  </Switch>
                  {selectedSource.can_delete && (
                    <Button isIconOnly variant="ghost" size="sm" onPress={() => handleDeleteSource(selectedSource)}>
                      <Trash2 size={14} className="text-danger" />
                    </Button>
                  )}
                </div>
              </div>

              {selectedSource.apis && selectedSource.apis.length > 0 && (
                <div className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
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

                  {selectedApi && selectedApi.parameters && selectedApi.parameters.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {selectedApi.parameters.map((param, idx) => {
                        const key = param.key || `__param_${idx}`;
                        if (param.hidden) return null;
                        const label = param.label || param.key;
                        const type = param.type || 'text';
                        return (
                          <div key={key} className="space-y-1">
                            <Label className="text-xs text-muted">{label}</Label>
                            {type === 'choice' && param.choices ? (
                              <ComboBox
                                selectedKey={String(parameterValues[key] || '')}
                                onSelectionChange={(k) => setParameterValues((prev) => ({ ...prev, [key]: String(k || '') }))}
                              >
                                <ComboBox.InputGroup>
                                  <Input className="h-8 text-sm" />
                                  <ComboBox.Trigger />
                                </ComboBox.InputGroup>
                                <ComboBox.Popover>
                                  <ListBox>
                                    {param.choices.map((c) => (
                                      <ListBox.Item key={c} id={c} textValue={c}>{c}</ListBox.Item>
                                    ))}
                                  </ListBox>
                                </ComboBox.Popover>
                              </ComboBox>
                            ) : type === 'boolean' ? (
                              <Switch
                                isSelected={Boolean(parameterValues[key])}
                                onChange={(v) => setParameterValues((prev) => ({ ...prev, [key]: v }))}
                              >
                                <Switch.Control><Switch.Thumb /></Switch.Control>
                              </Switch>
                            ) : (
                              <Input
                                className="h-8 text-sm"
                                value={String(parameterValues[key] || '')}
                                onChange={(e) => setParameterValues((prev) => ({ ...prev, [key]: e.target.value }))}
                                placeholder={param.placeholder || ''}
                              />
                            )}
                            {param.description && (
                              <div className="text-xs text-muted">{param.description}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <Button size="sm" onPress={handleExecute} isDisabled={resultsLoading}>
                    <Play size={14} /> {resultsLoading ? '执行中...' : '执行查询'}
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {invalidSources.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-danger">加载失败的源</div>
          {invalidSources.map((source) => (
            <Card key={source.identifier} className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="text-danger" />
                <div>
                  <div className="text-sm">{source.name || source.identifier}</div>
                  <div className="text-xs text-muted">{source.error}</div>
                </div>
              </div>
              {source.can_delete && (
                <Button isIconOnly variant="ghost" size="sm" onPress={() => handleDeleteSource(source)}>
                  <Trash2 size={14} className="text-danger" />
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium">查询结果 ({results.length})</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {results.map((item, idx) => (
              <div
                key={item.id || idx}
                className="group relative overflow-hidden rounded-lg cursor-pointer"
                onClick={() => openResultViewer(idx)}
              >
                <img
                  src={item.preview_url || item.image_url}
                  alt={item.title}
                  className="h-[120px] w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                  <div className="text-xs text-white truncate">{item.title}</div>
                  <div className="flex gap-1 mt-1">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-white" onPress={() => { handleSetWallpaper(item.image_url, item.title); }}>
                      <ImageIcon size={12} />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-white" onPress={() => { handleFavorite(item); }}>
                      <Heart size={12} />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-white" onPress={() => { copyToClipboard(item.image_url); }}>
                      <Copy size={12} />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreator && (
        <Drawer.Backdrop isOpen={showCreator} onOpenChange={setShowCreator} isDismissable={false}>
          <Drawer.Content placement="right">
            <Drawer.Dialog>
              <Drawer.Header>
                <Drawer.Heading>创建壁纸源</Drawer.Heading>
              </Drawer.Header>
              <Drawer.Body>
                <Tabs selectedKey={creatorTab} onSelectionChange={(k) => setCreatorTab(String(k))}>
                  <Tabs.ListContainer>
                    <Tabs.List>
                      <Tabs.Tab id="basic">
                        <span className="flex items-center gap-1">
                          基本信息
                          {validation.tabErrors.basic && <span className="h-2 w-2 rounded-full bg-danger inline-block" />}
                        </span>
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab id="categories">
                        <span className="flex items-center gap-1">
                          分类
                          {validation.tabErrors.categories && <span className="h-2 w-2 rounded-full bg-danger inline-block" />}
                        </span>
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab id="api">
                        <span className="flex items-center gap-1">
                          API
                          {validation.tabErrors.api && <span className="h-2 w-2 rounded-full bg-danger inline-block" />}
                        </span>
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>

                  <Tabs.Panel id="basic">
                    <div className="space-y-3">
                      <TextField
                        isInvalid={!!validation.errors.basic.identifier}
                      >
                        <Label>标识符 (反向域名格式)</Label>
                        <Input
                          value={creatorPayload.source?.identifier || ''}
                          onChange={(e) => setCreatorPayload((prev) => ({ ...prev, source: { ...prev.source, identifier: e.target.value } }))}
                          placeholder="com.example.my_source"
                        />
                        <FieldError>{validation.errors.basic.identifier}</FieldError>
                      </TextField>
                      <TextField
                        isInvalid={!!validation.errors.basic.name}
                      >
                        <Label>名称</Label>
                        <Input
                          value={creatorPayload.source?.name || ''}
                          onChange={(e) => setCreatorPayload((prev) => ({ ...prev, source: { ...prev.source, name: e.target.value } }))}
                          placeholder="我的壁纸源"
                        />
                        <FieldError>{validation.errors.basic.name}</FieldError>
                      </TextField>
                      <TextField
                        isInvalid={!!validation.errors.basic.version}
                      >
                        <Label>版本</Label>
                        <Input
                          value={creatorPayload.source?.version || '1.0.0'}
                          onChange={(e) => setCreatorPayload((prev) => ({ ...prev, source: { ...prev.source, version: e.target.value } }))}
                        />
                        <FieldError>{validation.errors.basic.version}</FieldError>
                      </TextField>
                      <TextField>
                        <Label>描述</Label>
                        <TextArea
                          value={creatorPayload.source?.description || ''}
                          onChange={(e) => setCreatorPayload((prev) => ({ ...prev, source: { ...prev.source, description: e.target.value } }))}
                          rows={2}
                        />
                      </TextField>
                    </div>
                  </Tabs.Panel>

                  <Tabs.Panel id="categories">
                    <div className="space-y-3">
                      {validation.errors.categories && (
                        <div className="text-sm text-danger">{validation.errors.categories}</div>
                      )}
                      {(creatorPayload.categories?.categories || []).map((cat, idx) => (
                        <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                          <TextField>
                            <Input
                              className="h-8 text-sm w-full min-w-0"
                              value={cat.id}
                              onChange={(e) => {
                                const next = [...(creatorPayload.categories?.categories || [])];
                                next[idx] = { ...next[idx], id: e.target.value };
                                setCreatorPayload((prev) => ({ ...prev, categories: { ...prev.categories, categories: next } }));
                              }}
                              placeholder="分类ID"
                            />
                          </TextField>
                          <TextField>
                            <Input
                              className="h-8 text-sm w-full min-w-0"
                              value={cat.name}
                              onChange={(e) => {
                                const next = [...(creatorPayload.categories?.categories || [])];
                                next[idx] = { ...next[idx], name: e.target.value };
                                setCreatorPayload((prev) => ({ ...prev, categories: { ...prev.categories, categories: next } }));
                              }}
                              placeholder="分类名称"
                            />
                          </TextField>
                          <Button isIconOnly variant="ghost" size="sm" onPress={() => {
                            const next = (creatorPayload.categories?.categories || []).filter((_, i) => i !== idx);
                            setCreatorPayload((prev) => ({ ...prev, categories: { ...prev.categories, categories: next } }));
                          }}>
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      ))}
                      <Button size="sm" variant="secondary" onPress={() => {
                        const next = [...(creatorPayload.categories?.categories || []), { id: '', name: '' }];
                        setCreatorPayload((prev) => ({ ...prev, categories: { ...prev.categories, categories: next } }));
                      }}>
                        <Plus size={14} /> 添加分类
                      </Button>
                    </div>
                  </Tabs.Panel>

                  <Tabs.Panel id="api">
                    <div className="space-y-3">
                      {validation.errors.apisGeneral && (
                        <div className="text-sm text-danger">{validation.errors.apisGeneral}</div>
                      )}
                      {(creatorPayload.apis || []).map((api, idx) => {
                        const apiErrors = validation.errors.apis[idx] || {};
                        const catOptions = (creatorPayload.categories?.categories || []).map((c) => ({ id: c.id, name: c.name || c.id }));
                        return (
                          <Card key={idx} className="p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <TextField
                                className="w-48"
                                isInvalid={!!apiErrors.name}
                              >
                                <Input
                                  className="h-8 text-sm"
                                  value={api.name}
                                  onChange={(e) => {
                                    const next = [...(creatorPayload.apis || [])];
                                    next[idx] = { ...next[idx], name: e.target.value };
                                    setCreatorPayload((prev) => ({ ...prev, apis: next }));
                                  }}
                                  placeholder="API名称"
                                />
                                <FieldError>{apiErrors.name}</FieldError>
                              </TextField>
                              <Button isIconOnly variant="ghost" size="sm" onPress={() => {
                                const next = (creatorPayload.apis || []).filter((_, i) => i !== idx);
                                setCreatorPayload((prev) => ({ ...prev, apis: next }));
                              }}>
                                <Trash2 size={14} />
                              </Button>
                            </div>
                            <TextField isInvalid={!!apiErrors.category}>
                              <Label className="text-xs text-muted">绑定分类</Label>
                              <ComboBox
                                className="w-full"
                                selectedKey={api.categories?.[0] || ''}
                                onSelectionChange={(k) => {
                                  const next = [...(creatorPayload.apis || [])];
                                  next[idx] = { ...next[idx], categories: k ? [String(k)] : [] };
                                  setCreatorPayload((prev) => ({ ...prev, apis: next }));
                                }}
                              >
                                <ComboBox.InputGroup><Input className="h-8 text-sm" placeholder="选择分类" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                <ComboBox.Popover>
                                  <ListBox>
                                    {catOptions.map((c) => (
                                      <ListBox.Item key={c.id} id={c.id} textValue={c.name}>{c.name}</ListBox.Item>
                                    ))}
                                  </ListBox>
                                </ComboBox.Popover>
                              </ComboBox>
                              <FieldError>{apiErrors.category}</FieldError>
                            </TextField>
                            <TextField isInvalid={!!apiErrors.url}>
                              <Input
                                className="h-8 text-sm"
                                value={api.request?.url || ''}
                                onChange={(e) => {
                                  const next = [...(creatorPayload.apis || [])];
                                  next[idx] = { ...next[idx], request: { ...next[idx].request, url: e.target.value } };
                                  setCreatorPayload((prev) => ({ ...prev, apis: next }));
                                }}
                                placeholder="请求URL"
                              />
                              <FieldError>{apiErrors.url}</FieldError>
                            </TextField>
                            <div className="grid grid-cols-2 gap-2">
                              <ComboBox
                                selectedKey={api.response?.format || 'json'}
                                onSelectionChange={(k) => {
                                  const next = [...(creatorPayload.apis || [])];
                                  next[idx] = { ...next[idx], response: { ...next[idx].response, format: String(k) } };
                                  setCreatorPayload((prev) => ({ ...prev, apis: next }));
                                }}
                              >
                                <ComboBox.InputGroup><Input className="h-8 text-sm" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                <ComboBox.Popover>
                                  <ListBox>
                                    <ListBox.Item id="json" textValue="JSON">JSON</ListBox.Item>
                                    <ListBox.Item id="toml" textValue="TOML">TOML</ListBox.Item>
                                    <ListBox.Item id="image_url" textValue="图片URL">图片URL</ListBox.Item>
                                    <ListBox.Item id="image_raw" textValue="图片二进制">图片二进制</ListBox.Item>
                                    <ListBox.Item id="static_list" textValue="静态列表">静态列表</ListBox.Item>
                                    <ListBox.Item id="static_dict" textValue="静态字典">静态字典</ListBox.Item>
                                  </ListBox>
                                </ComboBox.Popover>
                              </ComboBox>
                              <ComboBox
                                selectedKey={api.response?.type || 'multi'}
                                onSelectionChange={(k) => {
                                  const next = [...(creatorPayload.apis || [])];
                                  next[idx] = { ...next[idx], response: { ...next[idx].response, type: String(k) } };
                                  setCreatorPayload((prev) => ({ ...prev, apis: next }));
                                }}
                              >
                                <ComboBox.InputGroup><Input className="h-8 text-sm" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                <ComboBox.Popover>
                                  <ListBox>
                                    <ListBox.Item id="single" textValue="单条">单条</ListBox.Item>
                                    <ListBox.Item id="multi" textValue="多条">多条</ListBox.Item>
                                  </ListBox>
                                </ComboBox.Popover>
                              </ComboBox>
                            </div>
                            {apiErrors.format && <div className="text-sm text-danger">{apiErrors.format}</div>}
                            <div className="flex items-start gap-2">
                              <TextField className="flex-1">
                                <Label className="text-xs text-muted">条目路径</Label>
                                <Input
                                  className="h-8 text-sm"
                                  value={api.mapping?.items || ''}
                                  onChange={(e) => {
                                    const next = [...(creatorPayload.apis || [])];
                                    next[idx] = { ...next[idx], mapping: { ...next[idx].mapping, items: e.target.value } };
                                    setCreatorPayload((prev) => ({ ...prev, apis: next }));
                                  }}
                                  placeholder="条目路径 (如: $.data.list)"
                                />
                              </TextField>
                              <Button isIconOnly variant="ghost" size="sm" className="mt-5" onPress={() => openPathGen('items', idx)}>
                                <Wand2 size={14} />
                              </Button>
                            </div>
                            <div className="flex items-start gap-2">
                              <TextField className="flex-1">
                                <Label className="text-xs text-muted">图片字段路径</Label>
                                <Input
                                  className="h-8 text-sm"
                                  value={api.mapping?.item_mapping?.find((m) => m.key === 'image')?.value || ''}
                                  onChange={(e) => {
                                    const next = [...(creatorPayload.apis || [])];
                                    const mapping = [...(next[idx].mapping?.item_mapping || [])];
                                    const existing = mapping.find((m) => m.key === 'image');
                                    if (existing) {
                                      existing.value = e.target.value;
                                    } else {
                                      mapping.push({ key: 'image', value: e.target.value });
                                    }
                                    next[idx] = { ...next[idx], mapping: { ...next[idx].mapping, item_mapping: mapping } };
                                    setCreatorPayload((prev) => ({ ...prev, apis: next }));
                                  }}
                                  placeholder="图片字段路径 (如: $.url)"
                                />
                              </TextField>
                              <Button isIconOnly variant="ghost" size="sm" className="mt-5" onPress={() => openPathGen('image', idx)}>
                                <Wand2 size={14} />
                              </Button>
                            </div>
                          </Card>
                        );
                      })}
                      <Button size="sm" variant="secondary" onPress={() => {
                        const next = [...(creatorPayload.apis || []), {
                          name: '新接口',
                          categories: [],
                          request: { url: '', method: 'GET' },
                          response: { format: 'json', type: 'multi' },
                          mapping: { items: '', item_mapping: [{ key: 'image', value: '' }] },
                        }];
                        setCreatorPayload((prev) => ({ ...prev, apis: next }));
                      }}>
                        <Plus size={14} /> 添加API
                      </Button>
                    </div>
                  </Tabs.Panel>
                </Tabs>
              </Drawer.Body>
              <Drawer.Footer>
                <Button variant="ghost" onPress={() => setShowCreator(false)}>取消</Button>
                <Button onPress={async () => {
                  if (!showValidation) setShowValidation(true);
                  if (!rawValidation.isValid) {
                    if (rawValidation.tabErrors.basic) setCreatorTab('basic');
                    else if (rawValidation.tabErrors.categories) setCreatorTab('categories');
                    else if (rawValidation.tabErrors.api) setCreatorTab('api');
                    return;
                  }
                  try {
                    await createWallpaperSource(creatorPayload);
                    setShowCreator(false);
                    setShowValidation(false);
                    await loadSources();
                  } catch (e) {
                    console.error('Create source failed', e);
                    alert('创建失败: ' + (e instanceof Error ? e.message : String(e)));
                  }
                }}>创建</Button>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      )}

      {pathGenOpen && (
        <Modal.Backdrop isOpen={pathGenOpen} onOpenChange={setPathGenOpen}>
          <Modal.Container size="cover">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>路径生成器</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <div className="space-y-4">
                  <div>
                    <Label className="text-xs text-muted mb-1 block">选择模板</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {(pathGenTarget?.type === 'items' ? ITEMS_PATH_TEMPLATES : IMAGE_PATH_TEMPLATES).map((t) => (
                        <Button
                          key={t.value}
                          size="sm"
                          variant={pathGenValue === t.value ? 'primary' : 'secondary'}
                          onPress={() => setPathGenValue(t.value)}
                        >
                          {t.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <TextField>
                    <Label>自定义路径</Label>
                    <Input
                      value={pathGenValue}
                      onChange={(e) => setPathGenValue(e.target.value)}
                      placeholder={pathGenTarget?.type === 'items' ? '$.data.list' : '$.url'}
                    />
                  </TextField>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setPathGenOpen(false)}>取消</Button>
                <Button onPress={applyPathGen}>确定</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      )}
    </div>
  );
}
