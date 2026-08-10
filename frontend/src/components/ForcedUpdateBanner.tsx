import { useEffect, useState } from 'react';
import { Alert, Button, ProgressBar, Spinner } from '@heroui/react';
import { Download, ExternalLink, Package, RefreshCw } from 'lucide-react';
import {
  checkForUpdates,
  FORCED_UPDATE_DETECTED_EVENT,
  getUpdateDownloadStatus,
  installDownloadedUpdate,
  openUrl,
  startUpdateDownload,
} from '@/api/backend';
import type { UpdateCheckResult, UpdateDownloadStatus } from '@/api/backend';
import { logError } from '@/lib/log';

type DownloadState = {
  update: UpdateCheckResult;
  download: UpdateDownloadStatus;
};

let forcedUpdateCheckPromise: Promise<UpdateCheckResult> | null = null;

function checkForcedUpdate(): Promise<UpdateCheckResult> {
  if (!forcedUpdateCheckPromise) {
    forcedUpdateCheckPromise = checkForUpdates().catch((error) => {
      forcedUpdateCheckPromise = null;
      throw error;
    });
  }
  return forcedUpdateCheckPromise;
}

export default function ForcedUpdateBanner() {
  const [state, setState] = useState<DownloadState | null>(null);
  const [installing, setInstalling] = useState(false);

  const startDownload = async (update: UpdateCheckResult) => {
    try {
      if (!update.package) throw new Error('当前平台没有可用的强制更新安装包');
      const download = await startUpdateDownload(update.latest_version, update.package);
      setState({ update, download });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '安装包下载失败';
      logError('Forced update download failed', error);
      setState({
        update,
        download: {
          id: '', phase: 'error', version: update.latest_version, filename: '', path: '',
          received_bytes: 0, total_bytes: update.package?.size_bytes || 0, progress: 0,
          error: message, already_downloaded: false, started_at: '', finished_at: '',
        },
      });
    }
  };

  const downloadActive = state?.download.phase === 'downloading' || state?.download.phase === 'verifying';
  useEffect(() => {
    if (!downloadActive) return undefined;
    const timer = window.setInterval(() => {
      void getUpdateDownloadStatus().then((download) => {
        setState((current) => current ? { ...current, download } : current);
      }).catch((error) => logError('Forced update progress failed', error));
    }, 500);
    return () => window.clearInterval(timer);
  }, [downloadActive]);

  const installUpdate = async () => {
    setInstalling(true);
    try {
      await installDownloadedUpdate();
      setState((current) => current ? { ...current, download: { ...current.download, phase: 'installing' } } : current);
    } catch (error: unknown) {
      logError('Forced update install failed', error);
      setState((current) => current ? {
        ...current,
        download: { ...current.download, phase: 'error', error: error instanceof Error ? error.message : '无法启动安装' },
      } : current);
      setInstalling(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const handleDetected = (event: Event) => {
      const update = (event as CustomEvent<UpdateCheckResult>).detail;
      if (update?.has_update && update.force_update) void startDownload(update);
    };
    window.addEventListener(FORCED_UPDATE_DETECTED_EVENT, handleDetected);
    checkForcedUpdate()
      .then((update) => {
        if (!cancelled && update.has_update && update.force_update) void startDownload(update);
      })
      .catch((error) => logError('Forced update check failed', error));
    return () => {
      cancelled = true;
      window.removeEventListener(FORCED_UPDATE_DETECTED_EVENT, handleDetected);
    };
  }, []);

  if (!state) return null;

  const phase = state.download.phase;
  const description = phase === 'downloading'
    ? '此版本必须更新才能继续获得支持，安装包正在后台下载。'
    : phase === 'verifying'
      ? '下载完成，正在校验安装包完整性。'
      : phase === 'downloaded'
        ? `安装包 ${state.download.filename} 已校验，可以静默安装。`
        : phase === 'installing'
          ? '正在启动静默安装，应用即将退出并在更新后重新启动。'
          : `自动下载安装包失败：${state.download.error}`;

  return (
    <div className="shrink-0 px-3 pt-2">
      <Alert status="danger" className="items-center py-2.5">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>必须更新到 v{state.update.latest_version}</Alert.Title>
          <Alert.Description>{description}</Alert.Description>
          {(phase === 'downloading' || phase === 'verifying') && (
            <ProgressBar
              aria-label="强制更新下载进度"
              className="mt-2"
              isIndeterminate={state.download.total_bytes <= 0}
              size="sm"
              value={state.download.progress}
            >
              <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
            </ProgressBar>
          )}
        </Alert.Content>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {(phase === 'downloading' || phase === 'verifying') && (
            <span className="flex items-center gap-2 text-sm font-medium">
              <Spinner color="current" size="sm" />{Math.round(state.download.progress)}%
            </span>
          )}
          {phase === 'downloaded' && (
            <Button size="sm" variant="danger" isPending={installing} onPress={() => void installUpdate()}>
              {installing ? <Spinner color="current" size="sm" /> : <Package size={14} />}静默安装并重启
            </Button>
          )}
          {phase === 'error' && (
            <Button size="sm" variant="danger" onPress={() => void startDownload(state.update)}>
              <RefreshCw size={14} />重新下载
            </Button>
          )}
          {state.update.release_notes_url && (
            <Button size="sm" variant="ghost" onPress={() => void openUrl(state.update.release_notes_url)}>
              {phase === 'downloading' ? <Download size={14} /> : <ExternalLink size={14} />}
              发布页面
            </Button>
          )}
        </div>
      </Alert>
    </div>
  );
}
