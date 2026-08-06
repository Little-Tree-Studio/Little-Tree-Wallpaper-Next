import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'wouter';
import {
  Card, Button, Switch, Input, Tabs, Separator, ComboBox, ListBox, RadioGroup, Radio, Label,
  Accordion, Link, Table, Modal, TextArea, toast, Autocomplete, SearchField, EmptyState, Tag,
  TagGroup, useFilter, Checkbox, CheckboxGroup, Spinner, Chip,
} from '@heroui/react';
import type { Key } from '@heroui/react';
import {
  Plus, Trash2, Wand2, ChevronDown, Heart, Package,
  Copyright, FileText, Shield, ExternalLink, Pencil, Upload, Download, RefreshCw,
} from 'lucide-react';
import { getSettings, setSetting, getAutostartStatus, setAutostartEnabled, getStorageOverview, openUrl, importCustomSentences, exportCustomSentences, getAppInfo, getBuildInfo } from '@/api/backend';
import StorageSettingsPanel from '@/components/StorageSettingsPanel';
import ThemeSettingsPanel from '@/components/ThemeSettingsPanel';
import PluginSettingsPanel from '@/components/PluginSettingsPanel';
import { requestNavigation } from '@/lib/navigationGuard';
import type {
  AppSettings,
  AutostartStatus,
  CustomSentence,
  DynamicWallpaperPerformanceAction,
  ImageProviderConfig,
  StorageOverview,
} from '@/types';
import {
  fetchImageProviders,
  parseProviderFromModelsDev,
  DEFAULT_ENDPOINT,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  MAX_IMAGES_PER_BATCH,
  POLLINATIONS_PROVIDER_ID,
} from '@/api/generate';

function getNestedValue(source: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((current, part) => (
    current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined
  ), source);
}

