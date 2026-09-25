import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Chip, ColorArea, ColorPicker, ColorSlider, ColorSwatch, Input, Label, ListBox, ScrollShadow, Select, Separator, Slider, Spinner, Switch, Tabs, TextArea, toast } from '@heroui/react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Check, Copy, Grip, LayoutGrid, MonitorUp, RotateCcw,
  MousePointer2, PanelRight, Plus, Save, SlidersHorizontal, Sparkles, Trash2, Undo2, Redo2, X,
} from 'lucide-react';
import DynamicDesktop, { DesktopPreviewOverlay, useWidgetDefinitions, widgetMinimumSize } from '@/components/DynamicDesktop';
import type { WidgetDragStatus, WidgetSettingDescriptor } from '@/components/DynamicDesktop';
import { defaultSettings, settingsSchemaFor } from '@/components/widgets/registry';
import { DEFAULT_WIDGET_ACCENT } from '@/components/widgets/BuiltinWidgets';
import { usePlugins } from '@/plugins/context';
import {
  closeDynamicWidgetEditor,
  applyDynamicWallpaperScene,
  getDisplayResolutions,
  getDynamicWallpaperScene,
  saveDynamicWallpaperScene,
} from '@/api/backend';
import type { DisplayResolution, DynamicWallpaperScene, DynamicWidgetInstance } from '@/api/backend';

interface CanvasSize { width: number; height: number }
interface DrawerDrag {
  type: string;
  label: string;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  overCanvas: boolean;
}

const HISTORY_LIMIT = 50;
const NO_WIDGETS: DynamicWidgetInstance[] = [];

function WidgetColorControl({ label, help, value, onChange, onReset }: {
  label: string;
  help?: string;
  value: string;
  onChange: (hex: string) => void;
  onReset?: () => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <ColorPicker value={value} onChange={(color) => onChange(color.toString('hex'))}>
          <ColorPicker.Trigger>
            <ColorSwatch size="lg" />
            <Label>{value.toUpperCase()}</Label>
          </ColorPicker.Trigger>
          <ColorPicker.Popover className="gap-2">
            <ColorArea
              aria-label="选择颜色"
              className="max-w-full"
              colorSpace="hsb"
              xChannel="saturation"
              yChannel="brightness"
            >
              <ColorArea.Thumb />
            </ColorArea>
            <ColorSlider aria-label="色相" channel="hue" className="gap-1 px-1" colorSpace="hsb">
              <ColorSlider.Track><ColorSlider.Thumb /></ColorSlider.Track>
            </ColorSlider>
          </ColorPicker.Popover>
        </ColorPicker>
        {onReset && <Button size="sm" variant="secondary" onPress={onReset}><RotateCcw size={14} />重置</Button>}
      </div>
      {help && <p className="mt-1 text-xs text-muted">{help}</p>}
    </div>
  );
}

