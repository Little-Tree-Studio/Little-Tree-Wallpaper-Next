import { useEffect, useRef, useState } from 'react';
import { Button, Card, Chip } from '@heroui/react';
import { CalendarDays, Clock3, FileText, Folder, Gauge, Image, StickyNote, Trash2, Volume2, Wifi } from 'lucide-react';
import { dynamicWallpaperAssetUrl } from '@/api/backend';
import type { DynamicWallpaperScene, DynamicWidgetInstance } from '@/api/backend';
import PluginRenderer from '@/plugins/PluginRenderer';
import { usePlugins } from '@/plugins/context';

export interface WidgetDefinition {
  type: string;
  label: string;
  description: string;
  width: number;
  height: number;
  pluginId?: string;
}

const BUILTIN_WIDGETS: WidgetDefinition[] = [
  { type: 'builtin:clock', label: '数字时钟', description: '显示当前时间与星期', width: 28, height: 18 },
  { type: 'builtin:date', label: '日期', description: '简洁的日历日期卡片', width: 20, height: 24 },
  { type: 'builtin:note', label: '便笺', description: '桌面上的快速提醒', width: 28, height: 24 },
  { type: 'builtin:status', label: '运行状态', description: '显示动态壁纸服务状态', width: 26, height: 18 },
];

export function useWidgetDefinitions(): WidgetDefinition[] {
  const { contributions } = usePlugins();
  return [
    ...BUILTIN_WIDGETS,
    ...contributions.widgets.map((widget) => ({
      type: `plugin:${widget.pluginId}:${widget.id}`,
      label: widget.label,
      description: widget.description || `由 ${widget.plugin.name} 提供`,
      width: widget.default_size.width,
      height: widget.default_size.height,
      pluginId: widget.pluginId,
    })),
  ];
}

function Background({ scene }: { scene: DynamicWallpaperScene }) {
  const { background } = scene;
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const slideshowTimerRef = useRef<number | null>(null);
  const items = background.type === 'slideshow' ? background.items : background.path ? [background.path] : [];

  useEffect(() => {
    const runtimeWindow = window as typeof window & { __ltwDynamicRuntime?: Record<string, () => unknown> };
    const move = (offset: number) => setIndex((current) => items.length ? (current + offset + items.length) % items.length : 0);
    runtimeWindow.__ltwDynamicRuntime = {
      play: () => videoRef.current?.play(),
      pause: () => videoRef.current?.pause(),
      auto: () => videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause(),
      reload: () => { videoRef.current?.load(); return videoRef.current?.play(); },
      next: () => move(1),
      previous: () => move(-1),
      dispose: () => {
        if (slideshowTimerRef.current !== null) {
          window.clearInterval(slideshowTimerRef.current);
          slideshowTimerRef.current = null;
        }
        const video = videoRef.current;
        if (video) {
          video.pause();
          video.removeAttribute('src');
          video.load();
        }
      },
    };
    return () => { runtimeWindow.__ltwDynamicRuntime = undefined; };
  }, [background.type, items.join('\n')]);

  useEffect(() => {
    setIndex(0);
    if (background.type !== 'slideshow' || items.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setIndex((current) => background.shuffle
        ? Math.floor(Math.random() * items.length)
        : (current + 1) % items.length);
    }, background.interval_seconds * 1000);
    slideshowTimerRef.current = timer;
    return () => {
      window.clearInterval(timer);
      if (slideshowTimerRef.current === timer) slideshowTimerRef.current = null;
    };
  }, [background.type, background.interval_seconds, background.shuffle, items.join('\n')]);

  if (background.type === 'video' && background.path) {
    return (
      <video
        className="absolute inset-0 size-full object-cover"
        src={dynamicWallpaperAssetUrl(background.path)}
        autoPlay={background.autoplay !== false}
        muted={background.muted}
        loop={background.loop}
        playsInline
        ref={(video) => {
          videoRef.current = video;
          if (video) {
            video.playbackRate = background.playback_rate;
            if (background.autoplay === false) video.pause();
          }
        }}
      />
    );
  }
  const current = items[index];
  return current ? (
    <img
      key={`${current}-${index}`}
      src={dynamicWallpaperAssetUrl(current)}
      alt="动态壁纸底图"
      className={`dynamic-scene-media dynamic-transition-${background.transition} absolute inset-0 size-full object-cover`}
      style={{ animationDuration: `${background.transition_duration}ms` }}
    />
  ) : (
    <div className="absolute inset-0 bg-surface-tertiary" />
  );
}

