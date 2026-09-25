import { useEffect, useRef, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import { Clock3, FileText, Folder, Image, PackageOpen, Trash2, Volume2, Wifi } from 'lucide-react';
import { dynamicWallpaperAssetUrl } from '@/api/backend';
import type { DynamicWallpaperScene, DynamicWidgetInstance } from '@/api/backend';
import { usePlugins } from '@/plugins/context';
import { BuiltinWidget, WidgetSurface } from './widgets/BuiltinWidgets';
import PluginWidget from './widgets/PluginWidget';
import { useWidgetDefinitions, widgetMinimumSize } from './widgets/registry';

export { useWidgetDefinitions, widgetMinimumSize } from './widgets/registry';
export type { WidgetDefinition, WidgetSettingDescriptor } from './widgets/registry';

export interface WidgetDragStatus {
  mode: 'move' | 'resize';
  x: number;
  y: number;
  width?: number;
  height?: number;
}

interface DragState {
  id: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

interface ResizeState {
  id: string;
  pointerId: number;
  handle: string;
  pointerX: number;
  pointerY: number;
  origin: { x: number; y: number; width: number; height: number };
}

const RESIZE_HANDLES: { key: string; cursor: string; left: number; top: number }[] = [
  { key: 'nw', cursor: 'nwse-resize', left: 0, top: 0 },
  { key: 'n', cursor: 'ns-resize', left: 50, top: 0 },
  { key: 'ne', cursor: 'nesw-resize', left: 100, top: 0 },
  { key: 'e', cursor: 'ew-resize', left: 100, top: 50 },
  { key: 'se', cursor: 'nwse-resize', left: 100, top: 100 },
  { key: 's', cursor: 'ns-resize', left: 50, top: 100 },
  { key: 'sw', cursor: 'nesw-resize', left: 0, top: 100 },
  { key: 'w', cursor: 'ew-resize', left: 0, top: 50 },
];

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
  onPlaybackStateChange?: (paused: boolean, event: string, ended?: boolean, slideshowSequence?: number) => void;
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
  const slideshowReportTimersRef = useRef(new Set<number>());
  const reportedSlideshowSequencesRef = useRef(new Set<number>());
  const motionPausedRef = useRef(false);
  const policyMutedRef = useRef(false);
  const policyWasPlayingRef = useRef(false);
  const items = background.type === 'slideshow' ? background.items : background.path ? [background.path] : [];

  useEffect(() => { motionPausedRef.current = motionPaused; }, [motionPaused]);

  useEffect(() => {
    const runtimeWindow = window as typeof window & {
      __ltwDynamicRuntime?: Record<string, (...args: unknown[]) => unknown>;
    };
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
      setPolicyMuted: (value: unknown) => {
        policyMutedRef.current = Boolean(value);
        if (videoRef.current) videoRef.current.muted = background.muted || policyMutedRef.current;
        return videoRef.current?.muted ?? true;
      },
      setPolicyPaused: (value: unknown) => {
        const paused = Boolean(value);
        const video = videoRef.current;
        if (video) {
          if (paused) {
            policyWasPlayingRef.current ||= !video.paused;
            video.pause();
          } else if (policyWasPlayingRef.current) {
            policyWasPlayingRef.current = false;
            return video.play();
          }
          return true;
        }
        if (paused) {
          policyWasPlayingRef.current ||= !motionPausedRef.current;
          setMotionPaused(true);
        } else if (policyWasPlayingRef.current) {
          policyWasPlayingRef.current = false;
          setMotionPaused(false);
        }
        return true;
      },
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
  }, [background.type, background.muted, items.join('\n')]);

  useEffect(() => () => {
    slideshowReportTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    slideshowReportTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (background.type !== 'video') {
      onPlaybackStateChange?.(motionPaused, motionPaused ? 'pause' : 'playing');
    }
  }, [background.type, motionPaused, onPlaybackStateChange]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = background.volume;
      videoRef.current.muted = background.muted || policyMutedRef.current;
    }
  }, [background.muted, background.volume]);

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
        onLoad={() => {
          if (background.type !== 'slideshow' || slideshowFrame.sequence === 0) return;
          const sequence = slideshowFrame.sequence;
          const timer = window.setTimeout(() => {
            slideshowReportTimersRef.current.delete(timer);
            if (reportedSlideshowSequencesRef.current.has(sequence)) return;
            reportedSlideshowSequencesRef.current.add(sequence);
            onPlaybackStateChange?.(motionPaused, 'slideshow-change', false, sequence);
          }, background.transition_duration + 100);
          slideshowReportTimersRef.current.add(timer);
        }}
        onAnimationEnd={() => {
          const sequence = slideshowFrame.sequence;
          setSlideshowFrame((latest) => latest.sequence === sequence
            ? { ...latest, previous: null }
            : latest);
          if (background.type !== 'slideshow' || sequence === 0 || reportedSlideshowSequencesRef.current.has(sequence)) return;
          reportedSlideshowSequencesRef.current.add(sequence);
          onPlaybackStateChange?.(motionPaused, 'slideshow-change', false, sequence);
        }}
      />
        </>
      )}
      <ImageOverlay scene={scene} isPaused={motionPaused} />
    </>
  ) : (
    <div className="absolute inset-0 bg-surface-tertiary" />
  );
}

