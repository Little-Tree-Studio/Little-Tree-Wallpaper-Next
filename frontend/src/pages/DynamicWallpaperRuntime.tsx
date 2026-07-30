import { useEffect, useState } from 'react';
import { Spinner } from '@heroui/react';
import DynamicDesktop from '@/components/DynamicDesktop';
import { getDynamicWallpaperScene } from '@/api/backend';
import type { DynamicWallpaperScene } from '@/api/backend';

export default function DynamicWallpaperRuntime() {
  const [scene, setScene] = useState<DynamicWallpaperScene | null>(null);
  useEffect(() => {
    let cancelled = false;
    let revision = -1;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await getDynamicWallpaperScene(true);
        if (!cancelled && next.revision !== revision) {
          revision = next.revision;
          setScene(next);
        }
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 750);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  if (!scene) return <div className="flex h-screen items-center justify-center bg-black"><Spinner /></div>;
  return <div className="h-screen w-screen overflow-hidden"><DynamicDesktop scene={scene} /></div>;
}
