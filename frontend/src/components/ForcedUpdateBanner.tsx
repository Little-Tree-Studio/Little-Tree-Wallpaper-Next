import { useEffect, useState } from 'react';
import { Alert, Button, Modal, ProgressBar, Spinner } from '@heroui/react';
import { Download, ExternalLink, Package, RefreshCw } from 'lucide-react';
import {
  checkForUpdates,
  FORCED_UPDATE_DETECTED_EVENT,
  TEST_UPDATE_DETECTED_EVENT,
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
  const [detailsOpen, setDetailsOpen] = useState(false);

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
    const handleTestDetected = (event: Event) => {
      const update = (event as CustomEvent<UpdateCheckResult>).detail;
      if (!update?.has_update || !update.force_update) return;
      setState({
        update,
        download: {
          id: 'debug-test', phase: 'downloaded', version: update.latest_version,
          filename: 'debug-test-update.exe', path: '', received_bytes: 0,
          total_bytes: update.package?.size_bytes || 0, progress: 100,
          error: '', already_downloaded: true, started_at: '', finished_at: '',
        },
      });
    };
    window.addEventListener(FORCED_UPDATE_DETECTED_EVENT, handleDetected);
    window.addEventListener(TEST_UPDATE_DETECTED_EVENT, handleTestDetected);
    checkForcedUpdate()
      .then((update) => {
        if (!cancelled && update.has_update && update.force_update) void startDownload(update);
      })
      .catch((error) => logError('Forced update check failed', error));
    return () => {
      cancelled = true;
      window.removeEventListener(FORCED_UPDATE_DETECTED_EVENT, handleDetected);
      window.removeEventListener(TEST_UPDATE_DETECTED_EVENT, handleTestDetected);
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
    <div className="mb-4 shrink-0 px-3 pt-0">
      <Alert status="danger" className="items-center py-2.5">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>必须更新到 v{state.update.latest_version}</Alert.Title>
           <Alert.Description>{description}</Alert.Description>
           <Button size="sm" variant="ghost" className="mt-1" onPress={() => setDetailsOpen(true)}>查看详情</Button>
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
      <Modal.Backdrop isOpen={detailsOpen} onOpenChange={setDetailsOpen}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>强制更新到 v{state.update.latest_version}</Modal.Heading>
              <p className="text-sm text-muted">当前版本 v{state.update.current_version} · {state.update.release_date || '暂无发布日期'}</p>
            </Modal.Header>
            <Modal.Body className="max-h-[60vh] overflow-y-auto">
              <div className="rounded-lg bg-surface-secondary p-4 text-sm leading-6 whitespace-pre-wrap">
                {state.update.release_note?.trim() || '此版本未提供更新说明。'}
              </div>
            </Modal.Body>
            <Modal.Footer>
              {state.update.release_notes_url && <Button variant="secondary" onPress={() => void openUrl(state.update.release_notes_url)}>查看发布页面</Button>}
              <Button onPress={() => setDetailsOpen(false)}>关闭</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
