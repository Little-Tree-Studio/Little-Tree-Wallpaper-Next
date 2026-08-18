import { useEffect, useState } from 'react';
import { Button, ScrollShadow } from '@heroui/react';
import { Puzzle, Settings } from 'lucide-react';
import { getSettings } from '@/api/backend';
import { requestNavigation } from '@/lib/navigationGuard';
import {
  CORE_NAV_ITEMS,
  HELP_NAV_ITEM,
  SIDEBAR_SETTINGS_CHANGED_EVENT,
  type NavigationItem,
} from '@/lib/navigationItems';
import { usePlugins } from '@/plugins/context';

interface NavItem extends NavigationItem {
  pluginId?: string;
}

interface NavigationProps {
  activeRoute: string;
  onChange: (route: string) => void;
  className?: string;
}

function coreRouteActive(activeRoute: string, route: string): boolean {
  if (route === '/') return activeRoute === '/';
  return activeRoute === route || activeRoute.startsWith(`${route}/`);
}

function coreRouteOwns(route: string): boolean {
  const exactRoutes = new Set([
    '/', '/resource', '/resource/source-management', '/generate', '/create', '/dynamic', '/dynamic/editor', '/dynamic/runtime', '/automation', '/search', '/sniff',
    '/favorite', '/tags', '/store', '/settings', '/help', '/history', '/tools', '/tools/color-palette',
    '/tools/zhongguose', '/tools/dynamic-wallpaper',
  ]);
  return exactRoutes.has(route)
    || /^\/settings\/[^/]+$/.test(route)
    || /^\/resource\/(cnu|pixivel)\/[^/]+$/.test(route);
}

export default function Navigation({ activeRoute, onChange, className = '' }: NavigationProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const { contributions } = usePlugins();
  const pages = [...contributions.pages, ...contributions.resource_pages];

  useEffect(() => {
    let active = true;
    getSettings()
      .then((settings) => {
        if (active) setHiddenIds(settings.ui.sidebar?.hidden || []);
      })
      .catch(() => undefined);
    const handleSettingsChange = (event: Event) => {
      const hidden = (event as CustomEvent<{ hidden?: unknown }>).detail?.hidden;
      if (Array.isArray(hidden)) setHiddenIds(hidden.filter((id): id is string => typeof id === 'string'));
    };
    window.addEventListener(SIDEBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    return () => {
      active = false;
      window.removeEventListener(SIDEBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    };
  }, []);

  const pluginItems: NavItem[] = contributions.navigation
    .filter((item) => !item.location || item.location === 'sidebar')
    .flatMap((item) => {
      const route = item.route ?? pages.find((page) => (
        page.pluginId === item.pluginId && page.id === item.page
      ))?.route;
      return route && !coreRouteOwns(route)
        ? [{ id: `${item.pluginId}:${item.id}`, label: item.label, icon: Puzzle, route, pluginId: item.pluginId }]
        : [];
    });
  const visibleItems: NavItem[] = [...CORE_NAV_ITEMS, ...pluginItems].filter((item) => !hiddenIds.includes(item.id));
  const activePluginRoute = pluginItems.some((item) => item.route === activeRoute);
  const navigateTo = (id: string, route: string) => {
    if (route === activeRoute) return;
    requestNavigation(id, () => onChange(route));
  };

  return (
    <nav className={`theme-navigation-chrome flex w-14 flex-col items-center gap-2 py-3 ${className}`}>
      <ScrollShadow hideScrollBar className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-x-hidden">
        {visibleItems.map((item) => {
          const isPlugin = item.icon === Puzzle;
          const isActive = isPlugin
            ? activeRoute === item.route
            : !activePluginRoute && coreRouteActive(activeRoute, item.route);
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              data-plugin-id={item.pluginId}
              variant="ghost"
              onPress={() => navigateTo(item.id, item.route)}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              className={`group relative flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0 py-0 transition-all ${isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-surface-tertiary hover:text-foreground'}`}
              aria-label={item.label}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[11px] leading-none">{item.label}</span>
              {hovered === item.id && !isActive && (
                <span className="absolute left-full ml-2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
                  {item.label}
                </span>
              )}
            </Button>
          );
        })}
      </ScrollShadow>

      <div className="mt-auto flex flex-col items-center gap-2">
        {!hiddenIds.includes(HELP_NAV_ITEM.id) && (
          <Button
            isIconOnly
            variant="ghost"
            className="h-11 w-11 rounded-lg text-muted-foreground hover:bg-surface-tertiary hover:text-foreground"
            onPress={() => navigateTo(HELP_NAV_ITEM.id, HELP_NAV_ITEM.route)}
            aria-label={HELP_NAV_ITEM.label}
          >
            <HELP_NAV_ITEM.icon size={20} />
          </Button>
        )}
        <Button
          isIconOnly
          variant="ghost"
          className="h-11 w-11 rounded-lg text-muted-foreground hover:bg-surface-tertiary hover:text-foreground"
          onPress={() => navigateTo('settings', '/settings')}
          aria-label="设置"
        >
          <Settings size={20} />
        </Button>
      </div>
    </nav>
  );
}
