import { useEffect, useState } from 'react';
import { Button, Modal, Spinner, toast } from '@heroui/react';
import { AlertTriangle, Swords } from 'lucide-react';
import {
  terminateWallpaperConflicts,
  type WallpaperConflictStatus,
} from '@/api/backend';
import { logError } from '@/lib/log';

export interface ConflictWarningModalProps {
  /** Latest detection snapshot; the modal re-renders as it changes. */
  status: WallpaperConflictStatus;
  /** Whether the warning modal is currently shown. */
  isOpen: boolean;
  /** Called when the user closes the modal without terminating anything. */
  onIgnore: () => void;
  /** Called after a terminate attempt so the parent can refresh its state. */
  onTerminated: () => void;
}

/**
 * Startup warning shown when a competing wallpaper application (Wallpaper
 * Engine) is running. The user can close the other application's processes
 * directly from here, or ignore the warning — in which case the title-bar
 * conflict indicator keeps pointing at this dialog.
 */
export default function ConflictWarningModal({
  status,
  isOpen,
  onIgnore,
  onTerminated,
}: ConflictWarningModalProps) {
  const [terminating, setTerminating] = useState(false);

  useEffect(() => {
    if (!isOpen) setTerminating(false);
  }, [isOpen]);

  const handleTerminate = async () => {
    setTerminating(true);
    try {
      const result = await terminateWallpaperConflicts();
      onTerminated();
      if (result.remaining.length === 0) {
        toast.success(`已结束${status.app_label}的进程`, { timeout: 3000 });
        onIgnore();
      } else {
        toast.danger(`部分进程未能关闭（${result.failed.map((p) => p.name).join('、')}）`, {
          description: '请手动退出该软件后重试，或重启电脑后再启动小树壁纸。',
          timeout: 0,
        });
      }
    } catch (e) {
      logError('terminateWallpaperConflicts failed', e);
      toast.danger('结束进程失败', {
        description: e instanceof Error ? e.message : '请手动退出该软件后重试。',
        timeout: 0,
      });
    } finally {
      setTerminating(false);
    }
  };

  return (
    <Modal.Backdrop
      isOpen={isOpen && status.detected}
      onOpenChange={(next) => {
        if (!next && !terminating) onIgnore();
      }}
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-md">
          <Modal.Header>
            <Modal.Icon className="bg-warning-soft text-warning-soft-foreground">
              <AlertTriangle className="size-5" />
            </Modal.Icon>
            <Modal.Heading>检测到同类软件</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="flex items-start gap-3">
              <Swords className="mt-0.5 size-5 shrink-0 text-warning" />
              <div className="space-y-2 text-sm leading-6 text-foreground">
                <p>
                  检测到正在运行同类壁纸软件——<strong className="font-semibold">{status.app_label}</strong>
                  （{status.processes.map((p) => p.name).join('、')}）。
                </p>
                <p className="text-muted">{status.description}</p>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" isDisabled={terminating} onPress={onIgnore}>
              暂不处理
            </Button>
            <Button variant="danger" isPending={terminating} onPress={() => void handleTerminate()}>
              {terminating ? <Spinner color="current" size="sm" /> : null}
              结束其进程并继续
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
