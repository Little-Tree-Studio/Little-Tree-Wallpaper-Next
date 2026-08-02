import { useEffect, useRef, useState } from 'react';
import { Button, Card, Chip } from '@heroui/react';
import { CalendarClock, CalendarDays, Clock3, FileText, Folder, Gauge, Image, MoonStar, Quote, Sparkles, StickyNote, Sunrise, Trash2, TrendingUp, Volume2, Wifi } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
  icon: LucideIcon;
  pluginId?: string;
}

export function widgetMinimumSize(type: string): { width: number; height: number } {
  const minimums: Record<string, { width: number; height: number }> = {
    'builtin:clock': { width: 20, height: 14 },
    'builtin:date': { width: 16, height: 18 },
    'builtin:note': { width: 20, height: 18 },
    'builtin:status': { width: 20, height: 14 },
    'builtin:greeting': { width: 22, height: 14 },
    'builtin:countdown': { width: 18, height: 18 },
    'builtin:quote': { width: 22, height: 18 },
    'builtin:progress': { width: 22, height: 14 },
  };
  return minimums[type] ?? { width: 8, height: 8 };
}

const BUILTIN_WIDGETS: WidgetDefinition[] = [
  { type: 'builtin:clock', label: '数字时钟', description: '显示当前时间与星期', width: 28, height: 18, icon: Clock3 },
  { type: 'builtin:date', label: '日期', description: '简洁的日历日期卡片', width: 20, height: 24, icon: CalendarDays },
  { type: 'builtin:note', label: '便笺', description: '桌面上的快速提醒', width: 28, height: 24, icon: StickyNote },
  { type: 'builtin:status', label: '运行状态', description: '显示动态壁纸服务状态', width: 26, height: 18, icon: Gauge },
  { type: 'builtin:greeting', label: '时段问候', description: '随一天时段变化的问候卡片', width: 30, height: 18, icon: Sunrise },
  { type: 'builtin:countdown', label: '日期倒计时', description: '记录距离重要日期还有多少天', width: 24, height: 22, icon: CalendarClock },
  { type: 'builtin:quote', label: '文字卡片', description: '展示一句喜欢的话', width: 32, height: 22, icon: Quote },
  { type: 'builtin:progress', label: '目标进度', description: '用进度条展示当前完成情况', width: 30, height: 18, icon: TrendingUp },
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
      icon: Sparkles,
      pluginId: widget.pluginId,
    })),
  ];
}

function ImageOverlay({ scene, isPaused }: { scene: DynamicWallpaperScene; isPaused: boolean }) {
  const { background } = scene;
  if (background.type !== 'image' || background.overlay_effect === 'none') return null;
  const count = Math.max(8, Math.min(120, Math.round(background.overlay_density)));
  const motion = ['bubbles'].includes(background.overlay_effect)
    ? 'rise'
    : ['fireflies', 'dust', 'stars'].includes(background.overlay_effect) ? 'float' : 'fall';
  return (
    <div className="dynamic-image-overlay pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => {
        const left = (index * 47 + 13) % 100;
        const delay = -((index * 31) % 100) / 10;
        const durationBase = background.overlay_effect === 'rain' ? 2.5 : motion === 'float' ? 8 : 7;
        const durationRange = background.overlay_effect === 'rain' ? 2 : 8;
        const duration = (durationBase + (index * 17) % durationRange) / background.overlay_speed;
        const size = (6 + (index * 11) % 12) * background.overlay_size;
        return (
          <span
            key={index}
            className={`dynamic-image-particle dynamic-image-particle--${background.overlay_effect} dynamic-image-particle--motion-${motion}`}
            style={{
              left: `${left}%`,
              width: size,
              height: size,
              top: motion === 'float' ? `${8 + (index * 37) % 80}%` : undefined,
              opacity: background.overlay_opacity,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              animationPlayState: isPaused ? 'paused' : 'running',
            }}
          />
        );
      })}
    </div>
  );
}

