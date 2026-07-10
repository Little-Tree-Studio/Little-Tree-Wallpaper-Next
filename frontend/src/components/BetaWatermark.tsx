/**
 * Persistent bottom-right watermark shown when the build is flagged ``beta``
 * in ``build.json``. Hidden for ``stable`` builds.
 *
 * The component reads ``getBuildInfo()`` on mount and renders a small
 * floating chip at the bottom-right of the viewport. It does not block
 * pointer events (``pointer-events-none``) so it never interferes with
 * underlying UI.
 */
import { useEffect, useState } from 'react';
import { Chip } from '@heroui/react';
import { FlaskConical } from 'lucide-react';
import { getBuildInfo, type BuildInfo } from '@/api/backend';

function formatBuildTime(iso: string): string {
  if (!iso) return '';
  // Render as YYYY-MM-DD in the user's local timezone; build_time is stored
  // ISO-8601 so Date.parse handles the conversion.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatShortCommit(commit: string): string {
  if (!commit) return '';
  // Show first 7 chars (standard short SHA) when the value is a long hash.
  return commit.length > 7 ? commit.slice(0, 7) : commit;
}

export default function BetaWatermark() {
  const [info, setInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getBuildInfo();
        if (!cancelled) setInfo(data);
      } catch {
        // Silently ignore: missing build info is a backend bug, not a
        // user-facing condition, and the watermark is decorative.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info || info.build_type !== 'beta') return null;

  const date = formatBuildTime(info.build_time);
  const commit = formatShortCommit(info.git_commit);
  const tooltip = [
    `版本: ${info.version}`,
    date ? `构建时间: ${date}` : null,
    commit ? `Commit: ${commit}` : null,
    info.built_by ? `构建方式: ${info.built_by}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div
      className="pointer-events-none fixed bottom-2 right-3 z-[60] select-none"
      aria-hidden
    >
      <Chip
        color="warning"
        variant="primary"
        size="sm"
        title={tooltip}
        className="opacity-80"
      >
        <FlaskConical size={12} />
        <span className="ml-1 font-mono text-[11px]">
          v{info.version} · BETA
          {date ? ` · ${date}` : ''}
          {commit ? ` · ${commit}` : ''}
        </span>
      </Chip>
    </div>
  );
}
