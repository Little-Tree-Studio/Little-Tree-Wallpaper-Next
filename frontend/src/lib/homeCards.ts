/** Home page card registry shared by the Home page and the Settings page. */

export const HOME_CARD_IDS = ['current_wallpaper', 'bing_daily', 'daily_quote', 'spotlight', 'recent_history', 'random_favorite'] as const;

export type HomePageCardId = (typeof HOME_CARD_IDS)[number];

export interface HomePageCardConfig {
  id: string;
  visible: boolean;
}

export interface HomeCardDescriptor {
  /** Built-in card id, or ``pluginId:cardId`` for plugin-contributed cards. */
  id: string;
  label: string;
  description: string;
  source: 'builtin' | 'plugin';
}

export const HOME_CARD_META: Record<HomePageCardId, { label: string; description: string }> = {
  current_wallpaper: { label: '当前壁纸', description: '查看桌面正在使用的壁纸，支持收藏、记录与刷新' },
  bing_daily: { label: 'Bing 每日壁纸', description: '必应每天更新的精选壁纸，可直接应用' },
  daily_quote: { label: '每日语句', description: '首页展示的一句话与出处' },
  spotlight: { label: 'Windows 聚焦', description: '从 Windows 聚焦在线图库随机挑选的精美图片' },
  recent_history: { label: '最近历史', description: '最近使用过的壁纸，可快速回看与恢复' },
  random_favorite: { label: '随机收藏', description: '从收藏夹随机展示一张壁纸' },
};

export const BUILTIN_HOME_CARDS: HomeCardDescriptor[] = HOME_CARD_IDS.map((id) => ({
  id,
  label: HOME_CARD_META[id].label,
  description: HOME_CARD_META[id].description,
  source: 'builtin' as const,
}));

/** 默认隐藏的内置卡片（需在设置中手动开启）。 */
const DEFAULT_HIDDEN_HOME_CARDS = new Set<string>(['random_favorite']);

export function homeCardDefaultVisible(id: string): boolean {
  return !DEFAULT_HIDDEN_HOME_CARDS.has(id);
}

/**
 * Normalize the persisted card list against the currently available cards.
 *
 * Persisted order wins; cards that are available but missing from the
 * persisted list are appended in their default order with their default
 * visibility. Entries that are persisted but no longer available (e.g. a
 * disabled plugin) are kept at the end so their visibility/order survives a
 * plugin being toggled off/on — the Home page simply skips cards that are
 * not available.
 */
export function resolveHomeCards(
  persisted: { id: string; visible?: boolean }[] | null | undefined,
  availableIds: readonly string[] = HOME_CARD_IDS,
): HomePageCardConfig[] {
  const available = new Set(availableIds);
  const seen = new Set<string>();
  const ordered: HomePageCardConfig[] = [];
  const unavailable: HomePageCardConfig[] = [];
  for (const item of persisted || []) {
    if (typeof item?.id !== 'string' || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    const entry: HomePageCardConfig = { id: item.id, visible: item.visible !== false };
    if (available.has(item.id)) ordered.push(entry);
    else unavailable.push(entry);
  }
  for (const id of availableIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push({ id, visible: homeCardDefaultVisible(id) });
  }
  return [...ordered, ...unavailable];
}
