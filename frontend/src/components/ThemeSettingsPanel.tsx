import { useEffect, useRef, useState } from 'react';
import type { Color, Key } from '@heroui/react';
import {
  Autocomplete,
  Button,
  Card,
  ColorArea,
  ColorField,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  EmptyState,
  Input,
  Label,
  ListBox,
  Modal,
  SearchField,
  Select,
  Separator,
  Slider,
  Spinner,
  Switch,
  Tabs,
  TextArea,
  TextField,
  Tooltip,
  parseColor,
  toast,
  useFilter,
} from '@heroui/react';
import {
  Check,
  Code2,
  Copy,
  Download,
  FolderOpen,
  Image as ImageIcon,
  Palette,
  Plus,
  Save,
  Trash2,
  Type,
  Upload,
  Video,
} from 'lucide-react';
import {
  deleteTheme,
  duplicateTheme,
  exportTheme,
  getTheme,
  listSystemFonts,
  listThemes,
  pickAndImportTheme,
  pickThemeAsset,
  saveTheme,
  themePreviewUrl,
} from '@/api/backend';
import type { SystemFontInfo } from '@/api/backend';
import { useThemeContext } from '@/components/ThemeProvider';
import { BEFORE_NAVIGATE_EVENT } from '@/lib/navigationGuard';
import type { NavigationRequestDetail } from '@/lib/navigationGuard';
import { createThemeDraft, DEFAULT_THEME } from '@/theme/defaults';
import type {
  ThemeAssetMode,
  ThemeBackgroundType,
  ThemeMode,
  ThemePalette,
  ThemePreviewAssets,
  ThemeProfile,
  ThemeSummary,
} from '@/theme/types';

type EditablePaletteKey = keyof ThemePalette;
type AssetStorageMode = Extract<ThemeAssetMode, 'bundled' | 'path'>;
type BackgroundAssetMode = AssetStorageMode | 'url';

const PALETTE_FIELDS: Array<{ key: EditablePaletteKey; label: string }> = [
  { key: 'background', label: '应用背景' },
  { key: 'foreground', label: '主要文字' },
  { key: 'surface', label: '主要表面' },
  { key: 'surface_secondary', label: '次级表面' },
  { key: 'surface_tertiary', label: '三级表面' },
  { key: 'muted', label: '弱化文字' },
  { key: 'border', label: '边框' },
  { key: 'separator', label: '分隔线' },
];

const BACKGROUND_TYPES: Array<{ id: ThemeBackgroundType; label: string }> = [
  { id: 'solid', label: '纯色' },
  { id: 'gradient', label: '渐变' },
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeColor(value: string): Color {
  try {
    return parseColor(value);
  } catch {
    return parseColor('#000000');
  }
}

function ColorControl({ label, value, onChange, isDisabled = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isDisabled?: boolean;
}) {
  return (
    <ColorPicker
      value={safeColor(value)}
      onChange={(color) => onChange(color.toString('hex').toUpperCase())}
    >
      <ColorPicker.Trigger className="min-h-9 w-full justify-start gap-2 px-2" isDisabled={isDisabled}>
        <ColorSwatch size="sm" />
        <Label className="min-w-0 flex-1 truncate text-left text-xs">{label}</Label>
        <span className="font-mono text-xs text-muted">{value}</span>
      </ColorPicker.Trigger>
      <ColorPicker.Popover className="w-60 gap-3 p-3">
        <ColorArea
          aria-label={`${label}颜色区域`}
          className="h-36 w-full"
          colorSpace="hsb"
          xChannel="saturation"
          yChannel="brightness"
        >
          <ColorArea.Thumb />
        </ColorArea>
        <ColorSlider aria-label={`${label}色相`} channel="hue" colorSpace="hsb">
          <ColorSlider.Track><ColorSlider.Thumb /></ColorSlider.Track>
        </ColorSlider>
        <ColorField aria-label={`${label}颜色值`}>
          <ColorField.Group variant="secondary">
            <ColorField.Prefix><ColorSwatch size="xs" /></ColorField.Prefix>
            <ColorField.Input />
          </ColorField.Group>
        </ColorField>
      </ColorPicker.Popover>
    </ColorPicker>
  );
}

function SelectControl({ label, value, options, onChange, isDisabled = false }: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
  isDisabled?: boolean;
}) {
  return (
    <Select value={value} onChange={(key) => key && onChange(String(key))} isDisabled={isDisabled} variant="secondary">
      <Label>{label}</Label>
      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}<ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function IconButton({ label, children, onPress, isDisabled = false }: {
  label: string;
  children: React.ReactNode;
  onPress: () => void;
  isDisabled?: boolean;
}) {
  return (
    <Tooltip delay={0}>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label} onPress={onPress} isDisabled={isDisabled}>
        {children}
      </Button>
      <Tooltip.Content><p>{label}</p></Tooltip.Content>
    </Tooltip>
  );
}

