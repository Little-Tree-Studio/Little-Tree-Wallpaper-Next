import { useEffect, useState } from 'react';
import { getBuildInfo, type BuildInfo } from '@/api/backend';

function formatBuildTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 右下角测试版本水印。
 *
 * 仅当 build_type 为 beta 时显示。
 */
export default function Watermark() {
  const [build, setBuild] = useState<BuildInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getBuildInfo();
        if (!cancelled) setBuild(data);
      } catch {
        // 静默忽略：水印为装饰性组件。
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!build || build.build_type !== 'beta') return null;

  const date = build.build_time ? formatBuildTime(build.build_time) : '';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed bottom-9 right-4 z-50 select-none whitespace-pre-line text-right"
      style={{
        color: 'var(--color-foreground)',
        opacity: 0.45,
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        padding: '2px 6px',
        borderRadius: '4px',
        backgroundColor: 'color-mix(in srgb, var(--color-background) 60%, transparent)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      {'测试版本\n不代表最终品质'}
      {date ? ` · ${date}` : ''}
    </div>
  );
}
