import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Loader2, AlertTriangle, Sprout } from 'lucide-react';
import './index.css';
import App from './App';

const BRIDGE_TIMEOUT_MS = 12000;

function BridgeLoader() {
  const [status, setStatus] = useState<'waiting' | 'ready' | 'timeout'>('waiting');
  const [elapsed, setElapsed] = useState(0);

  const checkReady = useCallback(() => {
    if (typeof window !== 'undefined' && window.pywebview?.api) {
      setStatus('ready');
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    if (checkReady()) return;

    const onReady = () => {
      setStatus('ready');
    };
    window.addEventListener('pywebviewready', onReady, { once: true });

    const interval = window.setInterval(() => {
      setElapsed((e) => e + 100);
      if (checkReady()) {
        window.clearInterval(interval);
        window.removeEventListener('pywebviewready', onReady);
      }
    }, 100);

    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
      window.removeEventListener('pywebviewready', onReady);
      if (!checkReady()) {
        setStatus('timeout');
      }
    }, BRIDGE_TIMEOUT_MS);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      window.removeEventListener('pywebviewready', onReady);
    };
  }, [checkReady]);

  if (status === 'ready') {
    return (
      <StrictMode>
        <App />
      </StrictMode>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-background text-foreground">
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
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-surface-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(100, (elapsed / BRIDGE_TIMEOUT_MS) * 100)}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 text-lg font-medium text-danger">
              <AlertTriangle size={20} />
              后端服务未响应
            </div>
            <div className="max-w-xs text-center text-sm text-muted">
              前端无法连接到 pywebview 后端。请确认应用是通过桌面宿主（Python）启动的，而不是直接在浏览器中打开。
            </div>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              重新连接
            </button>
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <BridgeLoader />,
);
