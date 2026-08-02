import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { Copy, Minus, Square, X } from 'lucide-react';

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

const RESIZE_REGIONS = [
  ['north', 'inset-x-1 top-0 h-1 cursor-n-resize'],
  ['south', 'inset-x-1 bottom-0 h-1 cursor-s-resize'],
  ['west', 'inset-y-1 left-0 w-1 cursor-w-resize'],
  ['east', 'inset-y-1 right-0 w-1 cursor-e-resize'],
  ['north-west', 'left-0 top-0 size-2 cursor-nw-resize'],
  ['north-east', 'right-0 top-0 size-2 cursor-ne-resize'],
  ['south-west', 'bottom-0 left-0 size-2 cursor-sw-resize'],
  ['south-east', 'bottom-0 right-0 size-2 cursor-se-resize'],
] as const;

function invoke(action: keyof LumiViewWindowControls) {
  const controls = window.lumiview?.window;
  if (!controls) return;
  void controls[action]().catch(() => undefined);
}

export default function WindowTitleBar({ title = '小树壁纸 Next' }: { title?: string }) {
  const [maximized, setMaximized] = useState(false);

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
    <>
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
      </header>
      {RESIZE_REGIONS.map(([direction, className]) => (
        <div
          key={direction}
          data-lumiview-resize-region={direction}
          className={`fixed z-[110] ${className}`}
        />
      ))}
    </>
  );
}
