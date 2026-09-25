import { useEffect, useState } from 'react';
import { CalendarClock, CalendarDays, Clock3, Gauge, MoonStar, Quote, StickyNote, Sunrise, TrendingUp } from 'lucide-react';
import type { DynamicWidgetInstance } from '@/api/backend';

export const DEFAULT_WIDGET_ACCENT = '#86b6ff';

export interface WidgetVisual {
  textColor: 'light' | 'dark';
  accent: string;
  scale: number;
}

export function widgetVisual(widget: DynamicWidgetInstance): WidgetVisual {
  const scale = Math.max(0.8, Math.min(1.6, typeof widget.text_scale === 'number' && Number.isFinite(widget.text_scale) ? widget.text_scale : 1));
  const textColor = widget.text_color === 'dark' ? 'dark' : 'light';
  const accent = typeof widget.accent_color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(widget.accent_color) ? widget.accent_color : DEFAULT_WIDGET_ACCENT;
  return { textColor, accent, scale };
}

export function stringSetting(widget: DynamicWidgetInstance, key: string, fallback: string): string {
  const value = widget.settings[key];
  return typeof value === 'string' ? value : fallback;
}

export function booleanSetting(widget: DynamicWidgetInstance, key: string, fallback: boolean): boolean {
  const value = widget.settings[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function numberSetting(widget: DynamicWidgetInstance, key: string, fallback: number): number {
  const value = widget.settings[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

interface WidgetSurfaceProps {
  widget: DynamicWidgetInstance;
  children: React.ReactNode;
  className?: string;
  baseColor?: string;
}

export function WidgetSurface({ widget, children, className = '', baseColor }: WidgetSurfaceProps) {
  const visual = widgetVisual(widget);
  const opacity = Math.max(0, Math.min(1, widget.background_opacity ?? 1));
  const resolvedBase = baseColor ?? (visual.textColor === 'dark' ? 'rgb(250 250 252)' : 'rgb(14 18 28)');
  const blur = widget.background_blur === false ? 'none' : 'blur(26px)';
  const transparent = opacity <= 0.01;
  return (
    <div
      className={`relative flex size-full flex-col overflow-hidden rounded-[1.35em] border shadow-2xl backdrop-blur-xl ${visual.textColor === 'dark' ? 'border-black/10 text-zinc-900' : 'border-white/15 text-white'} ${transparent ? 'border-transparent shadow-none backdrop-blur-none' : ''} ${className}`}
      style={{
        fontSize: `${16 * visual.scale}px`,
        backgroundColor: transparent ? 'transparent' : `color-mix(in srgb, ${resolvedBase} ${Math.round(opacity * 100)}%, transparent)`,
        backdropFilter: transparent ? 'none' : blur,
        WebkitBackdropFilter: transparent ? 'none' : blur,
        ['--widget-accent' as string]: visual.accent,
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[1.1em] top-0 h-px opacity-80"
        style={{ backgroundColor: 'var(--widget-accent)' }}
      />
      {children}
    </div>
  );
}

function useNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function ClockWidget({ widget }: { widget: DynamicWidgetInstance }) {
  const now = useNow(true);
  const label = stringSetting(widget, 'label', '');
  const showDate = booleanSetting(widget, 'showDate', true);
  const showSeconds = booleanSetting(widget, 'showSeconds', false);
  const use24Hour = booleanSetting(widget, 'use24Hour', true);
  const hourMinute = use24Hour
    ? now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).split(' ')[0];
  const meridiem = use24Hour ? '' : now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).split(' ')[1] ?? '';
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return (
    <WidgetSurface widget={widget} className="justify-end p-[1.25em]">
      <div className="relative flex items-center justify-between gap-[0.6em]">
        <span className="truncate text-[0.72em] font-semibold uppercase tracking-[0.16em] opacity-55">{label || 'Local time'}</span>
        <span className="flex size-[1.8em] shrink-0 items-center justify-center rounded-[0.6em]" style={{ background: 'color-mix(in srgb, var(--widget-accent) 18%, transparent)' }}>
          <Clock3 size="0.95em" className="opacity-80" />
        </span>
      </div>
      <div className="relative mt-[0.2em] flex items-baseline gap-[0.25em]">
        <span className="text-[3.1em] font-semibold leading-none tracking-[-0.045em] tabular-nums">{hourMinute}</span>
        {showSeconds && <span className="text-[1.25em] font-medium leading-none tabular-nums" style={{ color: 'var(--widget-accent)' }}>{seconds}</span>}
        {meridiem && <span className="text-[0.85em] font-semibold uppercase opacity-60">{meridiem}</span>}
      </div>
      {showDate && (
        <span className="relative mt-[0.45em] truncate text-[0.85em] font-medium opacity-65">
          {now.toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}
        </span>
      )}
    </WidgetSurface>
  );
}

function DateWidget({ widget }: { widget: DynamicWidgetInstance }) {
  const now = useNow(true);
  const title = stringSetting(widget, 'title', '');
  const showWeekday = booleanSetting(widget, 'showWeekday', true);
  return (
    <WidgetSurface widget={widget} baseColor="rgb(250 250 252)">
      <div className="flex items-center justify-between border-b border-black/10 px-[1.15em] py-[0.7em]">
        <span className="truncate text-[0.72em] font-semibold uppercase tracking-[0.2em] text-zinc-500">{title || `${now.getFullYear()} 年`}</span>
        <CalendarDays size="1em" className="shrink-0 text-zinc-400" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[0.15em] px-[0.8em] py-[0.6em]">
        <span
          className="text-[4.2em] font-semibold leading-none tracking-tighter tabular-nums"
          style={{ color: 'var(--widget-accent)' }}
        >
          {now.getDate()}
        </span>
        <span className="text-[0.85em] font-medium text-zinc-500">
          {now.toLocaleDateString('zh-CN', { month: 'long', ...(showWeekday ? { weekday: 'short' } : {}) })}
        </span>
      </div>
    </WidgetSurface>
  );
}

function NoteWidget({ widget }: { widget: DynamicWidgetInstance }) {
  const title = stringSetting(widget, 'title', '便笺');
  const content = stringSetting(widget, 'content', '今天也要记得看看喜欢的风景。');
  return (
    <WidgetSurface widget={widget} className="p-[1.25em]" baseColor="rgb(253 224 104)">
      <div className="pointer-events-none absolute right-0 top-0 size-[2.6em] bg-black/10 [clip-path:polygon(100%_0,100%_100%,0_0)]" />
      <div className="mb-[0.9em] flex items-center gap-[0.55em]">
        <span className="flex size-[1.7em] shrink-0 items-center justify-center rounded-[0.65em] bg-black/10">
          <StickyNote size="0.9em" />
        </span>
        <span className="truncate text-[0.95em] font-semibold">{title}</span>
      </div>
      <p className="line-clamp-6 whitespace-pre-wrap text-[0.92em] leading-[1.7em] opacity-80">{content}</p>
    </WidgetSurface>
  );
}

function StatusWidget({ widget }: { widget: DynamicWidgetInstance }) {
  const title = stringSetting(widget, 'title', '动态服务');
  const subtitle = stringSetting(widget, 'subtitle', '场景正在运行');
  return (
    <WidgetSurface widget={widget} className="justify-center p-[1.25em]">
      <div className="flex items-center gap-[1em]">
        <span className="relative flex size-[2.9em] shrink-0 items-center justify-center rounded-[0.95em]" style={{ background: 'color-mix(in srgb, var(--widget-accent) 30%, transparent)' }}>
          <Gauge size="1.45em" />
          <span className="absolute -right-[0.2em] -top-[0.2em] size-[0.75em] animate-pulse rounded-full border-[0.18em] border-black/40 bg-emerald-400" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[1.1em] font-semibold leading-tight">{title}</p>
          <p className="mt-[0.2em] truncate text-[0.85em] opacity-60">{subtitle}</p>
        </div>
      </div>
      <div className="mt-[1.05em] h-[0.28em] overflow-hidden rounded-full bg-white/12">
        <div className="h-full w-2/3 rounded-full" style={{ backgroundColor: 'var(--widget-accent)' }} />
      </div>
    </WidgetSurface>
  );
}

function GreetingWidget({ widget }: { widget: DynamicWidgetInstance }) {
  const now = useNow(true);
  const hour = now.getHours();
  const title = stringSetting(widget, 'title', '') || (hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好');
  const subtitle = stringSetting(widget, 'subtitle', '愿今天也有好风景');
  const GreetingIcon = hour >= 6 && hour < 18 ? Sunrise : MoonStar;
  return (
    <WidgetSurface widget={widget} className="justify-end p-[1.25em]">
      <span className="absolute right-[1.15em] top-[1.15em] flex size-[2.2em] items-center justify-center rounded-[0.8em]" style={{ background: 'color-mix(in srgb, var(--widget-accent) 26%, transparent)' }}>
        <GreetingIcon size="1.15em" className="opacity-90" />
      </span>
      <div className="relative min-w-0">
        <p className="truncate text-[1.9em] font-semibold leading-tight tracking-tight">{title}</p>
        <p className="mt-[0.25em] truncate text-[0.88em] opacity-60">{subtitle}</p>
      </div>
    </WidgetSurface>
  );
}

function CountdownWidget({ widget }: { widget: DynamicWidgetInstance }) {
  const now = useNow(true);
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
    <WidgetSurface widget={widget} className="justify-between p-[1.25em]">
      <div className="flex items-center justify-between gap-[0.6em] text-[0.85em] opacity-70">
        <span className="truncate font-medium">{title}</span>
        <CalendarClock size="1.05em" className="shrink-0" />
      </div>
      <div>
        <div className="flex items-end gap-[0.3em]">
          <span className="text-[3.4em] font-semibold leading-none tracking-tighter tabular-nums" style={{ color: completed ? undefined : 'var(--widget-accent)' }}>
            {completed ? '✓' : days ?? '--'}
          </span>
          {!completed && days !== null && <span className="mb-[0.45em] text-[0.9em] opacity-65">天</span>}
        </div>
        <p className="mt-[0.4em] truncate text-[0.78em] opacity-60">
          {completed
            ? stringSetting(widget, 'completeText', '时间到了')
            : validTarget && targetDate
              ? targetDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
              : '请设置目标日期'}
        </p>
      </div>
    </WidgetSurface>
  );
}

function QuoteWidget({ widget }: { widget: DynamicWidgetInstance }) {
  const quote = stringSetting(widget, 'quote', '慢一点，也没关系。');
  const author = stringSetting(widget, 'author', '');
  return (
    <WidgetSurface widget={widget} className="justify-between p-[1.35em]" baseColor="rgb(250 250 252)">
      <Quote size="3.4em" className="absolute -right-[0.1em] -top-[0.5em] text-black/6" fill="currentColor" strokeWidth={0} />
      <blockquote className="relative line-clamp-5 font-serif text-[1.25em] font-medium italic leading-[1.75em] tracking-tight text-zinc-800">
        {quote}
      </blockquote>
      <div className="relative mt-[0.9em] flex items-center gap-[0.55em]">
        <span className="h-[0.14em] w-[1.6em] shrink-0 rounded-full" style={{ backgroundColor: 'var(--widget-accent)' }} />
        <p className="truncate text-[0.78em] font-semibold uppercase tracking-[0.12em] text-zinc-500">{author || 'Daily note'}</p>
      </div>
    </WidgetSurface>
  );
}

function ProgressWidget({ widget }: { widget: DynamicWidgetInstance }) {
  const title = stringSetting(widget, 'title', '本周进度');
  const value = Math.max(0, Math.min(100, numberSetting(widget, 'value', 50)));
  const unit = stringSetting(widget, 'unit', '%');
  return (
    <WidgetSurface widget={widget} className="justify-between p-[1.25em]">
      <div className="flex items-center justify-between gap-[0.6em] text-[0.85em] opacity-75">
        <span className="truncate font-medium">{title}</span>
        <TrendingUp size="1.05em" className="shrink-0" />
      </div>
      <div>
        <div className="mb-[0.55em] flex items-end gap-[0.25em]">
          <span className="text-[2.5em] font-semibold leading-none tracking-tight tabular-nums">{Math.round(value)}</span>
          <span className="mb-[0.35em] max-w-[3.5em] truncate text-[0.85em] opacity-65">{unit}</span>
        </div>
        <div className="h-[0.5em] overflow-hidden rounded-full bg-white/14 ring-1 ring-inset ring-white/10">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${value}%`,
              backgroundColor: 'var(--widget-accent)',
            }}
          />
        </div>
      </div>
    </WidgetSurface>
  );
}

export function BuiltinWidget({ widget }: { widget: DynamicWidgetInstance }) {
  switch (widget.type) {
    case 'builtin:clock': return <ClockWidget widget={widget} />;
    case 'builtin:date': return <DateWidget widget={widget} />;
    case 'builtin:note': return <NoteWidget widget={widget} />;
    case 'builtin:status': return <StatusWidget widget={widget} />;
    case 'builtin:greeting': return <GreetingWidget widget={widget} />;
    case 'builtin:countdown': return <CountdownWidget widget={widget} />;
    case 'builtin:quote': return <QuoteWidget widget={widget} />;
    case 'builtin:progress': return <ProgressWidget widget={widget} />;
    default:
      return (
        <WidgetSurface widget={widget} className="items-center justify-center p-[1.2em]">
          <span className="text-[0.85em] opacity-60">未知小组组件：{widget.type}</span>
        </WidgetSurface>
      );
  }
}
