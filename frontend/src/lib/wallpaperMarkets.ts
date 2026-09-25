export interface WallpaperMarket {
  id: string;
  label: string;
}

export const DEFAULT_WALLPAPER_MARKET = 'zh-CN';

export const WALLPAPER_MARKETS: WallpaperMarket[] = [
  { id: 'zh-CN', label: '中国' },
  { id: 'zh-TW', label: '中国台湾' },
  { id: 'en-US', label: '美国' },
  { id: 'en-GB', label: '英国' },
  { id: 'en-AU', label: '澳大利亚' },
  { id: 'en-CA', label: '加拿大' },
  { id: 'en-IN', label: '印度' },
  { id: 'ja-JP', label: '日本' },
  { id: 'ko-KR', label: '韩国' },
  { id: 'de-DE', label: '德国' },
  { id: 'fr-FR', label: '法国' },
  { id: 'it-IT', label: '意大利' },
  { id: 'es-ES', label: '西班牙' },
  { id: 'pt-BR', label: '巴西' },
  { id: 'ru-RU', label: '俄罗斯' },
  { id: 'nl-NL', label: '荷兰' },
  { id: 'pl-PL', label: '波兰' },
  { id: 'tr-TR', label: '土耳其' },
  { id: 'sv-SE', label: '瑞典' },
  { id: 'th-TH', label: '泰国' },
];

export function resolveWallpaperMarket(market?: string | null): string {
  return market && WALLPAPER_MARKETS.some((item) => item.id === market) ? market : DEFAULT_WALLPAPER_MARKET;
}
