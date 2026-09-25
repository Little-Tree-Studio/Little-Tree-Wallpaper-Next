import { useEffect, useState } from 'react';
import { Button, Card, Separator, Spinner, toast } from '@heroui/react';
import { pluginAssetUrl } from '@/api/backend';
import type { PluginBlock, PluginOperationResult } from '@/types';
import { usePlugins } from './context';

interface PluginRendererProps {
  pluginId: string;
  pluginName: string;
  packageHash?: string | null;
  blocks: PluginBlock[];
  className?: string;
  root?: boolean;
  context?: Record<string, unknown>;
  dense?: boolean;
}

export function safePluginClassName(value?: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256) return '';
  const names = value.trim().split(/\s+/);
  if (names.length > 16 || names.some((name) => (
    name.length > 64 || !/^-?[_A-Za-z]+[_A-Za-z0-9-]*$/.test(name)
  ))) return '';
  return names.join(' ');
}

function resolvePath(context: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((accumulator, rawSegment) => {
    if (accumulator === null || typeof accumulator !== 'object') return undefined;
    const segment = rawSegment.replace(/^\["(.*)"\]$/, '$1').replace(/^\['(.*)'\]$/, '$1');
    return (accumulator as Record<string, unknown>)[segment];
  }, context);
}

export function interpolateTemplate(
  input: string,
  context?: Record<string, unknown>,
): string {
  if (!context || !input.includes('{{')) return input;
  return input.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawPath: string) => {
    const value = resolvePath(context, String(rawPath).trim());
    if (value === undefined) return match;
    if (value === null) return '';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch { return match; }
    }
    return String(value);
  });
}

function describeResult(operation: PluginOperationResult): string {
  const result = operation.result;
  if (result === null || result === undefined) return operation.status || '操作完成';
  if (typeof result === 'string') return result.slice(0, 160);
  if (typeof result === 'number' || typeof result === 'boolean') return String(result);
  try {
    const serialized = JSON.stringify(result);
    return serialized.length > 160 ? `${serialized.slice(0, 157)}...` : serialized;
  } catch {
    return '操作完成';
  }
}

function ActionButton({ pluginId, block }: { pluginId: string; block: Extract<PluginBlock, { type: 'button' }> }) {
  const { invoke } = usePlugins();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    try {
      const operation = await invoke(pluginId, block.action, block.payload);
      if (operation.error || operation.status === 'error') {
        throw new Error(operation.error || '插件动作执行失败');
      }
      toast.success(block.label, { description: describeResult(operation), timeout: 3500 });
    } catch (error) {
      toast.danger(`${block.label}失败`, {
        description: error instanceof Error ? error.message : '插件动作执行失败',
        timeout: 0,
      });
    } finally {
      setPending(false);
    }
  };
  return (
    <Button
      className={safePluginClassName(block.className)}
      isPending={pending}
      onPress={run}
    >
      {pending && <Spinner color="current" size="sm" />}
      {block.label}
    </Button>
  );
}

const badgeTones: Record<string, { background: string; color: string }> = {
  neutral: { background: 'rgb(120 120 135 / 0.16)', color: 'inherit' },
  success: { background: 'rgb(52 199 89 / 0.18)', color: 'rgb(46 184 80)' },
  warning: { background: 'rgb(255 179 0 / 0.2)', color: 'rgb(217 119 6)' },
  danger: { background: 'rgb(255 69 58 / 0.18)', color: 'rgb(240 72 60)' },
  info: { background: 'rgb(0 122 255 / 0.16)', color: 'rgb(0 122 255)' },
};

const metricSizes: Record<string, string> = { sm: 'text-[1.4em]', md: 'text-[2.2em]', lg: 'text-[3em]' };
const metricAlign: Record<string, string> = { left: 'items-start text-left', center: 'items-center text-center', right: 'items-end text-right' };

function TimeBlockView({ block, context }: { block: Extract<PluginBlock, { type: 'time' }>; context?: Record<string, unknown> }) {
  const [now, setNow] = useState(() => new Date());
  const use24Hour = block.use24Hour !== false;
  const format = block.format ?? 'time';
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const formatted = format === 'date'
    ? now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
    : format === 'datetime'
      ? `${now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: !use24Hour })}`
      : now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: !use24Hour });
  const label = interpolateTemplate(block.label ?? '', context);
  return (
    <div className="flex flex-col gap-[0.3em]">
      {label && <span className="text-[0.78em] font-semibold uppercase tracking-[0.16em] opacity-55">{label}</span>}
      <span className="text-[2em] font-semibold leading-none tracking-[-0.03em] tabular-nums">{formatted}</span>
    </div>
  );
}

