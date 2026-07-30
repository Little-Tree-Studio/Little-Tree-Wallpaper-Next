import { useState } from 'react';
import { Button, Spinner, toast } from '@heroui/react';
import { Puzzle } from 'lucide-react';
import type { BoundPluginContribution, PluginButtonContribution } from '@/types';
import PluginRenderer, { safePluginClassName } from './PluginRenderer';
import { usePlugins } from './context';

const overlayPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

function lockOverlayStack(element: HTMLElement | null, position: string): void {
  if (!element) return;
  const mobile = window.matchMedia('(max-width: 640px)').matches;
  const left = mobile ? '4.75rem' : '5rem';
  const edge = mobile ? '0.75rem' : '1rem';
  const values: Record<string, string> = {
    position: 'fixed',
    'z-index': '1100',
    width: mobile ? 'min(20rem, calc(100vw - 5.75rem))' : 'min(22rem, calc(100vw - 2rem))',
    'max-height': mobile ? 'calc(100vh - 1.5rem)' : 'calc(100vh - 2rem)',
    margin: '0',
    transform: 'none',
    translate: 'none',
    top: position.startsWith('top') ? edge : 'auto',
    right: position.endsWith('right') ? edge : 'auto',
    bottom: position.startsWith('bottom') ? '4.75rem' : 'auto',
    left: position.endsWith('left') ? left : 'auto',
  };
  for (const [name, value] of Object.entries(values)) element.style.setProperty(name, value, 'important');
}

function lockOverlay(element: HTMLElement | null): void {
  if (!element) return;
  for (const [name, value] of Object.entries({
    position: 'static',
    inset: 'auto',
    margin: '0',
    transform: 'none',
    translate: 'none',
    width: '100%',
    'max-height': 'none',
  })) element.style.setProperty(name, value, 'important');
}

function GlobalButton({ contribution }: {
  contribution: BoundPluginContribution<PluginButtonContribution>;
}) {
  const { invoke } = usePlugins();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    try {
      const result = await invoke(contribution.pluginId, contribution.action, contribution.payload);
      if (result.error || result.status === 'error') throw new Error(result.error || '插件动作执行失败');
      const description = result.result === undefined ? result.status : JSON.stringify(result.result).slice(0, 160);
      toast.success(contribution.label, { description, timeout: 3500 });
    } catch (error) {
      toast.danger(`${contribution.label}失败`, {
        description: error instanceof Error ? error.message : '插件动作执行失败',
        timeout: 0,
      });
    } finally {
      setPending(false);
    }
  };
  return (
    <div data-plugin-id={contribution.pluginId}>
      <Button size="sm" variant="secondary" isPending={pending} onPress={run}>
        {pending ? <Spinner color="current" size="sm" /> : <Puzzle size={15} />}
        {contribution.label}
      </Button>
    </div>
  );
}

export default function PluginGlobalUI() {
  const { contributions } = usePlugins();
  const buttons = contributions.buttons.filter((button) => !button.location || button.location === 'global');
  const overlays = contributions.overlays.map((overlay) => ({
    ...overlay,
    hostPosition: overlayPositions.includes(overlay.position as typeof overlayPositions[number])
      ? overlay.position as typeof overlayPositions[number]
      : 'bottom-right' as const,
  }));
  return (
    <>
      {buttons.length > 0 && (
        <div className="plugin-global-toolbar" role="toolbar" aria-label="插件快捷操作">
          {buttons.map((button) => <GlobalButton key={`${button.pluginId}:${button.id}`} contribution={button} />)}
        </div>
      )}
      {overlayPositions.map((position) => {
        const positioned = overlays.filter((overlay) => overlay.hostPosition === position);
        if (!positioned.length) return null;
        return (
          <div
            key={position}
            className="plugin-overlay-stack"
            data-position={position}
            ref={(element) => lockOverlayStack(element, position)}
          >
            {positioned.map((overlay) => (
              <aside
                key={`${overlay.pluginId}:${overlay.id}`}
                data-plugin-id={overlay.pluginId}
                className={`plugin-overlay ${safePluginClassName(overlay.className)}`}
                aria-label={overlay.label}
                ref={lockOverlay}
              >
                <PluginRenderer
                  pluginId={overlay.pluginId}
                  pluginName={overlay.plugin.name}
                  packageHash={overlay.packageHash}
                  blocks={overlay.blocks}
                />
              </aside>
            ))}
          </div>
        );
      })}
    </>
  );
}
