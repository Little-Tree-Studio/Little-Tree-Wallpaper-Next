import { Button, Card, Description, Input, Label, ListBox, Select, Switch, TextField } from '@heroui/react';
import { Clock3, FolderOpen, Image, MonitorUp, RefreshCw } from 'lucide-react';
import { selectAutomationDirectory, selectAutomationLocalImage } from '@/api/backend';
import type { AutomationDocument, SimpleAutomationSettings } from './types';
import { DEFAULT_SIMPLE_SETTINGS, applySimpleSettings } from './types';

interface SimpleAutomationEditorProps {
  document: AutomationDocument;
  onChange: (document: AutomationDocument) => void;
}

const TRIGGERS = [
  { id: 'interval', label: '每隔一段时间', description: '适合持续轮换壁纸', icon: RefreshCw },
  { id: 'schedule', label: '每天固定时间', description: '每天在指定时间执行', icon: Clock3 },
  { id: 'startup', label: '打开应用时', description: '每次启动小树壁纸时执行', icon: MonitorUp },
] as const;

const SOURCES = [
  { id: 'folder', label: '本地文件夹', description: '随机轮换文件夹中的图片' },
  { id: 'file', label: '一张本地图片', description: '每次使用指定图片' },
  { id: 'resource', label: '在线壁纸', description: '自动获取新的在线壁纸' },
] as const;

export default function SimpleAutomationEditor({ document, onChange }: SimpleAutomationEditorProps) {
  const settings = document.simple || DEFAULT_SIMPLE_SETTINGS;
  const change = (patch: Partial<SimpleAutomationSettings>) => onChange(applySimpleSettings(document, { ...settings, ...patch }));
  const triggerLabel = TRIGGERS.find((item) => item.id === settings.trigger)?.label || '';
  const sourceLabel = SOURCES.find((item) => item.id === settings.source)?.label || '';

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background p-5 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <p className="text-lg font-semibold">创建一个自动换壁纸任务</p>
          <p className="mt-1 text-sm text-muted">只需选择什么时候更换、从哪里取壁纸。保存并启用后，应用会在后台自动执行。</p>
        </div>

        <Card>
          <Card.Header><Card.Title>1. 什么时候更换？</Card.Title><Card.Description>选择最符合使用习惯的执行方式</Card.Description></Card.Header>
          <Card.Content className="grid gap-3 sm:grid-cols-3">
            {TRIGGERS.map(({ id, label, description, icon: Icon }) => (
              <Button key={id} variant={settings.trigger === id ? 'secondary' : 'outline'} className="h-auto justify-start p-4 text-left" onPress={() => change({ trigger: id })}>
                <Icon size={18} className="shrink-0" />
                <span><span className="block font-medium">{label}</span><span className="block text-xs font-normal text-muted">{description}</span></span>
              </Button>
            ))}
          </Card.Content>
          {settings.trigger !== 'startup' && <Card.Footer className="flex-wrap items-end gap-3">
            {settings.trigger === 'interval' ? <>
              <TextField className="w-32" value={String(settings.interval)} onChange={(value) => change({ interval: Math.max(1, Number(value) || 1) })}>
                <Label>间隔</Label><Input type="number" min="1" />
              </TextField>
              <Select aria-label="间隔单位" className="w-32" value={settings.intervalUnit} onChange={(key) => change({ intervalUnit: String(key) as SimpleAutomationSettings['intervalUnit'] })}>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>
                  <ListBox.Item id="minutes" textValue="分钟">分钟</ListBox.Item>
                  <ListBox.Item id="hours" textValue="小时">小时</ListBox.Item>
                  <ListBox.Item id="days" textValue="天">天</ListBox.Item>
                </ListBox></Select.Popover>
              </Select>
            </> : <TextField className="w-48" value={settings.scheduleTime} onChange={(value) => change({ scheduleTime: String(value) })}>
              <Label>每天执行时间</Label><Input type="time" /><Description>使用系统本地时间</Description>
            </TextField>}
          </Card.Footer>}
        </Card>

        <Card>
          <Card.Header><Card.Title>2. 壁纸从哪里来？</Card.Title><Card.Description>任务每次执行时会从这里选择壁纸</Card.Description></Card.Header>
          <Card.Content className="grid gap-3 sm:grid-cols-3">
            {SOURCES.map(({ id, label, description }) => (
              <Button key={id} variant={settings.source === id ? 'secondary' : 'outline'} className="h-auto justify-start p-4 text-left" onPress={() => change({ source: id, path: '' })}>
                {id === 'folder' ? <FolderOpen size={18} /> : <Image size={18} />}
                <span><span className="block font-medium">{label}</span><span className="block text-xs font-normal text-muted">{description}</span></span>
              </Button>
            ))}
          </Card.Content>
          <Card.Footer className="flex-wrap gap-3">
            {settings.source === 'resource' ? <Select className="w-60" value={settings.resource} onChange={(key) => change({ resource: String(key) as SimpleAutomationSettings['resource'] })}>
              <Label>在线壁纸来源</Label>
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover><ListBox>
                <ListBox.Item id="bing" textValue="Bing 每日壁纸">Bing 每日壁纸</ListBox.Item>
                <ListBox.Item id="spotlight" textValue="Windows 聚焦">Windows 聚焦</ListBox.Item>
                <ListBox.Item id="cnu" textValue="CNU 精选">CNU 精选</ListBox.Item>
                <ListBox.Item id="pixiv" textValue="Pixiv 日榜">Pixiv 日榜</ListBox.Item>
              </ListBox></Select.Popover>
            </Select> : <>
              <Button variant="secondary" onPress={async () => {
                const path = settings.source === 'folder' ? await selectAutomationDirectory() : await selectAutomationLocalImage();
                if (path) change({ path });
              }}><FolderOpen size={15} />选择{settings.source === 'folder' ? '文件夹' : '图片'}</Button>
              <span className="min-w-0 flex-1 truncate text-sm text-muted">{settings.path || '尚未选择'}</span>
              {settings.source === 'folder' && <Switch isSelected={settings.recursive} onChange={(recursive) => change({ recursive })}>
                <Switch.Control><Switch.Thumb /></Switch.Control><Switch.Content>包含子文件夹</Switch.Content>
              </Switch>}
            </>}
          </Card.Footer>
        </Card>

        <Card variant="secondary" className="sm:flex-row sm:items-center">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground"><RefreshCw size={20} /></div>
          <Card.Header className="flex-1">
            <Card.Title>任务摘要</Card.Title>
            <Card.Description>{triggerLabel}，使用{sourceLabel}更换桌面壁纸。三个模式中的任务可以分别启用并同时生效。</Card.Description>
          </Card.Header>
        </Card>
      </div>
    </div>
  );
}
