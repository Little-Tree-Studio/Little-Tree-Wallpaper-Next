import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Card, Chip, EmptyState, Modal, SearchField, Spinner, Tooltip, toast } from '@heroui/react';
import { ArrowLeft, CalendarDays, Clock, Copy, Download, FolderSearch, Image as ImageIcon, Images, RefreshCw, Search, Trash2 } from 'lucide-react';
import {
  clearHistory,
  copyImageToClipboardWithProgress,
  copyToClipboard,
  deleteHistoryItem,
  downloadWithProgress,
  getHistory,
  HISTORY_CHANGED_EVENT,
  localFileUrl,
  localPreviewUrl,
  openFile,
  setWallpaperWithProgress,
  type HistoryItem,
} from '@/api/backend';
import { safeNameForFile } from '@/lib/download';
import { useImageViewer } from '@/components/ImageViewer';

const REASON_TEXT: Record<string, string> = {
  startup: '启动更换',
  refresh: '手动刷新',
  set: '手动设置',
  record: '手动记录',
  external: '外部更换',
  dynamic: '动态壁纸画面',
  generated: 'AI 生成',
};

function historyFilename(item: HistoryItem): string {
  const ext = item.path.includes('.') ? item.path.slice(item.path.lastIndexOf('.')) : '.jpg';
  return `${safeNameForFile(item.title, 'wallpaper')}${ext}`;
}

function dayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayLabel(key: string): string {
  if (key === 'unknown') return '日期未知';
  const date = new Date(`${key}T00:00:00`);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((startOfToday.getTime() - date.getTime()) / 86_400_000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
}

function historyTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function History() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const { openViewer } = useImageViewer();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHistory(await getHistory());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(HISTORY_CHANGED_EVENT, load);
    return () => window.removeEventListener(HISTORY_CHANGED_EVENT, load);
  }, [load]);

  const visibleHistory = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return history;
    return history.filter((item) => [
      item.title,
      item.path,
      item.original_path,
      item.reason,
      REASON_TEXT[item.reason],
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)));
  }, [history, query]);

  const groupedHistory = useMemo(() => {
    const groups = new Map<string, HistoryItem[]>();
    visibleHistory.forEach((item) => {
      const key = dayKey(item.time);
      const entries = groups.get(key) || [];
      entries.push(item);
      groups.set(key, entries);
    });
    return Array.from(groups.entries());
  }, [visibleHistory]);

  const todayCount = useMemo(() => {
    const today = dayKey(new Date().toISOString());
    return history.filter((item) => dayKey(item.time) === today).length;
  }, [history]);

  const localCopyCount = useMemo(() => history.filter((item) => item.original_path).length, [history]);

  const openItemViewer = (index: number) => {
    if (!visibleHistory.length) return;
    openViewer(visibleHistory.map((item) => ({
      src: localFileUrl(item.path),
      title: item.title || '壁纸',
      description: `${REASON_TEXT[item.reason] || item.reason} · ${new Date(item.time).toLocaleString()}`,
      local_path: item.path,
      preview_url: item.preview_url || localPreviewUrl(item.path, 320),
      source_type: 'history',
    })), index);
  };

  const handleSetWallpaper = async (item: HistoryItem) => {
    await setWallpaperWithProgress('', historyFilename(item), item.path);
  };

  const handleDownload = async (item: HistoryItem) => {
    await downloadWithProgress(localFileUrl(item.path), historyFilename(item));
  };

  const handleCopyImage = async (item: HistoryItem) => {
    await copyImageToClipboardWithProgress(localFileUrl(item.path));
  };

  const handleCopyPath = async (item: HistoryItem) => {
    await copyToClipboard(item.path);
    toast.success('已复制路径', { timeout: 2000 });
  };

  const handleOpenFolder = async (item: HistoryItem) => {
    await openFile(item.path);
  };

  const handleDelete = async (item: HistoryItem) => {
    const removed = await deleteHistoryItem(item.path);
    if (removed) {
      setHistory((items) => items.filter((entry) => entry !== item));
      toast.success('已删除记录', { timeout: 2000 });
    } else {
      toast.danger('删除失败', { timeout: 3000 });
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearHistory();
      setHistory([]);
      setClearOpen(false);
      toast.success('已清空历史记录', { timeout: 2000 });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="history-page mx-auto max-w-6xl space-y-6 pb-8">
      <header className="flex flex-wrap items-start gap-3">
        <Button isIconOnly variant="ghost" aria-label="返回" onPress={() => window.history.back()}><ArrowLeft size={18} /></Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">历史图片</h1>
            <Chip size="sm" variant="secondary">{history.length} 张</Chip>
          </div>
          <p className="mt-1 text-sm text-muted">每一次更换都被保留下来，点击图片即可连续浏览。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" isPending={loading} onPress={() => void load()}>
            {({ isPending }) => <><RefreshCw size={14} className={isPending ? 'animate-spin' : ''} />{isPending ? '刷新中' : '刷新'}</>}
          </Button>
          {history.length > 0 && <Button size="sm" variant="danger-soft" onPress={() => setClearOpen(true)}><Trash2 size={14} />清空</Button>}
        </div>
      </header>

      {history.length > 0 && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="历史统计">
          <Card className="history-stat-card border-l-2 border-l-accent">
            <Card.Content className="flex items-center gap-3 p-4">
              <div className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-foreground"><Images size={18} /></div>
              <div><p className="text-xs text-muted">全部记录</p><p className="text-lg font-semibold">{history.length}<span className="ml-1 text-xs font-normal text-muted">张</span></p></div>
            </Card.Content>
          </Card>
          <Card className="history-stat-card border-l-2 border-l-warning">
            <Card.Content className="flex items-center gap-3 p-4">
              <div className="flex size-9 items-center justify-center rounded-lg bg-warning-soft text-warning-soft-foreground"><CalendarDays size={18} /></div>
              <div><p className="text-xs text-muted">今天使用</p><p className="text-lg font-semibold">{todayCount}<span className="ml-1 text-xs font-normal text-muted">张</span></p></div>
            </Card.Content>
          </Card>
          <Card className="history-stat-card border-l-2 border-l-success">
            <Card.Content className="flex items-center gap-3 p-4">
              <div className="flex size-9 items-center justify-center rounded-lg bg-success-soft text-success-soft-foreground"><FolderSearch size={18} /></div>
              <div><p className="text-xs text-muted">已保存副本</p><p className="text-lg font-semibold">{localCopyCount}<span className="ml-1 text-xs font-normal text-muted">张</span></p></div>
            </Card.Content>
          </Card>
        </section>
      )}

      {!loading && history.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <SearchField aria-label="搜索历史图片" className="min-w-[220px] flex-1 sm:max-w-md" value={query} onChange={(value) => setQuery(String(value))}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="搜索标题、路径或更换原因" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <span className="text-sm text-muted">{query.trim() ? `找到 ${visibleHistory.length} 张` : '按最近使用时间排列'}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24"><Spinner size="lg" /></div>
      ) : history.length === 0 ? (
        <EmptyState className="flex flex-col items-center gap-2 py-16 text-center">
          <Clock size={28} className="text-muted" />
          <p className="font-medium">还没有历史图片</p>
          <p className="text-sm text-muted">设置或记录一张壁纸后，它会出现在这里。</p>
        </EmptyState>
      ) : visibleHistory.length === 0 ? (
        <EmptyState className="flex flex-col items-center gap-2 py-16 text-center">
          <Search size={28} className="text-muted" />
          <p className="font-medium">没有匹配的图片</p>
          <p className="text-sm text-muted">试试搜索其他标题、路径或更换原因。</p>
          <Button variant="secondary" size="sm" onPress={() => setQuery('')}>清除搜索</Button>
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {groupedHistory.map(([key, items]) => (
            <section key={key} aria-labelledby={`history-${key}`}>
              <div className="mb-3 flex items-center gap-3">
                <h2 id={`history-${key}`} className="text-sm font-semibold">{dayLabel(key)}</h2>
                <span className="h-px flex-1 bg-separator" />
                <span className="text-xs text-muted">{items.length} 张</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => {
                  const index = visibleHistory.indexOf(item);
                  return (
                    <Card key={`${item.path}-${item.time}`} className="history-card group overflow-hidden">
                      <button
                        type="button"
                        className="relative block aspect-[16/10] w-full overflow-hidden bg-surface-secondary text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                        onClick={() => openItemViewer(index)}
                        aria-label={`查看 ${item.title || '壁纸'}`}
                      >
                        {item.preview_url ? (
                          <img src={item.preview_url} alt={item.title || '壁纸'} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-muted">无预览</div>
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/65 to-transparent opacity-80" />
                        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
                          <Chip size="sm" variant="secondary" className="bg-black/45 text-white backdrop-blur">{REASON_TEXT[item.reason] || item.reason}</Chip>
                          {item.original_path && <Chip size="sm" variant="soft" className="bg-black/45 text-white backdrop-blur">已保存</Chip>}
                        </div>
                        <span className="absolute bottom-3 left-3 flex items-center gap-1 text-xs text-white/90"><Clock size={12} />{historyTime(item.time)}</span>
                      </button>
                      <Card.Content className="space-y-3 p-3">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Card.Title className="truncate text-sm" title={item.title}>{item.title || '壁纸'}</Card.Title>
                            <p className="mt-1 truncate text-xs text-muted" title={item.path}>{item.path}</p>
                          </div>
                          <Tooltip><Button isIconOnly size="sm" variant="ghost" aria-label="复制路径" onPress={() => void handleCopyPath(item)}><Copy size={14} /></Button><Tooltip.Content>复制路径</Tooltip.Content></Tooltip>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="secondary" className="min-w-0 flex-1" onPress={() => void handleSetWallpaper(item)}><ImageIcon size={14} />设为壁纸</Button>
                          <Tooltip><Button isIconOnly size="sm" variant="ghost" aria-label="下载到下载目录" onPress={() => void handleDownload(item)}><Download size={14} /></Button><Tooltip.Content>下载</Tooltip.Content></Tooltip>
                          <Tooltip><Button isIconOnly size="sm" variant="ghost" aria-label="复制图片" onPress={() => void handleCopyImage(item)}><Copy size={14} /></Button><Tooltip.Content>复制图片</Tooltip.Content></Tooltip>
                          <Tooltip><Button isIconOnly size="sm" variant="ghost" aria-label="打开所在位置" onPress={() => void handleOpenFolder(item)}><FolderSearch size={14} /></Button><Tooltip.Content>打开文件</Tooltip.Content></Tooltip>
                          <Tooltip><Button isIconOnly size="sm" variant="danger-soft" aria-label="删除记录" onPress={() => void handleDelete(item)}><Trash2 size={14} /></Button><Tooltip.Content>删除</Tooltip.Content></Tooltip>
                        </div>
                      </Card.Content>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal.Backdrop isOpen={clearOpen} onOpenChange={setClearOpen}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-md">
            <Modal.Header>
              <Modal.Heading>清空历史记录</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm text-foreground">将删除全部 {history.length} 条历史记录，已保存到数据目录的副本文件也会一并删除。此操作无法撤销。</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setClearOpen(false)}>取消</Button>
              <Button variant="danger" isDisabled={clearing} onPress={() => void handleClear()}>
                {clearing ? '正在清空…' : '确认清空'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