function Background({
  scene,
  onPlaybackStateChange,
}: {
  scene: DynamicWallpaperScene;
  onPlaybackStateChange?: (paused: boolean, event: string, ended?: boolean) => void;
}) {
  const { background } = scene;
  const [motionPaused, setMotionPaused] = useState(false);
  const [slideshowFrame, setSlideshowFrame] = useState({
    index: 0,
    sequence: 0,
    previous: null as { index: number; sequence: number } | null,
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const slideshowTimerRef = useRef<number | null>(null);
  const items = background.type === 'slideshow' ? background.items : background.path ? [background.path] : [];

  useEffect(() => {
    const runtimeWindow = window as typeof window & { __ltwDynamicRuntime?: Record<string, () => unknown> };
    const move = (offset: number) => setSlideshowFrame((current) => {
      if (!items.length) return { index: 0, sequence: current.sequence, previous: null };
      const nextIndex = (current.index + offset + items.length) % items.length;
      if (nextIndex === current.index) return current;
      return {
        index: nextIndex,
        sequence: current.sequence + 1,
        previous: { index: current.index, sequence: current.sequence },
      };
    });
    runtimeWindow.__ltwDynamicRuntime = {
      play: () => videoRef.current ? videoRef.current.play() : setMotionPaused(false),
      pause: () => videoRef.current ? videoRef.current.pause() : setMotionPaused(true),
      auto: () => videoRef.current
        ? videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause()
        : setMotionPaused((paused) => !paused),
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
    if (background.type !== 'video') {
      onPlaybackStateChange?.(motionPaused, motionPaused ? 'pause' : 'playing');
    }
  }, [background.type, motionPaused, onPlaybackStateChange]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = background.volume;
  }, [background.volume]);

  useEffect(() => {
    setSlideshowFrame((current) => current.index === 0 && current.previous === null
      ? current
      : { index: 0, sequence: current.sequence + 1, previous: null });
    if (background.type !== 'slideshow' || items.length < 2 || motionPaused) return undefined;
    const timer = window.setInterval(() => {
      setSlideshowFrame((current) => {
        const nextIndex = background.shuffle
          ? Math.floor(Math.random() * items.length)
          : (current.index + 1) % items.length;
        if (nextIndex === current.index) return current;
        return {
          index: nextIndex,
          sequence: current.sequence + 1,
          previous: { index: current.index, sequence: current.sequence },
        };
      });
    }, background.interval_seconds * 1000);
    slideshowTimerRef.current = timer;
    return () => {
      window.clearInterval(timer);
      if (slideshowTimerRef.current === timer) slideshowTimerRef.current = null;
    };
  }, [background.type, background.interval_seconds, background.shuffle, motionPaused, items.join('\n')]);

  if (background.type === 'video' && background.path) {
    return (
      <video
        className="absolute inset-0 size-full object-cover"
        src={dynamicWallpaperAssetUrl(background.path)}
        autoPlay={background.autoplay !== false}
        muted={background.muted}
        loop={background.loop}
        playsInline
        onPlaying={() => onPlaybackStateChange?.(false, 'playing')}
        onPause={() => onPlaybackStateChange?.(true, 'pause')}
        onEnded={() => onPlaybackStateChange?.(true, 'ended', true)}
        ref={(video) => {
          videoRef.current = video;
          if (video) {
            video.playbackRate = background.playback_rate;
            video.volume = background.volume;
            if (background.autoplay === false) video.pause();
          }
        }}
      />
    );
  }
  const current = items[slideshowFrame.index];
  const previous = background.type === 'slideshow' && slideshowFrame.previous
    ? items[slideshowFrame.previous.index]
    : null;
  const imageFit = background.type === 'image' ? background.image_fit : 'cover';
  return current ? (
    <>
      {imageFit === 'repeat' ? (
        <div
          className="absolute inset-0 bg-center bg-repeat"
          style={{ backgroundImage: `url("${dynamicWallpaperAssetUrl(current).replace(/"/g, '%22')}")` }}
        />
      ) : (
        <>
      {previous && (
        <img
          key={`frame-${slideshowFrame.previous?.sequence}`}
          src={dynamicWallpaperAssetUrl(previous)}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 size-full object-cover"
        />
      )}
      <img
        key={`frame-${slideshowFrame.sequence}`}
        src={dynamicWallpaperAssetUrl(current)}
        alt="动态壁纸底图"
        className={`dynamic-scene-media dynamic-transition-${background.transition} absolute inset-0 size-full`}
        style={{
          animationDuration: `${background.transition_duration}ms`,
          animationPlayState: motionPaused ? 'paused' : 'running',
          objectFit: imageFit,
          objectPosition: '50% 50%',
        }}
        onAnimationEnd={() => setSlideshowFrame((latest) => latest.sequence === slideshowFrame.sequence
          ? { ...latest, previous: null }
          : latest)}
      />
        </>
      )}
      <ImageOverlay scene={scene} isPaused={motionPaused} />
    </>
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

function numberSetting(widget: DynamicWidgetInstance, key: string, fallback: number): number {
  const value = widget.settings[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function widgetBackground(widget: DynamicWidgetInstance, color: string): React.CSSProperties {
  const opacity = Math.max(0, Math.min(1, widget.background_opacity ?? 1));
  const blur = widget.background_blur === false ? 'none' : 'blur(24px)';
  return {
    backgroundColor: `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`,
    backdropFilter: blur,
    WebkitBackdropFilter: blur,
    borderColor: opacity === 0 ? 'transparent' : undefined,
    boxShadow: opacity === 0 ? 'none' : undefined,
  };
}

function BuiltinWidget({ widget }: { widget: DynamicWidgetInstance }) {
  const { type } = widget;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!['builtin:clock', 'builtin:date', 'builtin:greeting', 'builtin:countdown'].includes(type)) return undefined;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [type]);

  if (type === 'builtin:clock') {
    const label = stringSetting(widget, 'label', '');
    const showDate = booleanSetting(widget, 'showDate', true);
    const use24Hour = booleanSetting(widget, 'use24Hour', true);
    return (
      <div className="relative flex size-full flex-col justify-end overflow-hidden rounded-3xl border border-white/15 bg-black/45 p-5 text-white shadow-2xl backdrop-blur-xl" style={widgetBackground(widget, 'rgb(0 0 0 / 45%)')}>
        <div className="absolute -right-8 -top-10 size-32 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex items-center justify-between gap-3">
          <span className="truncate text-xs font-medium uppercase tracking-[0.18em] text-white/55">{label || 'Local time'}</span>
          <Clock3 size={17} className="shrink-0 text-white/55" />
        </div>
        <span className="relative mt-1 text-5xl font-semibold tabular-nums tracking-[-0.06em]">{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: !use24Hour })}</span>
        {showDate && <span className="relative mt-1 truncate text-sm text-white/65">{now.toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}</span>}
      </div>
    );
  }
  if (type === 'builtin:date') {
    const title = stringSetting(widget, 'title', '');
    const showWeekday = booleanSetting(widget, 'showWeekday', true);
    return (
      <div className="flex size-full flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/85 text-black shadow-2xl backdrop-blur-xl" style={widgetBackground(widget, 'rgb(255 255 255 / 85%)')}>
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-black/45">
          <span className="truncate">{title || now.getFullYear()}</span><CalendarDays size={17} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
          <span className="text-6xl font-semibold tabular-nums tracking-tighter">{now.getDate()}</span>
          <span className="mt-1 text-sm font-medium text-black/50">{now.toLocaleDateString('zh-CN', { month: 'long', ...(showWeekday ? { weekday: 'short' } : {}) })}</span>
        </div>
      </div>
    );
  }
  if (type === 'builtin:note') {
    const title = stringSetting(widget, 'title', '便笺');
    const content = stringSetting(widget, 'content', '今天也要记得看看喜欢的风景。');
    return (
      <div className="relative size-full overflow-hidden rounded-3xl border border-white/25 bg-warning/90 p-5 text-warning-foreground shadow-2xl" style={widgetBackground(widget, 'color-mix(in srgb, var(--color-warning) 90%, transparent)')}>
        <div className="absolute right-0 top-0 size-12 bg-white/20 [clip-path:polygon(100%_0,100%_100%,0_0)]" />
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold"><span className="flex size-8 items-center justify-center rounded-xl bg-black/10"><StickyNote size={16} /></span><span className="truncate">{title}</span></div>
        <p className="line-clamp-5 whitespace-pre-wrap text-[15px] leading-6 opacity-75">{content}</p>
      </div>
    );
  }
  if (type === 'builtin:status') {
    const title = stringSetting(widget, 'title', '动态服务');
    const subtitle = stringSetting(widget, 'subtitle', '场景正在运行');
    return (
      <div className="flex size-full items-center gap-4 overflow-hidden rounded-3xl border border-white/15 bg-black/55 p-5 text-white shadow-2xl backdrop-blur-xl" style={widgetBackground(widget, 'rgb(0 0 0 / 55%)')}>
        <div className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/10"><Gauge size={24} /><span className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-black/50 bg-success" /></div>
        <div className="min-w-0"><p className="truncate text-lg font-semibold">{title}</p><p className="mt-1 truncate text-sm text-white/55">{subtitle}</p></div>
      </div>
    );
  }
  if (type === 'builtin:greeting') {
    const hour = now.getHours();
    const isDay = hour >= 6 && hour < 18;
    const title = stringSetting(widget, 'title', '') || (hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好');
    const subtitle = stringSetting(widget, 'subtitle', '愿今天也有好风景');
    const GreetingIcon = isDay ? Sunrise : MoonStar;
    return (
      <div className="relative flex size-full items-end overflow-hidden rounded-3xl border border-white/20 bg-black/55 p-5 text-white shadow-2xl backdrop-blur-xl" style={widgetBackground(widget, 'rgb(0 0 0 / 55%)')}>
        <GreetingIcon className="absolute right-5 top-5 text-white/60" size={28} />
        <div className="absolute -left-12 -top-16 size-44 rounded-full bg-warning/20 blur-3xl" />
        <div className="relative min-w-0"><p className="truncate text-3xl font-semibold tracking-tight">{title}</p><p className="mt-1 truncate text-sm text-white/60">{subtitle}</p></div>
      </div>
    );
  }
  if (type === 'builtin:countdown') {
    const title = stringSetting(widget, 'title', '倒计时');
    const target = stringSetting(widget, 'target', '');
    const targetParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(target);
    const targetDate = targetParts ? new Date(Number(targetParts[1]), Number(targetParts[2]) - 1, Number(targetParts[3])) : null;
    const validTarget = Boolean(targetDate
      && targetDate.getFullYear() === Number(targetParts?.[1])
      && targetDate.getMonth() === Number(targetParts?.[2]) - 1
      && targetDate.getDate() === Number(targetParts?.[3]));
    const todayIndex = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000;
    const targetIndex = validTarget && targetDate ? Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()) / 86_400_000 : null;
    const days = targetIndex === null ? null : Math.max(0, targetIndex - todayIndex);
    const completed = targetIndex !== null && targetIndex <= todayIndex;
    return (
      <div className="flex size-full flex-col justify-between overflow-hidden rounded-3xl border border-white/20 bg-black/55 p-5 text-white shadow-2xl backdrop-blur-xl" style={widgetBackground(widget, 'rgb(0 0 0 / 55%)')}>
        <div className="flex items-center justify-between gap-3 text-sm text-white/70"><span className="truncate font-medium">{title}</span><CalendarClock size={19} /></div>
        <div><div className="flex items-end gap-2"><span className="text-6xl font-semibold tabular-nums tracking-tighter">{completed ? '✓' : days ?? '--'}</span>{!completed && days !== null && <span className="mb-2 text-sm text-white/65">天</span>}</div><p className="mt-1 truncate text-xs text-white/65">{completed ? stringSetting(widget, 'completeText', '时间到了') : validTarget && targetDate ? targetDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : '请设置目标日期'}</p></div>
      </div>
    );
  }
  if (type === 'builtin:quote') {
    const quote = stringSetting(widget, 'quote', '慢一点，也没关系。');
    const author = stringSetting(widget, 'author', '');
    return (
      <div className="relative flex size-full flex-col justify-between overflow-hidden rounded-3xl border border-white/20 bg-white/90 p-6 text-black shadow-2xl backdrop-blur-xl" style={widgetBackground(widget, 'rgb(255 255 255 / 90%)')}>
        <Quote size={54} className="absolute -right-1 -top-2 text-black/5" fill="currentColor" />
        <Sparkles size={18} className="text-black/35" />
        <blockquote className="line-clamp-4 text-xl font-medium leading-relaxed tracking-tight">{quote}</blockquote>
        <p className="truncate text-xs font-medium uppercase tracking-[0.15em] text-black/55">{author ? `— ${author}` : 'Daily note'}</p>
      </div>
    );
  }
  const title = stringSetting(widget, 'title', '本周进度');
  const value = Math.max(0, Math.min(100, numberSetting(widget, 'value', 50)));
  const unit = stringSetting(widget, 'unit', '%');
  return (
    <div className="flex size-full flex-col justify-between overflow-hidden rounded-3xl border border-white/15 bg-black/55 p-5 text-white shadow-2xl backdrop-blur-xl" style={widgetBackground(widget, 'rgb(0 0 0 / 55%)')}>
      <div className="flex items-center justify-between text-sm text-white/70"><span className="truncate font-medium">{title}</span><TrendingUp size={19} /></div>
      <div><div className="mb-3 flex items-end gap-1"><span className="text-4xl font-semibold tabular-nums tracking-tight">{Math.round(value)}</span><span className="mb-1 max-w-24 truncate text-sm text-white/65">{unit}</span></div><div className="h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-white transition-[width] duration-500" style={{ width: `${value}%` }} /></div></div>
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
    <Card data-plugin-id={pluginId} className="size-full overflow-auto p-4" style={widgetBackground(widget, 'var(--surface)')}>
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
  onPlaybackStateChange?: (paused: boolean, event: string, ended?: boolean) => void;
  editing?: boolean;
  editingScale?: number;
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
  onPlaybackStateChange,
  editing = false,
  editingScale = 1,
  selectedId,
  onSelect,
  onChange,
  preview = null,
  showDragStatus = true,
  onDragStatusChange,
}: DynamicDesktopProps) {
  const desktopRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const visibleEditingScale = Math.max(0.1, Math.min(1, editingScale));
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
    >
      <Background scene={scene} onPlaybackStateChange={onPlaybackStateChange} />
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
          onFocus={() => editing && onSelect?.(widget.id)}
          onKeyDown={(event) => {
            if (!editing) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect?.(widget.id);
              return;
            }
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const step = event.shiftKey ? 5 : 1;
            const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
            const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
            moveWidget(widget.id, widget.x + dx, widget.y + dy);
          }}
          className={`absolute z-20 min-h-12 min-w-12 ${editing ? 'cursor-grab rounded-2xl ring-1 ring-white/35 outline-offset-2 active:cursor-grabbing' : ''} ${selectedId === widget.id ? 'outline-2 outline-primary' : ''} ${draggingId === widget.id ? 'scale-[1.01] shadow-2xl' : ''}`}
          style={{ left: `${widget.x}%`, top: `${widget.y}%`, width: `${widget.width}%`, height: `${widget.height}%` }}
        >
          <div className={editing ? 'pointer-events-none size-full select-none' : 'size-full'} style={{ opacity: editing ? Math.max(widget.opacity ?? 1, 0.16) : widget.opacity ?? 1 }}>
            <WidgetContent widget={widget} />
          </div>
          {editing && selectedId === widget.id && (
            <Button
              isIconOnly
              size="sm"
              variant="danger"
              aria-label="删除小组件"
              className="absolute right-0 top-0 z-20 rounded-full"
              style={{
                transform: `scale(${1 / visibleEditingScale})`,
                transformOrigin: 'top right',
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onPress={() => onChange?.(scene.widgets.filter((item) => item.id !== widget.id))}
            ><Trash2 size={16} /></Button>
          )}
        </div>
      ))}
      {editing && scene.widgets.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Chip
            size="lg"
            variant="soft"
            className="bg-black/65 text-white shadow-lg backdrop-blur-md"
            style={{ transform: `scale(${1 / visibleEditingScale})` }}
          ><Clock3 size={18} />从下方抽屉拖入小组件</Chip>
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
