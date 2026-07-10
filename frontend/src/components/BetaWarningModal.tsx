import { useEffect, useState } from 'react';
import { Modal, Button } from '@heroui/react';
import { AlertTriangle, Sprout } from 'lucide-react';

const COUNTDOWN_SECONDS = 5;

export interface BetaWarningModalProps {
  /** Application version shown in the warning copy. */
  version: string;
  /** Called when the user dismisses the warning (or the countdown ends). */
  onDismiss: () => void;
}

/**
 * Full-screen modal that warns the user this build is not a final release.
 *
 * The "I understand" button is disabled for the first ``COUNTDOWN_SECONDS``
 * seconds to force the user to actually read the message; once the countdown
 * reaches zero the button activates. Backdrop click and ESC are both
 * disabled for the same reason — there is no way to skip the warning.
 */
export default function BetaWarningModal({ version, onDismiss }: BetaWarningModalProps) {
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [secondsLeft]);

  const handleDismiss = () => {
    setOpen(false);
    onDismiss();
  };

  const buttonLabel = secondsLeft > 0 ? `我已知晓 (${secondsLeft})` : '我已知晓，继续';

  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) handleDismiss();
      }}
      isDismissable={false}
      isKeyboardDismissDisabled
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-md">
          <Modal.Header>
            <Modal.Icon className="bg-warning-soft text-warning-soft-foreground">
              <AlertTriangle className="size-5" />
            </Modal.Icon>
            <Modal.Heading>测试版提醒</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="flex items-start gap-3">
              <Sprout className="mt-0.5 size-5 shrink-0 text-primary" />
              <p className="text-sm leading-6 text-foreground">
                你正在使用的是 <strong className="font-semibold">测试版</strong>（v{version}），
                尚非最终发布版本。可能存在未修复的 bug、数据丢失或功能不稳定的情况。
                请勿在生产环境或重要场景中依赖此版本。
              </p>
            </div>
            <p className="mt-4 text-xs text-muted">
              为确保你已阅读以上说明，关闭按钮将在 {COUNTDOWN_SECONDS} 秒后启用。
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button
              className="w-full"
              isDisabled={secondsLeft > 0}
              onPress={handleDismiss}
            >
              {buttonLabel}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