export default function ThemeSettingsPanel() {
  const {
    theme: themeMode,
    activeTheme,
    setTheme: setThemeMode,
    activateTheme,
    previewTheme,
    clearThemePreview,
    syncTheme,
  } = useThemeContext();
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [selectedId, setSelectedId] = useState(activeTheme.id);
  const [draft, setDraft] = useState<ThemeProfile>(activeTheme);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [systemFonts, setSystemFonts] = useState<SystemFontInfo[]>([]);
  const [fontsLoading, setFontsLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [previewAssets, setPreviewAssets] = useState<ThemePreviewAssets>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const dirtyRef = useRef(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);

  const isReadonly = draft.is_builtin;
  const isActive = activeTheme.id === draft.id;

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listThemes(), getTheme(activeTheme.id)])
      .then(([items, profile]) => {
        if (cancelled) return;
        setThemes(items);
        setSelectedId(profile.id);
        setDraft(profile);
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.danger('主题加载失败', { description: error instanceof Error ? error.message : '后端未响应' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeTheme.id]);

  useEffect(() => {
    let cancelled = false;
    listSystemFonts()
      .then((fonts) => { if (!cancelled) setSystemFonts(fonts); })
      .catch(() => { if (!cancelled) setSystemFonts([]); })
      .finally(() => { if (!cancelled) setFontsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (previewEnabled) previewTheme(draft, previewAssets);
    else clearThemePreview();
  }, [clearThemePreview, draft, previewAssets, previewEnabled, previewTheme]);

  useEffect(() => () => clearThemePreview(), [clearThemePreview]);

  useEffect(() => {
    const handleNavigationRequest = (event: Event) => {
      if (!dirtyRef.current) return;
      const request = event as CustomEvent<NavigationRequestDetail>;
      event.preventDefault();
      pendingNavigationRef.current = request.detail.proceed;
      setPendingSelection(null);
      setDiscardOpen(true);
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener(BEFORE_NAVIGATE_EVENT, handleNavigationRequest);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener(BEFORE_NAVIGATE_EVENT, handleNavigationRequest);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const refreshThemes = async () => setThemes(await listThemes());

  const loadProfile = async (themeId: string) => {
    setLoading(true);
    try {
      const profile = await getTheme(themeId);
      setSelectedId(profile.id);
      setDraft(profile);
      setPreviewAssets({});
      dirtyRef.current = false;
      setDirty(false);
    } catch (error) {
      toast.danger('主题读取失败', { description: error instanceof Error ? error.message : '未知错误' });
    } finally {
      setLoading(false);
    }
  };

  const requestProfile = (themeId: string) => {
    if (themeId === selectedId) return;
    if (dirty) {
      setPendingSelection(themeId);
      setDiscardOpen(true);
      return;
    }
    void loadProfile(themeId);
  };

  const updateDraft = (mutate: (next: ThemeProfile) => void) => {
    if (isReadonly) return;
    setDraft((current) => {
      const next = structuredClone(current);
      mutate(next);
      return next;
    });
    dirtyRef.current = true;
    setDirty(true);
  };

  const saveDraft = async (): Promise<ThemeProfile | null> => {
    if (isReadonly) return draft;
    if (!draft.name.trim()) {
      toast.warning('请输入主题名称');
      return null;
    }
    setSaving(true);
    try {
      const saved = await saveTheme(draft);
      setDraft(saved);
      setSelectedId(saved.id);
      dirtyRef.current = false;
      setDirty(false);
      syncTheme(saved);
      await refreshThemes();
      toast.success('主题已保存', { timeout: 2500 });
      return saved;
    } catch (error) {
      toast.danger('主题保存失败', { description: error instanceof Error ? error.message : '未知错误', timeout: 0 });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    const profile = dirty ? await saveDraft() : draft;
    if (!profile) return;
    try {
      await activateTheme(profile.id);
      setDraft(profile);
      toast.success(`已启用「${profile.name}」`, { timeout: 2500 });
    } catch (error) {
      toast.danger('主题启用失败', { description: error instanceof Error ? error.message : '未知错误' });
    }
  };

  const createNew = () => {
    const next = createThemeDraft(DEFAULT_THEME);
    setDraft(next);
    setSelectedId(next.id);
    setPreviewAssets({});
    dirtyRef.current = true;
    setDirty(true);
  };

  const handleNew = () => {
    if (dirty) {
      setPendingSelection('__new__');
      setDiscardOpen(true);
    } else {
      createNew();
    }
  };

  const handleDuplicate = async () => {
    try {
      const copy = await duplicateTheme(draft.id);
      await refreshThemes();
      setSelectedId(copy.id);
      setDraft(copy);
      setPreviewAssets({});
      dirtyRef.current = false;
      setDirty(false);
      toast.success('主题副本已创建', { timeout: 2500 });
    } catch (error) {
      toast.danger('复制主题失败', { description: error instanceof Error ? error.message : '未知错误' });
    }
  };

  const handleImport = async () => {
    try {
      const imported = await pickAndImportTheme();
      if (!imported) return;
      await refreshThemes();
      setSelectedId(imported.id);
      setDraft(imported);
      setPreviewAssets({});
      dirtyRef.current = false;
      setDirty(false);
      toast.success(`已导入「${imported.name}」`, { timeout: 2500 });
    } catch (error) {
      toast.danger('主题导入失败', { description: error instanceof Error ? error.message : '未知错误', timeout: 0 });
    }
  };

  const requestImport = () => {
    if (dirty) {
      setPendingSelection('__import__');
      setDiscardOpen(true);
    } else {
      void handleImport();
    }
  };

  const handleExport = async () => {
    try {
      const path = await exportTheme(draft.id);
      if (path) toast.success('主题包已导出', { timeout: 2500 });
    } catch (error) {
      toast.danger('主题导出失败', { description: error instanceof Error ? error.message : '未知错误' });
    }
  };

  const confirmDelete = async () => {
    try {
      await deleteTheme(draft.id);
      if (isActive) await activateTheme('default');
      await refreshThemes();
      await loadProfile('default');
      setDeleteOpen(false);
      toast.success('主题已删除', { timeout: 2500 });
    } catch (error) {
      toast.danger('主题删除失败', { description: error instanceof Error ? error.message : '未知错误' });
    }
  };

  const handlePickAsset = async (role: 'image' | 'video' | 'font', mode: AssetStorageMode) => {
    try {
      const selection = await pickThemeAsset(draft.id, role, mode);
      if (!selection) return;
      const previewUrl = themePreviewUrl(selection.preview_token);
      updateDraft((next) => {
        if (role === 'font') next.typography.source = selection.source;
        else next.background.source = selection.source;
      });
      setPreviewAssets((current) => role === 'font'
        ? { ...current, font: previewUrl }
        : { ...current, background: previewUrl });
    } catch (error) {
      toast.danger('资源选择失败', { description: error instanceof Error ? error.message : '未知错误' });
    }
  };

  const discardAndContinue = () => {
    const target = pendingSelection;
    const proceed = pendingNavigationRef.current;
    dirtyRef.current = false;
    pendingNavigationRef.current = null;
    setDirty(false);
    setDiscardOpen(false);
    setPendingSelection(null);
    if (proceed) proceed();
    else if (target === '__new__') createNew();
    else if (target === '__import__') void handleImport();
    else if (target) void loadProfile(target);
  };

  const continueEditing = () => {
    pendingNavigationRef.current = null;
    setPendingSelection(null);
    setDiscardOpen(false);
  };

  if (loading && themes.length === 0) {
    return (
      <Card className="flex min-h-80 items-center justify-center gap-3 p-8">
        <Spinner size="sm" />
        <span className="text-sm text-muted">正在加载主题...</span>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
          <div>
            <h2 className="text-sm font-semibold">显示模式</h2>
            <p className="mt-1 text-xs text-muted">{themeMode === 'system' ? '跟随操作系统明暗设置' : themeMode === 'light' ? '始终使用浅色配色' : '始终使用深色配色'}</p>
          </div>
          <SelectControl
            label="界面明暗"
            value={themeMode}
            options={[
              { id: 'system', label: '跟随系统' },
              { id: 'light', label: '浅色' },
              { id: 'dark', label: '深色' },
            ]}
            onChange={(value) => void setThemeMode(value as ThemeMode).catch((error: unknown) => {
              toast.danger('显示模式保存失败', { description: error instanceof Error ? error.message : '未知错误' });
            })}
          />
        </div>
      </Card>

      <Card className="min-h-[640px] overflow-hidden p-0">
        <div className="grid min-h-[640px] lg:grid-cols-[248px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-border bg-surface-secondary/70 lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
              <div>
                <h2 className="text-sm font-semibold">主题</h2>
                <p className="text-xs text-muted">{themes.length} 个已安装</p>
              </div>
              <div className="flex items-center">
                <IconButton label="新建主题" onPress={handleNew}><Plus size={16} /></IconButton>
                <IconButton label="导入主题" onPress={requestImport}><Upload size={16} /></IconButton>
              </div>
            </div>
            <div className="grid max-h-56 gap-1 overflow-y-auto p-2 lg:max-h-none lg:flex-1 lg:content-start">
              {themes.map((item) => {
                const selected = item.id === selectedId;
                const active = item.id === activeTheme.id;
                return (
                  <Button
                    key={item.id}
                    variant={selected ? 'secondary' : 'ghost'}
                    className="h-auto min-h-14 w-full justify-start px-2 py-2 text-left"
                    onPress={() => requestProfile(item.id)}
                  >
                    <span className="size-7 shrink-0 rounded-md border border-border" style={{ backgroundColor: item.accent }} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{item.name}</span>
                        {active && <Check size={13} className="shrink-0 text-success" />}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {item.is_builtin ? '内置主题' : `${item.background_type} · ${formatBytes(item.size_bytes)}`}
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </aside>

          <section className="flex min-w-0 flex-col">
            <header className="flex min-h-16 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-semibold">{draft.name}</h2>
                  {dirty && <span className="text-xs text-warning">未保存</span>}
                </div>
                <p className="truncate text-xs text-muted">{draft.id}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Switch aria-label="实时预览" isSelected={previewEnabled} onChange={setPreviewEnabled}>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                  <Switch.Content>实时预览</Switch.Content>
                </Switch>
                <Separator orientation="vertical" className="mx-1 h-6" />
                <IconButton label="复制主题" onPress={() => void handleDuplicate()} isDisabled={dirty}><Copy size={16} /></IconButton>
                <IconButton label="导出主题" onPress={() => void handleExport()} isDisabled={dirty}><Download size={16} /></IconButton>
                <IconButton label="删除主题" onPress={() => setDeleteOpen(true)} isDisabled={isReadonly}><Trash2 size={16} /></IconButton>
                <Button size="sm" variant="secondary" onPress={() => void saveDraft()} isDisabled={isReadonly || !dirty} isPending={saving}>
                  {({ isPending }) => <>{isPending ? <Spinner size="sm" color="current" /> : <Save size={15} />}保存</>}
                </Button>
                <Button size="sm" onPress={() => void handleActivate()} isDisabled={isActive && !dirty}>
                  <Check size={15} />{isActive ? '已启用' : '启用'}
                </Button>
              </div>
            </header>

            {isReadonly && (
              <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-secondary px-4 py-2">
                <p className="text-xs text-muted">默认主题为只读主题。</p>
                <Button size="sm" variant="ghost" onPress={() => void handleDuplicate()}><Copy size={14} />创建副本</Button>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <Tabs defaultSelectedKey="basic">
                <Tabs.ListContainer>
                  <Tabs.List aria-label="主题设计器分类">
                    <Tabs.Tab id="basic"><Palette size={14} />基本<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="colors"><Palette size={14} />颜色<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="background"><ImageIcon size={14} />背景<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="font"><Type size={14} />字体<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="css"><Code2 size={14} />CSS<Tabs.Indicator /></Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>

                <Tabs.Panel id="basic" className="pt-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField isDisabled={isReadonly} value={draft.name} onChange={(value) => updateDraft((next) => { next.name = value; })}>
                      <Label>主题名称</Label>
                      <Input />
                    </TextField>
                    <TextField isDisabled={isReadonly} value={draft.author} onChange={(value) => updateDraft((next) => { next.author = value; })}>
                      <Label>作者</Label>
                      <Input />
                    </TextField>
                    <TextField isDisabled={isReadonly} value={draft.version} onChange={(value) => updateDraft((next) => { next.version = value; })}>
                      <Label>版本</Label>
                      <Input />
                    </TextField>
                    <ColorControl label="主题色" value={draft.colors.accent} onChange={(value) => updateDraft((next) => { next.colors.accent = value; })} isDisabled={isReadonly} />
                    <TextField className="md:col-span-2" isDisabled={isReadonly} value={draft.description} onChange={(value) => updateDraft((next) => { next.description = value; })}>
                      <Label>描述</Label>
                      <TextArea rows={3} />
                    </TextField>
                  </div>
                </Tabs.Panel>

                <Tabs.Panel id="colors" className="pt-5">
                  <div className="grid gap-5 lg:grid-cols-2">
                    {(['light', 'dark'] as const).map((scheme) => (
                      <div key={scheme} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">{scheme === 'light' ? '浅色模式' : '深色模式'}</h3>
                          <span className="text-xs text-muted">8 个语义颜色</span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                          {PALETTE_FIELDS.map((field) => (
                            <ColorControl
                              key={field.key}
                              label={field.label}
                              value={draft.colors[scheme][field.key]}
                              onChange={(value) => updateDraft((next) => { next.colors[scheme][field.key] = value; })}
                              isDisabled={isReadonly}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Separator className="my-5" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ColorControl label="主题色" value={draft.colors.accent} onChange={(value) => updateDraft((next) => { next.colors.accent = value; })} isDisabled={isReadonly} />
                    <ColorControl label="主题色文字" value={draft.colors.accent_foreground} onChange={(value) => updateDraft((next) => { next.colors.accent_foreground = value; })} isDisabled={isReadonly} />
                  </div>
                </Tabs.Panel>

                <Tabs.Panel id="background" className="pt-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <SelectControl
                      label="背景类型"
                      value={draft.background.type}
                      options={BACKGROUND_TYPES}
                      onChange={(value) => updateDraft((next) => {
                        const previous = next.background.type;
                        next.background.type = value as ThemeBackgroundType;
                        if (previous !== value) {
                          next.background.source = value === 'video'
                            ? { mode: 'path', value: '' }
                            : value === 'image'
                              ? { mode: 'bundled', value: '' }
                              : null;
                        }
                      })}
                      isDisabled={isReadonly}
                    />
                    <SelectControl
                      label="填充方式"
                      value={draft.background.fit}
                      options={[
                        { id: 'cover', label: '覆盖' },
                        { id: 'contain', label: '完整显示' },
                        { id: 'fill', label: '拉伸' },
                        { id: 'none', label: '原始尺寸' },
                      ]}
                      onChange={(value) => updateDraft((next) => { next.background.fit = value as ThemeProfile['background']['fit']; })}
                      isDisabled={isReadonly || draft.background.type === 'solid' || draft.background.type === 'gradient'}
                    />

                    {draft.background.type === 'solid' && (
                      <>
                        <ColorControl label="浅色背景" value={draft.colors.light.background} onChange={(value) => updateDraft((next) => { next.colors.light.background = value; })} isDisabled={isReadonly} />
                        <ColorControl label="深色背景" value={draft.colors.dark.background} onChange={(value) => updateDraft((next) => { next.colors.dark.background = value; })} isDisabled={isReadonly} />
                      </>
                    )}

                    {draft.background.type === 'gradient' && (
                      <TextField className="md:col-span-2" isDisabled={isReadonly} value={draft.background.gradient} onChange={(value) => updateDraft((next) => { next.background.gradient = value; })}>
                        <Label>CSS 渐变</Label>
                        <TextArea
                          rows={3}
                          className="font-mono text-xs"
                        />
                      </TextField>
                    )}

                    {(draft.background.type === 'image' || draft.background.type === 'video') && (
                      <BackgroundAssetEditor
                        draft={draft}
                        isDisabled={isReadonly}
                        onUpdate={updateDraft}
                        onPick={(mode) => void handlePickAsset(draft.background.type as 'image' | 'video', mode)}
                        onClearPreview={() => setPreviewAssets((current) => ({ ...current, background: undefined }))}
                      />
                    )}

                    <TextField isDisabled={isReadonly || draft.background.type === 'solid'} value={draft.background.position} onChange={(value) => updateDraft((next) => { next.background.position = value; })}>
                      <Label>背景位置</Label>
                      <Input />
                    </TextField>
                    <Slider
                      minValue={0}
                      maxValue={1}
                      step={0.05}
                      value={draft.background.media_opacity}
                      onChange={(value) => updateDraft((next) => { next.background.media_opacity = Number(value); })}
                      isDisabled={isReadonly || draft.background.type === 'solid'}
                    >
                      <Label>媒体不透明度</Label>
                      <Slider.Output>{Math.round(draft.background.media_opacity * 100)}%</Slider.Output>
                      <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                    </Slider>
                    <Slider
                      minValue={0}
                      maxValue={1}
                      step={0.05}
                      value={draft.background.overlay_opacity}
                      onChange={(value) => updateDraft((next) => { next.background.overlay_opacity = Number(value); })}
                      isDisabled={isReadonly || draft.background.type === 'solid'}
                    >
                      <Label>可读性遮罩</Label>
                      <Slider.Output>{Math.round(draft.background.overlay_opacity * 100)}%</Slider.Output>
                      <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                    </Slider>
                    {draft.background.type === 'video' && (
                      <Slider
                        minValue={0}
                        maxValue={1}
                        step={0.05}
                        value={draft.background.video_volume ?? 0}
                        onChange={(value) => updateDraft((next) => { next.background.video_volume = Number(value); })}
                        isDisabled={isReadonly}
                      >
                        <Label>视频音量</Label>
                        <Slider.Output>{Math.round((draft.background.video_volume ?? 0) * 100)}%</Slider.Output>
                        <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                      </Slider>
                    )}
                  </div>
                </Tabs.Panel>

                <Tabs.Panel id="font" className="pt-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField className="md:col-span-2" isDisabled={isReadonly} value={draft.typography.font_family} onChange={(value) => updateDraft((next) => { next.typography.font_family = value; })}>
                      <Label>回退字体族</Label>
                      <Input className="font-mono" />
                    </TextField>
                    <SelectControl
                      label="字体来源"
                      value={draft.typography.source?.mode ?? 'system'}
                      options={[
                        { id: 'system', label: '默认字体' },
                        { id: 'installed', label: '本机已安装字体' },
                        { id: 'bundled', label: '内置到主题' },
                        { id: 'path', label: '本地路径引用' },
                        { id: 'url', label: '链接引用' },
                      ]}
                      onChange={(value) => {
                        updateDraft((next) => {
                          if (value === 'system') next.typography.source = null;
                          else next.typography.source = { mode: value as ThemeAssetMode, value: '' };
                        });
                        setPreviewAssets((current) => ({ ...current, font: undefined }));
                      }}
                      isDisabled={isReadonly}
                    />
                    {draft.typography.source?.mode === 'installed' ? (
                      <SystemFontPicker
                        fonts={systemFonts}
                        value={draft.typography.source.value}
                        isLoading={fontsLoading}
                        isDisabled={isReadonly}
                        onChange={(font) => updateDraft((next) => {
                          next.typography.source = { mode: 'installed', value: font };
                        })}
                      />
                    ) : draft.typography.source?.mode === 'url' ? (
                      <TextField
                        isDisabled={isReadonly}
                        value={draft.typography.source.value}
                        onChange={(value) => {
                          updateDraft((next) => { if (next.typography.source) next.typography.source.value = value; });
                          setPreviewAssets((current) => ({ ...current, font: undefined }));
                        }}
                      >
                        <Label>字体链接</Label>
                        <Input />
                      </TextField>
                    ) : draft.typography.source ? (
                      <div className="space-y-1.5">
                        <Label>字体文件</Label>
                        <Button
                          fullWidth
                          variant="secondary"
                          onPress={() => void handlePickAsset('font', draft.typography.source?.mode as AssetStorageMode)}
                          isDisabled={isReadonly}
                        >
                          <FolderOpen size={15} />
                          <span className="truncate">{draft.typography.source.value || '选择字体文件'}</span>
                        </Button>
                      </div>
                    ) : null}
                    <div className="rounded-md border border-border bg-surface-secondary px-4 py-5 md:col-span-2">
                      <p className="text-2xl font-semibold">小树壁纸 Theme Preview</p>
                      <p className="mt-2 text-sm text-muted">春风又绿江南岸，明月何时照我还。0123456789</p>
                    </div>
                  </div>
                </Tabs.Panel>

                <Tabs.Panel id="css" className="pt-5">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs text-warning">
                      <Code2 size={14} />自定义 CSS 具有完整界面控制权，仅使用可信内容。
                    </div>
                    <div className="rounded-md border border-border bg-surface-secondary px-3 py-2 text-xs text-muted">
                      标记外 CSS 全局生效。使用 <code>/* @page home */</code> 和 <code>/* @endpage */</code> 包围页面专属 CSS；多个页面用逗号分隔。
                    </div>
                    <TextField isDisabled={isReadonly} value={draft.custom_css} onChange={(value) => updateDraft((next) => { next.custom_css = value; })}>
                      <Label>自定义 CSS</Label>
                      <TextArea
                        rows={18}
                        className="font-mono text-xs"
                        placeholder={'[data-theme-profile="my-theme"] {\n  --radius: 0.375rem;\n}\n\n/* @page home */\n.home-only { opacity: 0.95; }\n/* @endpage */'}
                      />
                    </TextField>
                  </div>
                </Tabs.Panel>
              </Tabs>
            </div>
          </section>
        </div>
      </Card>

      <Modal.Backdrop isOpen={deleteOpen} onOpenChange={setDeleteOpen}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header><Modal.Heading>删除主题</Modal.Heading></Modal.Header>
            <Modal.Body><p className="text-sm text-muted">将删除「{draft.name}」及其内置资源，此操作无法撤销。</p></Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setDeleteOpen(false)}>取消</Button>
              <Button variant="danger" onPress={() => void confirmDelete()}><Trash2 size={15} />删除</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop
        isOpen={discardOpen}
        onOpenChange={(open) => {
          if (open) setDiscardOpen(true);
          else continueEditing();
        }}
      >
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header><Modal.Heading>放弃未保存更改</Modal.Heading></Modal.Header>
            <Modal.Body><p className="text-sm text-muted">当前主题包含未保存的修改。</p></Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={continueEditing}>继续编辑</Button>
              <Button variant="danger" onPress={discardAndContinue}>放弃更改</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

function BackgroundAssetEditor({ draft, isDisabled, onUpdate, onPick, onClearPreview }: {
  draft: ThemeProfile;
  isDisabled: boolean;
  onUpdate: (mutate: (next: ThemeProfile) => void) => void;
  onPick: (mode: AssetStorageMode) => void;
  onClearPreview: () => void;
}) {
  const mode: BackgroundAssetMode = draft.background.source?.mode === 'url'
    ? 'url'
    : draft.background.source?.mode === 'path'
      ? 'path'
      : draft.background.type === 'video' ? 'path' : 'bundled';
  return (
    <>
      <SelectControl
        label="资源来源"
        value={mode}
        options={[
          { id: 'bundled', label: '内置到主题' },
          { id: 'path', label: '本地路径引用' },
          { id: 'url', label: '链接引用' },
        ]}
        onChange={(value) => {
          onUpdate((next) => {
            next.background.source = {
              mode: value as BackgroundAssetMode,
              value: '',
            };
          });
          onClearPreview();
        }}
        isDisabled={isDisabled}
      />
      {mode === 'url' ? (
        <TextField
          isDisabled={isDisabled}
          value={draft.background.source?.value ?? ''}
          onChange={(value) => {
            onUpdate((next) => { if (next.background.source) next.background.source.value = value; });
            onClearPreview();
          }}
        >
          <Label>{draft.background.type === 'video' ? '视频链接' : '图片链接'}</Label>
          <Input />
        </TextField>
      ) : (
        <div className="space-y-1.5">
          <Label>{draft.background.type === 'video' ? '视频文件' : '图片文件'}</Label>
          <Button fullWidth variant="secondary" onPress={() => onPick(mode)} isDisabled={isDisabled}>
            {draft.background.type === 'video' ? <Video size={15} /> : <FolderOpen size={15} />}
            <span className="truncate">{draft.background.source?.value || '选择资源文件'}</span>
          </Button>
        </div>
      )}
    </>
  );
}

function SystemFontPicker({ fonts, value, isLoading, isDisabled, onChange }: {
  fonts: SystemFontInfo[];
  value: string;
  isLoading: boolean;
  isDisabled: boolean;
  onChange: (font: string) => void;
}) {
  const { contains } = useFilter({ sensitivity: 'base' });
  const selectedFont = fonts.find((font) => font.family.toLocaleLowerCase() === value.toLocaleLowerCase()) ?? null;
  const fontKey = (font: SystemFontInfo) => JSON.stringify([font.family, font.full_name]);
  const selectedKey = selectedFont ? fontKey(selectedFont) : null;

  return (
    <Autocomplete
      className="md:col-span-2"
      placeholder={isLoading ? '正在读取本机字体...' : '搜索本机已安装字体'}
      selectionMode="single"
      value={selectedKey}
      onChange={(key: Key | Key[] | null) => {
        if (key === null || Array.isArray(key)) return;
        const selected = fonts.find((font) => fontKey(font) === String(key));
        if (selected) onChange(selected.family);
      }}
      isDisabled={isDisabled || isLoading}
      variant="secondary"
    >
      <Label>本机已安装字体</Label>
      <Autocomplete.Trigger>
        <Autocomplete.Value>
          {({ defaultChildren, isPlaceholder }) => (
            isPlaceholder || !selectedFont
              ? defaultChildren
              : <span className="truncate" style={{ fontFamily: JSON.stringify(selectedFont.family) }}>{selectedFont.full_name}</span>
          )}
        </Autocomplete.Value>
        <Autocomplete.ClearButton />
        <Autocomplete.Indicator />
      </Autocomplete.Trigger>
      <Autocomplete.Popover>
        <Autocomplete.Filter filter={contains}>
          <SearchField autoFocus name="system-font-search" variant="secondary">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="搜索字体..." />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <ListBox
            className="max-h-72 overflow-y-auto"
            renderEmptyState={() => <EmptyState>{isLoading ? '正在读取字体...' : '未找到匹配字体'}</EmptyState>}
          >
            {fonts.map((font) => (
              <ListBox.Item key={fontKey(font)} id={fontKey(font)} textValue={`${font.full_name} ${font.family}`}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm" style={{ fontFamily: JSON.stringify(font.family) }}>{font.full_name}</span>
                  <span className="truncate text-xs text-muted">字体家族：{font.family}{font.style ? ` · ${font.style}` : ''}</span>
                </span>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Filter>
      </Autocomplete.Popover>
    </Autocomplete>
  );
}
