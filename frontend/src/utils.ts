import type { TranslateFn } from './i18n';
import type { WallpaperItem } from './types';

export function truncateMiddle(value: string, maxLength = 56): string {
  if (value.length <= maxLength) {
    return value;
  }

  const edgeLength = Math.max(8, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, edgeLength)}...${value.slice(-edgeLength)}`;
}

export function formatTimestamp(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function formatFileSize(size?: number | null): string | null {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return null;
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function resolveImageSource(value?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  if (/^(https?:|data:|blob:|file:)/i.test(raw)) {
    return raw;
  }
  if (/^[a-zA-Z]:[\\/]/.test(raw)) {
    return encodeURI(`file:///${raw.replace(/\\/g, '/')}`);
  }
  if (raw.startsWith('\\\\')) {
    return encodeURI(`file:${raw.replace(/\\/g, '/')}`);
  }
  return raw;
}

export function looksLikeLocalResource(value?: string | null): boolean {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return false;
  }
  if (/^file:/i.test(raw)) {
    return true;
  }
  if (/^[a-zA-Z]:[\\/]/.test(raw)) {
    return true;
  }
  return raw.startsWith('\\\\');
}

export function isLocalWallpaperItem(item?: WallpaperItem | null): boolean {
  if (!item) {
    return false;
  }
  return looksLikeLocalResource(item.image_url) || looksLikeLocalResource(item.preview_url);
}

export function resolvePreviewDialogSource(item: WallpaperItem): string {
  if (looksLikeLocalResource(item.image_url) && item.preview_url) {
    return resolveImageSource(item.preview_url);
  }
  return resolveImageSource(item.image_url || item.preview_url || '');
}

export function resolveDownloadBehavior(value: unknown): 'directory' | 'prompt' {
  return value === 'prompt' ? 'prompt' : 'directory';
}

export function localizeSourceName(sourceId: string, fallback: string, t: TranslateFn): string {
  switch (sourceId) {
    case 'builtin.bing_daily':
      return t('builtin.bingDaily');
    case 'builtin.bing_recent':
      return t('builtin.bingRecent');
    case 'builtin.windows_spotlight':
      return t('builtin.spotlightLocal');
    case 'builtin.windows_spotlight_online':
      return t('builtin.spotlightOnline');
    default:
      return fallback;
  }
}

export function parseScreenBingQuality(quality: string): { width: number; height: number } | null {
  const match = /^screen:(\d{2,5})x(\d{2,5})$/.exec(quality);
  if (!match) {
    return null;
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

export function formatBingQualityLabel(quality: string, t: TranslateFn): string {
  if (quality === 'highDef') {
    return t('resource.bing.quality.highDef');
  }
  if (quality === 'ultraHighDef') {
    return t('resource.bing.quality.ultraHighDef');
  }

  const screenQuality = parseScreenBingQuality(quality);
  if (screenQuality) {
    return t('resource.bing.quality.screen', { width: screenQuality.width, height: screenQuality.height });
  }

  return quality;
}

export function getIntelligentMarketHealthColor(status?: string | null): 'success' | 'error' | 'warning' | 'default' {
  if (status === 'healthy') {
    return 'success';
  }
  if (status === 'unhealthy') {
    return 'error';
  }
  if (status === 'unknown') {
    return 'warning';
  }
  return 'default';
}

export function getIntelligentMarketHealthLabel(status: string | null | undefined, t: TranslateFn): string {
  if (status === 'healthy') {
    return t('resource.im.health.healthy');
  }
  if (status === 'unhealthy') {
    return t('resource.im.health.unhealthy');
  }
  return t('resource.im.health.unknown');
}