function SettingControl({ descriptor, value, onChange }: {
  descriptor: WidgetSettingDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `widget-setting-${descriptor.key}`;
  switch (descriptor.type) {
    case 'textarea':
      return (
        <div>
          <Label htmlFor={id}>{descriptor.label}</Label>
          <TextArea
            id={id}
            fullWidth
            className="mt-1 min-h-28"
            variant="secondary"
            maxLength={descriptor.maxLength ?? 500}
            placeholder={descriptor.placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
          {descriptor.help && <p className="mt-1 text-xs text-muted">{descriptor.help}</p>}
        </div>
      );
    case 'switch':
      return (
        <div>
          <Switch isSelected={typeof value === 'boolean' ? value : Boolean(descriptor.default)} onChange={(checked) => onChange(checked)}>
            <Switch.Content>
              <span>
                <span className="block text-sm font-medium">{descriptor.label}</span>
                {descriptor.help && <span className="block text-xs text-muted">{descriptor.help}</span>}
              </span>
              <Switch.Control><Switch.Thumb /></Switch.Control>
            </Switch.Content>
          </Switch>
        </div>
      );
    case 'number':
      return (
        <div>
          <Label htmlFor={id}>{descriptor.label}</Label>
          <Input
            id={id}
            className="mt-1"
            variant="secondary"
            type="number"
            min={descriptor.min}
            max={descriptor.max}
            step={descriptor.step ?? 1}
            value={typeof value === 'number' && Number.isFinite(value) ? String(value) : ''}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          {descriptor.help && <p className="mt-1 text-xs text-muted">{descriptor.help}</p>}
        </div>
      );
    case 'select':
      return (
        <div>
          <Label htmlFor={id}>{descriptor.label}</Label>
          <Select
            aria-label={descriptor.label}
            className="mt-1"
            selectedKey={typeof value === 'string' && value ? value : String(descriptor.default ?? descriptor.options?.[0]?.value ?? '')}
            onSelectionChange={(key) => onChange(String(key))}
          >
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                {(descriptor.options ?? []).map((option) => (
                  <ListBox.Item key={option.value} id={option.value} textValue={option.label}>{option.label}<ListBox.ItemIndicator /></ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          {descriptor.help && <p className="mt-1 text-xs text-muted">{descriptor.help}</p>}
        </div>
      );
    case 'slider':
      return (
        <Slider
          minValue={descriptor.min ?? 0}
          maxValue={descriptor.max ?? 100}
          step={descriptor.step ?? 1}
          value={typeof value === 'number' && Number.isFinite(value) ? value : Number(descriptor.default ?? 0)}
          onChange={(next) => onChange(Number(next))}
        >
          <Label>{descriptor.label}</Label>
          <Slider.Output>{({ state }) => `${Math.round(state.values[0])}`}</Slider.Output>
          <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
        </Slider>
      );
    case 'color':
      return (
        <WidgetColorControl
          label={descriptor.label}
          help={descriptor.help}
          value={typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : DEFAULT_WIDGET_ACCENT}
          onChange={(hex) => onChange(hex)}
          onReset={value ? () => onChange('') : undefined}
        />
      );
    case 'date':
      return (
        <div>
          <Label htmlFor={id}>{descriptor.label}</Label>
          <Input
            id={id}
            className="mt-1"
            variant="secondary"
            type="date"
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
          {descriptor.help && <p className="mt-1 text-xs text-muted">{descriptor.help}</p>}
        </div>
      );
    default:
      return (
        <div>
          <Label htmlFor={id}>{descriptor.label}</Label>
          <Input
            id={id}
            className="mt-1"
            variant="secondary"
            maxLength={descriptor.maxLength ?? 40}
            placeholder={descriptor.placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
          {descriptor.help && <p className="mt-1 text-xs text-muted">{descriptor.help}</p>}
        </div>
      );
  }
}

export default function DynamicWidgetEditor() {
  const definitions = useWidgetDefinitions();
  const { contributions } = usePlugins();
  const [scene, setScene] = useState<DynamicWallpaperScene | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<'save' | 'apply' | ''>('');
  const [dirty, setDirty] = useState(false);
  const [displays, setDisplays] = useState<DisplayResolution[]>([]);
  const [displayId, setDisplayId] = useState('');
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [dragStatus, setDragStatus] = useState<WidgetDragStatus | null>(null);
  const [drawerDrag, setDrawerDrag] = useState<DrawerDrag | null>(null);
  const [drawerQuery, setDrawerQuery] = useState('');
  const [past, setPast] = useState<DynamicWidgetInstance[][]>([]);
  const [future, setFuture] = useState<DynamicWidgetInstance[][]>([]);
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  const desktopCanvasRef = useRef<HTMLDivElement | null>(null);
  const drawerDragRef = useRef<DrawerDrag | null>(null);
  const editVersionRef = useRef(0);
  const dragSnapshotRef = useRef<DynamicWidgetInstance[] | null>(null);
  const prevDragActiveRef = useRef(false);
  const lastPushRef = useRef<{ key: string; time: number } | null>(null);

  useEffect(() => {
    getDynamicWallpaperScene(true).then(setScene).catch((error: unknown) => {
      toast.danger('小组件布局加载失败', { description: error instanceof Error ? error.message : String(error) });
    });
    getDisplayResolutions().then((items) => {
      setDisplays(items);
      setDisplayId((items.find((item) => item.is_primary) ?? items[0])?.id ?? '');
    }).catch(() => setDisplays([]));
  }, []);

  const display = displays.find((item) => item.id === displayId) ?? displays[0] ?? {
    id: 'fallback', name: '主显示器', width: 1920, height: 1080, is_primary: true,
  };

  useEffect(() => {
    const area = canvasAreaRef.current;
    if (!area) return undefined;
    const update = () => {
      const rect = area.getBoundingClientRect();
      const ratio = display.width / display.height;
      const padding = 24;
      const availableWidth = Math.max(1, rect.width - padding * 2);
      const availableHeight = Math.max(1, rect.height - padding * 2);
      if (availableWidth / availableHeight > ratio) {
        setCanvasSize({ width: availableHeight * ratio, height: availableHeight });
      } else {
        setCanvasSize({ width: availableWidth, height: availableWidth / ratio });
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(area);
    update();
    return () => observer.disconnect();
  }, [display.width, display.height, scene !== null]);

  const pushPast = (snapshot: DynamicWidgetInstance[], coalesceKey?: string) => {
    const now = Date.now();
    if (coalesceKey && lastPushRef.current && lastPushRef.current.key === coalesceKey && now - lastPushRef.current.time < 1200) {
      lastPushRef.current.time = now;
      setFuture([]);
      return;
    }
    lastPushRef.current = coalesceKey ? { key: coalesceKey, time: now } : null;
    setPast((current) => [...current.slice(-(HISTORY_LIMIT - 1)), snapshot]);
    setFuture([]);
  };

  const edit = (next: DynamicWidgetInstance[], options: { history?: boolean; coalesceKey?: string } = {}) => {
    const { history = true, coalesceKey } = options;
    if (history) pushPast(scene?.widgets ?? NO_WIDGETS, coalesceKey);
    editVersionRef.current += 1;
    setDirty(true);
    setScene((current) => current ? { ...current, widgets: next } : current);
  };
  const setWidgets = (next: DynamicWidgetInstance[]) => edit(next, { history: false });

  const undo = () => {
    if (!past.length || !scene) return;
    const previous = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([scene.widgets, ...future].slice(0, HISTORY_LIMIT));
    lastPushRef.current = null;
    editVersionRef.current += 1;
    setDirty(true);
    setScene((current) => current ? { ...current, widgets: previous } : current);
  };
  const redo = () => {
    if (!future.length || !scene) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast([...past.slice(-(HISTORY_LIMIT - 1)), scene.widgets]);
    lastPushRef.current = null;
    editVersionRef.current += 1;
    setDirty(true);
    setScene((current) => current ? { ...current, widgets: next } : current);
  };

  const dragActive = dragStatus !== null;
  useEffect(() => {
    if (scene && !prevDragActiveRef.current && dragActive) dragSnapshotRef.current = scene.widgets;
    if (prevDragActiveRef.current && !dragActive && dragSnapshotRef.current) {
      const snapshot = dragSnapshotRef.current;
      dragSnapshotRef.current = null;
      if (scene && snapshot !== scene.widgets) pushPast(snapshot);
    }
    prevDragActiveRef.current = dragActive;
  });

  const selected = scene?.widgets.find((widget) => widget.id === selectedId) ?? null;
  const selectedDefinition = selected ? definitions.find((definition) => definition.type === selected.type) ?? null : null;
  const selectedMinimum = selected ? widgetMinimumSize(selected.type) : { width: 8, height: 8 };
  const widgets = scene?.widgets ?? NO_WIDGETS;
  const selectedIndex = selected ? widgets.findIndex((widget) => widget.id === selected.id) + 1 : 0;
  const SelectedIcon = selectedDefinition?.icon;

  const updateSelected = (updates: Partial<DynamicWidgetInstance>, coalesceKey?: string) => {
    if (!selectedId) return;
    edit(widgets.map((widget) => {
      if (widget.id !== selectedId) return widget;
      const next = { ...widget, ...updates };
      next.width = Math.max(selectedMinimum.width, Math.min(100, next.width));
      next.height = Math.max(selectedMinimum.height, Math.min(100, next.height));
      next.x = Math.max(0, Math.min(100 - next.width, next.x));
      next.y = Math.max(0, Math.min(100 - next.height, next.y));
      return next;
    }), { coalesceKey });
  };

  const updateSettings = (key: string, value: unknown) => {
    if (!selected) return;
    updateSelected({ settings: { ...selected.settings, [key]: value } }, `settings:${selected.id}:${key}`);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const clone: DynamicWidgetInstance = {
      ...selected,
      id: `widget-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      x: Math.min(Math.max(0, selected.x + 2), 100 - selected.width),
      y: Math.min(Math.max(0, selected.y + 2), 100 - selected.height),
      settings: { ...selected.settings },
    };
    const index = widgets.findIndex((widget) => widget.id === selected.id);
    const next = [...widgets];
    next.splice(index + 1, 0, clone);
    edit(next);
    setSelectedId(clone.id);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    edit(widgets.filter((widget) => widget.id !== selectedId));
    setSelectedId(null);
  };

  const moveLayer = (mode: 'up' | 'down' | 'top' | 'bottom') => {
    if (!selectedId) return;
    const index = widgets.findIndex((widget) => widget.id === selectedId);
    if (index < 0) return;
    const next = [...widgets];
    const [widget] = next.splice(index, 1);
    if (mode === 'top') next.push(widget);
    else if (mode === 'bottom') next.unshift(widget);
    else next.splice(Math.max(0, Math.min(next.length, index + (mode === 'up' ? 1 : -1))), 0, widget);
    edit(next);
  };

  const alignSelected = (mode: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom' | 'fill') => {
    if (!selected) return;
    if (mode === 'fill') {
      updateSelected({ x: 0, y: 0, width: 100, height: 100 });
      return;
    }
    if (mode === 'left') updateSelected({ x: 0 });
    else if (mode === 'center-x') updateSelected({ x: (100 - selected.width) / 2 });
    else if (mode === 'right') updateSelected({ x: 100 - selected.width });
    else if (mode === 'top') updateSelected({ y: 0 });
    else if (mode === 'center-y') updateSelected({ y: (100 - selected.height) / 2 });
    else if (mode === 'bottom') updateSelected({ y: 100 - selected.height });
  };

  const nudgeSelected = (dx: number, dy: number) => {
    if (!selected) return;
    updateSelected({ x: selected.x + dx, y: selected.y + dy }, `nudge:${selected.id}`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !scene) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (!selected) return;
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (event.key === 'Escape') {
        setSelectedId(null);
        return;
      }
      const step = event.shiftKey ? 5 : 1;
      if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeSelected(-step, 0); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); nudgeSelected(step, 0); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); nudgeSelected(0, -step); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); nudgeSelected(0, step); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const isOverCanvas = (clientX: number, clientY: number) => {
    const rect = desktopCanvasRef.current?.getBoundingClientRect();
    return Boolean(rect
      && clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom);
  };
  const createWidget = (type: string, centerPercent?: { x: number; y: number }) => {
    const definition = definitions.find((item) => item.type === type);
    if (!definition) return;
    const centerX = centerPercent?.x ?? 50;
    const centerY = centerPercent?.y ?? 50;
    const widget: DynamicWidgetInstance = {
      id: `widget-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type,
      x: Math.round(Math.max(0, Math.min(100 - definition.width, centerX - definition.width / 2))),
      y: Math.round(Math.max(0, Math.min(100 - definition.height, centerY - definition.height / 2))),
      width: definition.width,
      height: definition.height,
      opacity: 1,
      background_opacity: 1,
      background_blur: true,
      text_scale: 1,
      text_color: 'auto',
      accent_color: '',
      settings: defaultSettings(definition.settings),
    };
    edit([...widgets, widget]);
    setSelectedId(widget.id);
  };
  const addDrawerWidget = (type: string, clientX: number, clientY: number) => {
    const rect = desktopCanvasRef.current?.getBoundingClientRect();
    if (!rect || !isOverCanvas(clientX, clientY)) return;
    createWidget(type, {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    });
  };

  const persist = async (apply: boolean) => {
    if (pending) return;
    setPending(apply ? 'apply' : 'save');
    const editVersion = editVersionRef.current;
    try {
      const latest = await getDynamicWallpaperScene();
      const payload = { ...latest, widgets: scene ? scene.widgets : latest.widgets };
      if (apply) {
        const result = await applyDynamicWallpaperScene(payload);
        setScene((current) => editVersionRef.current === editVersion
          ? result.scene
          : current ? { ...current, background: result.scene.background, revision: result.scene.revision } : result.scene);
        toast.success(result.status.last_operation === 'apply-scene-requested' ? '布局已保存并排队应用' : '布局已保存并开始应用');
      } else {
        const saved = await saveDynamicWallpaperScene(payload);
        setScene((current) => editVersionRef.current === editVersion
          ? saved
          : current ? { ...current, background: saved.background, revision: saved.revision } : saved);
        toast.success('布局已保存');
      }
      setDirty(false);
    } catch (error) {
      toast.danger(apply ? '应用失败' : '保存失败', { description: error instanceof Error ? error.message : String(error), timeout: 0 });
    } finally { setPending(''); }
  };

  const query = drawerQuery.trim().toLowerCase();
  const filteredDefinitions = definitions.filter((definition) => !query
    || definition.label.toLowerCase().includes(query)
    || definition.description.toLowerCase().includes(query));
  const builtinDefinitions = useMemo(() => filteredDefinitions.filter((definition) => !definition.pluginId), [filteredDefinitions]);
  const pluginDefinitions = useMemo(() => filteredDefinitions.filter((definition) => definition.pluginId), [filteredDefinitions]);

  if (!scene) return <div className="flex size-full items-center justify-center bg-background"><Spinner /></div>;

  const settingsSchema = selected ? settingsSchemaFor(selected, contributions.widgets) : [];
  const drawerCard = (definition: (typeof definitions)[number]) => {
    const DefinitionIcon = definition.icon;
    return (
      <div
        key={definition.type}
        role="button"
        tabIndex={0}
        aria-label={`拖动或点击添加${definition.label}`}
        className="w-56 shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const nextDrag = {
            type: definition.type,
            label: definition.label,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            clientX: event.clientX,
            clientY: event.clientY,
            overCanvas: isOverCanvas(event.clientX, event.clientY),
          };
          drawerDragRef.current = nextDrag;
          setDrawerDrag(nextDrag);
        }}
        onPointerMove={(event) => {
          const current = drawerDragRef.current;
          if (current?.pointerId !== event.pointerId) return;
          event.preventDefault();
          const nextDrag = {
            ...current,
            clientX: event.clientX,
            clientY: event.clientY,
            overCanvas: isOverCanvas(event.clientX, event.clientY),
          };
          drawerDragRef.current = nextDrag;
          setDrawerDrag(nextDrag);
        }}
        onPointerUp={(event) => {
          const current = drawerDragRef.current;
          if (current?.pointerId !== event.pointerId) return;
          event.preventDefault();
          drawerDragRef.current = null;
          setDrawerDrag(null);
          const moved = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
          if (moved < 5) createWidget(current.type);
          else addDrawerWidget(current.type, event.clientX, event.clientY);
        }}
        onPointerCancel={() => {
          drawerDragRef.current = null;
          setDrawerDrag(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            createWidget(definition.type);
          }
        }}
      >
        <Card variant="secondary" className="widget-editor-library-card pointer-events-none group gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><DefinitionIcon size={17} /></span>
            <div className="min-w-0 flex-1">
              <Card.Title className="truncate text-sm">{definition.label}</Card.Title>
              <Card.Description className="mt-1 line-clamp-2 text-xs">{definition.description}</Card.Description>
            </div>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface text-muted opacity-0 transition-opacity group-hover:opacity-100">
              <Plus size={15} />
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>默认 {definition.width}% x {definition.height}%</span>
            <span>{definition.pluginId ? '插件' : definition.settings.length > 0 ? `${definition.settings.length} 项设置` : '无需设置'}</span>
          </div>
        </Card>
      </div>
    );
  };

  const alignButtons: { mode: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom' | 'fill'; label: string; icon: typeof AlignStartVertical }[] = [
    { mode: 'left', label: '左对齐', icon: AlignStartVertical },
    { mode: 'center-x', label: '水平居中', icon: AlignCenterVertical },
    { mode: 'right', label: '右对齐', icon: AlignEndVertical },
    { mode: 'top', label: '上对齐', icon: AlignStartHorizontal },
    { mode: 'center-y', label: '垂直居中', icon: AlignCenterHorizontal },
    { mode: 'bottom', label: '下对齐', icon: AlignEndHorizontal },
  ];

  return (
    <div className="widget-editor-root flex size-full min-h-0 flex-col bg-background text-foreground">
      <header className="widget-editor-header flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm shadow-primary/20"><MonitorUp size={19} /></div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold">小组件编辑器</h1>
              {dirty && <Chip size="sm" variant="soft" className="bg-warning/15 text-warning">未保存</Chip>}
            </div>
            <p className="mt-0.5 text-xs text-muted">编排你的桌面信息层 · 拖拽摆放 · 右侧精调</p>
          </div>
        </div>
        <div className="widget-editor-actions flex flex-wrap items-center gap-2">
          <Button isIconOnly variant="secondary" aria-label="撤销" onPress={undo} isDisabled={!past.length}><Undo2 size={16} /></Button>
          <Button isIconOnly variant="secondary" aria-label="重做" onPress={redo} isDisabled={!future.length}><Redo2 size={16} /></Button>
          <Separator orientation="vertical" className="mx-1 h-6" />
          {displays.length > 0 && (
            <Select aria-label="预览显示器" className="w-52" value={display.id} onChange={(key) => setDisplayId(String(key))}>
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover><ListBox>{displays.map((item) => <ListBox.Item key={item.id} id={item.id} textValue={`${item.name} ${item.width} x ${item.height}`}>{item.name} · {item.width} x {item.height}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
            </Select>
          )}
          <Chip size="sm" variant="soft" className="hidden sm:flex">{scene.widgets.length} 个组件</Chip>
          <Button variant="secondary" onPress={() => void persist(false)} isPending={pending === 'save'} isDisabled={pending !== ''}><Save size={16} />保存</Button>
          <Button onPress={() => void persist(true)} isPending={pending === 'apply'} isDisabled={pending !== ''}><Check size={16} />保存并应用</Button>
          <Button isIconOnly variant="ghost" aria-label="关闭编辑器" onPress={() => void closeDynamicWidgetEditor()} isDisabled={pending !== ''}><X size={18} /></Button>
        </div>
      </header>

      <main className="widget-editor-main grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]" inert={pending !== ''} aria-busy={pending !== ''}>
        <div ref={canvasAreaRef} className={`widget-editor-canvas relative flex min-h-[20rem] min-w-0 items-center justify-center overflow-hidden rounded-2xl border bg-surface-secondary transition-colors ${drawerDrag?.overCanvas ? 'border-primary bg-accent-soft' : 'border-border'}`}>
          <div ref={desktopCanvasRef} className="relative overflow-hidden rounded-xl bg-black shadow-xl ring-1 ring-border" style={{ width: canvasSize.width, height: canvasSize.height }}>
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: display.width,
                height: display.height,
                transform: `scale(${canvasSize.width / display.width})`,
              }}
            >
              <DynamicDesktop
                scene={scene}
                editing
                editingScale={canvasSize.width / display.width}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onChange={setWidgets}
                showDragStatus={false}
                onDragStatusChange={setDragStatus}
              />
            </div>
            <DesktopPreviewOverlay display={display} />
            {dragStatus && (
              <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-lg bg-black/70 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-md">
                {dragStatus.x}%, {dragStatus.y}%
                {dragStatus.mode === 'resize' && dragStatus.width !== undefined && dragStatus.height !== undefined
                  ? ` · ${dragStatus.width}% x ${dragStatus.height}%`
                  : ' · 已吸附 1% 网格'}
              </div>
            )}
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-surface/90 px-3 py-1.5 text-xs text-muted shadow-sm backdrop-blur-md"><PanelRight size={13} />{display.name} · {display.width} x {display.height} · {(display.width / display.height).toFixed(2)}:1</div>
        </div>

        <Card className="widget-editor-inspector min-h-0 gap-4 overflow-hidden p-0">
          <Card.Header className="px-4 pt-4">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                {SelectedIcon ? <SelectedIcon size={17} /> : <MousePointer2 size={17} />}
              </div>
              <div className="min-w-0 flex-1">
                <Card.Title>{selected ? (selectedDefinition?.label ?? '小组件设置') : '选择小组件'}</Card.Title>
                <Card.Description>
                  {selected
                    ? selectedDefinition?.pluginId ? `插件组件 · 图层 ${selectedIndex}` : `内置组件 · 图层 ${selectedIndex}`
                    : '在画布中选择组件，或从下方组件库添加。'}
                </Card.Description>
              </div>
            </div>
          </Card.Header>
          {selected ? (
            <Tabs defaultSelectedKey="content" className="flex min-h-0 flex-1 flex-col">
              <Tabs.ListContainer className="shrink-0 border-b border-border px-3">
                <Tabs.List aria-label="小组件设置" className="w-full">
                  <Tabs.Tab id="content"><SlidersHorizontal size={14} /><span className="text-xs">内容</span><Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="style"><Sparkles size={14} /><span className="text-xs">样式</span><Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="layout"><LayoutGrid size={14} /><span className="text-xs">布局</span><Tabs.Indicator /></Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <ScrollShadow className="min-h-0 flex-1 px-4 py-4">
                <Tabs.Panel id="content" className="space-y-4">
                  {settingsSchema.length > 0 ? (
                    <>
                      {settingsSchema.map((descriptor) => (
                        <SettingControl
                          key={descriptor.key}
                          descriptor={descriptor}
                          value={selected.settings[descriptor.key]}
                          onChange={(value) => updateSettings(descriptor.key, value)}
                        />
                      ))}
                      <Button variant="secondary" size="sm" onPress={() => updateSelected({ settings: defaultSettings(settingsSchema) })}>
                        <RotateCcw size={14} />恢复默认内容
                      </Button>
                    </>
                  ) : selectedDefinition?.pluginId ? (
                    <p className="rounded-lg bg-surface-secondary p-3 text-xs leading-5 text-muted">
                      该插件小组件未声明可配置内容，显示内容由插件定义；桌面背景不接收交互，因此小组件不能包含按钮。
                    </p>
                  ) : (
                    <p className="rounded-lg bg-surface-secondary p-3 text-xs leading-5 text-muted">该小组件没有可配置内容。</p>
                  )}
                </Tabs.Panel>
                <Tabs.Panel id="style" className="space-y-5">
                  <Slider minValue={0} maxValue={100} step={1} value={Math.round((selected.opacity ?? 1) * 100)} onChange={(value) => updateSelected({ opacity: Number(value) / 100 }, 'opacity')}>
                    <Label>整体不透明度</Label>
                    <Slider.Output>{({ state }) => `${Math.round(state.values[0])}%`}</Slider.Output>
                    <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                  </Slider>
                  <Slider minValue={0} maxValue={100} step={1} value={Math.round((selected.background_opacity ?? 1) * 100)} onChange={(value) => updateSelected({ background_opacity: Number(value) / 100 }, 'background-opacity')}>
                    <Label>背景不透明度</Label>
                    <Slider.Output>{({ state }) => `${Math.round(state.values[0])}%`}</Slider.Output>
                    <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                  </Slider>
                  <Switch isSelected={selected.background_blur !== false} onChange={(background_blur) => updateSelected({ background_blur })}>
                    <Switch.Content>
                      <span>
                        <span className="block text-sm font-medium">背景模糊</span>
                        <span className="block text-xs text-muted">配合低背景不透明度可获得更通透的效果</span>
                      </span>
                      <Switch.Control><Switch.Thumb /></Switch.Control>
                    </Switch.Content>
                  </Switch>
                  <Separator />
                  <div>
                    <Label>文字颜色</Label>
                    <Select
                      aria-label="文字颜色"
                      className="mt-1"
                      selectedKey={selected.text_color === 'dark' ? 'dark' : 'light'}
                      onSelectionChange={(key) => updateSelected({ text_color: key === 'dark' ? 'dark' : 'light' })}
                    >
                      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="light" textValue="浅色文字（深色玻璃）">浅色文字（深色玻璃）<ListBox.ItemIndicator /></ListBox.Item>
                          <ListBox.Item id="dark" textValue="深色文字（浅色玻璃）">深色文字（浅色玻璃）<ListBox.ItemIndicator /></ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  <Slider minValue={80} maxValue={160} step={5} value={Math.round((selected.text_scale ?? 1) * 100)} onChange={(value) => updateSelected({ text_scale: Number(value) / 100 }, 'text-scale')}>
                    <Label>文字大小</Label>
                    <Slider.Output>{({ state }) => `${Math.round(state.values[0])}%`}</Slider.Output>
                    <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                  </Slider>
                  <WidgetColorControl
                    label="强调色"
                    value={/^#[0-9A-Fa-f]{6}$/.test(selected.accent_color ?? '') ? selected.accent_color! : DEFAULT_WIDGET_ACCENT}
                    onChange={(hex) => updateSelected({ accent_color: hex }, 'accent')}
                    onReset={selected.accent_color ? () => updateSelected({ accent_color: '' }) : undefined}
                  />
                </Tabs.Panel>
                <Tabs.Panel id="layout" className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      ['x', '横向位置'], ['y', '纵向位置'], ['width', '宽度'], ['height', '高度'],
                    ] as const).map(([key, label]) => (
                      <div key={key}>
                        <Label htmlFor={`widget-${key}`}>{label}</Label>
                        <Input
                          id={`widget-${key}`}
                          className="mt-1"
                          variant="secondary"
                          type="number"
                          min={key === 'width' ? selectedMinimum.width : key === 'height' ? selectedMinimum.height : 0}
                          max="100"
                          value={String(Math.round(selected[key]))}
                          onChange={(event) => updateSelected({ [key]: Number(event.target.value) || 0 }, `layout:${key}`)}
                        />
                        <p className="mt-1 text-[11px] text-muted">≈ {Math.round((key === 'x' || key === 'width' ? display.width : display.height) * selected[key] / 100)} px</p>
                      </div>
                    ))}
                  </div>
                  <Separator />
                  <div>
                    <p className="mb-2 text-sm font-semibold">快速对齐</p>
                    <div className="grid grid-cols-3 gap-2">
                      {alignButtons.map(({ mode, label, icon: Icon }) => (
                        <Button key={mode} size="sm" variant="secondary" onPress={() => alignSelected(mode)}><Icon size={15} /><span className="truncate">{label}</span></Button>
                      ))}
                      <Button size="sm" variant="secondary" onPress={() => alignSelected('fill')}><LayoutGrid size={15} /><span className="truncate">铺满桌面</span></Button>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-semibold">图层</p>
                    <div className="grid grid-cols-4 gap-2">
                      <Button size="sm" variant="secondary" aria-label="置顶" onPress={() => moveLayer('top')}><ArrowUpToLine size={15} /></Button>
                      <Button size="sm" variant="secondary" aria-label="上移一层" onPress={() => moveLayer('up')}><ArrowUp size={15} /></Button>
                      <Button size="sm" variant="secondary" aria-label="下移一层" onPress={() => moveLayer('down')}><ArrowDown size={15} /></Button>
                      <Button size="sm" variant="secondary" aria-label="置底" onPress={() => moveLayer('bottom')}><ArrowDownToLine size={15} /></Button>
                    </div>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="secondary" onPress={duplicateSelected}><Copy size={15} />复制组件</Button>
                    <Button size="sm" variant="danger" onPress={deleteSelected}><Trash2 size={15} />删除组件</Button>
                  </div>
                  <p className="text-[11px] leading-4 text-muted">快捷键：方向键移动（Shift 加速）、Ctrl+D 复制、Delete 删除、Ctrl+Z / Ctrl+Y 撤销重做。</p>
                </Tabs.Panel>
              </ScrollShadow>
            </Tabs>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center px-6 pb-6 text-center text-sm text-muted">
              <span className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-surface-secondary"><Grip size={21} /></span>
              <p className="max-w-52 leading-5">从下方组件库添加一个组件，或直接在画布中选择已有组件。</p>
            </div>
          )}
        </Card>
      </main>

      <section className="widget-editor-library shrink-0 border-t border-border bg-surface px-5 py-4" inert={pending !== ''}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-xl bg-accent-soft text-accent"><Plus size={16} /></div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">组件库</h2>
                <Chip size="sm" variant="soft">{definitions.length} 个可用</Chip>
              </div>
              <p className="text-xs text-muted">点击添加到中央，拖拽放置到指定位置</p>
            </div>
          </div>
          <Input
            aria-label="搜索小组件"
            className="w-full sm:w-64"
            variant="secondary"
            placeholder="搜索小组件…"
            value={drawerQuery}
            onChange={(event) => setDrawerQuery(event.target.value)}
          />
        </div>
        <ScrollShadow orientation="horizontal" className="w-full pb-1">
          <div className="flex gap-3">
            {builtinDefinitions.map(drawerCard)}
            {pluginDefinitions.length > 0 && (
              <div className="flex shrink-0 items-center">
                <Chip size="sm" variant="soft" className="shrink-0">插件组件</Chip>
              </div>
            )}
            {pluginDefinitions.map(drawerCard)}
            {filteredDefinitions.length === 0 && (
              <div className="flex h-24 items-center text-sm text-muted">没有匹配的小组件。</div>
            )}
          </div>
        </ScrollShadow>
      </section>
      {drawerDrag && (
        <div
          className={`pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-4 py-2 text-sm font-medium shadow-xl backdrop-blur ${drawerDrag.overCanvas ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface/95 text-foreground'}`}
          style={{ left: drawerDrag.clientX, top: drawerDrag.clientY }}
        >
          {drawerDrag.overCanvas ? `放置 ${drawerDrag.label}` : drawerDrag.label}
        </div>
      )}
    </div>
  );
}
