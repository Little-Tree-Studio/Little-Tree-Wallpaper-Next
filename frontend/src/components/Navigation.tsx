import { useState } from 'react';
import {
  Home, Image, Wand2, Search, Star, Store, Settings, Wrench, Globe,
} from 'lucide-react';
import { Button } from '@heroui/react';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
}

const items: NavItem[] = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'resource', label: '资源', icon: Image },
  { id: 'generate', label: '生成', icon: Wand2 },
  { id: 'search', label: '搜索', icon: Globe },
  { id: 'sniff', label: '嗅探', icon: Search },
  { id: 'favorite', label: '收藏', icon: Star },
  { id: 'store', label: '商店', icon: Store },
  { id: 'tools', label: '工具', icon: Wrench },
];

interface NavigationProps {
  activeId: string;
  onChange: (id: string) => void;
}

export default function Navigation({ activeId, onChange }: NavigationProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <nav className="flex w-16 flex-col items-center gap-2 border-r border-border bg-surface-secondary py-3">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg overflow-hidden">
        <img src="./logo.png" alt="小树壁纸" className="h-full w-full object-cover" />
      </div>

        {items.map((item) => {
          const isActive = item.id === activeId;
          const Icon = item.icon;
          return (
          <Button
            key={item.id}
            variant="ghost"
            onPress={() => onChange(item.id)}
            onMouseEnter={() => setHovered(item.id)}
            onMouseLeave={() => setHovered(null)}
            className={`
              group relative flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-lg px-0 py-0 transition-all
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

      <div className="mt-auto">
        <Button
          isIconOnly
          variant="ghost"
          className="h-11 w-11 rounded-lg text-muted-foreground hover:bg-surface-tertiary hover:text-foreground"
          onPress={() => onChange('settings')}
          aria-label="设置"
        >
          <Settings size={20} />
        </Button>
      </div>
    </nav>
  );
}
