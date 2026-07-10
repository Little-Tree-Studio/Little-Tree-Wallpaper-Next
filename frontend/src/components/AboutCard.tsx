/**
 * "About this program" card for the Help page.
 *
 * Fetches static identity from ``getAppInfo()`` and build provenance from
 * ``getBuildInfo()`` on mount, then renders a single Card that shows:
 *
 *   - the localised + English name and one-line description
 *   - the version / build type / build time / git commit / producer
 *   - a clear "运行自源码" badge when the backend was launched without a
 *     ``build.json`` (typical ``python -m backend.main`` session)
 *   - the repository link
 *
 * Each labelled row is copy-to-clipboard on click so users can grab
 * commit SHAs and version strings to paste into bug reports.
 */

import { useEffect, useState } from 'react';
import { Card, Chip, Separator, toast } from '@heroui/react';
import { Copy, ExternalLink, Github, Sprout, Tag } from 'lucide-react';
import { getAppInfo, getBuildInfo, type AppInfo, type BuildInfo } from '@/api/backend';
import { logError } from '@/lib/log';

function formatBuildTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`已复制 ${label}`, { timeout: 2000 });
  } catch (e) {
    logError('clipboard write failed', e);
    toast.danger('复制失败', { timeout: 0 });
  }
}

interface RowProps {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
  copyLabel?: string;
}

function Row({ label, value, mono, copyable, copyLabel }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      {copyable ? (
        <button
          type="button"
          onClick={() => copyToClipboard(value, copyLabel || label)}
          className="group flex min-w-0 items-center gap-1 truncate rounded text-foreground transition-colors hover:bg-surface-tertiary hover:px-1.5"
          title={`点击复制 ${label}`}
        >
          <span className={`truncate ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
          <Copy size={12} className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ) : (
        <span className={`truncate text-foreground ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
      )}
    </div>
  );
}

function buildTypeChip(type: string, sourceRun: boolean) {
  if (sourceRun) {
    return (
      <Chip color="default" variant="primary" size="sm">
        <Tag size={11} className="mr-0.5" />
        运行自源码
      </Chip>
    );
  }
  if (type === 'beta') {
    return (
      <Chip color="warning" variant="primary" size="sm">
        BETA
      </Chip>
    );
  }
  return (
    <Chip color="success" variant="primary" size="sm">
      STABLE
    </Chip>
  );
}

export default function AboutCard() {
  const [app, setApp] = useState<AppInfo | null>(null);
  const [build, setBuild] = useState<BuildInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAppInfo(), getBuildInfo()])
      .then(([a, b]) => {
        if (cancelled) return;
        setApp(a);
        setBuild(b);
      })
      .catch((e) => logError('AboutCard load failed', e));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!app || !build) {
    return (
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-sm text-muted">加载中…</div>
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sprout size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-semibold">{app.name}</span>
            {buildTypeChip(build.build_type, build.source_run)}
          </div>
          <div className="truncate text-xs text-muted">{app.name_en}</div>
        </div>
      </div>

      {app.description && (
        <p className="text-sm leading-6 text-foreground">{app.description}</p>
      )}

      <Separator />

      <div className="grid gap-x-6 gap-y-0 sm:grid-cols-2">
        <Row label="版本" value={`v${build.version}`} mono copyable copyLabel="版本号" />
        <Row label="构建类型" value={build.source_run ? 'source' : build.build_type} mono />
        <Row label="构建时间" value={formatBuildTime(build.build_time)} mono copyable copyLabel="构建时间" />
        <Row label="Commit" value={build.git_commit || '—'} mono copyable copyLabel="Commit" />
        <Row label="构建方式" value={build.built_by || '—'} mono />
        <Row label="包名" value={app.package_name} mono copyable copyLabel="包名" />
      </div>

      <Separator />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">作者：</span>
        <span className="text-foreground">{app.author}</span>
        {app.repo_url && (
          <>
            <span className="text-muted">·</span>
            <a
              href={app.repo_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-primary transition-colors hover:underline"
            >
              <Github size={12} />
              {app.repo_url.replace(/^https?:\/\//, '')}
              <ExternalLink size={10} />
            </a>
          </>
        )}
      </div>

      {build.source_run && (
        <div className="rounded-lg border border-border bg-surface-tertiary p-2 text-[11px] leading-relaxed text-muted">
          检测到当前为源码运行模式（项目根目录缺少 <span className="font-mono">build.json</span>）。
          上述版本号、提交哈希、构建时间等元数据已由后端在启动时自动合成，仅供本地调试参考。
        </div>
      )}
    </Card>
  );
}
