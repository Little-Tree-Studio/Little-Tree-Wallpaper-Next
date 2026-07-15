import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  Button,
  Card,
  Chip,
  ComboBox,
  Input,
  ListBox,
  Modal,
  ProgressBar,
  Separator,
  Skeleton,
  Switch,
  toast,
} from '@heroui/react';
import {
  AppWindow,
  Archive,
  Database,
  Download,
  FolderOpen,
  HardDrive,
  Heart,
  Puzzle,
  RefreshCw,
  ScrollText,
  Settings2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react';

import {
  clearStorageCategory,
  compressDownloads,
  getSettings,
  getStorageOverview,
  getStorageOperationStatus,
  inspectStorageDirectory,
  pickDownloadDirectory,
  pickFavoritesDirectory,
  startStorageDirectoryChange,
} from '@/api/backend';
import type {
  AppSettings,
  StorageCategory,
  StorageOverview,
  StorageDisk,
} from '@/types';
import type { StorageOperationStatus } from '@/api/backend';

let lastHandledStorageOperationId = '';
let cachedStorageOperationStatus: StorageOperationStatus | null = null;

interface StorageSettingsPanelProps {
  settings: AppSettings;
  initialOverview: StorageOverview | null | undefined;
  onOverviewChange: (overview: StorageOverview) => void;
  onSettingsChange: Dispatch<SetStateAction<AppSettings | null>>;
  onUpdate: (key: string, value: unknown) => void;
}

type LocationKind = 'downloads' | 'favorites';

interface PendingLocationChange {
  kind: LocationKind;
  path: string;
  directoryValue: string;
  entryCount: number;
  allowNonEmpty: boolean;
  stage: 'non-empty' | 'migration';
}

const CATEGORY_COLORS = [
  'var(--accent)',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
  'var(--muted)',
  'color-mix(in oklab, var(--accent) 45%, var(--warning))',
  'color-mix(in oklab, var(--success) 50%, var(--foreground))',
  'color-mix(in oklab, var(--danger) 55%, var(--accent))',
];

const CATEGORY_ICONS = {
  application: AppWindow,
  downloads: Download,
  cache: Database,
  logs: ScrollText,
  crash_reports: TriangleAlert,
  sources: Puzzle,
  favorites: Heart,
  settings: Settings2,
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  if (value < 0.01) return '<0.01%';
  if (value < 1) return `${value.toFixed(2)}%`;
  return `${value.toFixed(1)}%`;
}

function diskLabel(disk: StorageDisk, diskCount: number): string {
  if (diskCount === 1) return `${disk.kind === 'mount' ? '所在挂载点' : '所在磁盘'} ${disk.path}`;
  const prefix = disk.is_system ? `应用所在${disk.kind === 'mount' ? '挂载点' : '磁盘'}` : `数据所在${disk.kind === 'mount' ? '挂载点' : '磁盘'}`;
  return `${prefix} ${disk.path}`;
}

function DiskUsageBar({ disk }: { disk: StorageDisk }) {
  const appPercent = disk.total_bytes ? (disk.app_bytes / disk.total_bytes) * 100 : 0;
  const otherPercent = disk.total_bytes ? (disk.other_used_bytes / disk.total_bytes) * 100 : 0;
  const reservedPercent = disk.total_bytes ? (disk.reserved_bytes / disk.total_bytes) * 100 : 0;
  const visibleAppPercent = disk.app_bytes > 0 ? Math.max(appPercent, 0.65) : 0;
  const visibleOtherPercent = Math.min(otherPercent, Math.max(0, 100 - visibleAppPercent - reservedPercent));

  return (
    <div
      className="flex h-3 w-full overflow-hidden rounded-full bg-surface-secondary"
      role="meter"
      aria-label={`${disk.path}：本应用占用 ${formatBytes(disk.app_bytes)}，其他内容占用 ${formatBytes(disk.other_used_bytes)}，可用 ${formatBytes(disk.free_bytes)}`}
      aria-valuemin={0}
      aria-valuemax={disk.total_bytes}
      aria-valuenow={disk.used_bytes}
    >
      <div className="h-full bg-surface-tertiary" style={{ width: `${visibleOtherPercent}%` }} />
      {disk.app_bytes > 0 && (
        <div
          className="h-full min-w-[3px] bg-accent"
          style={{ width: `${visibleAppPercent}%` }}
          title={`本应用 ${formatBytes(disk.app_bytes)}（${formatPercent(appPercent)}）`}
        />
      )}
      {disk.reserved_bytes > 0 && <div className="h-full bg-muted/35" style={{ width: `${reservedPercent}%` }} />}
    </div>
  );
}

function StorageSkeleton() {
  return (
    <div className="space-y-4" aria-label="正在统计存储空间">
      <Card className="p-4">
        <div className="flex items-center gap-6">
          <Skeleton className="size-36 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-36 rounded-md" />
            <Skeleton className="h-4 w-full rounded-md" />
            <Skeleton className="h-4 w-4/5 rounded-md" />
            <Skeleton className="h-4 w-3/5 rounded-md" />
          </div>
        </div>
      </Card>
      <Card className="space-y-3 p-4">
        {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-12 w-full rounded-md" />)}
      </Card>
    </div>
  );
}

export default function StorageSettingsPanel({
  settings,
  initialOverview,
  onOverviewChange,
  onSettingsChange,
  onUpdate,
}: StorageSettingsPanelProps) {
  const [overview, setOverview] = useState<StorageOverview | null>(initialOverview ?? null);
  const [loading, setLoading] = useState(initialOverview === undefined);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmCategory, setConfirmCategory] = useState<StorageCategory | null>(null);
  const [compressConfirmOpen, setCompressConfirmOpen] = useState(false);
  const [pendingLocation, setPendingLocation] = useState<PendingLocationChange | null>(null);
  const [storageOperation, setStorageOperation] = useState<StorageOperationStatus | null>(cachedStorageOperationStatus);
  const [compressionFormat, setCompressionFormat] = useState(settings.storage.auto_compress.format || 'avif');
  const [quality, setQuality] = useState(settings.storage.auto_compress.quality || 80);
  const overviewRequestId = useRef(0);

  const applyOverview = (nextOverview: StorageOverview) => {
    setOverview(nextOverview);
    onOverviewChange(nextOverview);
  };

  const refresh = async () => {
    const requestId = ++overviewRequestId.current;
    setLoading(true);
    try {
      const nextOverview = await getStorageOverview();
      if (requestId === overviewRequestId.current) applyOverview(nextOverview);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '存储统计加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialOverview === undefined) return;
    if (initialOverview) {
      setOverview(initialOverview);
      setLoading(false);
    } else {
      setOverview(null);
      setLoading(false);
    }
  }, [initialOverview]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const status = await getStorageOperationStatus();
        if (!active) return;
        cachedStorageOperationStatus = status;
        setStorageOperation(status);
        if (!status.running && status.id && status.id !== lastHandledStorageOperationId) {
          const [nextOverview, nextSettings] = await Promise.all([getStorageOverview(), getSettings()]);
          if (!active) return;
          applyOverview(nextOverview);
          onSettingsChange(nextSettings as AppSettings);
          lastHandledStorageOperationId = status.id;
          if (status.success) {
            const warning = status.undeleted > 0 ? `，原位置有 ${status.undeleted} 个文件无法删除` : '';
            toast.success(`${status.message}${warning}`);
          } else if (status.error) {
            toast.danger(status.error);
          }
        }
      } catch {
        // The regular page error state handles backend connectivity failures.
      } finally {
        if (active) timer = window.setTimeout(poll, 500);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const chartBackground = useMemo(() => {
    if (!overview?.total_bytes) return 'var(--surface-tertiary)';
    let cursor = 0;
    const segments = overview.items.map((item, index) => {
      const start = cursor;
      cursor += (item.size_bytes / overview.total_bytes) * 100;
      return `${CATEGORY_COLORS[index % CATEGORY_COLORS.length]} ${start}% ${cursor}%`;
    });
    return `conic-gradient(${segments.join(', ')})`;
  }, [overview]);

  const availableFormats = overview?.compression.filter((format) => format.available) || [];
  const selectedFormat = overview?.compression.find((format) => format.id === compressionFormat);
  const operationRunning = storageOperation?.running === true;
  const controlsDisabled = busyAction !== null || operationRunning;
  const overviewDescription = overview
    ? overview.disks.length === 1
      ? `应用本体与数据当前集中在${overview.disks[0].kind === 'mount' ? '挂载点' : '磁盘'} ${overview.disks[0].path}`
      : `应用本体与数据分布在 ${overview.disks.length} 个磁盘或挂载点`
    : '';
  const locationItems = overview?.items.filter((item) => ['downloads', 'favorites', 'cache', 'logs', 'settings'].includes(item.id)) || [];

  const runClear = async (category: StorageCategory) => {
    overviewRequestId.current += 1;
    setBusyAction(`clear:${category.id}`);
    try {
      const result = await clearStorageCategory(category.id);
      applyOverview(result.overview);
      const detail = result.skipped ? `，保留 ${result.skipped} 个受保护或正在写入的文件` : '';
      const message = `已清理 ${result.removed ?? 0} 个文件${detail}${result.failed ? `，${result.failed} 个失败` : ''}`;
      result.failed ? toast.warning(message) : toast.success(message);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '清理失败');
    } finally {
      setBusyAction(null);
      setConfirmCategory(null);
    }
  };

  const requestClear = (category: StorageCategory) => {
    if (category.action === 'safe') {
      void runClear(category);
      return;
    }
    setConfirmCategory(category);
  };

  const runCompression = async () => {
    overviewRequestId.current += 1;
    setBusyAction('compress');
    try {
      const result = await compressDownloads(compressionFormat, quality);
      applyOverview(result.overview);
      const message = `已压缩 ${result.compressed ?? 0} 个文件，节省 ${formatBytes(result.saved_bytes ?? 0)}${result.failed ? `，${result.failed} 个失败` : ''}`;
      result.failed ? toast.warning(message) : toast.success(message);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '压缩失败');
    } finally {
      setBusyAction(null);
      setCompressConfirmOpen(false);
    }
  };

  const prepareLocationChange = async (kind: LocationKind, path: string, directoryValue: string = path) => {
    overviewRequestId.current += 1;
    setBusyAction(`${kind === 'downloads' ? 'download' : 'favorites'}-directory`);
    try {
      const inspection = await inspectStorageDirectory(path, kind);
      if (inspection.same_as_current) {
        toast.info('当前已经使用该位置');
        return;
      }
      setPendingLocation({
        kind,
        path: inspection.path,
        directoryValue,
        entryCount: inspection.entry_count,
        allowNonEmpty: !inspection.is_empty,
        stage: inspection.is_empty ? 'migration' : 'non-empty',
      });
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '无法检查目标文件夹');
    } finally {
      setBusyAction(null);
    }
  };

  const chooseLocationDirectory = async (kind: LocationKind) => {
    setBusyAction(`${kind === 'downloads' ? 'download' : 'favorites'}-directory`);
    try {
      const selection = kind === 'downloads' ? await pickDownloadDirectory() : await pickFavoritesDirectory();
      if (selection?.path) await prepareLocationChange(kind, selection.path);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '无法打开文件夹选择窗口');
    } finally {
      setBusyAction(null);
    }
  };

  const applyLocationChange = async (migrate: boolean) => {
    if (!pendingLocation) return;
    const change = pendingLocation;
    overviewRequestId.current += 1;
    setBusyAction(`${change.kind === 'downloads' ? 'download' : 'favorites'}-directory`);
    try {
      const status = await startStorageDirectoryChange(
        change.kind,
        change.directoryValue || undefined,
        migrate,
        change.allowNonEmpty,
      );
      cachedStorageOperationStatus = status;
      setStorageOperation(status);
      setPendingLocation(null);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '无法更改存储位置');
    } finally {
      setBusyAction(null);
    }
  };

  const resetLocationDirectory = async (kind: LocationKind) => {
    const path = kind === 'downloads'
      ? overview?.default_download_directory
      : overview?.default_favorites_directory;
    if (path) await prepareLocationChange(kind, path, '');
  };

  if (loading && !overview) return <StorageSkeleton />;
  if (!overview) {
    return (
      <Card className="items-center p-8 text-center">
        <HardDrive className="mb-2 text-muted" size={28} />
        <p className="text-sm text-muted">暂时无法读取存储信息</p>
        <Button className="mt-3" size="sm" variant="secondary" onPress={refresh}>重试</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">存储空间</h2>
          <p className="text-xs text-muted">{overviewDescription}</p>
        </div>
        <Button isIconOnly aria-label="重新统计存储空间" size="sm" variant="ghost" isPending={loading} isDisabled={controlsDisabled} onPress={refresh}>
          <RefreshCw size={16} />
        </Button>
      </div>

      {storageOperation?.running && (
        <Card className="space-y-3 p-4" aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{storageOperation.title}</div>
              <div className="mt-1 text-xs text-muted">{storageOperation.message}</div>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {Math.min(100, Math.round((storageOperation.current / Math.max(1, storageOperation.total)) * 100))}%
            </span>
          </div>
          <ProgressBar
            aria-label={storageOperation.title}
            value={(storageOperation.current / Math.max(1, storageOperation.total)) * 100}
          >
            <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
          </ProgressBar>
          <div className="text-xs text-muted">迁移进行期间，存储操作暂时不可用。切换页面不会中断任务。</div>
        </Card>
      )}

      <Card className="p-4">
        <div className="grid items-center gap-5 sm:grid-cols-[164px_1fr]">
          <div
            className="relative mx-auto grid size-40 place-items-center rounded-full"
            style={{ background: chartBackground }}
            role="img"
            aria-label={`应用共占用 ${formatBytes(overview.total_bytes)}`}
          >
            <div className="grid size-28 place-items-center rounded-full bg-surface text-center shadow-sm">
              <div>
                <div className="text-lg font-semibold">{formatBytes(overview.total_bytes)}</div>
                <div className="text-xs text-muted">应用占用</div>
              </div>
            </div>
          </div>
          <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
            {overview.items.map((item, index) => (
              <div key={item.id} className="flex min-w-0 items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} />
                <span className="min-w-0 flex-1 truncate text-muted">{item.title}</span>
                <span className="shrink-0 tabular-nums">{formatBytes(item.size_bytes)}</span>
              </div>
            ))}
            <div className="col-span-full mt-1 text-xs text-muted">
              可回收约 {formatBytes(overview.reclaimable_bytes)}，实际清理量取决于受保护文件。
            </div>
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <HardDrive size={17} />
          <h3 className="text-sm font-semibold">{overview.disks.length === 1 ? `${overview.disks[0].kind === 'mount' ? '挂载点' : '磁盘'}占用` : '占用的磁盘与挂载点'}</h3>
        </div>
        {overview.disks.map((disk) => {
          const appPercent = disk.total_bytes ? (disk.app_bytes / disk.total_bytes) * 100 : 0;
          const categoryNames = disk.item_ids
            .map((id) => overview.items.find((item) => item.id === id)?.title)
            .filter(Boolean)
            .join('、');
          return (
            <div key={disk.id} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{diskLabel(disk, overview.disks.length)}</span>
                <span className="text-xs text-muted">容量 {formatBytes(disk.total_bytes)}</span>
              </div>
              <DiskUsageBar disk={disk} />
              <div className={`grid gap-x-4 gap-y-1 text-xs ${disk.reserved_bytes > 0 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
                <div className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent" /><span>本应用 <strong className="font-medium text-foreground">{formatBytes(disk.app_bytes)}</strong> · {formatPercent(appPercent)}</span></div>
                <div className="flex items-center gap-1.5 text-muted"><span className="size-2 rounded-sm bg-surface-tertiary" /><span>其他已用 {formatBytes(disk.other_used_bytes)}</span></div>
                {disk.reserved_bytes > 0 && <div className="flex items-center gap-1.5 text-muted"><span className="size-2 rounded-sm bg-muted/35" /><span>系统保留 {formatBytes(disk.reserved_bytes)}</span></div>}
                <div className="flex items-center gap-1.5 text-muted"><span className="size-2 rounded-sm bg-surface-secondary" /><span>可用 {formatBytes(disk.free_bytes)}</span></div>
              </div>
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted">
                <span>本应用在此处存放：{categoryNames}</span>
                <span>总计已用 {formatBytes(disk.used_bytes)}</span>
              </div>
            </div>
          );
        })}
      </Card>

      <Card className="p-4">
        <div className="mb-2">
          <h3 className="text-sm font-semibold">存储位置</h3>
          <p className="text-xs text-muted">路径改变后，数据可能分布到不同磁盘或挂载点</p>
        </div>
        <div className="divide-y divide-separator">
          {locationItems.map((item) => {
            const disk = overview.disks.find((candidate) => candidate.id === item.disk);
            const isDownloads = item.id === 'downloads';
            const isFavorites = item.id === 'favorites';
            const configurable = isDownloads || isFavorites;
            const locationBusy = busyAction === `${isDownloads ? 'download' : 'favorites'}-directory`;
            return (
              <div key={item.id} className="grid min-h-16 items-center gap-3 py-3 sm:grid-cols-[120px_1fr_auto]">
                <div>
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="text-xs text-muted">{configurable ? '可配置' : '固定位置'}</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs text-foreground" title={item.path}>{item.path}</div>
                  <div className="mt-1 text-xs text-muted">{disk ? diskLabel(disk, overview.disks.length) : item.disk}</div>
                </div>
                {configurable ? (
                  <div className="flex justify-end gap-1">
                    <Button
                      isIconOnly
                      aria-label={isDownloads ? '选择下载目录' : '选择收藏目录'}
                      size="sm"
                      variant="secondary"
                      isPending={locationBusy}
                      isDisabled={controlsDisabled && !locationBusy}
                      onPress={() => chooseLocationDirectory(isDownloads ? 'downloads' : 'favorites')}
                    >
                      <FolderOpen size={14} />
                    </Button>
                    {(isDownloads ? settings.storage.download_directory : settings.storage.favorites_directory) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={controlsDisabled}
                        onPress={() => resetLocationDirectory(isDownloads ? 'downloads' : 'favorites')}
                      >
                        恢复默认
                      </Button>
                    )}
                  </div>
                ) : <Chip size="sm" variant="soft">随应用固定</Chip>}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">存储内容</h3>
            <p className="text-xs text-muted">受保护内容不会被清理或压缩</p>
          </div>
        </div>
        <div className="divide-y divide-separator">
          {overview.items.map((item) => {
            const Icon = CATEGORY_ICONS[item.id as keyof typeof CATEGORY_ICONS] || Archive;
            const pending = busyAction === `clear:${item.id}`;
            return (
              <div key={item.id} className="flex min-h-16 items-center gap-3 py-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-secondary text-muted">
                  <Icon size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.title}</span>
                    {item.action === 'none' && <Chip size="sm" variant="soft"><ShieldCheck size={12} />受保护</Chip>}
                  </div>
                  <p className="truncate text-xs text-muted">
                    {item.description} · {item.file_count} 个文件 · {formatBytes(item.size_bytes)}
                    {item.reclaimable_bytes !== item.size_bytes && item.action !== 'none' ? ` · 可安全清理 ${formatBytes(item.reclaimable_bytes)}` : ''}
                  </p>
                </div>
                {item.action !== 'none' && (
                  <Button
                    size="sm"
                    variant={item.action === 'risk' ? 'danger-soft' : 'ghost'}
                    isPending={pending}
                    isDisabled={item.size_bytes === 0 || controlsDisabled}
                    onPress={() => requestClear(item)}
                  >
                    <Trash2 size={14} /> 清理
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <h3 className="text-sm font-semibold">下载压缩</h3>
          <p className="text-xs text-muted">批量转换当前下载目录中的受管理图片</p>
        </div>
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_120px_auto]">
          <div>
            <label className="mb-1.5 block text-xs font-medium">压缩格式</label>
            <ComboBox selectedKey={compressionFormat} onSelectionChange={(key) => {
              const nextFormat = String(key);
              setCompressionFormat(nextFormat);
              onUpdate('storage.auto_compress.format', nextFormat);
            }}>
              <ComboBox.InputGroup><Input /><ComboBox.Trigger /></ComboBox.InputGroup>
              <ComboBox.Popover>
                <ListBox>
                  {overview.compression.map((format) => (
                    <ListBox.Item key={format.id} id={format.id} textValue={format.title} isDisabled={!format.available}>
                      {format.title}{format.available ? '' : '（编码器不可用）'}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </ComboBox.Popover>
            </ComboBox>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium">质量 (1-100)</label>
            <Input type="number" min={1} max={100} value={String(quality)} onChange={(event) => {
              const nextQuality = Math.max(1, Math.min(100, Number(event.target.value) || 1));
              setQuality(nextQuality);
              onUpdate('storage.auto_compress.quality', nextQuality);
            }} />
          </div>
          <Button
            isDisabled={!selectedFormat?.available || controlsDisabled}
            isPending={busyAction === 'compress'}
            onPress={() => setCompressConfirmOpen(true)}
          >
            <Archive size={15} /> 全部压缩
          </Button>
        </div>
        {!availableFormats.length && <p className="text-xs text-danger">当前运行环境没有可用的 AVIF 或 JPEG XL 编码器。</p>}
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <h3 className="text-sm font-semibold">自动管理</h3>
          <p className="text-xs text-muted">达到阈值时在启动期间自动维护</p>
        </div>
        <div className="grid items-center gap-3 sm:grid-cols-[1fr_130px_auto]">
          <div><div className="text-sm font-medium">自动清理缓存</div><div className="text-xs text-muted">超过设定容量后清除可重新获取的缓存</div></div>
          <Input
            aria-label="缓存清理阈值（MB）"
            type="number"
            min={32}
            value={String(settings.storage.auto_clear_cache.max_mb)}
            disabled={!settings.storage.auto_clear_cache.enabled}
            onChange={(event) => onUpdate('storage.auto_clear_cache.max_mb', Math.max(32, Number(event.target.value) || 32))}
          />
          <Switch aria-label="自动清理缓存" isSelected={settings.storage.auto_clear_cache.enabled} onChange={(value) => onUpdate('storage.auto_clear_cache.enabled', value)}>
            <Switch.Control><Switch.Thumb /></Switch.Control>
          </Switch>
        </div>
        <Separator />
        <div className="grid items-center gap-3 sm:grid-cols-[1fr_130px_auto]">
          <div><div className="text-sm font-medium">自动清理日志</div><div className="text-xs text-muted">超过文件数量后保留最新日志</div></div>
          <Input
            aria-label="日志文件保留数量"
            type="number"
            min={2}
            value={String(settings.storage.auto_clear_logs.max_files)}
            disabled={!settings.storage.auto_clear_logs.enabled}
            onChange={(event) => onUpdate('storage.auto_clear_logs.max_files', Math.max(2, Number(event.target.value) || 2))}
          />
          <Switch aria-label="自动清理日志" isSelected={settings.storage.auto_clear_logs.enabled} onChange={(value) => onUpdate('storage.auto_clear_logs.enabled', value)}>
            <Switch.Control><Switch.Thumb /></Switch.Control>
          </Switch>
        </div>
        <Separator />
        <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <div className="text-sm font-medium">自动压缩新下载</div>
            <div className="text-xs text-muted">使用上方选择的 {selectedFormat?.title || compressionFormat}，质量 {quality}</div>
          </div>
          <Switch
            aria-label="自动压缩新下载"
            isSelected={settings.storage.auto_compress.enabled}
            isDisabled={!selectedFormat?.available}
            onChange={(value) => {
              onUpdate('storage.auto_compress.format', compressionFormat);
              onUpdate('storage.auto_compress.quality', quality);
              onUpdate('storage.auto_compress.enabled', value);
            }}
          >
            <Switch.Control><Switch.Thumb /></Switch.Control>
          </Switch>
        </div>
      </Card>

      <Modal.Backdrop
        isOpen={!!pendingLocation}
        onOpenChange={(open) => !open && !controlsDisabled && setPendingLocation(null)}
      >
        <Modal.Container size="sm">
          <Modal.Dialog>
            {pendingLocation?.stage === 'non-empty' ? (
              <>
                <Modal.Header><Modal.Heading>目标文件夹不为空</Modal.Heading></Modal.Header>
                <Modal.Body>
                  <div className="space-y-3 text-sm text-muted">
                    <p className="break-all">{pendingLocation.path}</p>
                    <div className="flex gap-2 rounded-md bg-warning-soft p-3 text-warning-soft-foreground">
                      <TriangleAlert className="mt-0.5 shrink-0" size={16} />
                      <span>文件夹中已有 {pendingLocation.entryCount} 个项目。继续后将再询问是否迁移，现有文件不会被直接覆盖。</span>
                    </div>
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="ghost" onPress={() => {
                    const kind = pendingLocation.kind;
                    setPendingLocation(null);
                    void chooseLocationDirectory(kind);
                  }}>
                    重新选择
                  </Button>
                  <Button onPress={() => setPendingLocation({ ...pendingLocation, stage: 'migration' })}>继续</Button>
                </Modal.Footer>
              </>
            ) : (
              <>
                <Modal.Header><Modal.Heading>是否迁移现有数据？</Modal.Heading></Modal.Header>
                <Modal.Body>
                  <div className="space-y-3 text-sm text-muted">
                    <p>
                      {pendingLocation?.kind === 'downloads'
                        ? '迁移会移动应用管理的下载文件，并删除原位置中的这些文件。遇到同名文件会自动使用新名称。'
                        : '迁移会移动当前收藏数据并删除原 favorites.json。目标已有收藏时会先创建备份。'}
                    </p>
                    <p>选择“仅更改位置”不会移动或删除原文件，原位置也不会继续显示或统计。</p>
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="ghost" isDisabled={controlsDisabled} onPress={() => setPendingLocation(null)}>取消</Button>
                  <Button variant="secondary" isDisabled={controlsDisabled} onPress={() => applyLocationChange(false)}>仅更改位置</Button>
                  <Button isPending={busyAction !== null} isDisabled={operationRunning} onPress={() => applyLocationChange(true)}>迁移并删除原文件</Button>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop isOpen={!!confirmCategory} onOpenChange={(open) => !open && !operationRunning && setConfirmCategory(null)}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header><Modal.Heading>清理{confirmCategory?.title}</Modal.Heading></Modal.Header>
            <Modal.Body>
              <div className="space-y-3 text-sm text-muted">
                {confirmCategory?.id === 'downloads' ? (
                  <>
                    <p>将永久删除下载目录中的内容。当前壁纸、收藏和历史记录引用的本地文件会被保留。</p>
                    <div className="flex gap-2 rounded-md bg-danger-soft p-3 text-danger-soft-foreground"><TriangleAlert className="mt-0.5 shrink-0" size={16} /><span>未被识别为受保护的文件无法恢复。</span></div>
                  </>
                ) : (
                  <p>将删除这些诊断内容，此操作不可撤销。当前会话仍会继续生成新的记录。</p>
                )}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setConfirmCategory(null)}>取消</Button>
              <Button variant="danger" isPending={busyAction?.startsWith('clear:')} isDisabled={operationRunning} onPress={() => confirmCategory && runClear(confirmCategory)}>
                <Trash2 size={14} /> 确认清理
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop isOpen={compressConfirmOpen} onOpenChange={(open) => !open && !operationRunning && setCompressConfirmOpen(false)}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header><Modal.Heading>压缩全部下载内容</Modal.Heading></Modal.Header>
            <Modal.Body>
              <div className="space-y-3 text-sm text-muted">
                <p>图片将转换为 {selectedFormat?.title}，质量设为 {quality}。仅在新文件更小时替换原文件。</p>
                <p>当前壁纸、收藏和历史记录引用的文件会跳过。转换后的格式可能不受其他软件支持。</p>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setCompressConfirmOpen(false)}>取消</Button>
              <Button isPending={busyAction === 'compress'} isDisabled={operationRunning} onPress={runCompression}><Archive size={14} /> 开始压缩</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
