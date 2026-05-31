import { useState } from 'react';
import {
  Home, Image, Wand2, Search, Star, Store, Settings,
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
  { id: 'sniff', label: '嗅探', icon: Search },
  { id: 'favorite', label: '收藏', icon: Star },
  { id: 'store', label: '商店', icon: Store },
];

interface NavigationProps {
  activeId: string;
  onChange: (id: string) => void;
}

export default function Navigation({ activeId, onChange }: NavigationProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <nav className="flex w-20 flex-col items-center gap-2 border-r border-border bg-surface-secondary py-4">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold">
        树
      </div>

        {items.map((item) => {
          const isActive = item.id === activeId;
          const Icon = item.icon;
          return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            onMouseEnter={() => setHovered(item.id)}
            onMouseLeave={() => setHovered(null)}
            className={`
              group relative flex h-12 w-12 flex-col items-center justify-center rounded-xl transition-all
              ${isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-surface-tertiary hover:text-foreground'}
            `}
            title={item.label}
          >
            <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
            <span className="mt-0.5 text-[10px]">{item.label}</span>
            {hovered === item.id && !isActive && (
              <span className="absolute left-full ml-2 rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md whitespace-nowrap">
                {item.label}
              </span>
            )}
          </button>
        );
      })}

      <div className="mt-auto">
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          className="rounded-xl"
          onPress={() => onChange('settings')}
          aria-label="设置"
        >
          <Settings size={20} />
        </Button>
      </div>
    </nav>
  );
}
