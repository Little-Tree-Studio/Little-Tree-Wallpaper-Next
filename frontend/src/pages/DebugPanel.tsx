import { useEffect, useState } from 'react';
import { Alert, Button, Card, ProgressBar, Separator, Spinner, toast } from '@heroui/react';
import { Bug, Check, Download, ExternalLink, FileText, FolderOpen, RefreshCw, Trash2, Zap } from 'lucide-react';
import {
  checkForUpdates, clearLogs, getBuildInfo, getDebugLog, getLogStats, getSettings,
  installDownloadedUpdate, openDebugLogDirectory, openDebugLogFile, openUrl,
  startUpdateDownload, notifyTestUpdateDetected, type BuildInfo, type LogStats, type UpdateCheckResult,
  type UpdateDownloadStatus,
} from '@/api/backend';
import { logError } from '@/lib/log';

export default function DebugPanel() {
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [settings, setSettings] = useState<unknown>(null);
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [download, setDownload] = useState<UpdateDownloadStatus | null>(null);
  const [log, setLog] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      const [nextBuild, nextStats, nextSettings] = await Promise.all([getBuildInfo(), getLogStats(), getSettings()]);
      setBuild(nextBuild); setStats(nextStats); setSettings(nextSettings);
      toast.success('调试信息已刷新', { timeout: 2000 });
    } catch (error) { logError('Debug panel refresh failed', error); toast.danger('刷新调试信息失败', { timeout: 0 }); }
    finally { setBusy(false); }
  };

  useEffect(() => { void refresh(); }, []);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); toast.success(`${label}已完成`, { timeout: 2000 }); }
    catch (error) { logError(`Debug action failed: ${label}`, error); toast.danger(`${label}失败`, { timeout: 0 }); }
    finally { setBusy(false); }
  };

  const loadLog = async () => {
    try { const result = await getDebugLog(300); setLog(result?.content || '（无日志）'); }
    catch (error) { logError('Debug log load failed', error); toast.danger('读取日志失败', { timeout: 0 }); }
  };

  const checkUpdate = async () => {
    setBusy(true);
    try { setUpdate(await checkForUpdates()); setDownload(null); }
    catch (error) { logError('Debug update check failed', error); toast.danger('检查更新失败', { timeout: 0 }); }
    finally { setBusy(false); }
  };

  const simulateUpdate = async (forceUpdate: boolean) => {
    setBusy(true);
    try {
      const current = update || await checkForUpdates();
      const simulated: UpdateCheckResult = {
        ...current,
        has_update: true,
        force_update: forceUpdate,
        latest_version: `${current.current_version || build?.version || '2.0.0'}-test`,
        release_note: '这是调试面板模拟的更新提示，不会下载或安装真实文件。',
        package: current.package || {
          download_url: 'https://example.invalid/debug-test-update.exe',
          size_bytes: 0,
          sha256: '',
        },
      };
      setUpdate(simulated);
      notifyTestUpdateDetected(simulated);
      toast.success(forceUpdate ? '已模拟强制更新提示' : '已模拟普通更新顶栏提示', { timeout: 2500 });
    } catch (error) {
      logError('Debug update simulation failed', error);
      toast.danger('模拟更新提示失败', { timeout: 0 });
    } finally { setBusy(false); }
  };

  const startDownload = async () => {
    if (!update?.package) return;
    try { setDownload(await startUpdateDownload(update.latest_version, update.package)); }
    catch (error) { logError('Debug update download failed', error); toast.danger('下载更新失败', { timeout: 0 }); }
  };

  return <div className="mx-auto max-w-4xl space-y-4 pb-8">
    <div className="flex items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">调试面板</h1><p className="text-sm text-muted">隐藏工具，仅用于问题定位与更新验证</p></div><Button size="sm" variant="secondary" onPress={() => void refresh()} isDisabled={busy}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />刷新</Button></div>
    <Card className="space-y-3 p-4"><h2 className="flex items-center gap-2 font-semibold"><Bug size={17} />运行信息</h2><Separator /><div className="grid gap-2 text-sm sm:grid-cols-2"><div>版本 <b className="font-mono">{build ? `v${build.version}` : '—'}</b></div><div>构建类型 <b className="font-mono">{build?.build_type || '—'}</b></div><div>Commit <b className="font-mono">{build?.git_commit || '—'}</b></div><div>日志文件 <b>{stats?.file_count ?? '—'}</b> 个，共 <b>{stats?.entry_count ?? '—'}</b> 条</div></div><details><summary className="cursor-pointer text-sm text-muted">查看当前设置快照</summary><pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-surface-tertiary p-3 text-xs whitespace-pre-wrap">{JSON.stringify(settings, null, 2)}</pre></details></Card>
    <Card className="space-y-3 p-4"><h2 className="flex items-center gap-2 font-semibold"><Zap size={17} />快速调试</h2><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onPress={() => void run('自动换壁纸', () => import('@/api/backend').then(({ triggerAutoChangeNow }) => triggerAutoChangeNow()))} isDisabled={busy}><Zap size={14} />立即执行自动换壁纸</Button><Button size="sm" variant="ghost" onPress={() => void loadLog()}><FileText size={14} />读取最近日志</Button><Button size="sm" variant="ghost" onPress={() => openDebugLogFile()}><FileText size={14} />打开日志文件</Button><Button size="sm" variant="ghost" onPress={() => openDebugLogDirectory()}><FolderOpen size={14} />打开日志目录</Button><Button size="sm" variant="ghost" className="text-danger" onPress={() => void run('清理日志', async () => { const result = await clearLogs(); setStats(result); setLog(''); })} isDisabled={busy}><Trash2 size={14} />清理日志</Button></div>{log && <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-surface-tertiary p-3 text-xs leading-relaxed whitespace-pre-wrap break-all">{log}</pre>}</Card>
    <Card className="space-y-3 p-4"><h2 className="flex items-center gap-2 font-semibold"><Download size={17} />更新调试</h2><div className="flex flex-wrap gap-2"><Button size="sm" onPress={() => void checkUpdate()} isDisabled={busy}><RefreshCw size={14} />检查更新</Button><Button size="sm" variant="secondary" onPress={() => void simulateUpdate(false)} isDisabled={busy}><Bug size={14} />模拟普通更新</Button><Button size="sm" variant="danger" onPress={() => void simulateUpdate(true)} isDisabled={busy}><Bug size={14} />模拟强制更新</Button>{update?.release_notes_url && <Button size="sm" variant="ghost" onPress={() => void openUrl(update.release_notes_url)}><ExternalLink size={14} />发布说明</Button>}</div>{update && <Alert status={update.has_update ? 'warning' : 'success'}><Alert.Indicator />{update.has_update ? `发现 v${update.latest_version}，当前为 v${update.current_version}（${update.force_update ? '强制更新' : '普通更新'}）` : <><Check size={14} />当前已是最新版本</>}{update.has_update && update.package && <Button size="sm" variant="secondary" onPress={() => void startDownload()}><Download size={14} />下载</Button>}</Alert>}{download && <div className="space-y-2"><div className="flex justify-between text-sm"><span>{download.phase}</span><span>{Math.round(download.progress)}%</span></div><ProgressBar value={download.progress} isIndeterminate={download.phase === 'downloading' && download.total_bytes <= 0}><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar>{download.phase === 'downloaded' && <Button size="sm" onPress={() => void run('安装更新', installDownloadedUpdate)}>安装并重启</Button>}{download.phase === 'installing' && <Spinner size="sm" />}</div>}</Card>
  </div>;
}
