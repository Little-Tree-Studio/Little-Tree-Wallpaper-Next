import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { DynamicWidgetInstance } from '@/api/backend';
import type { BoundPluginContribution, PluginBlock, PluginWidgetContribution } from '@/types';
import { usePlugins } from '@/plugins/context';
import PluginRenderer from '@/plugins/PluginRenderer';
import { WidgetSurface } from './BuiltinWidgets';
import { defaultSettings, pluginWidgetSettings } from './registry';

const WIDGET_BLOCK_TYPES = new Set(['heading', 'text', 'image', 'card', 'divider', 'metric', 'progress', 'time', 'badge', 'rows', 'columns']);

export function sanitizeWidgetBlocks(value: unknown, depth = 0): PluginBlock[] {
  if (!Array.isArray(value) || depth > 3) return [];
  return value
    .filter((block): block is PluginBlock => (
      typeof block === 'object'
      && block !== null
      && typeof (block as { type?: unknown }).type === 'string'
      && WIDGET_BLOCK_TYPES.has((block as { type: string }).type)
    ))
    .slice(0, 64);
}

function cleanSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === 'string' || typeof value === 'boolean') cleaned[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) cleaned[key] = value;
  }
  return cleaned;
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

interface PluginWidgetProps {
  widget: DynamicWidgetInstance;
  definition: BoundPluginContribution<PluginWidgetContribution>;
  editing?: boolean;
}

export default function PluginWidget({ widget, definition, editing = false }: PluginWidgetProps) {
  const { invoke } = usePlugins();
  const refresh = definition.refresh ?? null;
  const settings = cleanSettings(widget.settings);
  const settingsKey = JSON.stringify(settings);
  const payloadKey = JSON.stringify(refresh?.payload ?? null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [dynamicBlocks, setDynamicBlocks] = useState<PluginBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const runRef = useRef(0);
  const invokeRef = useRef(invoke);
  const settingsRef = useRef(settings);

  useEffect(() => { invokeRef.current = invoke; }, [invoke]);
  useEffect(() => { settingsRef.current = settings; });

  useEffect(() => {
    if (!refresh?.action) {
      setData(null);
      setDynamicBlocks(null);
      setError(null);
      setIsRefreshing(false);
      return undefined;
    }
    const runId = ++runRef.current;
    let disposed = false;
    const run = async () => {
      setIsRefreshing(true);
      try {
        const payloadBase = asPlainObject(refresh.payload) ?? {};
        const operation = await invokeRef.current(definition.pluginId, refresh.action, { ...payloadBase, settings: settingsRef.current });
        if (disposed || runRef.current !== runId) return;
        if (operation.error || operation.status === 'error') {
          throw new Error(operation.error || '插件刷新动作失败');
        }
        setError(null);
        const result = operation.result;
        if (Array.isArray(result)) {
          setDynamicBlocks(sanitizeWidgetBlocks(result));
          setData(null);
          return;
        }
        const record = asPlainObject(result);
        if (record) {
          if (Array.isArray(record.blocks)) {
            setDynamicBlocks(sanitizeWidgetBlocks(record.blocks));
            setData(asPlainObject(record.data));
          } else {
            setDynamicBlocks(null);
            setData(record);
          }
        }
      } catch (reason) {
        if (!disposed && runRef.current === runId) {
          setError(reason instanceof Error ? reason.message : '插件小组件刷新失败');
        }
      } finally {
        if (!disposed && runRef.current === runId) setIsRefreshing(false);
      }
    };
    void run();
    const interval = Math.max(15, Math.min(86_400, Math.round(refresh.interval_seconds) || 300));
    const timer = window.setInterval(() => void run(), interval * 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [definition.pluginId, refresh?.action, refresh?.interval_seconds, payloadKey, settingsKey]);

  const descriptors = pluginWidgetSettings(definition);
  const context = useMemo(() => ({
    ...defaultSettings(descriptors),
    ...cleanSettings(widget.settings),
    ...(data ?? {}),
  }), [descriptors, settingsKey, data]);
  const blocks = dynamicBlocks ?? definition.blocks;

  return (
    <WidgetSurface widget={widget} className="p-[1.1em]">
      {editing && refresh?.action && (
        <div className={`pointer-events-none absolute right-[0.8em] top-[0.8em] flex items-center gap-[0.35em] rounded-full px-[0.55em] py-[0.25em] text-[0.68em] font-medium ${error ? 'bg-red-500/20 text-red-200' : 'bg-black/20 text-white/70'}`}>
          <RefreshCw size="1em" className={isRefreshing ? 'animate-spin' : ''} />
          {isRefreshing ? '更新中' : error ? '更新失败' : '已同步'}
        </div>
      )}
      <div
        data-plugin-id={definition.pluginId}
        className="relative min-h-0 flex-1 overflow-auto text-[0.92em] leading-snug"
      >
        <PluginRenderer
          pluginId={definition.pluginId}
          pluginName={definition.plugin.name}
          packageHash={definition.packageHash}
          blocks={blocks}
          context={context}
          dense
        />
      </div>
      {editing && refresh?.action && !error && !isRefreshing && (
        <div className="pointer-events-none absolute bottom-[0.6em] right-[0.8em] flex items-center gap-[0.35em] text-[0.68em] opacity-45">
          <RefreshCw size="1em" />
          {Math.max(15, Math.min(86_400, Math.round(refresh.interval_seconds) || 300)) >= 60
            ? `每 ${Math.round((Math.max(15, Math.min(86_400, Math.round(refresh.interval_seconds) || 300)) / 60))} 分钟刷新`
            : `每 ${Math.max(15, Math.round(refresh.interval_seconds) || 300)} 秒刷新`}
        </div>
      )}
      {editing && error && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-red-600/85 px-[0.8em] py-[0.35em] text-[0.7em] font-medium text-white">
          刷新失败：{error}
        </div>
      )}
    </WidgetSurface>
  );
}
