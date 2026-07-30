import { Accordion, Button, Card, Chip, Label, ListBox, ScrollShadow, Select, Tooltip } from '@heroui/react';
import { ArrowDown, ArrowUp, Blocks, ChevronDown, Clock3, Copy, FolderCog, Image, MonitorCog, Plus, Trash2, Variable } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import InlineNodeSettings from './InlineNodeSettings';
import { NODE_META, createNodeConfig, getNodeSettings, setNodeConfigValue } from './types';
import type { AutomationDocument, AutomationNode, AutomationNodeType, AutomationResourceCatalogView } from './types';

interface BlocksAutomationEditorProps {
  document: AutomationDocument;
  resourceCatalog?: AutomationResourceCatalogView | null;
  runningNodeId?: string;
  onChange: (document: AutomationDocument) => void;
}

interface BlockCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  items: AutomationNodeType[];
  dangerous?: boolean;
}

const BLOCK_CATEGORIES: BlockCategory[] = [
  { id: 'wallpaper', label: '壁纸', icon: Image, items: ['fetch_resource', 'local_file', 'set_wallpaper', 'dynamic_wallpaper'] },
  { id: 'data', label: '数据与计算', icon: Variable, items: ['set_variable', 'calculate', 'function', 'datetime'] },
  { id: 'flow', label: '流程与反馈', icon: Clock3, items: ['wait', 'notification', 'log', 'open_target'] },
  { id: 'files', label: '文件与文件夹', icon: FolderCog, items: ['data_directory', 'list_directory', 'read_file', 'write_file'] },
  { id: 'system', label: '高级系统操作', icon: MonitorCog, items: ['command', 'delete_file', 'system_action'], dangerous: true },
];

function rebuild(document: AutomationDocument, nodes: AutomationNode[]): AutomationDocument {
  return {
    ...document,
    automation_type: 'blocks',
    nodes: nodes.map((node, index) => ({ ...node, x: 120, y: 80 + index * 150 })),
    edges: nodes.slice(0, -1).map((node, index) => ({ id: `${document.id}-block-edge-${index}`, source: node.id, target: nodes[index + 1].id })),
    annotations: [],
  };
}

