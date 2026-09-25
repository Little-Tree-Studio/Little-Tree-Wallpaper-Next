import type { LucideIcon } from 'lucide-react';
import { CalendarClock, CalendarDays, Clock3, Gauge, Quote, Sparkles, StickyNote, Sunrise, TrendingUp } from 'lucide-react';
import type { DynamicWidgetInstance } from '@/api/backend';
import type { BoundPluginContribution, BoundPluginContributions, PluginWidgetContribution } from '@/types';
import { usePlugins } from '@/plugins/context';

export type WidgetSettingType = 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'slider' | 'color' | 'date';

export interface WidgetSettingDescriptor {
  key: string;
  label: string;
  type: WidgetSettingType;
  default?: string | number | boolean;
  placeholder?: string;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  options?: { value: string; label: string }[];
}

export interface WidgetDefinition {
  type: string;
  label: string;
  description: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  icon: LucideIcon;
  pluginId?: string;
  settings: WidgetSettingDescriptor[];
}

const text = (key: string, label: string, extra: Partial<WidgetSettingDescriptor> = {}): WidgetSettingDescriptor => ({
  key, label, type: 'text', maxLength: 40, ...extra,
});

const toggle = (key: string, label: string, fallback: boolean, help?: string): WidgetSettingDescriptor => ({
  key, label, type: 'switch', default: fallback, help,
});

export const BUILTIN_WIDGETS: WidgetDefinition[] = [
  {
    type: 'builtin:clock', label: '数字时钟', description: '大字号时间与日期，可显示秒数', width: 28, height: 18, minWidth: 18, minHeight: 12, icon: Clock3,
    settings: [
      text('label', '顶部文字', { placeholder: '可选，例如：北京时间' }),
      toggle('use24Hour', '使用 24 小时制', true),
      toggle('showSeconds', '显示秒数', false),
      toggle('showDate', '显示日期', true),
    ],
  },
  {
    type: 'builtin:date', label: '日期', description: '日历风格的日期卡片', width: 18, height: 24, minWidth: 14, minHeight: 16, icon: CalendarDays,
    settings: [
      text('title', '标题', { placeholder: '留空显示年份' }),
      toggle('showWeekday', '显示星期', true),
    ],
  },
  {
    type: 'builtin:note', label: '便笺', description: '桌面上的快速提醒', width: 26, height: 22, minWidth: 18, minHeight: 14, icon: StickyNote,
    settings: [
      text('title', '标题', { default: '便笺' }),
      { key: 'content', label: '便笺内容', type: 'textarea', default: '今天也要记得看看喜欢的风景。', maxLength: 500 },
    ],
  },
  {
    type: 'builtin:status', label: '运行状态', description: '显示动态壁纸服务状态', width: 26, height: 14, minWidth: 18, minHeight: 10, icon: Gauge,
    settings: [
      text('title', '标题', { default: '动态服务' }),
      text('subtitle', '状态文字', { default: '场景正在运行', maxLength: 100 }),
    ],
  },
  {
    type: 'builtin:greeting', label: '时段问候', description: '随一天时段变化的问候卡片', width: 30, height: 16, minWidth: 20, minHeight: 11, icon: Sunrise,
    settings: [
      text('title', '问候语', { placeholder: '留空时跟随时段变化' }),
      text('subtitle', '副标题', { default: '愿今天也有好风景', maxLength: 100 }),
    ],
  },
  {
    type: 'builtin:countdown', label: '日期倒计时', description: '记录距离重要日期还有多少天', width: 22, height: 20, minWidth: 16, minHeight: 14, icon: CalendarClock,
    settings: [
      text('title', '标题', { default: '倒计时' }),
      { key: 'target', label: '目标日期', type: 'date' },
      text('completeText', '完成提示', { default: '时间到了', maxLength: 80 }),
    ],
  },
  {
    type: 'builtin:quote', label: '文字卡片', description: '展示一句喜欢的话', width: 30, height: 20, minWidth: 20, minHeight: 14, icon: Quote,
    settings: [
      { key: 'quote', label: '文字内容', type: 'textarea', default: '慢一点，也没关系。', maxLength: 240 },
      text('author', '署名', { placeholder: '可选', maxLength: 60 }),
    ],
  },
  {
    type: 'builtin:progress', label: '目标进度', description: '用进度条展示当前完成情况', width: 28, height: 16, minWidth: 18, minHeight: 11, icon: TrendingUp,
    settings: [
      text('title', '标题', { default: '本周进度' }),
      { key: 'value', label: '完成进度', type: 'slider', default: 50, min: 0, max: 100, step: 1 },
      text('unit', '显示单位', { default: '%', maxLength: 12 }),
    ],
  },
];

const PLUGIN_SETTING_TYPES: WidgetSettingType[] = ['text', 'textarea', 'number', 'switch', 'select', 'slider', 'color', 'date'];

