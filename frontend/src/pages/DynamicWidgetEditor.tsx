import { useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Input, Label, ListBox, ScrollShadow, Select, Spinner, Switch, TextArea, toast } from '@heroui/react';
import { Check, Grip, MonitorUp, Save, SlidersHorizontal, X } from 'lucide-react';
import DynamicDesktop, { DesktopPreviewOverlay, useWidgetDefinitions } from '@/components/DynamicDesktop';
import {
  closeDynamicWidgetEditor,
  applyDynamicWallpaperScene,
  getDisplayResolutions,
  getDynamicWallpaperScene,
  saveDynamicWallpaperScene,
} from '@/api/backend';
import type { DisplayResolution, DynamicWallpaperScene, DynamicWidgetInstance } from '@/api/backend';

interface CanvasSize { width: number; height: number }

function ContentSettings({ widget, onSettingsChange }: {
  widget: DynamicWidgetInstance;
  onSettingsChange: (settings: Record<string, unknown>) => void;
}) {
  const settings = widget.settings;
  const patch = (updates: Record<string, unknown>) => onSettingsChange({ ...settings, ...updates });
  const text = (key: string, fallback = '') => typeof settings[key] === 'string' ? String(settings[key]) : fallback;
  const flag = (key: string, fallback: boolean) => typeof settings[key] === 'boolean' ? Boolean(settings[key]) : fallback;

  if (widget.type === 'builtin:clock') return (
    <div className="space-y-4">
      <div><Label htmlFor="widget-clock-label">顶部文字</Label><Input id="widget-clock-label" className="mt-1" variant="secondary" maxLength={40} placeholder="可选，例如：北京时间" value={text('label')} onChange={(event) => patch({ label: event.target.value })} /></div>
      <Switch isSelected={flag('use24Hour', true)} onChange={(use24Hour) => patch({ use24Hour })}><Switch.Content><span className="text-sm">使用 24 小时制</span><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch>
      <Switch isSelected={flag('showDate', true)} onChange={(showDate) => patch({ showDate })}><Switch.Content><span className="text-sm">显示日期</span><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch>
    </div>
  );
  if (widget.type === 'builtin:date') return (
    <div className="space-y-4">
      <div><Label htmlFor="widget-date-title">标题</Label><Input id="widget-date-title" className="mt-1" variant="secondary" maxLength={40} placeholder="可选标题" value={text('title')} onChange={(event) => patch({ title: event.target.value })} /></div>
      <Switch isSelected={flag('showWeekday', true)} onChange={(showWeekday) => patch({ showWeekday })}><Switch.Content><span className="text-sm">显示星期</span><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch>
    </div>
  );
  if (widget.type === 'builtin:note') return (
    <div className="space-y-4">
      <div><Label htmlFor="widget-note-title">标题</Label><Input id="widget-note-title" className="mt-1" variant="secondary" maxLength={40} value={text('title', '便笺')} onChange={(event) => patch({ title: event.target.value })} /></div>
      <div><Label htmlFor="widget-note-content">便笺内容</Label><TextArea id="widget-note-content" fullWidth className="mt-1 min-h-28" variant="secondary" maxLength={500} value={text('content', '今天也要记得看看喜欢的风景。')} onChange={(event) => patch({ content: event.target.value })} /></div>
    </div>
  );
  if (widget.type === 'builtin:status') return (
    <div className="space-y-4">
      <div><Label htmlFor="widget-status-title">标题</Label><Input id="widget-status-title" className="mt-1" variant="secondary" maxLength={40} value={text('title', '动态服务')} onChange={(event) => patch({ title: event.target.value })} /></div>
      <div><Label htmlFor="widget-status-subtitle">状态文字</Label><Input id="widget-status-subtitle" className="mt-1" variant="secondary" maxLength={100} value={text('subtitle', '场景正在运行')} onChange={(event) => patch({ subtitle: event.target.value })} /></div>
    </div>
  );
  return <p className="rounded-lg bg-surface-secondary p-3 text-xs leading-5 text-muted">插件小组件的内容由插件声明预先定义。桌面背景不接收交互，因此插件小组件不能包含按钮。</p>;
}