function stringSetting(widget: DynamicWidgetInstance, key: string, fallback: string): string {
  const value = widget.settings[key];
  return typeof value === 'string' ? value : fallback;
}

function booleanSetting(widget: DynamicWidgetInstance, key: string, fallback: boolean): boolean {
  const value = widget.settings[key];
  return typeof value === 'boolean' ? value : fallback;
}

function BuiltinWidget({ widget }: { widget: DynamicWidgetInstance }) {
  const { type } = widget;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!type.includes('clock') && !type.includes('date')) return undefined;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [type]);

  if (type === 'builtin:clock') {
    const label = stringSetting(widget, 'label', '');
    const showDate = booleanSetting(widget, 'showDate', true);
    const use24Hour = booleanSetting(widget, 'use24Hour', true);
    return (
    <div className="flex size-full flex-col justify-center rounded-2xl bg-black/45 p-5 text-white shadow-lg backdrop-blur-md">
      {label && <span className="mb-1 truncate text-xs font-medium text-white/60">{label}</span>}
      <span className="text-4xl font-semibold tabular-nums tracking-tight">{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: !use24Hour })}</span>
      {showDate && <span className="mt-1 truncate text-sm text-white/70">{now.toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}</span>}
    </div>
    );
  }
  if (type === 'builtin:date') {
    const title = stringSetting(widget, 'title', '');
    const showWeekday = booleanSetting(widget, 'showWeekday', true);
    return (
    <div className="flex size-full flex-col items-center justify-center rounded-2xl bg-white/85 text-black shadow-lg backdrop-blur-md">
      <CalendarDays size={22} className="mb-2 opacity-55" />
      {title && <span className="mb-1 max-w-full truncate px-2 text-xs font-medium opacity-60">{title}</span>}
      <span className="text-5xl font-semibold tabular-nums">{now.getDate()}</span>
      <span className="text-sm opacity-60">{now.toLocaleDateString('zh-CN', { month: 'long', ...(showWeekday ? { weekday: 'short' } : {}) })}</span>
    </div>
    );
  }
  if (type === 'builtin:note') {
    const title = stringSetting(widget, 'title', '便笺');
    const content = stringSetting(widget, 'content', '今天也要记得看看喜欢的风景。');
    return (
    <div className="size-full rounded-2xl bg-warning/90 p-5 text-warning-foreground shadow-lg">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><StickyNote size={17} /><span className="truncate">{title}</span></div>
      <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-6 opacity-80">{content}</p>
    </div>
    );
  }
  const title = stringSetting(widget, 'title', '动态服务');
  const subtitle = stringSetting(widget, 'subtitle', '场景正在运行');
  return (
    <div className="flex size-full items-center gap-3 rounded-2xl bg-black/45 p-4 text-white shadow-lg backdrop-blur-md">
      <Gauge size={26} />
      <div className="min-w-0"><p className="truncate font-semibold">{title}</p><p className="truncate text-xs text-white/65">{subtitle}</p></div>
    </div>
  );
}

