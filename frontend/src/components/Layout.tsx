import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ScrollShadow } from '@heroui/react';
import Navigation from './Navigation';
import Watermark from './Watermark';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  const handleNavChange = (route: string) => navigate(route);

  return (
    <div className="theme-shell relative z-0 flex h-screen w-screen overflow-hidden text-foreground">
      <Navigation className="relative z-40" activeRoute={location.pathname} onChange={handleNavChange} />
      <main className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-6">
        <ScrollShadow className="relative min-h-0 min-w-0 flex-1 overflow-x-auto">
          <Outlet />
        </ScrollShadow>
      </main>
      <Watermark />
    </div>
  );
}
