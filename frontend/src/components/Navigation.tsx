import { useState } from 'react';
import {
  Home, Image, Wand2, Search, Star, Store, Settings, Wrench, Globe, LifeBuoy, Frame, Puzzle, Workflow,
} from 'lucide-react';
import { Button, ScrollShadow } from '@heroui/react';
import { requestNavigation } from '@/lib/navigationGuard';
import { usePlugins } from '@/plugins/context';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  route: string;
  pluginId?: string;
}

const items: NavItem[] = [
  { id: 'home', label: '首页', icon: Home, route: '/' },
  { id: 'resource', label: '资源', icon: Image, route: '/resource' },
  { id: 'generate', label: '生成', icon: Wand2, route: '/generate' },
  { id: 'create', label: '制作', icon: Frame, route: '/create' },
  { id: 'automation', label: '自动化', icon: Workflow, route: '/automation' },
  { id: 'search', label: '搜索', icon: Search, route: '/search' },
  { id: 'sniff', label: '嗅探', icon: Globe, route: '/sniff' },
  { id: 'favorite', label: '收藏', icon: Star, route: '/favorite' },
  { id: 'store', label: '商店', icon: Store, route: '/store' },
  { id: 'tools', label: '工具', icon: Wrench, route: '/tools' },
];

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
    '/', '/resource', '/resource/source-management', '/generate', '/create', '/automation', '/search', '/sniff',
    '/favorite', '/tags', '/store', '/settings', '/help', '/history', '/tools', '/tools/color-palette',
    '/tools/dynamic-wallpaper',
  ]);
  return exactRoutes.has(route)
    || /^\/settings\/[^/]+$/.test(route)
    || /^\/resource\/(cnu|pixivel)\/[^/]+$/.test(route);
}

export default function Navigation({ activeRoute, onChange, className = '' }: NavigationProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const { contributions } = usePlugins();
  const pages = [...contributions.pages, ...contributions.resource_pages];
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
  const activePluginRoute = pluginItems.some((item) => item.route === activeRoute);
  const navigateTo = (id: string, route: string) => {
    if (route === activeRoute) return;
    requestNavigation(id, () => onChange(route));
  };

  return (
    <nav className={`flex w-16 flex-col items-center gap-2 border-r border-border bg-surface-secondary py-3 ${className}`}>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg overflow-hidden">
        <img src="./logo.png" alt="小树壁纸" className="h-full w-full object-cover" />
      </div>

      <ScrollShadow hideScrollBar className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-x-hidden">
          {[...items, ...pluginItems].map((item) => {
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
                className={`
                  group relative flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0 py-0 transition-all
                  ${isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-surface-tertiary hover:text-foreground'}
                `}
                aria-label={item.label}
              >
                <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[11px] leading-none">{item.label}</span>
                {hovered === item.id && !isActive && (
                  <span className="absolute left-full ml-2 rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md whitespace-nowrap">
                    {item.label}
                  </span>
                )}
              </Button>
            );
          })}
      </ScrollShadow>

      <div className="mt-auto flex flex-col items-center gap-2">
        <Button
          isIconOnly
          variant="ghost"
          className="h-11 w-11 rounded-lg text-muted-foreground hover:bg-surface-tertiary hover:text-foreground"
          onPress={() => navigateTo('help', '/help')}
          aria-label="帮助与反馈"
        >
          <LifeBuoy size={20} />
        </Button>
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
