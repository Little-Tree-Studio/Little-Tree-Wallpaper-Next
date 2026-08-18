import type { ElementType } from 'react';
import {
  Frame,
  Globe,
  Home,
  Image,
  LifeBuoy,
  MonitorPlay,
  Search,
  Star,
  Store,
  Wand2,
  Wrench,
  Workflow,
} from 'lucide-react';

export interface NavigationItem {
  id: string;
  label: string;
  icon: ElementType;
  route: string;
}

export const CORE_NAV_ITEMS: NavigationItem[] = [
  { id: 'home', label: '首页', icon: Home, route: '/' },
  { id: 'resource', label: '资源', icon: Image, route: '/resource' },
  { id: 'generate', label: '生成', icon: Wand2, route: '/generate' },
  { id: 'create', label: '制作', icon: Frame, route: '/create' },
  { id: 'dynamic', label: '动态', icon: MonitorPlay, route: '/dynamic' },
  { id: 'automation', label: '自动化', icon: Workflow, route: '/automation' },
  { id: 'search', label: '搜索', icon: Search, route: '/search' },
  { id: 'sniff', label: '嗅探', icon: Globe, route: '/sniff' },
  { id: 'favorite', label: '收藏', icon: Star, route: '/favorite' },
  { id: 'store', label: '商店', icon: Store, route: '/store' },
  { id: 'tools', label: '工具', icon: Wrench, route: '/tools' },
];

export const HELP_NAV_ITEM: NavigationItem = {
  id: 'help',
  label: '帮助与反馈',
  icon: LifeBuoy,
  route: '/help',
};

export const SIDEBAR_NAV_ITEMS = [...CORE_NAV_ITEMS, HELP_NAV_ITEM];

export const SIDEBAR_SETTINGS_CHANGED_EVENT = 'ltw:sidebar-settings-changed';

export function notifySidebarSettingsChanged(hidden: string[]) {
  window.dispatchEvent(new CustomEvent(SIDEBAR_SETTINGS_CHANGED_EVENT, {
    detail: { hidden },
  }));
}