function Block({ block, pluginId, pluginName, packageHash, context, dense }: {
  block: PluginBlock;
  pluginId: string;
  pluginName: string;
  packageHash?: string | null;
  context?: Record<string, unknown>;
  dense?: boolean;
}) {
  const className = safePluginClassName(block.className);
  const renderBlocks = (blocks: PluginBlock[], extraClassName = '') => (
    <div className={`min-w-0 ${extraClassName}`}>
      {blocks.map((child, index) => (
        <Block key={`${child.type}-${index}`} block={child} pluginId={pluginId} pluginName={pluginName} packageHash={packageHash} context={context} dense={dense} />
      ))}
    </div>
  );
  switch (block.type) {
    case 'heading': {
      const level = block.level ?? 2;
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      return <Tag className={`${level <= 2 ? 'text-2xl font-bold' : 'text-lg font-semibold'} ${className}`}>{interpolateTemplate(block.text, context)}</Tag>;
    }
    case 'text':
      return <p className={`whitespace-pre-wrap text-wrap-pretty text-sm leading-6 ${className}`}>{interpolateTemplate(block.text, context)}</p>;
    case 'image':
      return (
        <img
          className={`h-auto w-full rounded-xl object-contain ${dense ? 'max-h-[11em]' : 'max-h-[70vh]'} ${className}`}
          src={pluginAssetUrl(pluginId, block.src, packageHash)}
          alt={interpolateTemplate(block.alt?.trim() || '', context) || `${pluginName} 提供的图片`}
          loading="lazy"
        />
      );
    case 'card':
      return (
        <Card className={className}>
          {block.title && <Card.Header><Card.Title>{interpolateTemplate(block.title, context)}</Card.Title></Card.Header>}
          <Card.Content className="space-y-4">
            <PluginRenderer pluginId={pluginId} pluginName={pluginName} packageHash={packageHash} blocks={block.blocks} context={context} dense={dense} />
          </Card.Content>
        </Card>
      );
    case 'button':
      return <ActionButton pluginId={pluginId} block={block} />;
    case 'divider':
      return <Separator className={className} />;
    case 'metric': {
      const label = interpolateTemplate(block.label ?? '', context);
      const value = interpolateTemplate(block.value, context);
      const unit = interpolateTemplate(block.unit ?? '', context);
      return (
        <div className={`flex flex-col gap-[0.3em] ${metricAlign[block.align ?? 'left']} ${className}`}>
          {label && <span className="text-[0.78em] font-semibold uppercase tracking-[0.16em] opacity-55">{label}</span>}
          <span className={`flex items-baseline gap-[0.25em] font-semibold leading-none tracking-tight tabular-nums ${metricSizes[block.size ?? 'md']}`}>
            {value}
            {unit && <span className="text-[0.42em] font-medium opacity-60">{unit}</span>}
          </span>
        </div>
      );
    }
    case 'progress': {
      const label = interpolateTemplate(block.label ?? '', context);
      const rawValue = typeof block.value === 'number' ? block.value : Number(interpolateTemplate(String(block.value), context));
      const value = Number.isFinite(rawValue) ? Math.max(0, Math.min(100, rawValue)) : 0;
      const unit = interpolateTemplate(block.unit ?? '', context) || '%';
      return (
        <div className={`w-full ${className}`}>
          {label && (
            <div className="mb-[0.45em] flex items-baseline justify-between gap-[0.8em] text-[0.8em] opacity-70">
              <span className="truncate font-medium">{label}</span>
              <span className="shrink-0 tabular-nums">{Math.round(value)}{unit}</span>
            </div>
          )}
          <div
            className="h-[0.5em] overflow-hidden rounded-full"
            style={{ backgroundColor: 'color-mix(in srgb, currentColor 14%, transparent)' }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${value}%`,
                background: 'linear-gradient(90deg, color-mix(in srgb, var(--widget-accent, currentColor) 55%, transparent), var(--widget-accent, currentColor))',
              }}
            />
          </div>
        </div>
      );
    }
    case 'time':
      return <TimeBlockView block={block} context={context} />;
    case 'badge': {
      const tone = badgeTones[block.tone ?? 'neutral'] ?? badgeTones.neutral;
      return (
        <span
          className={`inline-flex w-fit items-center rounded-full px-[0.75em] py-[0.3em] text-[0.75em] font-semibold ${className}`}
          style={tone}
        >
          {interpolateTemplate(block.text, context)}
        </span>
      );
    }
    case 'rows':
      return (
        <div className={`w-full space-y-[0.5em] text-[0.88em] ${className}`}>
          {block.items.map((row, index) => (
            <div key={index} className="flex items-baseline gap-[0.7em]">
              <span className="shrink-0 opacity-60">{interpolateTemplate(row.label, context)}</span>
              <span
                className="min-w-[1em] flex-1 border-b border-dotted"
                style={{ borderColor: 'color-mix(in srgb, currentColor 22%, transparent)' }}
                aria-hidden="true"
              />
              <span className={`shrink-0 tabular-nums ${row.emphasis ? 'text-[1.05em] font-semibold' : 'font-medium'}`}>
                {interpolateTemplate(row.value, context)}
              </span>
            </div>
          ))}
        </div>
      );
    case 'columns':
      return (
        <div className={`flex w-full items-stretch gap-[1em] ${className}`}>
          {block.blocks.map((child) => renderBlocks([child], 'flex-1 min-w-0'))}
        </div>
      );
  }
}

export default function PluginRenderer({
  pluginId,
  pluginName,
  packageHash,
  blocks,
  className,
  root = false,
  context,
  dense = false,
}: PluginRendererProps) {
  const content = blocks.map((block, index) => (
    <Block key={`${block.type}-${index}`} block={block} pluginId={pluginId} pluginName={pluginName} packageHash={packageHash} context={context} dense={dense} />
  ));
  const layout = dense ? 'flex size-full flex-col gap-[0.7em] overflow-hidden' : 'space-y-4';
  if (!root) return <div className={layout}>{content}</div>;
  return (
    <div data-plugin-id={pluginId} className={`${layout} ${safePluginClassName(className)}`}>
      {content}
    </div>
  );
}
