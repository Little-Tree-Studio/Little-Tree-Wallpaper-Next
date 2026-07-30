import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertDialog, Button, Card, Chip, Description, Dropdown, Input, Kbd, Label, ListBox, Modal, ScrollShadow, Select, Switch, Tabs, TextArea, TextField, Tooltip, toast } from '@heroui/react';
import { Blocks, Braces, ChevronLeft, ChevronRight, CircleStop, Clock3, Download, FileJson, FileOutput, FolderOpen, HelpCircle, Image, MousePointer2, Move, Play, Plus, Redo2, RefreshCw, Save, Settings2, Sparkles, StickyNote, Trash2, Undo2, Upload, Video } from 'lucide-react';
import AutomationCanvas from '@/components/AutomationEditor/AutomationCanvas';
import type { AutomationCanvasTool } from '@/components/AutomationEditor/AutomationCanvas';
import BlocksAutomationEditor from '@/components/AutomationEditor/BlocksAutomationEditor';
import SimpleAutomationEditor from '@/components/AutomationEditor/SimpleAutomationEditor';
import {
  AUTOMATION_TYPE_META,
  NODE_META,
  createNodeConfig,
  createAutomation,
  createBlocksAutomation,
  createSimpleAutomation,
  createScheduledDynamicWallpaperAutomation,
  createScheduledWallpaperAutomation,
  createWallpaperRotationAutomation,
  getAutomationType,
} from '@/components/AutomationEditor/types';
import type {
  AutomationDocument,
  AutomationNodeType,
  AutomationRuntime,
  AutomationSummary,
  AutomationType,
} from '@/components/AutomationEditor/types';
import {
  cancelAutomation,
  deleteAutomation,
  exportAutomation,
  getAutomation,
  getAutomationResourceCatalog,
  getAutomationRuntime,
  listAutomations,
  pickAndImportAutomation,
  runAutomation,
  saveAutomation,
  selectAutomationDirectory,
  selectAutomationLocalImage,
  selectDynamicWallpaperMedia,
  setAutomationEnabled,
} from '@/api/backend';
import type { AutomationResourceCatalog } from '@/api/backend';
import { BEFORE_NAVIGATE_EVENT } from '@/lib/navigationGuard';
import type { NavigationRequestDetail } from '@/lib/navigationGuard';

const NODE_TYPES = Object.keys(NODE_META) as AutomationNodeType[];
const HISTORY_LIMIT = 100;
const INTERVAL_UNITS = { minutes: 60, hours: 3600, days: 86400 } as const;
type IntervalUnit = keyof typeof INTERVAL_UNITS;
type CreationKind = 'blank' | 'scheduled-wallpaper' | 'scheduled-dynamic' | 'rotation';
type TemplateResourceSource = 'bing' | 'spotlight' | 'cnu' | 'pixiv';

const TEMPLATE_RESOURCE_CONFIGS: Record<TemplateResourceSource, Record<string, unknown>> = {
  bing: { source: 'bing', category: 'daily', market: 'zh-CN', quality: 'highDef', count: 8, selection: 'random' },
  spotlight: { source: 'spotlight', spotlight_source: 'online', market: 'zh-CN', limit: 20, selection: 'random' },
  cnu: { source: 'cnu', section: 'selected', page: 1, limit: 20, work_selection: 'random', image_selection: 'random' },
  pixiv: { source: 'pixiv', mode: 'day', page: 1, limit: 30, work_selection: 'random', image_selection: 'random' },
};

function documentFingerprint(document: AutomationDocument) {
  return JSON.stringify(document);
}

