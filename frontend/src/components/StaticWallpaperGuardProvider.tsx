import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertDialog, Button, Spinner } from '@heroui/react';
import { MonitorOff } from 'lucide-react';
import {
  getPendingStaticWallpaper,
  resolvePendingStaticWallpaper,
  type PendingStaticWallpaper,
} from '@/api/backend';
import { registerStaticWallpaperConfirmationHandler } from '@/lib/staticWallpaperConfirmation';

interface StaticWallpaperGuardProviderProps {
  children: ReactNode;
}

export default function StaticWallpaperGuardProvider({ children }: StaticWallpaperGuardProviderProps) {
  const [open, setOpen] = useState(false);
  const [pendingTask, setPendingTask] = useState<PendingStaticWallpaper | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const openRef = useRef(false);

  const refreshPending = async () => {
    if (openRef.current || resolverRef.current) return;
    try {
      const task = await getPendingStaticWallpaper();
      if (!task) return;
      setPendingTask(task);
      setError('');
      openRef.current = true;
      setOpen(true);
    } catch {
      // The next focus/visibility event retries without interrupting the user.
    }
  };

  useEffect(() => {
    const unregister = registerStaticWallpaperConfirmationHandler(() => new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPendingTask(null);
      setError('');
      openRef.current = true;
      setOpen(true);
    }));
    const handleFocus = () => void refreshPending();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshPending();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    void refreshPending();

    return () => {
      unregister();
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      resolverRef.current?.(false);
      resolverRef.current = null;
    };
  }, []);

  const closeLocalConfirmation = (confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    openRef.current = false;
    setOpen(false);
    resolve?.(confirmed);
  };

  const resolveConfirmation = async (confirmed: boolean) => {
    if (!pendingTask) {
      closeLocalConfirmation(confirmed);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await resolvePendingStaticWallpaper(pendingTask.id, confirmed);
      if (!result.success) throw new Error(result.error || '处理待确认壁纸失败');
      setPendingTask(null);
      openRef.current = false;
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {children}
      <AlertDialog.Backdrop
        isOpen={open}
        onOpenChange={(next) => {
          if (!next && !submitting) void resolveConfirmation(false);
        }}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning"><MonitorOff size={20} /></AlertDialog.Icon>
              <AlertDialog.Heading>停止动态壁纸？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>动态壁纸正在运行。设置静态壁纸将停止播放，并释放动态壁纸占用的媒体资源。</p>
              {pendingTask && <p className="mt-2 text-sm text-muted">待设置：{pendingTask.name}</p>}
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="tertiary" isDisabled={submitting} onPress={() => void resolveConfirmation(false)}>取消</Button>
              <Button isPending={submitting} onPress={() => void resolveConfirmation(true)}>
                {submitting && <Spinner size="sm" color="current" />}
                停止并设置
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}
