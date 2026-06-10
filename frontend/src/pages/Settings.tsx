import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card, Button, Switch, Input, Tabs, Separator, ComboBox, ListBox, RadioGroup, Radio, Label,
  Accordion, Link, Table,
} from '@heroui/react';
import {
  ArrowLeft, FolderOpen, Plus, Trash2, Wand2, ChevronDown, Heart, Package,
  Copyright, FileText, Shield, ExternalLink,
} from 'lucide-react';
import { getSettings, setSetting, pickDownloadDirectory, setDownloadDirectory, getStorageOverview, openUrl } from '@/api/backend';
import { useThemeContext } from '@/components/ThemeProvider';
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
                <ComboBox
                  className="w-40"
                  selectedKey={settings.home_page.source}
                  onSelectionChange={(key) => update('home_page.source', String(key))}
                >
                  <ComboBox.InputGroup>
                    <Input />
                    <ComboBox.Trigger />
                  </ComboBox.InputGroup>
                  <ComboBox.Popover>
                    <ListBox>
                      <ListBox.Item id="hitokoto" textValue="一言">一言</ListBox.Item>
                      <ListBox.Item id="zhaoyu" textValue="诏预">诏预</ListBox.Item>
                      <ListBox.Item id="custom" textValue="自定义">自定义</ListBox.Item>
                    </ListBox>
                  </ComboBox.Popover>
                </ComboBox>
              </Row>
              <Row label="显示作者"><Switch aria-label="显示作者" isSelected={settings.home_page.show_author} onChange={(v) => update('home_page.show_author', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
              <Row label="显示来源"><Switch aria-label="显示来源" isSelected={settings.home_page.show_source} onChange={(v) => update('home_page.show_source', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
            </Section>
            <Separator />
            <Section title="开机与后台">
              <Row label="开机后自动隐藏到后台"><Switch aria-label="开机后自动隐藏到后台" isSelected={settings.startup.hide_on_launch} onChange={(v) => update('startup.hide_on_launch', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
              <Row label="开机自启动"><Switch aria-label="开机自启动" isSelected={settings.startup.auto_start} onChange={(v) => update('startup.auto_start', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="wallpaper">
          <Card className="space-y-4 p-4">
            <Section title="自动更换">
              <Row label="启用"><Switch aria-label="启用" isSelected={settings.wallpaper.auto_change.enabled} onChange={(v) => update('wallpaper.auto_change.enabled', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
              <Row label="模式">
                <ComboBox
                  className="w-40"
                  selectedKey={settings.wallpaper.auto_change.mode}
                  onSelectionChange={(key) => update('wallpaper.auto_change.mode', String(key))}
                >
                  <ComboBox.InputGroup>
                    <Input />
                    <ComboBox.Trigger />
                  </ComboBox.InputGroup>
                  <ComboBox.Popover>
                    <ListBox>
                      <ListBox.Item id="off" textValue="关闭">关闭</ListBox.Item>
                      <ListBox.Item id="interval" textValue="间隔">间隔</ListBox.Item>
                      <ListBox.Item id="schedule" textValue="定时">定时</ListBox.Item>
                      <ListBox.Item id="slideshow" textValue="轮播">轮播</ListBox.Item>
                    </ListBox>
                  </ComboBox.Popover>
                </ComboBox>
              </Row>
              {settings.wallpaper.auto_change.mode === 'interval' && (
                <Row label="间隔">
                  <Input
                    type="number"
                    className="w-24"
                    value={String(settings.wallpaper.auto_change.interval.value)}
                    onChange={(e) => update('wallpaper.auto_change.interval.value', Number(e.target.value))}
                  />
                  <ComboBox
                    className="w-24"
                    selectedKey={settings.wallpaper.auto_change.interval.unit}
                    onSelectionChange={(key) => update('wallpaper.auto_change.interval.unit', String(key))}
                  >
                    <ComboBox.InputGroup>
                      <Input />
                      <ComboBox.Trigger />
                    </ComboBox.InputGroup>
                    <ComboBox.Popover>
                      <ListBox>
                        <ListBox.Item id="seconds" textValue="秒">秒</ListBox.Item>
                        <ListBox.Item id="minutes" textValue="分">分</ListBox.Item>
                        <ListBox.Item id="hours" textValue="时">时</ListBox.Item>
                      </ListBox>
                    </ComboBox.Popover>
                  </ComboBox>
                </Row>
              )}
            </Section>
            <Separator />
            <Section title="历史记录">
              <Row label="自动保存历史壁纸副本"><Switch aria-label="自动保存历史壁纸副本" isSelected={settings.wallpaper.history_save_copy} onChange={(v) => update('wallpaper.history_save_copy', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="content">
          <Card className="space-y-4 p-4">
            <Row label="显示 NSFW 内容"><Switch aria-label="显示 NSFW 内容" isSelected={settings.wallpaper.allow_NSFW} onChange={(v) => update('wallpaper.allow_NSFW', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
            <Separator />
            <Section title="商店源">
              <Row label="使用自定义源"><Switch aria-label="使用自定义源" isSelected={settings.store.use_custom_source} onChange={(v) => update('store.use_custom_source', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
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
            <Row label="自动使用输入链接作为 Referer"><Switch aria-label="自动使用输入链接作为 Referer" isSelected={settings.sniff.use_source_as_referer} onChange={(v) => update('sniff.use_source_as_referer', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
            <Row label="超时时间 (秒)">
              <Input type="number" className="w-24" value={String(settings.sniff.timeout_seconds)} onChange={(e) => update('sniff.timeout_seconds', Number(e.target.value))} />
            </Row>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="appearance">
          <AppearanceSettingsPanel settings={settings} onUpdate={update} />
        </Tabs.Panel>

        <Tabs.Panel id="about">
          <AboutPanel />
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
            <RadioGroup
              value={activeId}
              onChange={(v) => onUpdate('generate.active_provider_id', v)}
              className="space-y-2"
            >
              {providers.map((p) => (
                <Radio
                  key={p.id}
                  value={p.id}
                  className={`flex items-center justify-between rounded-lg border p-3 ${activeId === p.id ? 'border-primary bg-primary/5' : 'border-border'}`}
                >
                  <div className="flex flex-1 items-center gap-3">
                    <Radio.Control>
                      <Radio.Indicator />
                    </Radio.Control>
                    <Radio.Content>
                      <div className="text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-muted">{p.endpoint} · {p.model}</div>
                    </Radio.Content>
                  </div>
                  <Button isIconOnly variant="ghost" size="sm" onPress={() => removeProvider(p.id)}>
                    <Trash2 size={14} className="text-danger" />
                  </Button>
                </Radio>
              ))}
            </RadioGroup>
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
                  <Label className="mb-1 block text-xs text-muted">提供商</Label>
                  <ComboBox
                    className="w-full"
                    selectedKey={selectedProvider || null}
                    onSelectionChange={(key) => { setSelectedProvider(String(key || '')); setSelectedModel(''); }}
                  >
                    <ComboBox.InputGroup>
                      <Input placeholder="选择提供商" />
                      <ComboBox.Trigger />
                    </ComboBox.InputGroup>
                    <ComboBox.Popover>
                      <ListBox>
                        {mdProviders.map((p) => (
                          <ListBox.Item key={p.id} id={p.id} textValue={`${p.name} (${p.models.length} 个模型)`}>
                            {p.name} ({p.models.length} 个模型)
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </ComboBox.Popover>
                  </ComboBox>
                </div>
                {currentMdProvider && (
                  <div>
                    <Label className="mb-1 block text-xs text-muted">模型</Label>
                    <ComboBox
                      className="w-full"
                      selectedKey={selectedModel || null}
                      onSelectionChange={(key) => setSelectedModel(String(key || ''))}
                    >
                      <ComboBox.InputGroup>
                        <Input placeholder="选择模型" />
                        <ComboBox.Trigger />
                      </ComboBox.InputGroup>
                      <ComboBox.Popover>
                        <ListBox>
                          {currentMdProvider.models.map((m) => (
                            <ListBox.Item key={m.id} id={m.id} textValue={m.name}>
                              {m.name}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </ComboBox.Popover>
                    </ComboBox>
                  </div>
                )}
                <div>
                  <Label className="mb-1 block text-xs text-muted">API Key</Label>
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
              <Label className="mb-1 block text-xs text-muted">名称</Label>
              <Input fullWidth value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="例如：火山引擎" />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted">格式</Label>
              <ComboBox
                className="w-full"
                selectedKey={customFormat}
                onSelectionChange={(key) => setCustomFormat(String(key) as ImageProviderConfig['format'])}
              >
                <ComboBox.InputGroup>
                  <Input />
                  <ComboBox.Trigger />
                </ComboBox.InputGroup>
                <ComboBox.Popover>
                  <ListBox>
                    <ListBox.Item id="openai" textValue="OpenAI">OpenAI</ListBox.Item>
                    <ListBox.Item id="volcano" textValue="火山引擎">火山引擎</ListBox.Item>
                    <ListBox.Item id="openai-compatible" textValue="OpenAI 兼容">OpenAI 兼容</ListBox.Item>
                  </ListBox>
                </ComboBox.Popover>
              </ComboBox>
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted">端点 (Base URL)</Label>
              <Input
                fullWidth
                value={customEndpoint}
                onChange={(e) => setCustomEndpoint(e.target.value)}
                placeholder={customFormat === 'volcano' ? VOLCANO_PRESET.endpoint : OPENAI_PRESET.endpoint}
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted">模型 ID</Label>
              <Input fullWidth value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="例如：gpt-image-1" />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted">API Key</Label>
              <Input type="password" fullWidth value={customApiKey} onChange={(e) => setCustomApiKey(e.target.value)} placeholder="输入 API Key" />
            </div>
            <Button size="sm" onPress={addCustom} isDisabled={!customName || !customEndpoint || !customApiKey || !customModel}>添加</Button>
          </div>
        )}
      </Section>
    </Card>
  );
}

function AppearanceSettingsPanel({ settings, onUpdate }: { settings: AppSettings; onUpdate: (key: string, value: unknown) => void }) {
  const { setTheme } = useThemeContext();

  const handleThemeChange = (key: React.Key | null) => {
    const next = String(key || 'system') as 'system' | 'light' | 'dark';
    setTheme(next);
    onUpdate('ui.theme', next);
  };

  return (
    <Card className="space-y-4 p-4">
      <Row label="界面主题">
        <ComboBox
          className="w-40"
          selectedKey={settings.ui.theme}
          onSelectionChange={handleThemeChange}
        >
          <ComboBox.InputGroup>
            <Input />
            <ComboBox.Trigger />
          </ComboBox.InputGroup>
          <ComboBox.Popover>
            <ListBox>
              <ListBox.Item id="system" textValue="跟随系统">跟随系统</ListBox.Item>
              <ListBox.Item id="light" textValue="浅色">浅色</ListBox.Item>
              <ListBox.Item id="dark" textValue="深色">深色</ListBox.Item>
            </ListBox>
          </ComboBox.Popover>
        </ComboBox>
      </Row>
    </Card>
  );
}

function AboutPanel() {
  const handleOpenUrl = (url: string) => {
    openUrl(url);
  };

  return (
    <div className="space-y-4">
      <Card className="p-6 text-center">
        <div className="mb-2 flex justify-center">
          <img src="./logo.png" alt="小树壁纸" className="h-16 w-16 rounded-xl object-cover" />
        </div>
        <div className="text-2xl font-bold">小树壁纸 Next</div>
        <div className="text-muted">v2.0.0</div>
        <Separator className="my-4" />
        <p className="text-sm text-muted">
          一款桌面壁纸管理应用，支持多种壁纸来源、AI 生成、自动更换、收藏管理等功能。
        </p>
      </Card>

      <Accordion variant="surface">
        <Accordion.Item id="sponsors">
          <Accordion.Heading>
            <Accordion.Trigger>
              <Heart size={16} className="text-danger shrink-0" />
              <span>赞助</span>
              <Accordion.Indicator>
                <ChevronDown size={16} />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <div className="space-y-3 text-sm text-muted">
                <p>感谢以下支持者对小树壁纸的赞助与支持：</p>
                <Table variant="secondary">
                  <Table.ScrollContainer>
                    <Table.Content aria-label="赞助者名单">
                      <Table.Header>
                        <Table.Column isRowHeader>赞助者</Table.Column>
                        <Table.Column>金额</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        <Table.Row>
                          <Table.Cell className="font-medium">炫饭的芙芙</Table.Cell>
                          <Table.Cell className="text-danger font-medium">520￥ 👑</Table.Cell>
                        </Table.Row>
                        <Table.Row>
                          <Table.Cell>*匿名赞助*</Table.Cell>
                          <Table.Cell>66￥</Table.Cell>
                        </Table.Row>
                        <Table.Row>
                          <Table.Cell>Giampaolo-zzp</Table.Cell>
                          <Table.Cell>50￥</Table.Cell>
                        </Table.Row>
                        <Table.Row>
                          <Table.Cell>Kyle</Table.Cell>
                          <Table.Cell>30￥</Table.Cell>
                        </Table.Row>
                        <Table.Row>
                          <Table.Cell>昊阳（漩涡7人）</Table.Cell>
                          <Table.Cell>8.88￥</Table.Cell>
                        </Table.Row>
                        <Table.Row>
                          <Table.Cell>蔡亩</Table.Cell>
                          <Table.Cell>6￥</Table.Cell>
                        </Table.Row>
                        <Table.Row>
                          <Table.Cell>小苗</Table.Cell>
                          <Table.Cell>6￥</Table.Cell>
                        </Table.Row>
                        <Table.Row>
                          <Table.Cell>Zero</Table.Cell>
                          <Table.Cell>6￥</Table.Cell>
                        </Table.Row>
                        <Table.Row>
                          <Table.Cell>遮天s忏悔</Table.Cell>
                          <Table.Cell>5.91￥</Table.Cell>
                        </Table.Row>
                        <Table.Row>
                          <Table.Cell>青山如岱</Table.Cell>
                          <Table.Cell>5￥</Table.Cell>
                        </Table.Row>
                        <Table.Row>
                          <Table.Cell>LYC(luis)</Table.Cell>
                          <Table.Cell>1￥</Table.Cell>
                        </Table.Row>
                        <Table.Row>
                          <Table.Cell>Cu_32767</Table.Cell>
                          <Table.Cell>0.91￥</Table.Cell>
                        </Table.Row>                        
                        <Table.Row>
                          <Table.Cell>wzr</Table.Cell>
                          <Table.Cell>0.01￥</Table.Cell>
                        </Table.Row>
                        <Table.Row>
                          <Table.Cell>Furuya</Table.Cell>
                          <Table.Cell>0.01￥</Table.Cell>
                        </Table.Row>
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
                <p>您的支持是我们持续改进的动力。</p>
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item id="acknowledgements">
          <Accordion.Heading>
            <Accordion.Trigger>
              <Shield size={16} className="text-primary shrink-0" />
              <span>鸣谢</span>
              <Accordion.Indicator>
                <ChevronDown size={16} />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <div className="space-y-3 text-sm text-muted">
                <p>小树壁纸的开发离不开以下优秀开源项目与服务的支持：</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>壁纸源服务：小树壁纸资源中心</li>
                  <li>壁纸源市场：IntelliMarkets</li>
                  <li>搜索服务：百度图片</li>
                  <li>AI 图片生成：各 AI 提供商</li>
                  <li>UI 组件库：HeroUI</li>
                  <li>图标库：Lucide</li>
                </ul>
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item id="dependencies">
          <Accordion.Heading>
            <Accordion.Trigger>
              <Package size={16} className="text-accent shrink-0" />
              <span>依赖说明</span>
              <Accordion.Indicator>
                <ChevronDown size={16} />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <div className="space-y-4 text-sm text-muted">
                <p>本项目使用了大量优秀的开源软件，以下列出所有直接及间接依赖及其许可证信息：</p>

                <div className="space-y-2">
                  <p className="font-medium text-foreground">前端运行时与框架</p>
                  <div className="grid grid-cols-2 gap-2">
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">react@19.2.6 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">react-dom@19.2.6 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">react-router@7.16.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">react-router-dom@7.16.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">scheduler@0.27.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">use-sync-external-store@1.6.0 (MIT)</span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="font-medium text-foreground">UI 组件与样式</p>
                  <div className="grid grid-cols-2 gap-2">
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@heroui/react@3.1.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@heroui/styles@3.1.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">tailwindcss@4.3.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@tailwindcss/vite@4.3.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">tailwind-merge@3.4.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">tailwind-variants@3.2.2 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">tw-animate-css@1.4.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">lucide-react@0.460.0 (ISC)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">clsx@2.1.1 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">input-otp@1.4.2 (MIT)</span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="font-medium text-foreground">React Aria / Adobe Spectrum (Apache-2.0)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">react-aria@3.48.0</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">react-aria-components@1.17.0</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">react-stately@3.46.0</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@adobe/react-spectrum@3.47.1</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@react-aria/*</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@react-stately/*</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@react-types/*</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@react-spectrum/*</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@spectrum-icons/*</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@internationalized/*</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@swc/helpers@0.5.23</span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="font-medium text-foreground">Radix UI (MIT)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@radix-ui/react-avatar@1.1.11</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@radix-ui/react-primitive@2.1.4</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@radix-ui/react-slot@1.2.4</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@radix-ui/react-context@1.1.3</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@radix-ui/react-compose-refs@1.1.2</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@radix-ui/react-use-*@1.1.1</span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="font-medium text-foreground">构建工具</p>
                  <div className="grid grid-cols-2 gap-2">
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">vite@6.4.2 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@vitejs/plugin-react@4.7.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">esbuild@0.25.12 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">rollup@4.60.4 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">typescript@5.9.3 (Apache-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@babel/*@7.29.7 (MIT)</span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="font-medium text-foreground">前端其他依赖</p>
                  <div className="grid grid-cols-3 gap-2">
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">postcss@8.5.15 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">nanoid@3.3.12 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">tslib@2.8.1 (0BSD)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">lightningcss@1.32.0 (MPL-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">caniuse-lite@1.0.30 (CC-BY-4.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">source-map-js@1.2.1 (BSD-3-Clause)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">intl-messageformat@10.7.18 (BSD-3-Clause)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">react-transition-group@4.4.5 (BSD-3-Clause)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@formatjs/*@2.x (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@jridgewell/* (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@types/* (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@rolldown/pluginutils (MIT)</span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="font-medium text-foreground">后端 (Python)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">pywebview@6.2.1 (BSD-3-Clause)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">requests@2.34.2 (Apache-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">platformdirs@4.10.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">pillow@12.2.0 (HPND)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">psutil@7.2.2 (BSD-3-Clause)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">pystray@0.19.5 (LGPL-3.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">pyperclip@1.11.0 (BSD)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">loguru@0.7.3 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">aiohttp@3.14.0 (Apache-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">certifi@2026.5.20 (MPL-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">aiohappyeyeballs@2.6.2 (PSF-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">aiosignal@1.4.0 (Apache-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">attrs@26.1.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">bottle@0.13.4 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">cffi@2.0.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">charset-normalizer@3.4.7 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">clr-loader@0.3.1 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">colorama@0.4.6 (BSD)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">frozenlist@1.8.0 (Apache-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">idna@3.18 (BSD-3-Clause)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">multidict@6.7.1 (Apache-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">propcache@0.5.2 (Apache-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">proxy-tools@0.1.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">pycparser@3.0 (BSD-3-Clause)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">pythonnet@3.1.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">six@1.17.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">typing-extensions@4.15.0 (PSF-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">urllib3@2.7.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">win32-setctime@1.2.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">yarl@1.24.2 (Apache-2.0)</span>
                  </div>
                </div>

                <p className="text-xs">
                  完整依赖列表及精确版本请参阅项目源码中的 package.json、package-lock.json、pyproject.toml 及 uv.lock。
                  前端共 140+ 个包，后端共 30 个包。
                </p>
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item id="copyright">
          <Accordion.Heading>
            <Accordion.Trigger>
              <Copyright size={16} className="text-muted shrink-0" />
              <span>版权说明</span>
              <Accordion.Indicator>
                <ChevronDown size={16} />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <div className="space-y-3 text-sm text-muted">
                <p>Copyright 2026 Little Tree Studio. 保留所有权利。</p>
                <Separator />
                <p>本软件按"原样"提供，不提供任何明示或暗示的担保。</p>
                <div className="space-y-1 rounded-md bg-surface-tertiary p-3">
                  <p className="font-medium text-foreground">第三方数据声明</p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>部分壁纸源由小树壁纸资源中心、IntelliMarkets-壁纸源市场提供</li>
                    <li>部分搜索功能由百度图片提供</li>
                    <li>生成功能由对应 AI 提供商提供</li>
                    <li>壁纸源的数据由对应壁纸源负责</li>
                  </ul>
                </div>
                <p>
                  更多详见
                  <Link
                    className="ml-1 inline-flex items-center gap-0.5"
                    onPress={() => handleOpenUrl('https://docs.zsxiaoshu.cn/terms/wallpaper/user_agreement/')}
                  >
                    小树壁纸用户协议
                    <ExternalLink size={12} />
                  </Link>
                </p>
                <p className="text-xs">
                  当您使用本软件时，即表示您接受小树壁纸用户协议及第三方数据提供方条款。
                </p>
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item id="third-party">
          <Accordion.Heading>
            <Accordion.Trigger>
              <FileText size={16} className="text-success shrink-0" />
              <span>第三方数据提供商条款</span>
              <Accordion.Indicator>
                <ChevronDown size={16} />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <div className="space-y-3 text-sm text-muted">
                <div className="space-y-2">
                  <p className="font-medium text-foreground">IntelliMarkets</p>
                  <p className="text-xs">
                    壁纸源市场服务条款：
                    <Link
                      className="ml-1 inline-flex items-center gap-0.5 break-all"
                      onPress={() => handleOpenUrl('https://github.com/SRInternet-Studio/Wallpaper-generator/blob/NEXT-PREVIEW/DISCLAIMER.md')}
                    >
                      https://github.com/SRInternet-Studio/Wallpaper-generator/blob/NEXT-PREVIEW/DISCLAIMER.md
                      <ExternalLink size={12} />
                    </Link>
                  </p>
                </div>
                <Separator />
                <div className="space-y-2">
                  <p className="font-medium text-foreground">小树壁纸用户协议</p>
                  <p className="text-xs">
                    <Link
                      className="inline-flex items-center gap-0.5 break-all"
                      onPress={() => handleOpenUrl('https://docs.zsxiaoshu.cn/terms/wallpaper/user_agreement/')}
                    >
                      https://docs.zsxiaoshu.cn/terms/wallpaper/user_agreement/
                      <ExternalLink size={12} />
                    </Link>
                  </p>
                </div>
                <p className="text-xs text-muted">
                  当您使用本软件时，即表示您接受小树壁纸用户协议及第三方数据提供方条款。
                </p>
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </div>
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