function WidgetContent({ widget }: { widget: DynamicWidgetInstance }) {
  const { contributions } = usePlugins();
  if (widget.type.startsWith('builtin:')) return <BuiltinWidget widget={widget} />;
  const [, pluginId, widgetId] = widget.type.split(':');
  const definition = contributions.widgets.find((item) => item.pluginId === pluginId && item.id === widgetId);
  if (!definition) return <Card className="size-full justify-center p-4"><Card.Title>小组件不可用</Card.Title></Card>;
  return (
    <Card data-plugin-id={pluginId} className="size-full overflow-auto p-4">
      <PluginRenderer
        pluginId={pluginId}
        pluginName={definition.plugin.name}
        packageHash={definition.packageHash}
        blocks={definition.blocks}
      />
    </Card>
  );
}

interface DynamicDesktopProps {
  scene: DynamicWallpaperScene;
  editing?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (widgets: DynamicWidgetInstance[]) => void;
  preview?: { name: string; width: number; height: number } | null;
  showDragStatus?: boolean;
  onDragStatusChange?: (status: { x: number; y: number } | null) => void;
}

export function DesktopPreviewOverlay({ display }: { display: NonNullable<DynamicDesktopProps['preview']> }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 select-none text-white">
      <div className="absolute left-3 top-3 flex flex-col gap-3 text-xs font-medium drop-shadow-md">
        <div className="flex w-14 flex-col items-center gap-1"><Folder size={25} fill="currentColor" className="text-warning" /><span>文件</span></div>
        <div className="flex w-14 flex-col items-center gap-1"><Image size={25} className="text-primary" /><span>图片</span></div>
        <div className="flex w-14 flex-col items-center gap-1"><FileText size={25} /><span>文档</span></div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-9 items-center justify-center border-t border-white/10 bg-black/60 backdrop-blur-lg">
        <div className="flex items-center gap-2"><span className="size-4 rounded bg-primary" /><span className="size-4 rounded bg-white/85" /><span className="size-4 rounded bg-white/85" /></div>
        <div className="absolute right-3 flex items-center gap-2 text-xs font-medium"><Wifi size={15} /><Volume2 size={15} /><span>{new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></div>
      </div>
      <div className="absolute right-3 top-3 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur-md">
        {display.name} · {display.width} x {display.height}
      </div>
    </div>
  );
}