function setNestedValue(source: AppSettings, key: string, value: unknown): AppSettings {
  const parts = key.split('.');
  const next = { ...source } as unknown as Record<string, unknown>;
  let current = next;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    current[part] = child && typeof child === 'object' ? { ...(child as Record<string, unknown>) } : {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
  return next as unknown as AppSettings;
}

export default function Settings() {
  const { tab } = useParams<{ tab?: string }>();
  const [settings, setLocalSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState(tab || 'general');
  const [storageOverview, setStorageOverview] = useState<StorageOverview | null | undefined>(undefined);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [autostartStatus, setAutostartStatus] = useState<AutostartStatus | null>(null);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const settingsRequestId = useRef(0);
  const settingsController = useRef<AbortController | null>(null);
  const [nsfwDialogOpen, setNsfwDialogOpen] = useState(false);
  const [nsfwConfirmAdult, setNsfwConfirmAdult] = useState(false);
  const [nsfwConfirmLegal, setNsfwConfirmLegal] = useState(false);
  const [quickEditorEnabled, setQuickEditorEnabled] = useState(() => localStorage.getItem('ltw:create:quick-editor-enabled') !== 'false');
  const nsfwConfirmValue = useMemo(
    () => [
      ...(nsfwConfirmAdult ? ['adult'] : []),
      ...(nsfwConfirmLegal ? ['legal'] : []),
    ],
    [nsfwConfirmAdult, nsfwConfirmLegal]
  );
  const handleNsfwConfirmChange = (values: string[]) => {
    setNsfwConfirmAdult(values.includes('adult'));
    setNsfwConfirmLegal(values.includes('legal'));
  };

  const loadSettings = () => {
    const requestId = ++settingsRequestId.current;
    settingsController.current?.abort();
    const controller = new AbortController();
    settingsController.current = controller;
    setSettingsLoading(true);
    setSettingsError(null);
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    Promise.all([getSettings(controller.signal), getAutostartStatus(controller.signal)])
      .then(([s, status]) => {
        if (requestId === settingsRequestId.current) {
          setLocalSettings(s as AppSettings);
          setAutostartStatus(status);
        }
      })
      .catch((error: unknown) => {
        if (requestId !== settingsRequestId.current) return;
        setSettingsError(
          error instanceof DOMException && error.name === 'AbortError'
            ? '连接后端超时，请重试。'
            : error instanceof Error ? error.message : '后端未响应',
        );
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (requestId === settingsRequestId.current) setSettingsLoading(false);
        if (settingsController.current === controller) settingsController.current = null;
      });
  };

  useEffect(() => {
    loadSettings();
    getStorageOverview().then((s) => setStorageOverview(s)).catch(() => setStorageOverview(null));
    return () => {
      settingsRequestId.current += 1;
      settingsController.current?.abort();
      settingsController.current = null;
    };
  }, []);

  const update = (key: string, value: unknown) => {
    if (!settings) return;
    const previousValue = getNestedValue(settings, key);
    setLocalSettings((currentSettings) => currentSettings ? setNestedValue(currentSettings, key, value) : currentSettings);
    void setSetting(key, value).catch((error: unknown) => {
      setLocalSettings((currentSettings) => {
        if (!currentSettings || !Object.is(getNestedValue(currentSettings, key), value)) return currentSettings;
        return setNestedValue(currentSettings, key, previousValue);
      });
      toast.danger('设置保存失败', {
        description: error instanceof Error ? error.message : '请稍后重试',
        timeout: 0,
      });
    });
  };

  const updateAutostart = async (enabled: boolean) => {
    if (autostartBusy) return;
    setAutostartBusy(true);
    try {
      const status = await setAutostartEnabled(enabled);
      setAutostartStatus(status);
      setLocalSettings((currentSettings) => currentSettings
        ? setNestedValue(currentSettings, 'startup.auto_start', enabled)
        : currentSettings);
      toast.success(enabled ? '已启用开机自启动' : '已关闭开机自启动');
    } catch (error: unknown) {
      toast.danger(enabled ? '无法启用开机自启动' : '无法关闭开机自启动', {
        description: error instanceof Error ? error.message : '请检查系统权限后重试',
        timeout: 0,
      });
    } finally {
      setAutostartBusy(false);
    }
  };

  if (settingsLoading && !settings) return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">设置</h1>
      <Card className="flex flex-col items-center justify-center gap-3 py-20">
        <Spinner size="sm" />
        <p className="text-muted">正在加载设置...</p>
      </Card>
    </div>
  );

  if (!settings) return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">设置</h1>
      <Card className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-danger">设置加载失败</p>
        <p className="max-w-md text-sm text-muted">{settingsError || '后端未响应，请稍后重试。'}</p>
        <Button size="sm" variant="secondary" onPress={loadSettings}>
          <RefreshCw size={14} /> 重试
        </Button>
      </Card>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">设置</h1>

      <Tabs
        selectedKey={activeTab}
        onSelectionChange={(key) => {
          const nextTab = String(key);
          if (nextTab === activeTab) return;
          requestNavigation(`settings:${nextTab}`, () => setActiveTab(nextTab));
        }}
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="设置分类">
            <Tabs.Tab id="general"><span className="whitespace-nowrap">通用</span><Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="wallpaper"><span className="whitespace-nowrap">壁纸</span><Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="content"><span className="whitespace-nowrap">内容</span><Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="storage"><span className="whitespace-nowrap">存储</span><Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="generate"><span className="whitespace-nowrap">生成</span><Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="sniff"><span className="whitespace-nowrap">嗅探</span><Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="appearance"><span className="whitespace-nowrap">外观</span><Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="plugins"><span className="whitespace-nowrap">插件</span><Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="about"><span className="whitespace-nowrap">关于</span><Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="general">
          <Card className="space-y-4 p-4">
            <Section title="窗口与托盘">
              <Row label="关闭主窗口时隐藏到托盘"><Switch aria-label="关闭主窗口时隐藏到托盘" isSelected={settings.ui.hide_on_close} onChange={(v) => update('ui.hide_on_close', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
              <Row label="启用系统托盘"><Switch aria-label="启用系统托盘" isSelected={settings.ui.minimize_to_tray} onChange={(v) => update('ui.minimize_to_tray', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
              <Row label="关闭时释放主界面内存"><Switch aria-label="关闭时释放主界面内存" isSelected={settings.ui.release_webview_on_close} onChange={(v) => update('ui.release_webview_on_close', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
              <p className="text-xs text-muted">释放主界面后，自动化和动态壁纸继续在后台运行；从托盘打开时会重新创建界面。托盘开关重启程序后生效。</p>
            </Section>
            <Separator />
            <Section title="开机与后台">
              <Row label="开机自启动">
                <Switch
                  aria-label="开机自启动"
                  isSelected={autostartStatus?.enabled ?? false}
                  isDisabled={!autostartStatus?.supported || autostartBusy}
                  onChange={(enabled) => void updateAutostart(enabled)}
                ><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
              </Row>
              <Row label="自启动时隐藏主界面"><Switch aria-label="自启动时隐藏主界面" isSelected={settings.startup.hide_on_launch} onChange={(v) => update('startup.hide_on_launch', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                {autostartStatus?.platform && <Chip size="sm" variant="soft">{autostartStatus.platform}</Chip>}
                {autostartStatus?.mechanism && <span>通过 {autostartStatus.mechanism} 注册，仅对当前用户生效。</span>}
              </div>
              {autostartStatus?.reason && <p className="text-xs text-warning">{autostartStatus.reason}</p>}
              <p className="text-xs text-muted">隐藏启动需要系统托盘可用；如果托盘未启用或启动失败，主界面会自动显示。</p>
            </Section>
            <Separator />
            <HomePagePanel settings={settings} onUpdate={update} onReload={async () => {
              const s = await getSettings();
              setLocalSettings(s as AppSettings);
            }} />
            <Separator />
            <Section title="壁纸制作">
              <Row label="点击组件时显示快捷编辑面板"><Switch aria-label="点击组件时显示快捷编辑面板" isSelected={quickEditorEnabled} onChange={(enabled) => { setQuickEditorEnabled(enabled); localStorage.setItem('ltw:create:quick-editor-enabled', String(enabled)); window.dispatchEvent(new CustomEvent('ltw:quick-editor-setting', { detail: enabled })); }}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
              <Row label="默认显示辅助网格"><Switch aria-label="默认显示辅助网格" isSelected={settings.create.show_grid} onChange={(v) => update('create.show_grid', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
              <Row label="默认启用智能吸附"><Switch aria-label="默认启用智能吸附" isSelected={settings.create.snap_to_guides} onChange={(v) => update('create.snap_to_guides', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
              <Row label="默认导出格式">
                <ComboBox aria-label="默认导出格式" className="w-full sm:w-40" selectedKey={settings.create.export_format} onSelectionChange={(key) => update('create.export_format', String(key))}>
                  <ComboBox.InputGroup><Input /><ComboBox.Trigger /></ComboBox.InputGroup>
                  <ComboBox.Popover><ListBox>
                    <ListBox.Item id="png" textValue="PNG">PNG</ListBox.Item>
                    <ListBox.Item id="jpeg" textValue="JPEG">JPEG</ListBox.Item>
                  </ListBox></ComboBox.Popover>
                </ComboBox>
              </Row>
              {settings.create.export_format === 'jpeg' && (
                <Row label="JPEG 默认质量">
                  <Input aria-label="JPEG 默认质量" type="number" min={40} max={100} className="w-full sm:w-28" value={String(settings.create.jpeg_quality)} onChange={(event) => update('create.jpeg_quality', Math.max(40, Math.min(100, Number(event.target.value) || 40)))} />
                </Row>
              )}
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="wallpaper">
          <Card className="space-y-4 p-4">
            <Section title="动态壁纸性能">
              <p className="text-sm text-muted">检测到以下系统状态时，自动调整动态壁纸的运行方式。</p>
              <PerformanceActionRow label="其他应用程序成为焦点时" value={settings.wallpaper.dynamic.performance.other_application_focused} onChange={(value) => update('wallpaper.dynamic.performance.other_application_focused', value)} />
              <PerformanceActionRow label="其他应用程序最大化时" value={settings.wallpaper.dynamic.performance.other_application_maximized} onChange={(value) => update('wallpaper.dynamic.performance.other_application_maximized', value)} />
              <PerformanceActionRow label="其他应用程序全屏时" value={settings.wallpaper.dynamic.performance.other_application_fullscreen} onChange={(value) => update('wallpaper.dynamic.performance.other_application_fullscreen', value)} />
              <PerformanceActionRow label="其他应用程序播放音频时" value={settings.wallpaper.dynamic.performance.other_application_audio} onChange={(value) => update('wallpaper.dynamic.performance.other_application_audio', value)} />
              <PerformanceActionRow label="笔记本电脑使用电池时" value={settings.wallpaper.dynamic.performance.on_battery} onChange={(value) => update('wallpaper.dynamic.performance.on_battery', value)} />
              <p className="text-xs text-muted">多个条件同时满足时，优先级为停止、暂停、静音、保持运行。停止会释放动态壁纸资源，条件解除后自动重新创建。</p>
            </Section>
            <Separator />
            <Section title="退出后保留画面">
              <Row label="同步动态壁纸截图">
                <Switch
                  aria-label="同步动态壁纸截图"
                  isSelected={settings.wallpaper.dynamic.static_snapshot.enabled}
                  onChange={(enabled) => update('wallpaper.dynamic.static_snapshot.enabled', enabled)}
                ><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
              </Row>
              <p className="text-xs text-muted">开启后每 5 分钟将当前动态壁纸画面设为 Windows 静态壁纸；图片轮播每次切换后也会立即同步。周期固定，程序退出后仍可看到最近一次画面。</p>
            </Section>
            <Separator />
            <Section title="历史记录">
              <Row label="最多保留记录">
                <Input aria-label="最多保留壁纸历史记录" type="number" min={10} max={2000} className="w-full sm:w-28" value={String(settings.wallpaper.history.max_items)} onChange={(event) => update('wallpaper.history.max_items', Math.max(10, Math.min(2000, Number(event.target.value) || 10)))} />
              </Row>
              <Row label="加载预览图数量">
                <Input aria-label="壁纸历史预览图数量" type="number" min={0} max={settings.wallpaper.history.max_items} className="w-full sm:w-28" value={String(settings.wallpaper.history.preview_items)} onChange={(event) => update('wallpaper.history.preview_items', Math.max(0, Math.min(settings.wallpaper.history.max_items, Number(event.target.value) || 0)))} />
              </Row>
            </Section>
            <Separator />
            <Section title="壁纸源">
              <Row label="合并显示"><Switch aria-label="合并显示" isSelected={settings.wallpaper.sources?.merge_display ?? true} onChange={(v) => update('wallpaper.sources.merge_display', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="content">
          <Card className="space-y-4 p-4">
            <Row label="显示 NSFW 内容"><Switch aria-label="显示 NSFW 内容" isSelected={settings.wallpaper.allow_NSFW} onChange={(v) => {
              if (v) {
                setNsfwConfirmAdult(false);
                setNsfwConfirmLegal(false);
                setNsfwDialogOpen(true);
              } else {
                update('wallpaper.allow_NSFW', false);
              }
            }}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
            <Separator />
            <Section title="Pixiv">
              <Row label="收藏时添加作品标签"><Switch aria-label="Pixiv 收藏时添加作品标签" isSelected={settings.wallpaper.pixiv?.include_artwork_tags_in_favorites ?? true} onChange={(v) => update('wallpaper.pixiv.include_artwork_tags_in_favorites', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
            </Section>
            <Separator />
            <Section title="IntelliMarkets">
              <Row label="镜像偏好">
                <ComboBox aria-label="IntelliMarkets 镜像偏好" className="w-full sm:w-40" selectedKey={settings.im?.mirror_preference || 'auto'} onSelectionChange={(key) => update('im.mirror_preference', String(key))}>
                  <ComboBox.InputGroup><Input /><ComboBox.Trigger /></ComboBox.InputGroup>
                  <ComboBox.Popover><ListBox>
                    <ListBox.Item id="auto" textValue="自动">自动</ListBox.Item>
                    <ListBox.Item id="github" textValue="GitHub">GitHub</ListBox.Item>
                    <ListBox.Item id="jsdelivr" textValue="jsDelivr">jsDelivr</ListBox.Item>
                    <ListBox.Item id="ghproxy" textValue="gh-proxy">gh-proxy</ListBox.Item>
                  </ListBox></ComboBox.Popover>
                </ComboBox>
              </Row>
              <Row label="自动检查源可用性"><Switch aria-label="自动检查 IntelliMarkets 源可用性" isSelected={settings.im?.auto_health_check !== false} onChange={(v) => update('im.auto_health_check', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="storage">
          <StorageSettingsPanel
            settings={settings}
            initialOverview={storageOverview}
            onOverviewChange={setStorageOverview}
            onSettingsChange={setLocalSettings}
            onUpdate={update}
          />
        </Tabs.Panel>

        <Tabs.Panel id="generate">
          <GenerateSettingsPanel settings={settings} onUpdate={update} />
        </Tabs.Panel>

        <Tabs.Panel id="sniff">
          <Card className="space-y-4 p-4">
            <Section title="网页嗅探">
              <Row label="User-Agent"><Input fullWidth value={settings.sniff.user_agent} onChange={(e) => update('sniff.user_agent', e.target.value)} /></Row>
              <Row label="默认 Referer"><Input fullWidth value={settings.sniff.referer} onChange={(e) => update('sniff.referer', e.target.value)} /></Row>
              <Row label="自动使用输入链接作为 Referer"><Switch aria-label="自动使用输入链接作为 Referer" isSelected={settings.sniff.use_source_as_referer} onChange={(v) => update('sniff.use_source_as_referer', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
              <Row label="请求超时 (秒)"><Input aria-label="嗅探请求超时秒数" type="number" min={5} max={120} className="w-full sm:w-28" value={String(settings.sniff.timeout_seconds)} onChange={(e) => update('sniff.timeout_seconds', Math.max(5, Math.min(120, Number(e.target.value) || 5)))} /></Row>
              <Row label="单次最多提取"><Input aria-label="单次最多提取图片数" type="number" min={20} max={2000} className="w-full sm:w-28" value={String(settings.sniff.max_results)} onChange={(e) => update('sniff.max_results', Math.max(20, Math.min(2000, Number(e.target.value) || 20)))} /></Row>
            </Section>
            <Separator />
            <Section title="图片下载">
              <Row label="下载超时 (秒)"><Input aria-label="图片下载超时秒数" type="number" min={10} max={600} className="w-full sm:w-28" value={String(settings.download.timeout_seconds)} onChange={(e) => update('download.timeout_seconds', Math.max(10, Math.min(600, Number(e.target.value) || 10)))} /></Row>
              <Row label="批量下载并发数"><Input aria-label="批量下载并发数" type="number" min={1} max={8} className="w-full sm:w-28" value={String(settings.download.concurrent_tasks)} onChange={(e) => update('download.concurrent_tasks', Math.max(1, Math.min(8, Number(e.target.value) || 1)))} /></Row>
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="appearance">
          <ThemeSettingsPanel />
        </Tabs.Panel>

        <Tabs.Panel id="plugins">
          <PluginSettingsPanel />
        </Tabs.Panel>

        <Tabs.Panel id="about">
          <AboutPanel />
        </Tabs.Panel>
      </Tabs>

        <Modal.Backdrop isOpen={nsfwDialogOpen} onOpenChange={setNsfwDialogOpen} isDismissable={false}>
        <Modal.Container size="sm">
          <Modal.Dialog className="min-w-[340px]">
            <Modal.Header><Modal.Heading>确认开启 NSFW 内容</Modal.Heading></Modal.Header>
            <Modal.Body>
              <div className="space-y-4">
                <p className="text-sm text-muted">
                  开启「显示 NSFW 内容」后，壁纸源中标记为包含 NSFW 的 API 将会显示并可用。请确认以下事项：
                </p>
                <div className="space-y-3">
                  <CheckboxGroup value={nsfwConfirmValue} onChange={handleNsfwConfirmChange}>
                    <Checkbox value="adult">
                      <Checkbox.Content className="flex-row items-center">
                        <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                        <span className="whitespace-nowrap">我已年满 18 周岁</span>
                      </Checkbox.Content>
                    </Checkbox>
                    <Checkbox value="legal">
                      <Checkbox.Content className="flex-row items-center">
                        <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                        <span className="whitespace-nowrap">我所在的国家/地区允许访问 NSFW 内容</span>
                      </Checkbox.Content>
                    </Checkbox>
                  </CheckboxGroup>
                </div>
                <div className="rounded-lg border border-border bg-surface-secondary p-3 text-xs text-muted leading-relaxed">
                  NSFW 内容可能包含不适宜在工作场合或公共场所查看的图片。本应用仅作为工具提供内容访问能力，不对第三方壁纸源的内容负责。访问此类内容须遵守当地法律法规，因违反相关规定而产生的后果由用户自行承担。
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setNsfwDialogOpen(false)}>取消</Button>
              <Button
                isDisabled={!nsfwConfirmAdult || !nsfwConfirmLegal}
                onPress={() => {
                  update('wallpaper.allow_NSFW', true);
                  setNsfwDialogOpen(false);
                }}
              >
                确认开启
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

const PERFORMANCE_ACTIONS: { id: DynamicWallpaperPerformanceAction; label: string }[] = [
  { id: 'keep_running', label: '保持运行' },
  { id: 'mute', label: '静音' },
  { id: 'pause', label: '暂停' },
  { id: 'stop', label: '停止（释放资源）' },
];

function PerformanceActionRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DynamicWallpaperPerformanceAction;
  onChange: (value: DynamicWallpaperPerformanceAction) => void;
}) {
  return (
    <Row label={label}>
      <ComboBox
        aria-label={label}
        className="w-full sm:w-40"
        selectedKey={value}
        onSelectionChange={(key) => {
          const selected = String(key) as DynamicWallpaperPerformanceAction;
          if (PERFORMANCE_ACTIONS.some((action) => action.id === selected)) onChange(selected);
        }}
      >
        <ComboBox.InputGroup><Input /><ComboBox.Trigger /></ComboBox.InputGroup>
        <ComboBox.Popover>
          <ListBox>
            {PERFORMANCE_ACTIONS.map((action) => (
              <ListBox.Item key={action.id} id={action.id} textValue={action.label}>
                {action.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </ComboBox.Popover>
      </ComboBox>
    </Row>
  );
}

const HITOKOTO_CATEGORIES: { id: string; label: string }[] = [
  { id: 'a', label: '动画' },
  { id: 'b', label: '漫画' },
  { id: 'c', label: '游戏' },
  { id: 'd', label: '文学' },
  { id: 'e', label: '原创' },
  { id: 'f', label: '来自网络' },
  { id: 'g', label: '其他' },
  { id: 'h', label: '影视' },
  { id: 'i', label: '诗词' },
  { id: 'j', label: '哲学' },
  { id: 'k', label: '抖机灵' },
  { id: 'l', label: '网易云' },
];

function HomePagePanel({ settings, onUpdate, onReload }: {
  settings: AppSettings;
  onUpdate: (key: string, value: unknown) => void;
  onReload: () => Promise<void>;
}) {
  const hp = settings.home_page;
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ content: string; from: string; from_who: string }>({ content: '', from: '', from_who: '' });

  const items: CustomSentence[] = hp.custom?.items || [];
  const categories: string[] = hp.hitokoto?.categories || [];
  const { contains } = useFilter({ sensitivity: 'base' });

  const startAdd = () => {
    setDraft({ content: '', from: '', from_who: '' });
    setEditingIndex(-1);
  };
  const startEdit = (index: number) => {
    setDraft({ content: items[index].content, from: items[index].from, from_who: items[index].from_who || '' });
    setEditingIndex(index);
  };
  const saveDraft = () => {
    const content = draft.content.trim();
    if (!content) return;
    const normalized: CustomSentence = {
      content,
      from: draft.from.trim(),
      from_who: draft.from_who.trim() || null,
    };
    const next = [...items];
    if (editingIndex !== null && editingIndex >= 0) {
      next[editingIndex] = normalized;
    } else {
      next.push(normalized);
    }
    onUpdate('home_page.custom.items', next);
    setEditingIndex(null);
  };
  const removeItem = (index: number) => {
    onUpdate('home_page.custom.items', items.filter((_, i) => i !== index));
  };

  const handleImport = async () => {
    const imported = await importCustomSentences();
    if (imported === null) return;
    if (imported.length === 0) {
      toast.info('文件中未找到有效语句', { timeout: 3000 });
      return;
    }
    await onReload();
    toast.success(`已导入 ${imported.length} 条语句`, { timeout: 3000 });
  };
  const handleExport = async () => {
    const path = await exportCustomSentences();
    if (path) toast.success('已导出', { timeout: 3000 });
  };

  return (
    <Section title="主页语句">
      <Row label="语句来源">
        <ComboBox
          className="w-40"
          selectedKey={hp.source}
          onSelectionChange={(key) => onUpdate('home_page.source', String(key))}
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
      <Row label="显示作者"><Switch aria-label="显示作者" isSelected={hp.show_author} onChange={(v) => onUpdate('home_page.show_author', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
      <Row label="显示来源"><Switch aria-label="显示来源" isSelected={hp.show_source} onChange={(v) => onUpdate('home_page.show_source', v)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
      <Row label="当前壁纸刷新间隔 (秒)">
        <Input aria-label="当前壁纸刷新间隔秒数" type="number" min={10} max={600} className="w-full sm:w-28" value={String(hp.wallpaper_refresh_seconds)} onChange={(event) => onUpdate('home_page.wallpaper_refresh_seconds', Math.max(10, Math.min(600, Number(event.target.value) || 10)))} />
      </Row>

      {hp.source === 'hitokoto' && (
        <>
          <Row label="服务区域">
            <ComboBox
              className="w-40"
              selectedKey={hp.hitokoto?.region || 'domestic'}
              onSelectionChange={(key) => onUpdate('home_page.hitokoto.region', String(key))}
            >
              <ComboBox.InputGroup>
                <Input />
                <ComboBox.Trigger />
              </ComboBox.InputGroup>
              <ComboBox.Popover>
                <ListBox>
                  <ListBox.Item id="domestic" textValue="国内">国内</ListBox.Item>
                  <ListBox.Item id="international" textValue="国际">国际</ListBox.Item>
                </ListBox>
              </ComboBox.Popover>
            </ComboBox>
          </Row>
          <div className="space-y-2">
            <Label className="block text-sm">分类（留空表示全部）</Label>
            <Autocomplete
              className="w-full"
              placeholder="选择分类"
              selectionMode="multiple"
              aria-label="分类"
              value={categories}
              onChange={(keys) => onUpdate('home_page.hitokoto.categories', (keys as Key[]) || [])}
            >
              <Autocomplete.Trigger>
                <Autocomplete.Value>
                  {({ defaultChildren, isPlaceholder, state }: any) => {
                    if (isPlaceholder || state.selectedItems.length === 0) return defaultChildren;
                    const selectedIds = state.selectedItems.map((item: any) => String(item.key));
                    return (
                      <TagGroup
                        size="sm"
                        onRemove={(keys) => onUpdate('home_page.hitokoto.categories', categories.filter((c) => !keys.has(c)))}
                      >
                        <TagGroup.List>
                          {selectedIds.map((id: string) => {
                            const item = HITOKOTO_CATEGORIES.find((c) => c.id === id);
                            if (!item) return null;
                            return (
                              <Tag key={item.id} id={item.id}>{item.label}</Tag>
                            );
                          })}
                        </TagGroup.List>
                      </TagGroup>
                    );
                  }}
                </Autocomplete.Value>
                <Autocomplete.ClearButton />
                <Autocomplete.Indicator />
              </Autocomplete.Trigger>
              <Autocomplete.Popover>
                <Autocomplete.Filter filter={contains}>
                  <SearchField autoFocus name="search" variant="secondary">
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder="搜索分类..." />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                  <ListBox renderEmptyState={() => <EmptyState>未找到分类</EmptyState>}>
                    {HITOKOTO_CATEGORIES.map((c) => (
                      <ListBox.Item key={c.id} id={c.id} textValue={c.label}>
                        {c.label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Autocomplete.Filter>
              </Autocomplete.Popover>
            </Autocomplete>
          </div>
        </>
      )}

      {hp.source === 'custom' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onPress={startAdd}><Plus size={14} /> 添加语句</Button>
            <Button size="sm" variant="secondary" onPress={handleImport}><Upload size={14} /> 导入</Button>
            <Button size="sm" variant="secondary" onPress={handleExport} isDisabled={items.length === 0}><Download size={14} /> 导出</Button>
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-muted">还没有自定义语句，点击「添加语句」或「导入」开始。</p>
          ) : (
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{it.content}</p>
                    {(it.from_who || it.from) && (
                      <p className="mt-1 text-xs text-muted">
                        {it.from_who ? `—— ${it.from_who}` : ''}
                        {it.from ? `${it.from_who ? ' ' : ''}《${it.from}》` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" isIconOnly aria-label="编辑" onPress={() => startEdit(i)}><Pencil size={14} /></Button>
                    <Button size="sm" variant="ghost" isIconOnly aria-label="删除" className="text-danger" onPress={() => removeItem(i)}><Trash2 size={14} /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal.Backdrop isOpen={editingIndex !== null} onOpenChange={(open) => !open && setEditingIndex(null)}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header><Modal.Heading>{editingIndex !== null && editingIndex >= 0 ? '编辑语句' : '添加语句'}</Modal.Heading></Modal.Header>
            <Modal.Body>
              <div className="space-y-3">
                <div>
                  <Label className="mb-1 block text-sm">内容</Label>
                  <TextArea
                    autoFocus
                    rows={3}
                    className="w-full"
                    value={draft.content}
                    onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                    placeholder="输入语句内容"
                  />
                </div>
                <div>
                  <Label className="mb-1 block text-sm">作者</Label>
                  <Input value={draft.from_who} onChange={(e) => setDraft({ ...draft, from_who: e.target.value })} placeholder="（可选）" />
                </div>
                <div>
                  <Label className="mb-1 block text-sm">来源</Label>
                  <Input value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} placeholder="（可选）例如：书名、出处" />
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setEditingIndex(null)}>取消</Button>
              <Button onPress={saveDraft} isDisabled={!draft.content.trim()}>保存</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Section>
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
    if (id === POLLINATIONS_PROVIDER_ID) return;
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
      format: 'openai-compatible',
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
      <Section title="生成默认值">
        <Row label="图片尺寸">
          <ComboBox aria-label="默认生成图片尺寸" className="w-full sm:w-44" selectedKey={settings.generate.default_size} onSelectionChange={(key) => onUpdate('generate.default_size', String(key))}>
            <ComboBox.InputGroup><Input /><ComboBox.Trigger /></ComboBox.InputGroup>
            <ComboBox.Popover><ListBox>
              {IMAGE_SIZE_OPTIONS.map((size) => <ListBox.Item key={size} id={size} textValue={size}>{size}</ListBox.Item>)}
            </ListBox></ComboBox.Popover>
          </ComboBox>
        </Row>
        <Row label="每批图片数量">
          <Input aria-label="默认每批生成图片数量" type="number" min={1} max={MAX_IMAGES_PER_BATCH} className="w-full sm:w-28" value={String(settings.generate.default_n)} onChange={(event) => onUpdate('generate.default_n', Math.max(1, Math.min(MAX_IMAGES_PER_BATCH, Number(event.target.value) || 1)))} />
        </Row>
        <Row label="返回格式">
          <ComboBox aria-label="默认图片返回格式" className="w-full sm:w-44" selectedKey={settings.generate.default_response_format} onSelectionChange={(key) => onUpdate('generate.default_response_format', String(key))}>
            <ComboBox.InputGroup><Input /><ComboBox.Trigger /></ComboBox.InputGroup>
            <ComboBox.Popover><ListBox>
              <ListBox.Item id="url" textValue="图片 URL">图片 URL</ListBox.Item>
              <ListBox.Item id="b64_json" textValue="Base64 数据">Base64 数据</ListBox.Item>
            </ListBox></ComboBox.Popover>
          </ComboBox>
        </Row>
        <Row label="图片质量">
          <ComboBox aria-label="默认生成图片质量" className="w-full sm:w-44" selectedKey={settings.generate.default_quality} onSelectionChange={(key) => onUpdate('generate.default_quality', String(key))}>
            <ComboBox.InputGroup><Input /><ComboBox.Trigger /></ComboBox.InputGroup>
            <ComboBox.Popover><ListBox>
              {IMAGE_QUALITY_OPTIONS.map((quality) => (
                <ListBox.Item key={quality} id={quality} textValue={quality === 'auto' ? '自动' : quality === 'low' ? '低' : quality === 'medium' ? '中' : '高'}>
                  {quality === 'auto' ? '自动' : quality === 'low' ? '低' : quality === 'medium' ? '中' : '高'}
                </ListBox.Item>
              ))}
            </ListBox></ComboBox.Popover>
          </ComboBox>
        </Row>
      </Section>

      <Separator />

      <Section title="记录与隐私">
        <Row label="记住最近提示词"><Switch aria-label="记住最近提示词" isSelected={settings.generate.remember_prompts} onChange={(value) => onUpdate('generate.remember_prompts', value)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
        {settings.generate.remember_prompts && (
          <Row label="提示词历史数量"><Input aria-label="提示词历史数量" type="number" min={1} max={50} className="w-full sm:w-28" value={String(settings.generate.prompt_history_limit)} onChange={(event) => onUpdate('generate.prompt_history_limit', Math.max(1, Math.min(50, Number(event.target.value) || 1)))} /></Row>
        )}
        <Row label="生成记录保留数量"><Input aria-label="生成记录保留数量" type="number" min={10} max={500} className="w-full sm:w-28" value={String(settings.generate.history_max_items)} onChange={(event) => onUpdate('generate.history_max_items', Math.max(10, Math.min(500, Number(event.target.value) || 10)))} /></Row>
        <Row label="本地提示词历史">
          <Button size="sm" variant="secondary" onPress={() => {
            window.localStorage.removeItem('ltw:generate:prompt-history');
            toast.success('提示词历史已清除', { timeout: 2500 });
          }}><Trash2 size={14} /> 清除</Button>
        </Row>
      </Section>

      <Separator />

      <Section title="已配置的提供商">
        {providers.length === 0 && (
          <p className="text-sm text-muted">尚未配置任何图片生成提供商</p>
        )}
        <RadioGroup
          value={activeId}
          onChange={(v) => onUpdate('generate.active_provider_id', v)}
          className="space-y-2"
        >
          {providers.map((p) => {
            const isBuiltin = p.id === POLLINATIONS_PROVIDER_ID;
            return (
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
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {p.name}
                      {isBuiltin && (
                        <Chip size="sm" variant="secondary">
                          <Chip.Label>内置</Chip.Label>
                        </Chip>
                      )}
                    </div>
                    <div className="text-xs text-muted">{p.endpoint} · {p.model}</div>
                  </Radio.Content>
                </div>
                {!isBuiltin && (
                  <Button isIconOnly variant="ghost" size="sm" aria-label={`删除 ${p.name}`} onPress={() => removeProvider(p.id)}>
                    <Trash2 size={14} className="text-danger" />
                  </Button>
                )}
              </Radio>
            );
          })}
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
              <Input fullWidth value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="例如：GPT" />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted">端点 (Base URL)</Label>
              <Input
                fullWidth
                value={customEndpoint}
                onChange={(e) => setCustomEndpoint(e.target.value)}
                placeholder={DEFAULT_ENDPOINT}
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted">模型 ID</Label>
              <Input fullWidth value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="例如：gpt-image-2" />
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

function AboutPanel() {
  const [app, setApp] = useState<import('@/api/backend').AppInfo | null>(null);
  const [build, setBuild] = useState<import('@/api/backend').BuildInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAppInfo(), getBuildInfo()])
      .then(([a, b]) => {
        if (cancelled) return;
        setApp(a);
        setBuild(b);
      })
      .catch((e) => console.error('AboutPanel load failed', e));
    return () => { cancelled = true; };
  }, []);

  const handleOpenUrl = (url: string) => {
    openUrl(url);
  };

  const formatBuildTime = (iso: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  };

  const displayVersion = build ? `v${build.version}` : 'v2.0.0';
  const displayType = build ? (build.source_run ? '源码运行' : build.build_type) : '—';
  const displayBuildTime = build ? formatBuildTime(build.build_time) : '—';
  const displayCommit = build?.git_commit || '—';
  const displayBuiltBy = build?.built_by || '—';

  return (
    <div className="space-y-4">
      <Card className="p-6 text-center">
        <div className="mb-2 flex justify-center">
          <img src="./logo.png" alt="小树壁纸" className="h-16 w-16 rounded-xl object-cover" />
        </div>
        <div className="text-2xl font-bold">小树壁纸 Next</div>
        <div className="text-muted">{displayVersion}</div>
        <Separator className="my-4" />
        <p className="text-sm text-muted">
          一款桌面壁纸管理应用，支持多种壁纸来源、AI 生成、自动更换、收藏管理等功能。
        </p>
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-muted">版本信息</h3>
        <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2">
            <span className="text-muted">版本号</span>
            <span className="font-mono">{displayVersion}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted">构建类型</span>
            <span className="font-mono">{displayType}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted">构建时间</span>
            <span className="font-mono">{displayBuildTime}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted">Git Commit</span>
            <span className="font-mono">{displayCommit}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted">构建方式</span>
            <span className="font-mono">{displayBuiltBy}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted">包名</span>
            <span className="font-mono">{app?.package_name || '—'}</span>
          </div>
        </div>
        {build?.source_run && (
          <p className="text-xs text-muted">
            当前为源码运行模式，上述版本号、提交哈希、构建时间等元数据由后端自动合成，仅供本地调试参考。
          </p>
        )}
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
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">wouter@3.10.0 (Unlicense)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">scheduler@0.27.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">use-sync-external-store@1.6.0 (MIT)</span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="font-medium text-foreground">UI 组件与样式</p>
                  <div className="grid grid-cols-2 gap-2">
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@heroui/react@3.0.5 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@heroui/styles@3.0.5 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">tailwindcss@4.0.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@tailwindcss/vite@4.3.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">lucide-react@1.17.0 (ISC)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">tailwind-merge@3.4.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">tailwind-variants@3.2.2 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">tw-animate-css@1.4.0 (MIT)</span>
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
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">vite@6.0.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">@vitejs/plugin-react@6.0.2 (MIT)</span>
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
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">certifi@2026.6.17 (MPL-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">fastapi@0.115.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">uvicorn@0.32.0 (BSD-3-Clause)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">PyYAML@6.0.2 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">rtoml@0.12.0 (MIT)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">pywin32@306 (PSF-2.0)</span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="font-medium text-foreground">Python 构建与打包</p>
                  <div className="grid grid-cols-2 gap-2">
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">pyinstaller@6.21.0 (GPL-2.0)</span>
                    <span className="rounded-md bg-surface-tertiary px-2 py-1 text-center text-xs">hatchling@1.27.0 (MIT)</span>
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
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(200px,auto)] sm:items-center">
      <span className="text-sm text-wrap-pretty">{label}</span>
      <div className="min-w-0 sm:text-right">{children}</div>
    </div>
  );
}
