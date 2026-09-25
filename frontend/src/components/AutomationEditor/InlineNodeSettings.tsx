import { Button, Checkbox, Input, ListBox, Select, Separator, TextField } from '@heroui/react';
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
              <Select
                aria-label={setting.label}
                variant="secondary"
                className="min-w-0 flex-1"
                placeholder="请选择"
                value={String(setting.value ?? '')}
                onChange={(key) => onChange(setting.pointer, String(key ?? ''))}
              >
                <Select.Trigger
                  className="h-6 min-h-6 gap-1 rounded-md px-1.5 text-[10px]"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <Select.Value className="text-[10px]" />
                  <Select.Indicator className="size-3" />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {(setting.options || []).map((option) => (
                      <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                        {option.label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )}
            {setting.kind === 'boolean' && (
              <Checkbox
                aria-label={setting.label}
                variant="secondary"
                className="[&_[data-slot='checkbox-default-indicator--checkmark']]:size-2"
                isSelected={Boolean(setting.value)}
                onChange={(selected) => onChange(setting.pointer, selected)}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Checkbox.Content>
                  <Checkbox.Control className="size-3.5 rounded-sm before:rounded-[3px]">
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                </Checkbox.Content>
              </Checkbox>
            )}
            {(setting.kind === 'text' || setting.kind === 'number') && (
              <TextField
                className="min-w-0 flex-1"
                value={String(setting.value ?? '')}
                onChange={(value) => onChange(setting.pointer, setting.kind === 'number' ? Number(value) : value)}
              >
                <Input
                  aria-label={setting.label}
                  type={setting.kind === 'number' ? 'number' : 'text'}
                  variant="secondary"
                  className="h-6 min-h-6 rounded-md px-1.5 text-[10px]"
                  onPointerDown={(event) => event.stopPropagation()}
                />
              </TextField>
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