export function sanitizePluginSettingDescriptor(raw: unknown): WidgetSettingDescriptor | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const key = typeof value.key === 'string' ? value.key.trim() : '';
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  const type = typeof value.type === 'string' ? value.type : '';
  if (!/^[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,63})$/.test(key) || !label || label.length > 80) return null;
  if (!PLUGIN_SETTING_TYPES.includes(type as WidgetSettingType)) return null;
  const descriptor: WidgetSettingDescriptor = { key, label, type: type as WidgetSettingType };
  const fallback = value.default;
  if (typeof fallback === 'string' || typeof fallback === 'number' || typeof fallback === 'boolean') {
    if (typeof fallback === 'string' && fallback.length <= 500) descriptor.default = fallback;
    if (typeof fallback === 'boolean') descriptor.default = fallback;
    if (typeof fallback === 'number' && Number.isFinite(fallback)) descriptor.default = fallback;
  }
  for (const field of ['placeholder', 'help'] as const) {
    const item = value[field];
    if (typeof item === 'string' && item.length <= 200) descriptor[field] = item;
  }
  for (const field of ['min', 'max', 'step'] as const) {
    const item = value[field];
    if (typeof item === 'number' && Number.isFinite(item)) descriptor[field] = item;
  }
  if (typeof value.maxLength === 'number' && Number.isInteger(value.maxLength)) {
    descriptor.maxLength = Math.max(1, Math.min(1000, value.maxLength));
  }
  if (Array.isArray(value.options)) {
    const options = value.options
      .map((option): { value: string; label: string } | null => {
        if (typeof option !== 'object' || option === null) return null;
        const optionValue = (option as Record<string, unknown>).value;
        const optionLabel = (option as Record<string, unknown>).label;
        if (typeof optionValue !== 'string' || !optionValue || optionValue.length > 80) return null;
        if (typeof optionLabel !== 'string' || !optionLabel.trim() || optionLabel.length > 80) return null;
        return { value: optionValue, label: optionLabel.trim() };
      })
      .filter((option): option is { value: string; label: string } => option !== null)
      .slice(0, 12);
    if (options.length) descriptor.options = options;
  }
  return descriptor;
}

export function pluginWidgetSettings(contribution: BoundPluginContribution<PluginWidgetContribution>): WidgetSettingDescriptor[] {
  if (!Array.isArray(contribution.settings)) return [];
  return contribution.settings
    .map(sanitizePluginSettingDescriptor)
    .filter((descriptor): descriptor is WidgetSettingDescriptor => descriptor !== null)
    .slice(0, 16);
}

export function pluginWidgetDefinition(contribution: BoundPluginContribution<PluginWidgetContribution>): WidgetDefinition {
  const size = contribution.default_size ?? { width: 28, height: 20 };
  return {
    type: `plugin:${contribution.pluginId}:${contribution.id}`,
    label: contribution.label,
    description: contribution.description || `由 ${contribution.plugin.name} 提供`,
    width: Math.max(8, Math.min(100, Math.round(size.width || 28))),
    height: Math.max(8, Math.min(100, Math.round(size.height || 20))),
    minWidth: 8,
    minHeight: 8,
    icon: Sparkles,
    pluginId: contribution.pluginId,
    settings: pluginWidgetSettings(contribution),
  };
}

export function builtinWidgetDefinition(type: string): WidgetDefinition | null {
  return BUILTIN_WIDGETS.find((widget) => widget.type === type) ?? null;
}

export function useWidgetDefinitions(): WidgetDefinition[] {
  const { contributions } = usePlugins();
  return [
    ...BUILTIN_WIDGETS,
    ...contributions.widgets.map(pluginWidgetDefinition),
  ];
}

export function useWidgetDefinition(type: string): WidgetDefinition | null {
  const definitions = useWidgetDefinitions();
  return definitions.find((definition) => definition.type === type) ?? null;
}

export function widgetMinimumSize(type: string): { width: number; height: number } {
  const builtin = builtinWidgetDefinition(type);
  if (builtin) return { width: builtin.minWidth, height: builtin.minHeight };
  if (type.startsWith('plugin:')) return { width: 8, height: 8 };
  return { width: 8, height: 8 };
}

export function defaultSettings(descriptors: WidgetSettingDescriptor[]): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const descriptor of descriptors) {
    if (descriptor.default !== undefined) settings[descriptor.key] = descriptor.default;
  }
  return settings;
}

export function settingsSchemaFor(widget: DynamicWidgetInstance, contributions: BoundPluginContributions['widgets'] | null): WidgetSettingDescriptor[] {
  if (widget.type.startsWith('builtin:')) return builtinWidgetDefinition(widget.type)?.settings ?? [];
  const [, pluginId, widgetId] = widget.type.split(':');
  const contribution = contributions?.find((item) => item.pluginId === pluginId && item.id === widgetId);
  return contribution ? pluginWidgetSettings(contribution) : [];
}