export default function DynamicWidgetEditor() {
  const definitions = useWidgetDefinitions();
  const [scene, setScene] = useState<DynamicWallpaperScene | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<'save' | 'apply' | ''>('');
  const [displays, setDisplays] = useState<DisplayResolution[]>([]);
  const [displayId, setDisplayId] = useState('');
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [dragStatus, setDragStatus] = useState<{ x: number; y: number } | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getDynamicWallpaperScene().then(setScene).catch((error: unknown) => {
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

  if (!scene) return <div className="flex h-screen items-center justify-center bg-background"><Spinner /></div>;
  const selected = scene.widgets.find((widget) => widget.id === selectedId) ?? null;
  const setWidgets = (widgets: DynamicWidgetInstance[]) => setScene({ ...scene, widgets });
  const updateSelected = (updates: Partial<DynamicWidgetInstance>) => {
    if (!selected) return;
    setWidgets(scene.widgets.map((widget) => {
      if (widget.id !== selected.id) return widget;
      const next = { ...widget, ...updates };
      next.width = Math.max(8, Math.min(100, next.width));
      next.height = Math.max(8, Math.min(100, next.height));
      next.x = Math.max(0, Math.min(100 - next.width, next.x));
      next.y = Math.max(0, Math.min(100 - next.height, next.y));
      return next;
    }));
  };

  const persist = async (apply: boolean) => {
    setPending(apply ? 'apply' : 'save');
    try {
      if (apply) {
        const result = await applyDynamicWallpaperScene(scene);
        setScene(result.scene);
        toast.success(result.status.last_operation === 'apply-scene-requested' ? '布局已保存并排队应用' : '布局已保存并开始应用');
      } else {
        setScene(await saveDynamicWallpaperScene(scene));
        toast.success('布局已保存');
      }
    } catch (error) {
      toast.danger(apply ? '应用失败' : '保存失败', { description: error instanceof Error ? error.message : String(error), timeout: 0 });
    } finally { setPending(''); }
  };

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><MonitorUp size={19} /></div>
          <div><h1 className="font-semibold">小组件编辑器</h1><p className="text-xs text-muted">先设置内容，再按真实屏幕比例安排布局</p></div>
        </div>
        <div className="flex items-center gap-2">
          {displays.length > 0 && (
            <Select aria-label="预览显示器" className="w-52" value={display.id} onChange={(key) => setDisplayId(String(key))}>
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover><ListBox>{displays.map((item) => <ListBox.Item key={item.id} id={item.id} textValue={`${item.name} ${item.width} x ${item.height}`}>{item.name} · {item.width} x {item.height}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
            </Select>
          )}
          <Chip size="sm" variant="soft">{scene.widgets.length} 个组件</Chip>
          <Button variant="secondary" onPress={() => void persist(false)} isPending={pending === 'save'}><Save size={16} />保存</Button>
          <Button onPress={() => void persist(true)} isPending={pending === 'apply'}><Check size={16} />保存并应用</Button>
          <Button isIconOnly variant="ghost" aria-label="关闭编辑器" onPress={() => void closeDynamicWidgetEditor()}><X size={18} /></Button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 gap-4 p-4">
        <div ref={canvasAreaRef} className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface-secondary">
          <div className="relative overflow-hidden rounded-xl bg-black shadow-xl ring-1 ring-border" style={{ width: canvasSize.width, height: canvasSize.height }}>
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
                {dragStatus.x}%, {dragStatus.y}% · 已吸附 1% 网格
              </div>
            )}
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-surface/90 px-3 py-1.5 text-xs text-muted shadow-sm backdrop-blur-md">{display.name} · {display.width} x {display.height} · {(display.width / display.height).toFixed(2)}:1</div>
        </div>

        <Card className="w-72 shrink-0 gap-4 overflow-hidden p-4">
          <Card.Header><Card.Title>{selected ? '小组件设置' : '选择小组件'}</Card.Title><Card.Description>{selected ? '内容会随布局一起保存。' : '在桌面中选择组件后编辑内容。'}</Card.Description></Card.Header>
          <ScrollShadow className="min-h-0 flex-1 pr-1">
            {selected ? <div className="space-y-5">
              <section><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal size={15} />内容</div><ContentSettings widget={selected} onSettingsChange={(settings) => updateSelected({ settings })} /></section>
              <section><p className="mb-3 text-sm font-semibold">位置与尺寸</p><div className="grid grid-cols-2 gap-3">
                {([
                  ['x', '横向位置'], ['y', '纵向位置'], ['width', '宽度'], ['height', '高度'],
                ] as const).map(([key, label]) => (
                  <div key={key}><Label htmlFor={`widget-${key}`}>{label}</Label><Input id={`widget-${key}`} className="mt-1" variant="secondary" type="number" min="0" max="100" value={String(Math.round(selected[key]))} onChange={(event) => updateSelected({ [key]: Number(event.target.value) || 0 })} /></div>
                ))}
              </div></section>
            </div> : <div className="flex min-h-40 flex-col items-center justify-center rounded-xl bg-surface-secondary px-4 text-center text-sm text-muted"><Grip size={22} className="mb-2" /><p>从下方拖入一个组件，或选择桌面中已有组件。</p></div>}
          </ScrollShadow>
        </Card>
      </main>

      <section className="shrink-0 border-t border-border bg-surface px-5 py-4">
        <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">小组件抽屉</h2><p className="text-xs text-muted">拖到桌面后在右侧设置内容；应用后桌面小组件不接收鼠标交互。</p></div><Grip size={18} className="text-muted" /></div>
        <ScrollShadow orientation="horizontal" className="w-full pb-1">
          <div className="flex gap-3">
            {definitions.map((definition) => (
              <Card
                key={definition.type}
                draggable
                variant="secondary"
                className="w-52 shrink-0 cursor-grab gap-2 p-3 active:cursor-grabbing"
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData('application/x-ltw-widget', definition.type);
                }}
              >
                <div className="flex items-start justify-between gap-2"><Card.Title className="text-sm">{definition.label}</Card.Title>{definition.pluginId && <Chip size="sm" variant="soft">插件</Chip>}</div>
                <Card.Description className="line-clamp-2 text-xs">{definition.description}</Card.Description>
                <div className="text-[11px] text-muted">默认 {definition.width}% x {definition.height}%</div>
              </Card>
            ))}
          </div>
        </ScrollShadow>
      </section>
    </div>
  );
}
