import { ScrollShadow } from '@heroui/react';
import Navigation from './Navigation';
import Watermark from './Watermark';
import { useNavigate, usePathname } from '@/lib/router';

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navigate = useNavigate();

  const handleNavChange = (route: string) => navigate(route);
  const isStandalone = pathname === '/dynamic/editor' || pathname === '/dynamic/runtime';

  if (isStandalone) return children;

  return (
    <div className="theme-shell relative z-0 flex size-full overflow-hidden text-foreground">
      <Navigation className="relative z-40" activeRoute={pathname} onChange={handleNavChange} />
      <div className="theme-shell-corner pointer-events-none absolute left-14 top-0 z-30 size-3" />
      <main className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-6">
        <ScrollShadow hideScrollBar className="relative min-h-0 min-w-0 flex-1 overflow-x-auto">
          {children}
        </ScrollShadow>
      </main>
      <Watermark />
    </div>
  );
}
