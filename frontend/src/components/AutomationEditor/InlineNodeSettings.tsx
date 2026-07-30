import { Button, Separator } from '@heroui/react';
import { FolderOpen } from 'lucide-react';
import { selectAutomationDirectory, selectAutomationLocalImage, selectDynamicWallpaperMedia } from '@/api/backend';
import type { AutomationSettingDescriptor } from './types';

interface InlineNodeSettingsProps {
  settings: AutomationSettingDescriptor[];
  connectedPorts: Set<string>;
  linking: boolean;
  allowConnections?: boolean;
  onChange: (pointer: string, value: unknown) => void;
  onConnectInput: (event: React.PointerEvent, pointer: string) => void;
  onDisconnectInput: (pointer: string) => void;
}

export default function InlineNodeSettings({
  settings,
  connectedPorts,
  linking,
  allowConnections = true,
  onChange,
  onConnectInput,
  onDisconnectInput,
}: InlineNodeSettingsProps) {
  return (
    <div className="mt-2 w-full space-y-1.5" data-node-control>
      {settings.map((setting, index) => {
        const connected = allowConnections && connectedPorts.has(setting.pointer);
        const caseId = setting.pointer.match(/^\/cases\/([^/]+)\//)?.[1];
        const previousCaseId = settings[index - 1]?.pointer.match(/^\/cases\/([^/]+)\//)?.[1];
        const startsNewCase = Boolean(caseId && previousCaseId && caseId !== previousCaseId);
        return (
          <div key={setting.pointer} className="relative flex h-8 items-center gap-2 rounded-lg bg-surface-secondary px-2">
            {startsNewCase && <Separator variant="tertiary" className="absolute -top-1 left-0 right-0" />}
            {allowConnections && (
              <button
                type="button"
                data-port="setting-input"
                aria-label={`连接到设置：${setting.label}`}
                title="拖入值覆盖此设置；Alt 点击解除连接"
                className={`automation-port automation-port--setting absolute -left-4 top-1/2 -translate-x-1/2 -translate-y-1/2 ${linking ? 'automation-port--ready' : ''} ${connected ? 'automation-port--connected' : ''}`}
                onPointerUp={(event) => onConnectInput(event, setting.pointer)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (!event.altKey) return;
                  event.preventDefault();
                  onDisconnectInput(setting.pointer);
                }}
              />
            )}
            <span className="w-16 shrink-0 truncate text-[10px] font-medium text-muted">{setting.label}</span>
            {setting.kind === 'select' && (
              <select
                aria-label={setting.label}
                className="h-6 min-w-0 flex-1 rounded-md border border-border bg-surface px-1 text-[10px] text-foreground outline-none focus:border-primary"
                value={String(setting.value ?? '')}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => onChange(setting.pointer, event.target.value)}
              >
                {(setting.options || []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            )}
            {setting.kind === 'boolean' && (
              <input
                aria-label={setting.label}
                type="checkbox"
                checked={Boolean(setting.value)}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => onChange(setting.pointer, event.target.checked)}
              />
            )}
            {(setting.kind === 'text' || setting.kind === 'number') && (
              <input
                aria-label={setting.label}
                type={setting.kind === 'number' ? 'number' : 'text'}
                className="h-6 min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 text-[10px] text-foreground outline-none focus:border-primary"
                value={String(setting.value ?? '')}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => onChange(setting.pointer, setting.kind === 'number' ? Number(event.target.value) : event.target.value)}
              />
            )}
            {(setting.kind === 'path' || setting.kind === 'directory' || setting.kind === 'video') && (
              <>
                <span className="min-w-0 flex-1 truncate text-[10px] text-foreground">{String(setting.value || '未选择')}</span>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="size-6 min-w-6"
                  aria-label={`选择${setting.label}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPress={async () => {
                    const path = setting.kind === 'directory'
                      ? await selectAutomationDirectory()
                      : setting.kind === 'video'
                        ? await selectDynamicWallpaperMedia()
                        : await selectAutomationLocalImage();
                    if (path) onChange(setting.pointer, path);
                  }}
                >
                  <FolderOpen size={12} />
                </Button>
              </>
            )}
            {connected && <span className="absolute right-1 top-0 size-1.5 rounded-full bg-primary" title="运行时由连接值覆盖" />}
          </div>
        );
      })}
    </div>
  );
}
