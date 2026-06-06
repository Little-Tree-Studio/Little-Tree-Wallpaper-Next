import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ScrollShadow } from '@heroui/react';
import Navigation from './Navigation';
import Watermark from './Watermark';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  const getActiveNav = () => {
    const p = location.pathname;
    if (p === '/') return 'home';
    if (p.startsWith('/resource')) return 'resource';
    if (p.startsWith('/generate')) return 'generate';
    if (p.startsWith('/search')) return 'search';
    if (p.startsWith('/sniff')) return 'sniff';
    if (p.startsWith('/favorite')) return 'favorite';
    if (p.startsWith('/store')) return 'store';
    if (p.startsWith('/settings')) return 'settings';
    if (p.startsWith('/tools')) return 'tools';
    return 'home';
  };

  const handleNavChange = (id: string) => {
    navigate('/' + (id === 'home' ? '' : id));
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Navigation activeId={getActiveNav()} onChange={handleNavChange} />
      <main className="flex flex-1 flex-col overflow-hidden p-6">
        <ScrollShadow className="flex-1" hideScrollBar>
          <Outlet />
        </ScrollShadow>
      </main>
      <Watermark />
    </div>
  );
}
