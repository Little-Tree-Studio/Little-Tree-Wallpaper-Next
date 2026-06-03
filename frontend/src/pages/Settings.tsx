import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card, Button, Switch, Input, Tabs, Separator,
} from '@heroui/react';
import { ArrowLeft, FolderOpen, Plus, Trash2, Wand2 } from 'lucide-react';
import { getSettings, setSetting, pickDownloadDirectory, setDownloadDirectory, getStorageOverview } from '@/api/backend';
import type { AppSettings, ImageProviderConfig } from '@/types';
import { fetchImageProviders, parseProviderFromModelsDev, VOLCANO_PRESET, OPENAI_PRESET } from '@/api/generate';

export default function Settings() {
  const { tab } = useParams<{ tab?: string }>();
  const [settings, setLocalSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState(tab || 'general');
  const [storageOverview, setStorageOverview] = useState<any>(null);

  useEffect(() => {
    getSettings().then((s) => setLocalSettings(s as AppSettings));
    getStorageOverview().then((s) => setStorageOverview(s));
  }, []);

  const update = (key: string, value: any) => {
    if (!settings) return;
    const parts = key.split('.');
    const next = { ...settings };
    let cur: any = next;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = { ...cur[parts[i]] };
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    setLocalSettings(next);
    setSetting(key, value);
  };

  if (!settings) return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">设置</h1>
      <Card className="flex flex-col items-center justify-center py-20">
        <p className="text-muted">无法加载设置（未连接后端）</p>
      </Card>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Button isIconOnly variant="ghost" onPress={() => window.history.back()}><ArrowLeft size={18} /></Button>
        <h1 className="text-2xl font-bold">设置</h1>
      </div>

      <Tabs selectedKey={activeTab} onSelectionChange={(k) => setActiveTab(String(k))}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="设置分类">
            <Tabs.Tab id="general">通用<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="wallpaper">壁纸<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="content">内容<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="download">下载<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="generate">生成<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="sniff">嗅探<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="appearance">外观<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="about">关于<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="general">
          <Card className="space-y-4 p-4">
            <Section title="主页内容">
              <Row label="语句来源">
                <select
                  className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                  value={settings.home_page.source}
                  onChange={(e) => update('home_page.source', e.target.value)}
                >
                  <option value="hitokoto">一言</option>
                  <option value="zhaoyu">诏预</option>
                  <option value="custom">自定义</option>
                </select>
              </Row>
              <Row label="显示作者"><Switch isSelected={settings.home_page.show_author} onChange={(v) => update('home_page.show_author', v)} /></Row>
              <Row label="显示来源"><Switch isSelected={settings.home_page.show_source} onChange={(v) => update('home_page.show_source', v)} /></Row>
            </Section>
            <Separator />
            <Section title="开机与后台">
              <Row label="开机后自动隐藏到后台"><Switch isSelected={settings.startup.hide_on_launch} onChange={(v) => update('startup.hide_on_launch', v)} /></Row>
              <Row label="开机自启动"><Switch isSelected={settings.startup.auto_start} onChange={(v) => update('startup.auto_start', v)} /></Row>
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="wallpaper">
          <Card className="space-y-4 p-4">
            <Section title="自动更换">
              <Row label="启用"><Switch isSelected={settings.wallpaper.auto_change.enabled} onChange={(v) => update('wallpaper.auto_change.enabled', v)} /></Row>
              <Row label="模式">
                <select
                  className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                  value={settings.wallpaper.auto_change.mode}
                  onChange={(e) => update('wallpaper.auto_change.mode', e.target.value)}
                >
                  <option value="off">关闭</option>
                  <option value="interval">间隔</option>
                  <option value="schedule">定时</option>
                  <option value="slideshow">轮播</option>
                </select>
              </Row>
              {settings.wallpaper.auto_change.mode === 'interval' && (
                <Row label="间隔">
                  <Input
                    type="number"
                    className="w-24"
                    value={String(settings.wallpaper.auto_change.interval.value)}
                    onChange={(e) => update('wallpaper.auto_change.interval.value', Number(e.target.value))}
                  />
                  <select
                    className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                    value={settings.wallpaper.auto_change.interval.unit}
                    onChange={(e) => update('wallpaper.auto_change.interval.unit', e.target.value)}
                  >
                    <option value="seconds">秒</option>
                    <option value="minutes">分</option>
                    <option value="hours">时</option>
                  </select>
                </Row>
              )}
            </Section>
            <Separator />
            <Section title="历史记录">
              <Row label="自动保存历史壁纸副本"><Switch isSelected={settings.wallpaper.history_save_copy} onChange={(v) => update('wallpaper.history_save_copy', v)} /></Row>
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="content">
          <Card className="space-y-4 p-4">
            <Row label="显示 NSFW 内容"><Switch isSelected={settings.wallpaper.allow_NSFW} onChange={(v) => update('wallpaper.allow_NSFW', v)} /></Row>
            <Separator />
            <Section title="商店源">
              <Row label="使用自定义源"><Switch isSelected={settings.store.use_custom_source} onChange={(v) => update('store.use_custom_source', v)} /></Row>
              {settings.store.use_custom_source && (
                <Row label="自定义源 URL">
                  <Input
                    fullWidth
                    value={settings.store.custom_source_url}
                    onChange={(e) => update('store.custom_source_url', e.target.value)}
                  />
                </Row>
              )}
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="download">
          <Card className="space-y-4 p-4">
            <Section title="下载目录">
              <Row label="当前目录">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted truncate max-w-[200px]">
                    {storageOverview?.download_directory || settings.storage.download_directory || '默认'}
                  </span>
                  <Button size="sm" variant="secondary" onPress={async () => {
                    const result = await pickDownloadDirectory();
                    if (result?.path) {
                      await setDownloadDirectory(result.path);
                      const s = await getStorageOverview();
                      setStorageOverview(s);
                      const newSettings = await getSettings();
                      setLocalSettings(newSettings as AppSettings);
                    }
                  }}>
                    <FolderOpen size={14} /> 选择
                  </Button>
                </div>
              </Row>
              {settings.storage.download_directory && (
                <Row label="">
                  <Button size="sm" variant="ghost" onPress={async () => {
                    await setDownloadDirectory('');
                    const s = await getStorageOverview();
                    setStorageOverview(s);
                    const newSettings = await getSettings();
                    setLocalSettings(newSettings as AppSettings);
                  }}>恢复默认</Button>
                </Row>
              )}
            </Section>
            <Separator />
            <Section title="存储概览">
              {storageOverview?.items?.map((item: any) => (
                <Row key={item.id} label={item.title}>
                  <span className="text-xs text-muted">{item.file_count || 0} 文件 / {(item.size_bytes / 1024 / 1024).toFixed(1)} MB</span>
                </Row>
              ))}
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="generate">
          <GenerateSettingsPanel settings={settings} onUpdate={update} />
        </Tabs.Panel>

        <Tabs.Panel id="sniff">
          <Card className="space-y-4 p-4">
            <Row label="User-Agent">
              <Input fullWidth value={settings.sniff.user_agent} onChange={(e) => update('sniff.user_agent', e.target.value)} />
            </Row>
            <Row label="默认 Referer">
              <Input fullWidth value={settings.sniff.referer} onChange={(e) => update('sniff.referer', e.target.value)} />
            </Row>
            <Row label="自动使用输入链接作为 Referer"><Switch isSelected={settings.sniff.use_source_as_referer} onChange={(v) => update('sniff.use_source_as_referer', v)} /></Row>
            <Row label="超时时间 (秒)">
              <Input type="number" className="w-24" value={String(settings.sniff.timeout_seconds)} onChange={(e) => update('sniff.timeout_seconds', Number(e.target.value))} />
            </Row>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="appearance">
          <Card className="space-y-4 p-4">
            <Row label="界面主题">
              <select
                className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                value={settings.ui.theme}
                onChange={(e) => update('ui.theme', e.target.value)}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </Row>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="about">
          <Card className="space-y-4 p-6 text-center">
            <div className="text-3xl font-bold">小树壁纸 Next</div>
            <div className="text-muted">v2.0.0</div>
            <div className="text-sm text-muted">Copyright 2025 Little Tree Studio</div>
            <Separator />
            <p className="text-sm text-muted">一款桌面壁纸管理应用，支持多种壁纸来源、自动更换、收藏管理等功能。</p>
          </Card>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

function GenerateSettingsPanel({ settings, onUpdate }: { settings: AppSettings; onUpdate: (key: string, value: unknown) => void }) {
  const [mdProviders, setMdProviders] = useState<import('@/api/generate').ModelsDevProvider[] | null>(null);
  const [mdLoading, setMdLoading] = useState(false);
  const [showAddBuiltin, setShowAddBuiltin] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [builtinApiKey, setBuiltinApiKey] = useState('');
  const [customName, setCustomName] = useState('');
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customFormat, setCustomFormat] = useState<ImageProviderConfig['format']>('openai-compatible');

  const providers: ImageProviderConfig[] = settings.generate?.providers || [];
  const activeId = settings.generate?.active_provider_id || '';

  const loadMd = async () => {
    setMdLoading(true);
    try {
      const list = await fetchImageProviders();
      setMdProviders(list);
    } catch {
      setMdProviders([]);
    } finally {
      setMdLoading(false);
    }
  };

  const setProviders = (next: ImageProviderConfig[]) => {
    onUpdate('generate.providers', next);
  };

  const removeProvider = (id: string) => {
    const next = providers.filter((p) => p.id !== id);
    setProviders(next);
    if (activeId === id) {
      onUpdate('generate.active_provider_id', next[0]?.id || '');
    }
  };

  const ensureUniqueId = (baseId: string): string => {
    let id = baseId;
    let suffix = 1;
    while (providers.some((p) => p.id === id)) {
      id = `${baseId}-${suffix}`;
      suffix++;
    }
    return id;
  };

  const insertProvider = (cfg: ImageProviderConfig) => {
    const uniqueId = ensureUniqueId(cfg.id);
    const finalCfg = { ...cfg, id: uniqueId };
    const next = [...providers, finalCfg];
    setProviders(next);
    if (!activeId) onUpdate('generate.active_provider_id', uniqueId);
    return finalCfg;
  };

  const addBuiltin = () => {
    if (!selectedProvider || !selectedModel || !builtinApiKey) return;
    const p = mdProviders?.find((x) => x.id === selectedProvider);
    if (!p) return;
    const cfg = parseProviderFromModelsDev(p, selectedModel, builtinApiKey);
    insertProvider(cfg);
    setShowAddBuiltin(false);
    setSelectedProvider('');
    setSelectedModel('');
    setBuiltinApiKey('');
  };

  const addCustom = () => {
    if (!customName || !customEndpoint || !customApiKey || !customModel) return;
    const cfg: ImageProviderConfig = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: customName,
      format: customFormat,
      endpoint: customEndpoint,
      apiKey: customApiKey,
      model: customModel,
    };
    insertProvider(cfg);
    setShowAddCustom(false);
    setCustomName('');
    setCustomEndpoint('');
    setCustomApiKey('');
    setCustomModel('');
  };

  const currentMdProvider = mdProviders?.find((p) => p.id === selectedProvider);

  return (
    <Card className="space-y-4 p-4">
      <Section title="已配置的提供商">
        {providers.length === 0 && (
          <p className="text-sm text-muted">尚未配置任何图片生成提供商</p>
        )}
        <div className="space-y-2">
          {providers.map((p) => (
            <div key={p.id} className={`flex items-center justify-between rounded-lg border p-3 ${activeId === p.id ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="active_provider"
                  checked={activeId === p.id}
                  onChange={() => onUpdate('generate.active_provider_id', p.id)}
                  className="h-4 w-4"
                />
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-muted">{p.endpoint} · {p.model}</div>
                </div>
              </div>
              <Button isIconOnly variant="ghost" size="sm" onPress={() => removeProvider(p.id)}>
                <Trash2 size={14} className="text-danger" />
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Separator />

      <Section title="添加提供商">
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onPress={() => { setShowAddBuiltin(!showAddBuiltin); setShowAddCustom(false); if (!mdProviders) loadMd(); }}>
            <Wand2 size={14} /> 从 models.dev 添加
          </Button>
          <Button size="sm" variant="secondary" onPress={() => { setShowAddCustom(!showAddCustom); setShowAddBuiltin(false); }}>
            <Plus size={14} /> 自定义提供商
          </Button>
        </div>

        {showAddBuiltin && (
          <div className="mt-3 space-y-3 rounded-lg border border-border p-3">
            {mdLoading && <p className="text-sm text-muted">加载中...</p>}
            {mdProviders && (
              <>
                <div>
                  <label className="mb-1 block text-xs text-muted">提供商</label>
                  <select
                    className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm"
                    value={selectedProvider}
                    onChange={(e) => { setSelectedProvider(e.target.value); setSelectedModel(''); }}
                  >
                    <option value="">选择提供商</option>
                    {mdProviders.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.models.length} 个模型)</option>
                    ))}
                  </select>
                </div>
                {currentMdProvider && (
                  <div>
                    <label className="mb-1 block text-xs text-muted">模型</label>
                    <select
                      className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm"
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                    >
                      <option value="">选择模型</option>
                      {currentMdProvider.models.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs text-muted">API Key</label>
                  <Input
                    type="password"
                    fullWidth
                    value={builtinApiKey}
                    onChange={(e) => setBuiltinApiKey(e.target.value)}
                    placeholder="输入 API Key"
                  />
                </div>
                <Button size="sm" onPress={addBuiltin} isDisabled={!selectedProvider || !selectedModel || !builtinApiKey}>添加</Button>
              </>
            )}
          </div>
        )}

        {showAddCustom && (
          <div className="mt-3 space-y-3 rounded-lg border border-border p-3">
            <div>
              <label className="mb-1 block text-xs text-muted">名称</label>
              <Input fullWidth value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="例如：火山引擎" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">格式</label>
              <select
                className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm"
                value={customFormat}
                onChange={(e) => setCustomFormat(e.target.value as ImageProviderConfig['format'])}
              >
                <option value="openai">OpenAI</option>
                <option value="volcano">火山引擎</option>
                <option value="openai-compatible">OpenAI 兼容</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">端点 (Base URL)</label>
              <Input
                fullWidth
                value={customEndpoint}
                onChange={(e) => setCustomEndpoint(e.target.value)}
                placeholder={customFormat === 'volcano' ? VOLCANO_PRESET.endpoint : OPENAI_PRESET.endpoint}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">模型 ID</label>
              <Input fullWidth value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="例如：gpt-image-1" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">API Key</label>
              <Input type="password" fullWidth value={customApiKey} onChange={(e) => setCustomApiKey(e.target.value)} placeholder="输入 API Key" />
            </div>
            <Button size="sm" onPress={addCustom} isDisabled={!customName || !customEndpoint || !customApiKey || !customModel}>添加</Button>
          </div>
        )}
      </Section>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <div className="min-w-[200px] text-right">{children}</div>
    </div>
  );
}