function WidgetContent({ widget, editing }: { widget: DynamicWidgetInstance; editing: boolean }) {
  const { contributions } = usePlugins();
  if (widget.type.startsWith('builtin:')) return <BuiltinWidget widget={widget} />;
  const [, pluginId, widgetId] = widget.type.split(':');
  const definition = contributions.widgets.find((item) => item.pluginId === pluginId && item.id === widgetId);
  if (!definition) {
    return (
      <WidgetSurface widget={widget} className="items-center justify-center gap-[0.5em] p-[1.2em] text-center">
        <PackageOpen size="1.4em" className="opacity-50" />
        <span className="text-[0.85em] opacity-60">小组组件不可用（插件已停用或移除）</span>
      </WidgetSurface>
    );
  }
  return <PluginWidget widget={widget} definition={definition} editing={editing} />;
}

interface DynamicDesktopProps {
  scene: DynamicWallpaperScene;
  onPlaybackStateChange?: (paused: boolean, event: string, ended?: boolean, slideshowSequence?: number) => void;
  editing?: boolean;
  editingScale?: number;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (widgets: DynamicWidgetInstance[]) => void;
  preview?: { name: string; width: number; height: number } | null;
  showDragStatus?: boolean;
  onDragStatusChange?: (status: WidgetDragStatus | null) => void;
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

function resizeRect(
  origin: { x: number; y: number; width: number; height: number },
  handle: string,
  dx: number,
  dy: number,
  minWidth: number,
  minHeight: number,
): { x: number; y: number; width: number; height: number } {
  let { x, y, width, height } = origin;
  if (handle.includes('e')) width = origin.width + dx;
  if (handle.includes('s')) height = origin.height + dy;
  if (handle.includes('w')) {
    width = origin.width - dx;
    x = origin.x + dx;
  }
  if (handle.includes('n')) {
    height = origin.height - dy;
    y = origin.y + dy;
  }
  width = Math.round(Math.max(minWidth, Math.min(100, width)));
  height = Math.round(Math.max(minHeight, Math.min(100, height)));
  x = Math.round(Math.max(0, Math.min(100 - width, x)));
  y = Math.round(Math.max(0, Math.min(100 - height, y)));
  return { x, y, width, height };
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
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const [interaction, setInteraction] = useState<{ id: string; mode: 'move' | 'resize' } | null>(null);
  const definitions = useWidgetDefinitions();
  const visibleEditingScale = Math.max(0.1, Math.min(1, editingScale));
  const patchWidget = (id: string, updates: Partial<DynamicWidgetInstance>) => {
    if (!onChange) return;
    onChange(scene.widgets.map((item) => item.id === id ? { ...item, ...updates } : item));
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
    if (dragRef.current?.pointerId !== event.pointerId && resizeRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    resizeRef.current = null;
    setInteraction(null);
    onDragStatusChange?.(null);
  };

  const pointerPercent = (event: React.PointerEvent) => {
    const rect = desktopRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  };

  return (
    <div
      ref={desktopRef}
      className={`dynamic-desktop relative size-full overflow-hidden bg-black ${editing ? 'dynamic-desktop--editing touch-none' : ''}`}
      onClick={() => editing && onSelect?.(null)}
      onPointerMove={(event) => {
        const position = pointerPercent(event);
        if (!position) return;
        const drag = dragRef.current;
        if (drag && drag.pointerId === event.pointerId) {
          event.preventDefault();
          const widget = scene.widgets.find((item) => item.id === drag.id);
          if (!widget) return;
          const nextX = Math.round(Math.max(0, Math.min(100 - widget.width, position.x - drag.offsetX)));
          const nextY = Math.round(Math.max(0, Math.min(100 - widget.height, position.y - drag.offsetY)));
          if (nextX !== widget.x || nextY !== widget.y) {
            moveWidget(drag.id, position.x - drag.offsetX, position.y - drag.offsetY);
          }
          onDragStatusChange?.({ mode: 'move', x: nextX, y: nextY });
          return;
        }
        const resize = resizeRef.current;
        if (resize && resize.pointerId === event.pointerId) {
          event.preventDefault();
          const widget = scene.widgets.find((item) => item.id === resize.id);
          if (!widget) return;
          const minimum = widgetMinimumSize(widget.type);
          const next = resizeRect(resize.origin, resize.handle, position.x - resize.pointerX, position.y - resize.pointerY, minimum.width, minimum.height);
          if (next.x !== widget.x || next.y !== widget.y || next.width !== widget.width || next.height !== widget.height) {
            patchWidget(resize.id, next);
          }
          onDragStatusChange?.({ mode: 'resize', ...next });
        }
      }}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
    >
      <Background scene={scene} onPlaybackStateChange={onPlaybackStateChange} />
      <div className="absolute inset-0 bg-black/5" />
      {preview && <DesktopPreviewOverlay display={preview} />}
      {scene.widgets.map((widget, index) => {
        const definition = definitions.find((item) => item.type === widget.type);
        const isSelected = selectedId === widget.id;
        return (
          <div
            key={widget.id}
            tabIndex={editing ? 0 : -1}
            aria-label={editing ? `${definition?.label ?? '小组件'} ${widget.type}` : undefined}
            onPointerDown={(event) => {
              if (!editing || event.button !== 0) return;
              const position = pointerPercent(event);
              if (!position) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = {
                id: widget.id,
                pointerId: event.pointerId,
                offsetX: position.x - widget.x,
                offsetY: position.y - widget.y,
              };
              setInteraction({ id: widget.id, mode: 'move' });
              onDragStatusChange?.({ mode: 'move', x: Math.round(widget.x), y: Math.round(widget.y) });
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
            className={`absolute min-h-12 min-w-12 ${editing ? `cursor-grab rounded-2xl outline-offset-2 active:cursor-grabbing ${isSelected ? 'outline-2 outline-primary' : 'ring-1 ring-white/30'}` : ''} ${interaction?.id === widget.id ? 'z-40' : ''}`}
            style={{
              left: `${widget.x}%`,
              top: `${widget.y}%`,
              width: `${widget.width}%`,
              height: `${widget.height}%`,
              zIndex: interaction?.id === widget.id ? 40 : index + 1,
            }}
          >
            <div className={editing ? 'pointer-events-none size-full select-none' : 'size-full'} style={{ opacity: editing ? Math.max(widget.opacity ?? 1, 0.16) : widget.opacity ?? 1 }}>
              <WidgetContent widget={widget} editing={editing} />
            </div>
            {editing && isSelected && (
              <>
                <div
                  className="pointer-events-none absolute bottom-full left-0 mb-1.5 whitespace-nowrap rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground shadow-lg"
                  style={{ transform: `scale(${1 / visibleEditingScale})`, transformOrigin: 'bottom left' }}
                >
                  {definition?.label ?? widget.type}
                </div>
                {RESIZE_HANDLES.map((handle) => (
                  <span
                    key={handle.key}
                    role="presentation"
                    aria-hidden="true"
                    className="absolute size-2.5 rounded-full border border-white bg-primary shadow-md"
                    style={{
                      left: `${handle.left}%`,
                      top: `${handle.top}%`,
                      transform: `translate(-50%, -50%) scale(${1 / visibleEditingScale})`,
                      cursor: handle.cursor,
                      touchAction: 'none',
                    }}
                    onPointerDown={(event) => {
                      if (!editing || event.button !== 0) return;
                      const position = pointerPercent(event);
                      if (!position) return;
                      event.preventDefault();
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      resizeRef.current = {
                        id: widget.id,
                        pointerId: event.pointerId,
                        handle: handle.key,
                        pointerX: position.x,
                        pointerY: position.y,
                        origin: { x: widget.x, y: widget.y, width: widget.width, height: widget.height },
                      };
                      setInteraction({ id: widget.id, mode: 'resize' });
                      onDragStatusChange?.({ mode: 'resize', x: Math.round(widget.x), y: Math.round(widget.y), width: Math.round(widget.width), height: Math.round(widget.height) });
                    }}
                  />
                ))}
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
                >
                  <Trash2 size={16} />
                </Button>
              </>
            )}
          </div>
        );
      })}
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
      {editing && showDragStatus && interaction && (() => {
        const widget = scene.widgets.find((item) => item.id === interaction.id);
        if (!widget) return null;
        return (
          <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-lg bg-black/70 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-md">
            {Math.round(widget.x)}%, {Math.round(widget.y)}%
            {interaction.mode === 'resize' ? ` · ${Math.round(widget.width)}% x ${Math.round(widget.height)}%` : ' · 已吸附 1% 网格'}
          </div>
        );
      })()}
    </div>
  );
}