export default function Automation() {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<AutomationSummary[]>([]);
  const [activeType, setActiveType] = useState<AutomationType>('simple');
  const [document, setDocument] = useState<AutomationDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<AutomationRuntime | null>(null);
  const [resourceCatalog, setResourceCatalog] = useState<AutomationResourceCatalog | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedText, setAdvancedText] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creationKind, setCreationKind] = useState<CreationKind>('blank');
  const [scheduleTime, setScheduleTime] = useState('08:00');
  const [wallpaperSource, setWallpaperSource] = useState<'local' | 'resource'>('local');
  const [templateResourceSource, setTemplateResourceSource] = useState<TemplateResourceSource>('bing');
  const [templatePath, setTemplatePath] = useState('');
  const [rotationPath, setRotationPath] = useState('');
  const [rotationInterval, setRotationInterval] = useState(30);
  const [rotationUnit, setRotationUnit] = useState<IntervalUnit>('minutes');
  const [rotationRecursive, setRotationRecursive] = useState(false);
  const [canvasTool, setCanvasTool] = useState<AutomationCanvasTool>('default');
  const [listExpanded, setListExpanded] = useState(true);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [past, setPast] = useState<AutomationDocument[]>([]);
  const [future, setFuture] = useState<AutomationDocument[]>([]);
  const documentRef = useRef<AutomationDocument | null>(null);
  const savedFingerprintRef = useRef('');
  const historyTransactionRef = useRef<AutomationDocument | null>(null);
  const pendingNavigation = useRef<(() => void) | null>(null);

  const setCurrentDocument = (next: AutomationDocument) => {
    documentRef.current = next;
    setDocument(next);
    setDirty(documentFingerprint(next) !== savedFingerprintRef.current);
  };

  const resetDocument = (next: AutomationDocument, isDirty = false) => {
    savedFingerprintRef.current = isDirty ? '' : documentFingerprint(next);
    historyTransactionRef.current = null;
    setPast([]);
    setFuture([]);
    documentRef.current = next;
    setDocument(next);
    setSelectedId(null);
    setDirty(isDirty);
  };

  const recordHistory = (snapshot: AutomationDocument) => {
    setPast((items) => [...items, snapshot].slice(-HISTORY_LIMIT));
    setFuture([]);
  };

  const refreshList = async () => setItems(await listAutomations());
  const openDocument = async (id: string) => {
    const loaded = await getAutomation(id);
    setActiveType(getAutomationType(loaded));
    resetDocument(loaded);
  };

  const createForType = (type: AutomationType) => {
    const next = type === 'simple' ? createSimpleAutomation() : type === 'blocks' ? createBlocksAutomation() : createAutomation();
    setActiveType(type);
    resetDocument(next, true);
  };

  useEffect(() => {
    let cancelled = false;
    listAutomations().then(async (result) => {
      if (cancelled) return;
      setItems(result);
      const requestedId = searchParams.get('automation');
       if (requestedId && result.some((item) => item.id === requestedId)) await openDocument(requestedId);
       else {
         const firstSimple = result.find((item) => getAutomationType(item) === 'simple');
         if (firstSimple) await openDocument(firstSimple.id);
         else resetDocument(createSimpleAutomation());
       }
    }).catch((error: unknown) => toast.danger('自动化加载失败', { description: error instanceof Error ? error.message : '后端未响应' }))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const openCreationModal = () => {
    if (dirty) {
      toast.warning('请先保存当前自动化');
      return;
    }
    if (activeType !== 'advanced') {
      createForType(activeType);
      return;
    }
    setCreationKind('blank');
    setScheduleTime('08:00');
    setWallpaperSource('local');
    setTemplateResourceSource('bing');
    setTemplatePath('');
    setRotationPath('');
    setRotationInterval(30);
    setRotationUnit('minutes');
    setRotationRecursive(false);
    setCreateOpen(true);
  };

  const createFromModal = () => {
    let next: AutomationDocument;
    if (creationKind === 'blank') {
      next = createAutomation();
    } else if (creationKind === 'scheduled-wallpaper') {
      if (wallpaperSource === 'local' && !templatePath) {
        toast.warning('请选择本地壁纸文件');
        return;
      }
      next = createScheduledWallpaperAutomation({
        time: scheduleTime,
        source: wallpaperSource,
        path: templatePath,
        resourceConfig: TEMPLATE_RESOURCE_CONFIGS[templateResourceSource],
      });
    } else if (creationKind === 'scheduled-dynamic') {
      if (!templatePath) {
        toast.warning('请选择动态壁纸文件');
        return;
      }
      next = createScheduledDynamicWallpaperAutomation(scheduleTime, templatePath);
    } else {
      if (!rotationPath) {
        toast.warning('请选择壁纸文件夹');
        return;
      }
      next = createWallpaperRotationAutomation({
        name: '壁纸轮换',
        description: '按设定周期轮换本地文件夹中的壁纸',
        intervalSeconds: Math.max(60, rotationInterval * INTERVAL_UNITS[rotationUnit]),
        sourceConfig: { source: 'folder', path: rotationPath, recursive: rotationRecursive, order: 'shuffle' },
      });
    }
    resetDocument(next, true);
    setCreateOpen(false);
  };

  useEffect(() => {
    getAutomationResourceCatalog().then(setResourceCatalog).catch(() => undefined);
  }, []);

  useEffect(() => {
    const poll = () => getAutomationRuntime().then(setRuntime).catch(() => undefined);
    void poll();
    const timer = window.setInterval(poll, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onNavigate = (event: Event) => {
      if (!dirty) return;
      const custom = event as CustomEvent<NavigationRequestDetail>;
      custom.preventDefault();
      pendingNavigation.current = custom.detail.proceed;
      setLeaveOpen(true);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener(BEFORE_NAVIGATE_EVENT, onNavigate);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener(BEFORE_NAVIGATE_EVENT, onNavigate);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  const updateDocument = (updater: (current: AutomationDocument) => AutomationDocument, record = true) => {
    const current = documentRef.current;
    if (!current) return;
    const next = updater(current);
    if (documentFingerprint(next) === documentFingerprint(current)) return;
    if (record) recordHistory(current);
    setCurrentDocument(next);
  };

  const beginHistoryTransaction = () => {
    if (!historyTransactionRef.current && documentRef.current) historyTransactionRef.current = documentRef.current;
  };

  const endHistoryTransaction = () => {
    const before = historyTransactionRef.current;
    const after = documentRef.current;
    historyTransactionRef.current = null;
    if (before && after && documentFingerprint(before) !== documentFingerprint(after)) recordHistory(before);
  };

  const undo = () => {
    const current = documentRef.current;
    const previous = past[past.length - 1];
    if (!current || !previous) return;
    historyTransactionRef.current = null;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [current, ...items].slice(0, HISTORY_LIMIT));
    setCurrentDocument(previous);
    setSelectedId((id) => id && previous.nodes.some((node) => node.id === id) ? id : null);
  };

  const redo = () => {
    const current = documentRef.current;
    const next = future[0];
    if (!current || !next) return;
    historyTransactionRef.current = null;
    setFuture((items) => items.slice(1));
    setPast((items) => [...items, current].slice(-HISTORY_LIMIT));
    setCurrentDocument(next);
    setSelectedId((id) => id && next.nodes.some((node) => node.id === id) ? id : null);
  };

   const save = async (): Promise<boolean> => {
     if (!document) return false;
     if (getAutomationType(document) === 'simple' && document.simple?.source !== 'resource' && !document.simple?.path) {
       toast.warning(document.simple?.source === 'file' ? '请先选择壁纸图片' : '请先选择壁纸文件夹');
       return false;
     }
     setSaving(true);
     try {
      const saved = await saveAutomation(document);
      documentRef.current = saved;
      setDocument(saved);
      savedFingerprintRef.current = documentFingerprint(saved);
      setDirty(false);
       await refreshList();
       toast.success('自动化已保存');
       return true;
     } catch (error) {
       toast.danger('保存失败', { description: error instanceof Error ? error.message : '请检查节点和连接' });
       return false;
     } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const withCommand = event.ctrlKey || event.metaKey;
      if (withCommand && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (withCommand && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (withCommand && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      } else if (event.key === '?') {
        event.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const addNode = (type: AutomationNodeType) => {
    if (!document) return;
    if (type === 'trigger' && document.nodes.some((node) => node.type === 'trigger')) {
      toast.warning('每个自动化只能包含一个触发器');
      return;
    }
    const index = document.nodes.length;
    const config = createNodeConfig(type);
    const node = { id: crypto.randomUUID(), type, x: 140 + (index % 3) * 250, y: 100 + Math.floor(index / 3) * 130, config };
    updateDocument((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(node.id);
  };

  const connectNodes = (sourceId: string, port: string, targetId: string, targetPort?: string) => {
    if (!document || sourceId === targetId) return;
    if (document.nodes.some((node) => node.id === targetId && node.type === 'trigger')) {
      toast.warning('触发器是执行起点，不能连接上游输入');
      return;
    }
    updateDocument((current) => ({
      ...current,
      edges: current.edges.some((edge) => (
        edge.source === sourceId
        && (edge.source_port || 'default') === port
        && edge.target === targetId
        && (edge.target_port || '') === (targetPort || '')
      )) ? current.edges : [...current.edges, {
        id: crypto.randomUUID(),
        source: sourceId,
        source_port: port,
        target: targetId,
        ...(targetPort ? { target_port: targetPort } : {}),
      }],
    }));
  };

  const disconnectInput = (targetId: string, targetPort?: string) => {
    updateDocument((current) => ({
      ...current,
      edges: current.edges.filter((edge) => (
        edge.target !== targetId || (edge.target_port || '') !== (targetPort || '')
      )),
    }));
  };

  const disconnectOutput = (sourceId: string, port: string) => {
    updateDocument((current) => ({
      ...current,
      edges: current.edges.filter((edge) => (
        edge.source !== sourceId || (edge.source_port || 'default') !== port
      )),
    }));
  };

  const disconnectAllInputs = (targetId: string) => {
    updateDocument((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.target !== targetId),
    }));
  };

  const disconnectAllOutputs = (sourceId: string) => {
    updateDocument((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.source !== sourceId),
    }));
  };

  const deleteNode = (nodeId: string) => {
    updateDocument((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    }));
    setSelectedId((current) => current === nodeId ? null : current);
  };

  const addAnnotation = (x: number, y: number) => {
    const annotation = { id: crypto.randomUUID(), x, y, text: '输入注释...' };
    updateDocument((current) => ({ ...current, annotations: [...(current.annotations || []), annotation] }));
    setCanvasTool('default');
  };

  const importDocument = async () => {
    if (dirty) {
      toast.warning('请先保存当前自动化');
      return;
    }
    setImporting(true);
    try {
       const imported = await pickAndImportAutomation();
       if (!imported) return;
       setActiveType(getAutomationType(imported));
       resetDocument(imported, true);
      toast.success(`已导入「${imported.name}」`, { description: '检查后点击保存即可加入自动化列表' });
    } catch (error) {
      toast.danger('导入自动化失败', { description: error instanceof Error ? error.message : '文件格式无效' });
    } finally {
      setImporting(false);
    }
  };

  const exportDocument = async (format: 'ltauto' | 'json') => {
    if (!document) return;
    setExporting(true);
    try {
      let exportId = document.id;
      if (dirty || !items.some((item) => item.id === document.id)) {
        const saved = await saveAutomation(document);
        documentRef.current = saved;
        setDocument(saved);
        savedFingerprintRef.current = documentFingerprint(saved);
        setDirty(false);
        exportId = saved.id;
        await refreshList();
      }
      const path = await exportAutomation(exportId, format);
      if (path) toast.success('自动化已导出', { description: path });
    } catch (error) {
      toast.danger('导出自动化失败', { description: error instanceof Error ? error.message : '无法写入文件' });
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <Card className="flex h-64 items-center justify-center">正在加载自动化...</Card>;
  const run = runtime?.run;
  const hasTrigger = document?.nodes.some((node) => node.type === 'trigger') ?? false;
  const visibleItems = items.filter((item) => getAutomationType(item) === activeType);
  const currentType = document ? getAutomationType(document) : activeType;

  const changeType = async (type: AutomationType) => {
    if (type === activeType) return;
    const currentIsSaved = document ? items.some((item) => item.id === document.id) : false;
    if (dirty && currentIsSaved) {
      toast.warning('请先保存当前自动化');
      return;
    }
    setActiveType(type);
    const first = items.find((item) => getAutomationType(item) === type);
    if (first) await openDocument(first.id);
    else createForType(type);
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-[560px] overflow-clip rounded-lg border border-border bg-surface-secondary">
      <aside className={`flex shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 ${listExpanded ? 'w-60' : 'w-12'}`}>
        {listExpanded ? <>
           <div className="flex items-center justify-between gap-2 p-3">
            <div className="min-w-0 flex-1"><h1 className="font-semibold">自动化</h1><p className="text-xs text-muted">后台持续执行</p></div>
            <div className="flex items-center gap-0.5">
              <Tooltip><Button isIconOnly size="sm" variant="ghost" isPending={importing} aria-label="导入自动化" onPress={() => void importDocument()}><Upload size={15} /></Button><Tooltip.Content>导入 .ltauto 或 JSON</Tooltip.Content></Tooltip>
              <Tooltip><Button isIconOnly size="sm" variant="ghost" aria-label="创建自动化" onPress={openCreationModal}><Plus size={16} /></Button><Tooltip.Content>创建自动化</Tooltip.Content></Tooltip>
              <Tooltip><Button isIconOnly size="sm" variant="ghost" aria-label="收起自动化列表" onPress={() => setListExpanded(false)}><ChevronLeft size={15} /></Button><Tooltip.Content>收起列表</Tooltip.Content></Tooltip>
            </div>
           </div>
           <Tabs selectedKey={activeType} onSelectionChange={(key) => void changeType(String(key) as AutomationType)} className="border-b border-border px-2 pb-2">
             <Tabs.ListContainer>
               <Tabs.List aria-label="自动化类型" className="w-full *:min-w-0 *:flex-1 *:px-2">
                 <Tabs.Tab id="simple"><Sparkles size={14} /><span className="text-xs">简单</span><Tabs.Indicator /></Tabs.Tab>
                 <Tabs.Tab id="blocks"><Blocks size={14} /><span className="text-xs">积木</span><Tabs.Indicator /></Tabs.Tab>
                 <Tabs.Tab id="advanced"><Settings2 size={14} /><span className="text-xs">高级</span><Tabs.Indicator /></Tabs.Tab>
               </Tabs.List>
             </Tabs.ListContainer>
           </Tabs>
           <ScrollShadow hideScrollBar className="min-h-0 flex-1 space-y-1 p-2">
             {visibleItems.map((item) => (
              <Button key={item.id} fullWidth variant={document?.id === item.id ? 'secondary' : 'ghost'} className="h-auto justify-start px-3 py-2 text-left" onPress={() => {
                if (dirty && document?.id !== item.id) { toast.warning('请先保存当前自动化'); return; }
                void openDocument(item.id);
              }}>
                 <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.name}</span><span className="block text-xs text-muted">{AUTOMATION_TYPE_META[getAutomationType(item)].label}</span></span>
                 {item.enabled && <span className="size-2 rounded-full bg-success" />}
               </Button>
             ))}
             {!visibleItems.length && <div className="px-3 py-8 text-center"><p className="text-sm font-medium">还没有{AUTOMATION_TYPE_META[activeType].label}任务</p><p className="mt-1 text-xs text-muted">点击上方加号创建第一个任务</p></div>}
          </ScrollShadow>
          <div className="border-t border-border p-3 text-xs text-muted">已启用 {runtime?.enabled_count || 0} / {runtime?.total_count || 0}</div>
        </> : <div className="flex h-full flex-col items-center py-3">
          <Tooltip><Button isIconOnly size="sm" variant="ghost" aria-label="展开自动化列表" onPress={() => setListExpanded(true)}><ChevronRight size={16} /></Button><Tooltip.Content>展开自动化列表</Tooltip.Content></Tooltip>
          <span className="mt-4 [writing-mode:vertical-rl] text-xs font-medium tracking-widest text-muted">自动化</span>
          <span className="mt-auto size-2 rounded-full bg-success" title={`已启用 ${runtime?.enabled_count || 0} 个自动化`} />
        </div>}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center gap-2 border-b border-border bg-background px-4">
           <Input aria-label="自动化名称" className="max-w-56" value={document?.name || ''} onChange={(e) => updateDocument((current) => ({ ...current, name: e.target.value }))} />
           <Chip size="sm" variant="soft">{AUTOMATION_TYPE_META[currentType].label}</Chip>
          {dirty && <Chip size="sm" color="warning" variant="soft">未保存</Chip>}
          <div className="flex items-center gap-0.5">
            <Tooltip><Button isIconOnly size="sm" variant="ghost" isDisabled={!past.length} aria-label="撤销" onPress={undo}><Undo2 size={16} /></Button><Tooltip.Content>撤销 (Ctrl + Z)</Tooltip.Content></Tooltip>
            <Tooltip><Button isIconOnly size="sm" variant="ghost" isDisabled={!future.length} aria-label="恢复" onPress={redo}><Redo2 size={16} /></Button><Tooltip.Content>恢复 (Ctrl + Shift + Z / Ctrl + Y)</Tooltip.Content></Tooltip>
          </div>
          <div className="ml-auto flex items-center gap-2">
             <Switch isSelected={document?.enabled || false} onChange={async (enabled) => {
               if (!document) return;
               if (dirty && !await save()) return;
               const saved = await setAutomationEnabled(document.id, enabled);
              resetDocument(saved);
              await refreshList();
            }}><Switch.Control><Switch.Thumb /></Switch.Control><Switch.Content>后台启用</Switch.Content></Switch>
            <Button variant="secondary" isPending={saving} onPress={save}><Save size={15} />保存</Button>
             {run?.running ? <Button variant="danger-soft" onPress={() => void cancelAutomation()}><CircleStop size={15} />停止</Button> : <Button onPress={async () => { if (dirty && !await save()) return; if (document) await runAutomation(document.id); }}><Play size={15} />运行</Button>}
             {currentType === 'advanced' && <Button variant="ghost" onPress={() => setHelpOpen(true)}><HelpCircle size={16} />查看帮助</Button>}
             {currentType === 'advanced' && <Tooltip><Button isIconOnly variant="ghost" onPress={() => { if (document) { setAdvancedText(JSON.stringify(document, null, 2)); setAdvancedOpen(true); } }}><Braces size={16} /></Button><Tooltip.Content>高级 JSON 编辑</Tooltip.Content></Tooltip>}
            <Dropdown>
              <Tooltip><Button isIconOnly variant="ghost" isPending={exporting} aria-label="导出自动化"><Download size={16} /></Button><Tooltip.Content>导出自动化</Tooltip.Content></Tooltip>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu onAction={(key) => void exportDocument(String(key) as 'ltauto' | 'json')}>
                  <Dropdown.Item id="ltauto" textValue="小树自动化文件"><FileOutput size={15} className="text-muted" /><Label>小树自动化文件 (.ltauto)</Label></Dropdown.Item>
                  <Dropdown.Item id="json" textValue="JSON 文件"><FileJson size={15} className="text-muted" /><Label>JSON 文件 (.json)</Label></Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <Tooltip><Button isIconOnly variant="danger-soft" onPress={() => setDeleteOpen(true)}><Trash2 size={16} /></Button><Tooltip.Content>删除自动化</Tooltip.Content></Tooltip>
          </div>
        </header>

         {currentType === 'simple' && document && <SimpleAutomationEditor document={document} onChange={(next) => updateDocument(() => next)} />}
         {currentType === 'blocks' && document && <BlocksAutomationEditor document={document} resourceCatalog={resourceCatalog} runningNodeId={run?.current_node_id || ''} onChange={(next) => updateDocument(() => next)} />}
         {currentType === 'advanced' && <div className="flex min-h-0 flex-1">
          <aside className="flex min-h-0 w-48 shrink-0 flex-col border-r border-border bg-background">
            <ScrollShadow hideScrollBar className="min-h-0 flex-1 p-3">
              <p className="mb-2 text-xs font-medium text-muted">节点库</p>
               <div className="space-y-1">
                 {NODE_TYPES.map((type) => <Button key={type} fullWidth size="sm" variant="ghost" className="justify-start" isDisabled={type === 'trigger' && hasTrigger} onPress={() => addNode(type)}><Plus size={13} />{NODE_META[type].label}</Button>)}
               </div>
              <p className="mt-5 border-t border-border pt-4 text-[11px] leading-5 text-muted">节点内设置是回退值，每个设置左侧都可接入动态值；选项输入支持选项字符串或从 1 开始的序号。一个输出可连接多个节点。按住 Alt 点击端口可解除该端口连接，Ctrl 滚轮缩放。</p>
            </ScrollShadow>
          </aside>
          <AutomationCanvas
            document={document || createAutomation()}
            selectedId={selectedId}
            runningNodeId={run?.current_node_id || ''}
            resourceCatalog={resourceCatalog}
            tool={canvasTool}
            canUndo={past.length > 0}
            canRedo={future.length > 0}
            onToolChange={setCanvasTool}
            onUndo={undo}
            onRedo={redo}
            onSelect={setSelectedId}
            onBeginMove={beginHistoryTransaction}
            onEndMove={endHistoryTransaction}
            onMoveNode={(id, x, y) => updateDocument((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, x, y } : node) }), false)}
            onMoveNodes={(positions) => updateDocument((current) => ({ ...current, nodes: current.nodes.map((node) => positions[node.id] ? { ...node, ...positions[node.id] } : node) }))}
            onChangeNodeConfig={(id, config) => updateDocument((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, config } : node) }))}
            onConnect={connectNodes}
            onDisconnectInput={disconnectInput}
            onDisconnectOutput={disconnectOutput}
            onDisconnectAllInputs={disconnectAllInputs}
            onDisconnectAllOutputs={disconnectAllOutputs}
            onDeleteNode={deleteNode}
            onAddAnnotation={addAnnotation}
            onChangeAnnotation={(id, text) => updateDocument((current) => ({ ...current, annotations: (current.annotations || []).map((item) => item.id === id ? { ...item, text } : item) }))}
            onMoveAnnotation={(id, x, y) => updateDocument((current) => ({ ...current, annotations: (current.annotations || []).map((item) => item.id === id ? { ...item, x, y } : item) }), false)}
            onDeleteAnnotation={(id) => updateDocument((current) => ({ ...current, annotations: (current.annotations || []).filter((item) => item.id !== id) }))}
           />
         </div>}
        <footer className="flex h-10 items-center gap-3 border-t border-border bg-background px-4 text-xs text-muted">
          <Chip size="sm" color={run?.status === 'failed' ? 'danger' : run?.running ? 'warning' : run?.status === 'completed' ? 'success' : 'default'} variant="soft">{run?.running ? '执行中' : run?.status || '空闲'}</Chip>
          {run?.automation_name && <span>{run.automation_name}</span>}
          {run?.error && <span className="text-danger">{run.error}</span>}
          <span className="ml-auto">执行 {run?.steps || 0} 步</span>
        </footer>
      </section>

      <Modal isOpen={helpOpen} onOpenChange={setHelpOpen}>
        <Modal.Backdrop><Modal.Container size="lg"><Modal.Dialog>
          <Modal.Header><Modal.Heading>节点图帮助</Modal.Heading><Modal.CloseTrigger /></Modal.Header>
          <Modal.Body className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="p-4"><MousePointer2 size={18} className="mb-3 text-primary" /><p className="text-sm font-semibold">默认工具</p><p className="mt-1 text-xs leading-5 text-muted">选择和拖动节点，拖拽端口创建连接。</p></Card>
              <Card className="p-4"><Move size={18} className="mb-3 text-primary" /><p className="text-sm font-semibold">抓手工具</p><p className="mt-1 text-xs leading-5 text-muted">拖动画布移动视野，适合浏览大型节点图。</p></Card>
              <Card className="p-4"><StickyNote size={18} className="mb-3 text-primary" /><p className="text-sm font-semibold">注释工具</p><p className="mt-1 text-xs leading-5 text-muted">点击画布创建注释，内容会随自动化保存。</p></Card>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">快捷键</p>
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
                <Kbd><Kbd.Content>V</Kbd.Content></Kbd><span>切换到默认工具</span>
                <Kbd><Kbd.Content>H</Kbd.Content></Kbd><span>切换到抓手工具</span>
                <Kbd><Kbd.Content>C</Kbd.Content></Kbd><span>切换到注释工具</span>
                <Kbd><Kbd.Content>Ctrl + Z</Kbd.Content></Kbd><span>撤销</span>
                <Kbd><Kbd.Content>Ctrl + Shift + Z</Kbd.Content></Kbd><span>恢复</span>
                <Kbd><Kbd.Content>Ctrl + S</Kbd.Content></Kbd><span>保存自动化</span>
                <Kbd><Kbd.Content>Shift + 1</Kbd.Content></Kbd><span>一键整理节点图</span>
                <Kbd><Kbd.Content>Delete</Kbd.Content></Kbd><span>删除当前选中的节点</span>
                <Kbd><Kbd.Content>?</Kbd.Content></Kbd><span>打开此帮助</span>
              </div>
            </div>
            <p className="text-xs leading-5 text-muted">右键点击空白画布可快速创建注释、整理节点图或切换工具；右键点击节点可整理或删除节点。按住 Alt 点击端口可解除该端口连接，Ctrl + 滚轮可缩放。</p>
          </Modal.Body>
          <Modal.Footer><Button onPress={() => setHelpOpen(false)}>知道了</Button></Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>

      <Modal.Backdrop isOpen={createOpen} onOpenChange={setCreateOpen}>
        <Modal.Container size="lg"><Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground"><Plus size={20} /></Modal.Icon>
            <Modal.Heading>新建自动化</Modal.Heading>
             <p className="text-sm text-muted">高级模式可以从空白流程开始，或用模板生成可自由连接的节点图。</p>
          </Modal.Header>
          <Modal.Body className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ['blank', Plus, '空白自动化', '手动触发与结束节点'],
                ['scheduled-wallpaper', Image, '定时换壁纸', '本地文件或在线资源'],
                ['scheduled-dynamic', Video, '定时换动态壁纸', '按时间启动视频壁纸'],
                ['rotation', RefreshCw, '壁纸轮换', '按周期扫描本地文件夹'],
              ] as const).map(([kind, Icon, title, description]) => (
                <Button key={kind} variant={creationKind === kind ? 'secondary' : 'outline'} className="h-auto justify-start p-3 text-left" onPress={() => { setCreationKind(kind); setTemplatePath(''); }}>
                  <Icon size={18} className="shrink-0" />
                  <span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs font-normal text-muted">{description}</span></span>
                </Button>
              ))}
            </div>
            {(creationKind === 'scheduled-wallpaper' || creationKind === 'scheduled-dynamic') && (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <TextField className="max-w-48" value={scheduleTime} onChange={(value) => setScheduleTime(String(value))}>
                  <Label>每天执行时间</Label><Input type="time" /><Description>使用系统本地时间</Description>
                </TextField>
                {creationKind === 'scheduled-wallpaper' && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={wallpaperSource === 'local' ? 'secondary' : 'outline'} onPress={() => { setWallpaperSource('local'); setTemplatePath(''); }}><FolderOpen size={14} />本地文件</Button>
                    <Button size="sm" variant={wallpaperSource === 'resource' ? 'secondary' : 'outline'} onPress={() => { setWallpaperSource('resource'); setTemplatePath(''); }}><Image size={14} />在线资源</Button>
                  </div>
                )}
                {creationKind === 'scheduled-wallpaper' && wallpaperSource === 'resource' ? (
                  <div className="space-y-2">
                    <Label>在线资源来源</Label>
                    <Select value={templateResourceSource} onChange={(key) => setTemplateResourceSource(String(key) as TemplateResourceSource)}>
                      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox>
                        <ListBox.Item id="bing" textValue="Bing 每日壁纸">Bing 每日壁纸</ListBox.Item>
                        <ListBox.Item id="spotlight" textValue="Windows 聚焦">Windows 聚焦</ListBox.Item>
                        <ListBox.Item id="cnu" textValue="CNU 精选">CNU 精选</ListBox.Item>
                        <ListBox.Item id="pixiv" textValue="Pixiv 日榜">Pixiv 日榜</ListBox.Item>
                      </ListBox></Select.Popover>
                    </Select>
                    <p className="text-xs text-muted">创建后可在资源节点中继续调整分类、画质、榜单或切换为 IM 和其他壁纸源。</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onPress={async () => {
                      const path = creationKind === 'scheduled-dynamic' ? await selectDynamicWallpaperMedia() : await selectAutomationLocalImage();
                      if (path) setTemplatePath(path);
                    }}><FolderOpen size={15} />选择{creationKind === 'scheduled-dynamic' ? '动态壁纸' : '壁纸'}</Button>
                    <span className="min-w-0 truncate text-sm text-muted">{templatePath || '尚未选择文件'}</span>
                  </div>
                )}
              </div>
            )}
            {creationKind === 'rotation' && (
              <div className="space-y-4 rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onPress={async () => { const path = await selectAutomationDirectory(); if (path) setRotationPath(path); }}><FolderOpen size={15} />选择文件夹</Button>
                  <span className="min-w-0 truncate text-sm text-muted">{rotationPath || '尚未选择文件夹'}</span>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <TextField className="w-32" value={String(rotationInterval)} onChange={(value) => setRotationInterval(Math.max(1, Number(value) || 1))}><Label>轮换周期</Label><Input type="number" min="1" /></TextField>
                  <Select aria-label="周期单位" className="w-28" value={rotationUnit} onChange={(key) => setRotationUnit(String(key) as IntervalUnit)}>
                    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                    <Select.Popover><ListBox>
                      <ListBox.Item id="minutes" textValue="分钟">分钟</ListBox.Item>
                      <ListBox.Item id="hours" textValue="小时">小时</ListBox.Item>
                      <ListBox.Item id="days" textValue="天">天</ListBox.Item>
                    </ListBox></Select.Popover>
                  </Select>
                  <Switch isSelected={rotationRecursive} onChange={setRotationRecursive}><Switch.Control><Switch.Thumb /></Switch.Control><Switch.Content>包含子文件夹</Switch.Content></Switch>
                </div>
                <p className="text-xs text-muted">每次执行都会重新扫描文件夹，新加入的图片会自动进入随机不重复轮换队列。</p>
              </div>
            )}
          </Modal.Body>
           <Modal.Footer><Button variant="secondary" onPress={() => setCreateOpen(false)}>取消</Button><Button onPress={createFromModal}><Clock3 size={15} />创建高级任务</Button></Modal.Footer>
        </Modal.Dialog></Modal.Container>
      </Modal.Backdrop>

      <Modal isOpen={advancedOpen} onOpenChange={setAdvancedOpen}>
        <Modal.Backdrop><Modal.Container size="lg"><Modal.Dialog>
          <Modal.Header><Modal.Heading>高级自动化文档</Modal.Heading><Modal.CloseTrigger /></Modal.Header>
          <Modal.Body><TextField><Label>JSON</Label><TextArea className="min-h-96 font-mono text-xs" value={advancedText} onChange={(e) => setAdvancedText(e.target.value)} /></TextField></Modal.Body>
          <Modal.Footer><Button variant="secondary" onPress={() => setAdvancedOpen(false)}>取消</Button><Button onPress={() => { try { const parsed = JSON.parse(advancedText) as AutomationDocument; const triggerCount = Array.isArray(parsed.nodes) ? parsed.nodes.filter((node) => node?.type === 'trigger').length : 0; if (triggerCount !== 1) { toast.danger('自动化必须且只能包含一个触发器'); return; } updateDocument(() => parsed); setAdvancedOpen(false); } catch { toast.danger('JSON 格式无效'); } }}>应用</Button></Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>

      <AlertDialog isOpen={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialog.Backdrop><AlertDialog.Container><AlertDialog.Dialog>
          <AlertDialog.Header><AlertDialog.Icon /><AlertDialog.Heading>删除自动化？</AlertDialog.Heading></AlertDialog.Header>
          <AlertDialog.Body>删除后无法恢复，正在运行的实例也会被取消。</AlertDialog.Body>
           <AlertDialog.Footer><Button variant="secondary" onPress={() => setDeleteOpen(false)}>取消</Button><Button variant="danger" onPress={async () => { if (document && items.some((item) => item.id === document.id)) await deleteAutomation(document.id); setDeleteOpen(false); const refreshed = await listAutomations(); setItems(refreshed); const next = refreshed.find((item) => getAutomationType(item) === activeType); if (next) await openDocument(next.id); else createForType(activeType); }}>删除</Button></AlertDialog.Footer>
        </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog isOpen={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialog.Backdrop><AlertDialog.Container><AlertDialog.Dialog>
          <AlertDialog.Header><AlertDialog.Icon /><AlertDialog.Heading>放弃未保存的修改？</AlertDialog.Heading></AlertDialog.Header>
          <AlertDialog.Body>当前自动化尚未保存。</AlertDialog.Body>
          <AlertDialog.Footer><Button variant="secondary" onPress={() => setLeaveOpen(false)}>继续编辑</Button><Button variant="danger" onPress={() => { setDirty(false); setLeaveOpen(false); pendingNavigation.current?.(); pendingNavigation.current = null; }}>放弃修改</Button></AlertDialog.Footer>
        </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