export default function DynamicDesktop({
  scene,
  editing = false,
  selectedId,
  onSelect,
  onChange,
  preview = null,
  showDragStatus = true,
  onDragStatusChange,
}: DynamicDesktopProps) {
  const definitions = useWidgetDefinitions();
  const desktopRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const addWidget = (type: string, x: number, y: number) => {
    const definition = definitions.find((item) => item.type === type);
    if (!definition || !onChange) return;
    const widget: DynamicWidgetInstance = {
      id: `widget-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type,
      x: Math.round(Math.max(0, Math.min(100 - definition.width, x - definition.width / 2))),
      y: Math.round(Math.max(0, Math.min(100 - definition.height, y - definition.height / 2))),
      width: definition.width,
      height: definition.height,
      settings: {},
    };
    onChange([...scene.widgets, widget]);
    onSelect?.(widget.id);
  };
  const moveWidget = (id: string, x: number, y: number) => {
    const widget = scene.widgets.find((item) => item.id === id);
    if (!widget || !onChange) return;
    onChange(scene.widgets.map((item) => item.id === id ? {
      ...item,
      x: Math.round(Math.max(0, Math.min(100 - item.width, x))),
      y: Math.round(Math.max(0, Math.min(100 - item.height, y))),
    } : item));
  };

  const finishPointerDrag = (event: React.PointerEvent) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
    onDragStatusChange?.(null);
  };

  return (
    <div
      ref={desktopRef}
      className={`dynamic-desktop relative size-full overflow-hidden bg-black ${editing ? 'dynamic-desktop--editing touch-none' : ''}`}
      onClick={() => editing && onSelect?.(null)}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        const rect = desktopRef.current?.getBoundingClientRect();
        if (!drag || drag.pointerId !== event.pointerId || !rect) return;
        event.preventDefault();
        moveWidget(
          drag.id,
          ((event.clientX - rect.left) / rect.width) * 100 - drag.offsetX,
          ((event.clientY - rect.top) / rect.height) * 100 - drag.offsetY,
        );
        const widget = scene.widgets.find((item) => item.id === drag.id);
        if (widget) {
          onDragStatusChange?.({
            x: Math.round(Math.max(0, Math.min(100 - widget.width, ((event.clientX - rect.left) / rect.width) * 100 - drag.offsetX))),
            y: Math.round(Math.max(0, Math.min(100 - widget.height, ((event.clientY - rect.top) / rect.height) * 100 - drag.offsetY))),
          });
        }
      }}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      onDragOver={(event) => editing && event.preventDefault()}
      onDrop={(event) => {
        if (!editing) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const type = event.dataTransfer.getData('application/x-ltw-widget');
        const existingId = event.dataTransfer.getData('application/x-ltw-widget-instance');
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;
        if (existingId) moveWidget(existingId, x, y);
        else if (type) addWidget(type, x, y);
      }}
    >
      <Background scene={scene} />
      <div className="absolute inset-0 bg-black/5" />
      {preview && <DesktopPreviewOverlay display={preview} />}
      {scene.widgets.map((widget) => (
        <div
          key={widget.id}
          tabIndex={editing ? 0 : -1}
          aria-label={editing ? `移动小组件 ${widget.type}` : undefined}
          onPointerDown={(event) => {
            if (!editing || event.button !== 0) return;
            const rect = desktopRef.current?.getBoundingClientRect();
            if (!rect) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              id: widget.id,
              pointerId: event.pointerId,
              offsetX: ((event.clientX - rect.left) / rect.width) * 100 - widget.x,
              offsetY: ((event.clientY - rect.top) / rect.height) * 100 - widget.y,
            };
            setDraggingId(widget.id);
            onDragStatusChange?.({ x: Math.round(widget.x), y: Math.round(widget.y) });
            onSelect?.(widget.id);
          }}
          onClick={(event) => { event.stopPropagation(); onSelect?.(widget.id); }}
          onKeyDown={(event) => {
            if (!editing || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const step = event.shiftKey ? 5 : 1;
            const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
            const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
            moveWidget(widget.id, widget.x + dx, widget.y + dy);
          }}
          className={`absolute z-20 min-h-12 min-w-12 ${editing ? 'cursor-grab rounded-2xl outline-offset-2 active:cursor-grabbing' : ''} ${selectedId === widget.id ? 'outline-2 outline-primary' : ''} ${draggingId === widget.id ? 'scale-[1.01] shadow-2xl' : ''}`}
          style={{ left: `${widget.x}%`, top: `${widget.y}%`, width: `${widget.width}%`, height: `${widget.height}%` }}
        >
          <div className={editing ? 'pointer-events-none size-full select-none' : 'size-full'}>
            <WidgetContent widget={widget} />
          </div>
          {editing && selectedId === widget.id && (
            <Button
              isIconOnly
              size="sm"
              variant="danger"
              aria-label="删除小组件"
              className="absolute -right-3 -top-3 z-20 rounded-full"
              onPointerDown={(event) => event.stopPropagation()}
              onPress={() => onChange?.(scene.widgets.filter((item) => item.id !== widget.id))}
            ><Trash2 size={14} /></Button>
          )}
        </div>
      ))}
      {editing && scene.widgets.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Chip variant="soft" className="bg-black/55 text-white"><Clock3 size={15} />从下方抽屉拖入小组件</Chip>
        </div>
      )}
      {editing && showDragStatus && draggingId && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-lg bg-black/65 px-3 py-1.5 text-xs text-white backdrop-blur-md">
          {Math.round(scene.widgets.find((item) => item.id === draggingId)?.x ?? 0)}%, {Math.round(scene.widgets.find((item) => item.id === draggingId)?.y ?? 0)}% · 已吸附 1% 网格
        </div>
      )}
    </div>
  );
}
