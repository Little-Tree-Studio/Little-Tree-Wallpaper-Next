import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Navigation from './Navigation';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  const getActiveNav = () => {
    const p = location.pathname;
    if (p === '/') return 'home';
    if (p.startsWith('/resource')) return 'resource';
    if (p.startsWith('/generate')) return 'generate';
    if (p.startsWith('/sniff')) return 'sniff';
    if (p.startsWith('/favorite')) return 'favorite';
    if (p.startsWith('/store')) return 'store';
    if (p.startsWith('/settings')) return 'settings';
    return 'home';
  };

  const handleNavChange = (id: string) => {
    navigate('/' + (id === 'home' ? '' : id));
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Navigation activeId={getActiveNav()} onChange={handleNavChange} />
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