export default function BlocksAutomationEditor({ document, resourceCatalog, runningNodeId, onChange }: BlocksAutomationEditorProps) {
  const [trigger, ...rest] = document.nodes;
  const stop = rest.find((node) => node.type === 'stop');
  const actions = rest.filter((node) => node.type !== 'stop');
  const ordered = [trigger, ...actions, stop].filter(Boolean) as AutomationNode[];

  const updateNode = (id: string, config: Record<string, unknown>) => onChange(rebuild(document, ordered.map((node) => node.id === id ? { ...node, config } : node)));
  const move = (id: string, offset: number) => {
    const index = actions.findIndex((node) => node.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= actions.length) return;
    const next = [...actions];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(rebuild(document, [trigger, ...next, stop].filter(Boolean) as AutomationNode[]));
  };
  const add = (type: AutomationNodeType) => {
    const node: AutomationNode = { id: crypto.randomUUID(), type, x: 120, y: 0, config: createNodeConfig(type) };
    onChange(rebuild(document, [trigger, ...actions, node, stop].filter(Boolean) as AutomationNode[]));
  };
  const duplicate = (id: string) => {
    const index = actions.findIndex((node) => node.id === id);
    if (index < 0) return;
    const copy = { ...actions[index], id: crypto.randomUUID(), config: structuredClone(actions[index].config) };
    const next = [...actions];
    next.splice(index + 1, 0, copy);
    onChange(rebuild(document, [trigger, ...next, stop].filter(Boolean) as AutomationNode[]));
  };

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border p-4">
        <div className="mb-4 flex items-center gap-2"><Blocks size={18} className="text-primary" /><div><p className="text-sm font-semibold">积木库</p><p className="text-xs text-muted">点击添加到流程末尾</p></div></div>
        <ScrollShadow hideScrollBar className="min-h-0 flex-1">
          <Accordion allowsMultipleExpanded defaultExpandedKeys={['wallpaper', 'flow']} variant="surface" className="w-full">
            {BLOCK_CATEGORIES.map(({ id, label, icon: Icon, items, dangerous }) => (
              <Accordion.Item key={id} id={id}>
                <Accordion.Heading>
                  <Accordion.Trigger className="px-3">
                    <Icon size={15} className={dangerous ? 'text-danger' : 'text-muted'} />
                    <span className="flex-1 text-left text-sm">{label}</span>
                    {dangerous && <Chip size="sm" color="danger" variant="soft">谨慎</Chip>}
                    <Accordion.Indicator><ChevronDown size={14} /></Accordion.Indicator>
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel>
                  <Accordion.Body className="space-y-1 px-2 py-2">
                    {items.map((type) => <Button key={type} fullWidth size="sm" variant="ghost" className="h-auto justify-start px-2 py-2 text-left" onPress={() => add(type)}>
                      <Plus size={13} className="shrink-0" />
                      <span><span className="block text-xs font-medium">{NODE_META[type].label}</span><span className="block text-[10px] font-normal text-muted">{NODE_META[type].description}</span></span>
                    </Button>)}
                  </Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </ScrollShadow>
        <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted">积木从上到下依次执行。高级系统操作可能修改文件、运行程序或改变系统状态，请确认参数后再启用。</p>
      </aside>
      <ScrollShadow hideScrollBar className="min-w-0 flex-1 p-5 sm:p-8">
        <div className="mx-auto max-w-2xl space-y-0">
          {ordered.map((node, index) => {
            const fixed = node.type === 'trigger' || node.type === 'stop';
            const actionIndex = actions.findIndex((item) => item.id === node.id);
            const settings = getNodeSettings(node, resourceCatalog || undefined);
            return <div key={node.id} className="relative pb-5">
              {index < ordered.length - 1 && <div className="absolute bottom-0 left-8 top-10 w-0.5 bg-border" />}
              <Card variant={runningNodeId === node.id ? 'tertiary' : fixed ? 'secondary' : 'default'} className="relative z-10">
                <Card.Header className="flex-row items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-sm font-semibold text-accent-soft-foreground">{index + 1}</div>
                  <div className="min-w-0 flex-1"><Card.Title>{NODE_META[node.type].label}</Card.Title><Card.Description>{NODE_META[node.type].description}</Card.Description></div>
                  {!fixed && <div className="flex gap-1">
                    <Tooltip><Button isIconOnly size="sm" variant="ghost" aria-label="复制积木" onPress={() => duplicate(node.id)}><Copy size={14} /></Button><Tooltip.Content>复制到下方</Tooltip.Content></Tooltip>
                    <Tooltip><Button isIconOnly size="sm" variant="ghost" aria-label="上移积木" isDisabled={actionIndex <= 0} onPress={() => move(node.id, -1)}><ArrowUp size={14} /></Button><Tooltip.Content>上移</Tooltip.Content></Tooltip>
                    <Tooltip><Button isIconOnly size="sm" variant="ghost" aria-label="下移积木" isDisabled={actionIndex < 0 || actionIndex >= actions.length - 1} onPress={() => move(node.id, 1)}><ArrowDown size={14} /></Button><Tooltip.Content>下移</Tooltip.Content></Tooltip>
                    <Tooltip><Button isIconOnly size="sm" variant="danger-soft" aria-label="删除积木" onPress={() => onChange(rebuild(document, ordered.filter((item) => item.id !== node.id)))}><Trash2 size={14} /></Button><Tooltip.Content>删除</Tooltip.Content></Tooltip>
                  </div>}
                </Card.Header>
                {node.type === 'trigger' && <Card.Content>
                  <Select value={String(node.config.kind || 'manual')} onChange={(key) => {
                    const kind = String(key);
                    updateNode(node.id, { kind, ...(kind === 'interval' ? { seconds: 1800 } : {}), ...(kind === 'schedule' ? { time: '08:00' } : {}) });
                  }}>
                    <Label>启动方式</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                    <Select.Popover><ListBox>
                      <ListBox.Item id="manual" textValue="手动运行">手动运行</ListBox.Item>
                      <ListBox.Item id="startup" textValue="应用启动时">应用启动时</ListBox.Item>
                      <ListBox.Item id="interval" textValue="固定间隔">固定间隔</ListBox.Item>
                      <ListBox.Item id="schedule" textValue="每天定时">每天定时</ListBox.Item>
                    </ListBox></Select.Popover>
                  </Select>
                </Card.Content>}
                {settings.length > 0 && <Card.Content>
                  <InlineNodeSettings
                    settings={settings.filter((setting) => node.type !== 'trigger' || setting.pointer !== '/kind')}
                    connectedPorts={new Set()}
                    linking={false}
                    allowConnections={false}
                    onChange={(pointer, value) => updateNode(node.id, setNodeConfigValue(node.config, pointer, value))}
                    onConnectInput={() => undefined}
                    onDisconnectInput={() => undefined}
                  />
                </Card.Content>}
              </Card>
            </div>;
          })}
        </div>
      </ScrollShadow>
    </div>
  );
}
