import { useEffect, useState } from 'react';
import { Button, Modal, Tooltip } from '@heroui/react';
import { AlertTriangle, Copy, Download, Minus, Square, X } from 'lucide-react';
import type { UpdateCheckResult } from '@/api/backend';
import { TEST_UPDATE_DETECTED_EVENT, openUrl } from '@/api/backend';
import { useNavigate } from '@/lib/router';

interface LumiViewWindowControls {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<boolean>;
  isMaximized: () => Promise<boolean>;
  close: () => Promise<void>;
}

declare global {
  interface Window {
    lumiview?: {
      window?: LumiViewWindowControls;
      windowTheme?: {
        setAcrylic: (enabled: boolean, dark: boolean) => Promise<boolean>;
      };
    };
  }
}

function invoke(action: keyof LumiViewWindowControls) {
  const controls = window.lumiview?.window;
  if (!controls) return;
  void controls[action]().catch(() => undefined);
}

export default function WindowTitleBar({
  title = '小树壁纸 Next',
  conflictDetected = false,
  onConflictClick,
}: {
  title?: string;
  /** True while a competing wallpaper application is still running. */
  conflictDetected?: boolean;
  /** Opens the conflict warning dialog again. */
  onConflictClick?: () => void;
}) {
  const navigate = useNavigate();
  const [maximized, setMaximized] = useState(false);
  const [normalUpdate, setNormalUpdate] = useState<UpdateCheckResult | null>(null);
  const [normalUpdateOpen, setNormalUpdateOpen] = useState(false);

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const update = (event as CustomEvent<UpdateCheckResult>).detail;
      if (update?.has_update) setNormalUpdate(update);
    };
    window.addEventListener(TEST_UPDATE_DETECTED_EVENT, handleUpdate);
    window.addEventListener('ltw:forced-update-detected', handleUpdate);
    return () => {
      window.removeEventListener(TEST_UPDATE_DETECTED_EVENT, handleUpdate);
      window.removeEventListener('ltw:forced-update-detected', handleUpdate);
    };
  }, []);

  useEffect(() => {
    const syncMaximized = () => {
      const controls = window.lumiview?.window;
      if (!controls) return;
      void controls.isMaximized().then(setMaximized).catch(() => undefined);
    };
    syncMaximized();
    window.addEventListener('resize', syncMaximized);
    return () => window.removeEventListener('resize', syncMaximized);
  }, []);

  const toggleMaximize = () => {
    const controls = window.lumiview?.window;
    if (!controls) return;
    void controls.toggleMaximize().then(setMaximized).catch(() => undefined);
  };

  return (
    <header
      data-lumiview-drag-region
      className="theme-navigation-chrome relative z-[100] flex h-11 shrink-0 select-none items-center text-foreground"
    >
      <div data-lumiview-drag-region className="flex h-full w-14 shrink-0 items-center justify-center">
        <img src="./logo.png" alt="" className="size-[30px] rounded-md object-cover" draggable={false} />
      </div>
      <div data-lumiview-drag-region className="flex h-full min-w-0 flex-1 items-center px-3">
        <span className="truncate text-xs font-medium">{title}</span>
      </div>
      {conflictDetected && (
        <div data-lumiview-no-drag className="flex h-full shrink-0 items-center">
          <Tooltip delay={0}>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 rounded-md text-warning"
              onPress={onConflictClick}
            >
              <AlertTriangle size={14} />
              <span className="text-xs font-medium">检测到冲突</span>
            </Button>
            <Tooltip.Content>检测到同类壁纸软件正在运行，点击查看</Tooltip.Content>
          </Tooltip>
        </div>
      )}
      {normalUpdate && (
        <div data-lumiview-no-drag className="flex h-full shrink-0 items-center">
          <Tooltip delay={0}>
            <Button
              size="sm"
              variant="ghost"
              className={`h-7 gap-1.5 rounded-md ${normalUpdate.force_update ? 'text-danger' : 'text-primary'}`}
              onPress={() => setNormalUpdateOpen(true)}
            >
              <Download size={14} />
              <span className="text-xs font-medium">{normalUpdate.force_update ? '必须更新' : '发现新版本'} v{normalUpdate.latest_version}</span>
            </Button>
            <Tooltip.Content>{normalUpdate.force_update ? '发现强制更新，点击查看详情' : '发现普通更新，点击查看详情'}</Tooltip.Content>
          </Tooltip>
        </div>
      )}
      <div data-lumiview-no-drag className="flex h-full items-stretch">
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label="最小化窗口"
          className="window-control h-full w-11 rounded-none"
          onPress={() => invoke('minimize')}
        >
          <span className="window-control-icon window-control-icon--minimize"><Minus size={15} /></span>
        </Button>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={maximized ? '还原窗口' : '最大化窗口'}
          className="window-control h-full w-11 rounded-none"
          onPress={toggleMaximize}
        >
          {maximized
            ? <span className="window-control-icon window-control-icon--restore"><Copy size={8} strokeWidth={1.4} /></span>
            : <span className="window-control-icon window-control-icon--maximize"><Square size={6} strokeWidth={1.4} /></span>}
        </Button>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label="关闭窗口"
          className="window-control--close h-full w-11 rounded-none hover:bg-danger hover:text-danger-foreground"
          onPress={() => invoke('close')}
        >
          <span className="window-control-icon window-control-icon--close"><X size={16} /></span>
        </Button>
      </div>
      <Modal.Backdrop isOpen={normalUpdateOpen} onOpenChange={setNormalUpdateOpen}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>发现新版本 v{normalUpdate?.latest_version}</Modal.Heading>
              <p className="text-sm text-muted">当前版本 v{normalUpdate?.current_version} · {normalUpdate?.release_date || '暂无发布日期'}</p>
            </Modal.Header>
            <Modal.Body className="max-h-[60vh] overflow-y-auto">
              <div className="rounded-lg bg-surface-secondary p-4 text-sm leading-6 whitespace-pre-wrap">
                {normalUpdate?.release_note?.trim() || '此版本未提供更新说明。'}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setNormalUpdateOpen(false)}>稍后再看</Button>
              {normalUpdate?.has_update && (
                <Button
                  onPress={() => {
                    setNormalUpdateOpen(false);
                    navigate('/settings/updates');
                  }}
                >
                  前往安装
                </Button>
              )}
              {normalUpdate?.release_notes_url && (
                <Button variant="secondary" onPress={() => void openUrl(normalUpdate.release_notes_url)}>
                  查看发布页面
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </header>
  );
}
