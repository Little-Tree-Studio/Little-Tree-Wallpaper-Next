import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Loader2, AlertTriangle, Sprout } from 'lucide-react';
import { Button, ProgressBar } from '@heroui/react';
import './index.css';
import App from './App';
import { waitForApi } from '@/api/backend';
import { logError } from '@/lib/log';
import WindowTitleBar from '@/components/WindowTitleBar';

const BRIDGE_TIMEOUT_MS = 12000;

function BridgeLoader() {
  const [status, setStatus] = useState<'waiting' | 'ready' | 'timeout'>('waiting');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await waitForApi();
        if (!cancelled) setStatus('ready');
      } catch (e) {
        logError('Backend bridge timed out', e);
        if (!cancelled) setStatus('timeout');
      }
    })();

    const elapsedTimer = window.setInterval(() => setElapsed((e) => e + 100), 100);
    const timeout = window.setTimeout(() => {
      window.clearInterval(elapsedTimer);
      setStatus((s) => (s === 'ready' ? s : 'timeout'));
    }, BRIDGE_TIMEOUT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(elapsedTimer);
      window.clearTimeout(timeout);
    };
  }, []);

  if (status === 'ready') {
    return (
      <StrictMode>
        <App />
      </StrictMode>
    );
  }

  return (
    <div className="flex h-screen w-screen min-h-0 flex-col bg-background text-foreground">
      {!window.location.hash.startsWith('#/dynamic/runtime') && <WindowTitleBar title="小树壁纸 Next" />}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-surface p-10 shadow-lg">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Sprout size={36} />
        </div>

        {status === 'waiting' ? (
          <>
            <div className="flex items-center gap-3 text-lg font-medium">
              <Loader2 size={20} className="animate-spin text-primary" />
              正在连接后端服务...
            </div>
            <div className="text-sm text-muted">
              已等待 {(elapsed / 1000).toFixed(1)}s / {(BRIDGE_TIMEOUT_MS / 1000).toFixed(0)}s
            </div>
            <ProgressBar
              aria-label="连接进度"
              className="w-48"
              value={Math.min(100, (elapsed / BRIDGE_TIMEOUT_MS) * 100)}
            >
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 text-lg font-medium text-danger">
              <AlertTriangle size={20} />
              后端服务未响应
            </div>
            <div className="max-w-xs text-center text-sm text-muted">
              前端无法连接到 LumiView 后端。请确认应用是通过桌面宿主（Python）启动的，而不是直接在浏览器中打开。
            </div>
            <Button onPress={() => window.location.reload()}>重新连接</Button>
          </>
        )}
      </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <BridgeLoader />,
);
