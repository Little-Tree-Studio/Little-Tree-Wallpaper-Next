import { useEffect, useState } from 'react';
import { Alert, Button, Spinner } from '@heroui/react';
import { Download, ExternalLink, FolderOpen, RefreshCw } from 'lucide-react';
import {
  checkForUpdates,
  downloadUpdatePackage,
  FORCED_UPDATE_DETECTED_EVENT,
  openFile,
  openUrl,
} from '@/api/backend';
import type { UpdateCheckResult, UpdateDownloadResult } from '@/api/backend';
import { logError } from '@/lib/log';

type DownloadState =
  | { phase: 'downloading'; update: UpdateCheckResult }
  | { phase: 'downloaded'; update: UpdateCheckResult; download: UpdateDownloadResult }
  | { phase: 'error'; update: UpdateCheckResult; message: string };

let forcedUpdateCheckPromise: Promise<UpdateCheckResult> | null = null;
const updateDownloads = new Map<string, Promise<UpdateDownloadResult>>();

function checkForcedUpdate(): Promise<UpdateCheckResult> {
  if (!forcedUpdateCheckPromise) {
    forcedUpdateCheckPromise = checkForUpdates().catch((error) => {
      forcedUpdateCheckPromise = null;
      throw error;
    });
  }
  return forcedUpdateCheckPromise;
}

function downloadForcedUpdate(update: UpdateCheckResult): Promise<UpdateDownloadResult> {
  if (!update.package) return Promise.reject(new Error('当前平台没有可用的强制更新安装包'));
  const key = `${update.latest_version}:${update.package.sha256}`;
  const existing = updateDownloads.get(key);
  if (existing) return existing;
  const request = downloadUpdatePackage(update.latest_version, update.package).catch((error) => {
    updateDownloads.delete(key);
    throw error;
  });
  updateDownloads.set(key, request);
  return request;
}

export default function ForcedUpdateBanner() {
  const [state, setState] = useState<DownloadState | null>(null);

  const startDownload = async (update: UpdateCheckResult) => {
    setState({ phase: 'downloading', update });
    try {
      const download = await downloadForcedUpdate(update);
      setState({ phase: 'downloaded', update, download });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '安装包下载失败';
      logError('Forced update download failed', error);
      setState({ phase: 'error', update, message });
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

  const description = state.phase === 'downloading'
    ? '此版本必须更新才能继续获得支持，安装包正在自动下载。'
    : state.phase === 'downloaded'
      ? `安装包 ${state.download.filename} 已下载，请打开并完成更新。`
      : `自动下载安装包失败：${state.message}`;

  return (
    <div className="shrink-0 px-3 pt-2">
      <Alert status="danger" className="items-center py-2.5">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>必须更新到 v{state.update.latest_version}</Alert.Title>
          <Alert.Description>{description}</Alert.Description>
        </Alert.Content>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {state.phase === 'downloading' && (
            <span className="flex items-center gap-2 text-sm font-medium">
              <Spinner color="current" size="sm" />正在下载
            </span>
          )}
          {state.phase === 'downloaded' && (
            <Button size="sm" variant="danger" onPress={() => void openFile(state.download.path)}>
              <FolderOpen size={14} />打开安装包
            </Button>
          )}
          {state.phase === 'error' && (
            <Button size="sm" variant="danger" onPress={() => void startDownload(state.update)}>
              <RefreshCw size={14} />重新下载
            </Button>
          )}
          {state.update.release_notes_url && (
            <Button size="sm" variant="ghost" onPress={() => void openUrl(state.update.release_notes_url)}>
              {state.phase === 'downloading' ? <Download size={14} /> : <ExternalLink size={14} />}
              发布页面
            </Button>
          )}
        </div>
      </Alert>
    </div>
  );
}
