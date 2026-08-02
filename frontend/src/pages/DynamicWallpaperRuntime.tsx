import { useEffect, useState } from 'react';
import { Spinner } from '@heroui/react';
import DynamicDesktop from '@/components/DynamicDesktop';
import { getDynamicWallpaperScene, reportDynamicWallpaperTelemetry } from '@/api/backend';
import type { DynamicWallpaperScene } from '@/api/backend';

export default function DynamicWallpaperRuntime() {
  const [scene, setScene] = useState<DynamicWallpaperScene | null>(null);
  useEffect(() => {
    let cancelled = false;
    let sceneKey = '';
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await getDynamicWallpaperScene(true);
        const nextKey = `${next.revision}\0${next.background.items.join('\0')}`;
        if (!cancelled && nextKey !== sceneKey) {
          sceneKey = nextKey;
          setScene(next);
        }
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  if (!scene) return <div className="flex h-screen items-center justify-center bg-black"><Spinner /></div>;
  return (
    <div className="h-screen w-screen overflow-hidden">
      <DynamicDesktop
        scene={scene}
        onPlaybackStateChange={(paused, event, ended) => {
          const payload = { media_revision: scene.revision, event, paused, ended };
          void reportDynamicWallpaperTelemetry(payload).catch(() => undefined);
          window.setTimeout(() => void reportDynamicWallpaperTelemetry(payload).catch(() => undefined), 750);
        }}
      />
    </div>
  );
}
