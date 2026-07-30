import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button, ButtonGroup, Kbd, Label, ListBox, Separator, TextArea, Tooltip } from '@heroui/react';
import { Maximize2, MousePointer2, Move, Redo2, StickyNote, Trash2, Undo2, Unlink2, WandSparkles, ZoomIn, ZoomOut } from 'lucide-react';
import InlineNodeSettings from './InlineNodeSettings';
import { getNodeOutputs, getNodeSettings, NODE_META, setNodeConfigValue } from './types';
import type { AutomationDocument, AutomationNode, AutomationResourceCatalogView } from './types';

type OutputPort = string;
export type AutomationCanvasTool = 'default' | 'hand' | 'annotation';

type ContextMenuState = {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  nodeId?: string;
};

interface AutomationCanvasProps {
  document: AutomationDocument;
  selectedId: string | null;
  runningNodeId: string;
  resourceCatalog: AutomationResourceCatalogView | null;
  tool: AutomationCanvasTool;
  canUndo: boolean;
  canRedo: boolean;
  onToolChange: (tool: AutomationCanvasTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelect: (id: string | null) => void;
  onBeginMove: () => void;
  onEndMove: () => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onMoveNodes: (positions: Record<string, { x: number; y: number }>) => void;
  onChangeNodeConfig: (id: string, config: Record<string, unknown>) => void;
  onConnect: (source: string, sourcePort: OutputPort, target: string, targetPort?: string) => void;
  onDisconnectInput: (target: string, targetPort?: string) => void;
  onDisconnectOutput: (source: string, sourcePort: OutputPort) => void;
  onDisconnectAllInputs: (target: string) => void;
  onDisconnectAllOutputs: (source: string) => void;
  onDeleteNode: (id: string) => void;
  onAddAnnotation: (x: number, y: number) => void;
  onChangeAnnotation: (id: string, text: string) => void;
  onMoveAnnotation: (id: string, x: number, y: number) => void;
  onDeleteAnnotation: (id: string) => void;
}

const NODE_WIDTH = 286;
const BASE_NODE_HEIGHT = 62;
const SETTING_ROW_HEIGHT = 38;
const OUTPUT_HEIGHT = 34;
const CANVAS_WIDTH = 2600;
const CANVAS_HEIGHT = 1800;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const LAYER_GAP = 360;
const ROW_GAP = 36;

function nodeHeight(node: AutomationNode, catalog: AutomationResourceCatalogView | null) {
  return BASE_NODE_HEIGHT + getNodeSettings(node, catalog).length * SETTING_ROW_HEIGHT + getNodeOutputs(node).length * OUTPUT_HEIGHT;
}

function outputPoint(node: AutomationNode, port: OutputPort, catalog: AutomationResourceCatalogView | null) {
  const height = nodeHeight(node, catalog);
  const outputs = getNodeOutputs(node);
  const index = Math.max(0, outputs.findIndex((item) => item.id === port));
  const y = node.y + height - (outputs.length - index) * OUTPUT_HEIGHT + OUTPUT_HEIGHT / 2;
  return { x: node.x + NODE_WIDTH, y };
}

function inputPoint(node: AutomationNode, targetPort: string | undefined, catalog: AutomationResourceCatalogView | null) {
  if (!targetPort) return { x: node.x, y: node.y + 36 };
  const index = getNodeSettings(node, catalog).findIndex((setting) => setting.pointer === targetPort);
  return { x: node.x, y: node.y + 50 + Math.max(0, index) * SETTING_ROW_HEIGHT + 16 };
}

function edgePath(startX: number, startY: number, endX: number, endY: number) {
  const bend = Math.max(70, Math.abs(endX - startX) * 0.5);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

function edgeColor(node: AutomationNode, port: string) {
  return getNodeOutputs(node).find((item) => item.id === port)?.color || 'var(--primary)';
}

function portStyle(color: string): CSSProperties {
  return { '--automation-port-color': color } as CSSProperties;
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
}

export default function AutomationCanvas({
  document,
  selectedId,
  runningNodeId,
  resourceCatalog,
  tool,
  canUndo,
  canRedo,
  onToolChange,
  onUndo,
  onRedo,
  onSelect,
  onBeginMove,
  onEndMove,
  onMoveNode,
  onMoveNodes,
  onChangeNodeConfig,
  onConnect,
  onDisconnectInput,
  onDisconnectOutput,
  onDisconnectAllInputs,
  onDisconnectAllOutputs,
  onDeleteNode,
  onAddAnnotation,
  onChangeAnnotation,
  onMoveAnnotation,
  onDeleteAnnotation,
}: AutomationCanvasProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ id: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  const [annotationDrag, setAnnotationDrag] = useState<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null);
  const [pan, setPan] = useState<{ clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [link, setLink] = useState<{ source: string; port: OutputPort; x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const canvasWidth = Math.max(
    CANVAS_WIDTH,
    ...document.nodes.map((node) => node.x + NODE_WIDTH + 240),
    ...(document.annotations || []).map((annotation) => annotation.x + 460),
  );
  const canvasHeight = Math.max(
    CANVAS_HEIGHT,
    ...document.nodes.map((node) => node.y + nodeHeight(node, resourceCatalog) + 240),
    ...(document.annotations || []).map((annotation) => annotation.y + 360),
  );

  const clientToCanvas = (clientX: number, clientY: number) => {
    const root = rootRef.current;
    if (!root) return { x: 0, y: 0 };
    const rect = root.getBoundingClientRect();
    return { x: (clientX - rect.left + root.scrollLeft) / zoom, y: (clientY - rect.top + root.scrollTop) / zoom };
  };

  const setClampedZoom = (next: number) => setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next)));

  const organizeNodes = () => {
    if (!document.nodes.length) return;
    const incoming = new Map(document.nodes.map((node) => [node.id, 0]));
    const outgoing = new Map(document.nodes.map((node) => [node.id, [] as string[]]));
    for (const edge of document.edges) {
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
      incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
      outgoing.get(edge.source)?.push(edge.target);
    }
    const trigger = document.nodes.find((node) => node.type === 'trigger');
    const queue = [...(trigger ? [trigger.id] : []), ...document.nodes.filter((node) => node.id !== trigger?.id && (incoming.get(node.id) || 0) === 0).map((node) => node.id)];
    const layers = new Map<string, number>();
    for (const id of queue) layers.set(id, 0);
    while (queue.length) {
      const id = queue.shift()!;
      const nextLayer = (layers.get(id) || 0) + 1;
      for (const target of outgoing.get(id) || []) {
        if (layers.has(target)) continue;
        layers.set(target, nextLayer);
        queue.push(target);
      }
    }
    let fallbackLayer = Math.max(0, ...layers.values()) + 1;
    for (const node of document.nodes) {
      if (!layers.has(node.id)) layers.set(node.id, fallbackLayer++);
    }
    const columns = new Map<number, AutomationNode[]>();
    for (const node of document.nodes) {
      const layer = layers.get(node.id) || 0;
      columns.set(layer, [...(columns.get(layer) || []), node]);
    }
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [layer, column] of columns) {
      let y = 88;
      for (const node of column.sort((a, b) => a.y - b.y)) {
        positions[node.id] = { x: 88 + layer * LAYER_GAP, y };
        y += nodeHeight(node, resourceCatalog) + ROW_GAP;
      }
    }
    onMoveNodes(positions);
    window.setTimeout(() => {
      const root = rootRef.current;
      if (root) root.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key.toLowerCase() === 'v') onToolChange('default');
      else if (event.key.toLowerCase() === 'h') onToolChange('hand');
      else if (event.key.toLowerCase() === 'c') onToolChange('annotation');
      else if (event.shiftKey && event.key === '!') { event.preventDefault(); organizeNodes(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        onDeleteNode(selectedId);
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedAnnotationId) {
        onDeleteAnnotation(selectedAnnotationId);
        setSelectedAnnotationId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, [contextMenu]);

  const openContextMenu = (event: React.MouseEvent, nodeId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    const point = clientToCanvas(event.clientX, event.clientY);
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 224),
      y: Math.min(event.clientY, window.innerHeight - (nodeId ? 196 : 308)),
      canvasX: point.x,
      canvasY: point.y,
      nodeId,
    });
    if (nodeId) onSelect(nodeId);
  };

  const startLink = (event: React.PointerEvent, source: string, port: OutputPort) => {
    event.stopPropagation();
    if (event.altKey) {
      event.preventDefault();
      setLink(null);
      onDisconnectOutput(source, port);
      onSelect(source);
      return;
    }
    const point = clientToCanvas(event.clientX, event.clientY);
    setLink({ source, port, ...point });
    onSelect(source);
  };

  const finishLink = (event: React.PointerEvent, target: string, targetPort?: string) => {
    event.stopPropagation();
    if (event.altKey) {
      event.preventDefault();
      setLink(null);
      return;
    }
    if (link && link.source !== target) onConnect(link.source, link.port, target, targetPort);
    setLink(null);
  };

  const finishPointerInteraction = () => {
    if (drag || annotationDrag) onEndMove();
    setDrag(null);
    setAnnotationDrag(null);
    setPan(null);
    setLink(null);
  };

  return (
    <div className="relative h-full min-h-[420px] min-w-0 flex-1 overflow-hidden bg-surface-tertiary/50">
      <div
        ref={rootRef}
        className="automation-canvas absolute inset-0 overflow-auto"
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          setClampedZoom(zoom * (event.deltaY > 0 ? 0.9 : 1.1));
        }}
        onPointerMove={(event) => {
          const point = clientToCanvas(event.clientX, event.clientY);
          if (link) setLink({ ...link, ...point });
          if (drag) onMoveNode(drag.id, Math.max(16, drag.nodeX + point.x - drag.startX), Math.max(16, drag.nodeY + point.y - drag.startY));
          if (annotationDrag) onMoveAnnotation(annotationDrag.id, Math.max(16, annotationDrag.x + point.x - annotationDrag.startX), Math.max(16, annotationDrag.y + point.y - annotationDrag.startY));
          if (pan && rootRef.current) {
            rootRef.current.scrollLeft = pan.scrollLeft - (event.clientX - pan.clientX);
            rootRef.current.scrollTop = pan.scrollTop - (event.clientY - pan.clientY);
          }
        }}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={finishPointerInteraction}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('[data-canvas-item]')) return;
          setContextMenu(null);
          onSelect(null);
          setSelectedAnnotationId(null);
          if (tool === 'hand' && rootRef.current) {
            event.currentTarget.setPointerCapture(event.pointerId);
            setPan({ clientX: event.clientX, clientY: event.clientY, scrollLeft: rootRef.current.scrollLeft, scrollTop: rootRef.current.scrollTop });
          } else if (tool === 'annotation') {
            const point = clientToCanvas(event.clientX, event.clientY);
            onAddAnnotation(Math.max(16, point.x - 110), Math.max(16, point.y - 24));
          }
        }}
        onContextMenu={(event) => openContextMenu(event)}
        style={{ cursor: pan ? 'grabbing' : tool === 'hand' ? 'grab' : tool === 'annotation' ? 'crosshair' : 'default' }}
      >
        <div className="relative" style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})` }}>
          <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden="true">
            {document.edges.map((edge) => {
              const source = nodes.get(edge.source);
              const target = nodes.get(edge.target);
              if (!source || !target) return null;
              const start = outputPoint(source, edge.source_port || 'default', resourceCatalog);
              const end = inputPoint(target, edge.target_port, resourceCatalog);
              return <path key={edge.id} d={edgePath(start.x, start.y, end.x, end.y)} fill="none" stroke={edgeColor(source, edge.source_port || 'default')} strokeLinecap="round" strokeWidth="2.5" />;
            })}
            {link && (() => {
              const source = nodes.get(link.source);
              if (!source) return null;
              const start = outputPoint(source, link.port, resourceCatalog);
              return <path d={edgePath(start.x, start.y, link.x, link.y)} fill="none" stroke={edgeColor(source, link.port)} strokeDasharray="7 5" strokeLinecap="round" strokeWidth="2.5" />;
            })()}
          </svg>

          {(document.annotations || []).map((annotation) => (
            <div
              key={annotation.id}
              data-canvas-item
              className={`absolute z-[12] w-[220px] rounded-xl border bg-warning-soft p-3 shadow-sm ${selectedAnnotationId === annotation.id ? 'border-warning ring-2 ring-warning/20' : 'border-warning/40'}`}
              style={{ left: annotation.x, top: annotation.y }}
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest('textarea, button')) return;
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                const point = clientToCanvas(event.clientX, event.clientY);
                onBeginMove();
                setAnnotationDrag({ id: annotation.id, startX: point.x, startY: point.y, x: annotation.x, y: annotation.y });
                setSelectedAnnotationId(annotation.id);
                onSelect(null);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSelectedAnnotationId(annotation.id);
              }}
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-warning-soft-foreground">
                <StickyNote size={14} />注释
                <Button isIconOnly size="sm" variant="ghost" className="ml-auto size-6 min-w-6" aria-label="删除注释" onPress={() => onDeleteAnnotation(annotation.id)}><Trash2 size={12} /></Button>
              </div>
              <TextArea
                aria-label="注释内容"
                className="min-h-16 resize-none bg-transparent text-xs"
                value={annotation.text}
                onFocus={() => { setSelectedAnnotationId(annotation.id); onSelect(null); }}
                onChange={(event) => onChangeAnnotation(annotation.id, event.target.value)}
              />
            </div>
          ))}

          {document.nodes.map((node) => {
            const meta = NODE_META[node.type];
            const selected = selectedId === node.id;
            const running = runningNodeId === node.id;
            const settings = getNodeSettings(node, resourceCatalog);
            const outputs = getNodeOutputs(node);
            const connectedPorts = new Set(document.edges.filter((edge) => edge.target === node.id && edge.target_port).map((edge) => String(edge.target_port)));
            const height = nodeHeight(node, resourceCatalog);
            const changeSetting = (pointer: string, value: unknown) => {
              let nextConfig = setNodeConfigValue(node.config, pointer, value);
              if (node.type === 'fetch_resource' && pointer === '/source') {
                nextConfig = { source: value, selection: 'random', force_refresh: false };
              } else if (node.type === 'fetch_resource' && pointer === '/source_id') {
                if (nextConfig.source === 'im') {
                  const source = resourceCatalog?.intelligent_market.find((item) => item.id === value);
                  nextConfig = {
                    ...nextConfig,
                    source_name: source?.friendly_name || String(value),
                    parameters: Object.fromEntries((source?.parameters || []).map((parameter) => [parameter.key, parameter.default_value ?? ''])),
                  };
                } else if (nextConfig.source === 'ltws') {
                  const source = resourceCatalog?.wallpaper_sources.find((item) => item.identifier === value);
                  nextConfig = { ...nextConfig, source_name: source?.name || String(value), api_name: '', parameters: {} };
                }
              } else if (node.type === 'fetch_resource' && pointer === '/api_name' && nextConfig.source === 'ltws') {
                const source = resourceCatalog?.wallpaper_sources.find((item) => item.identifier === nextConfig.source_id);
                const api = source?.apis?.find((item) => item.name === value);
                nextConfig = {
                  ...nextConfig,
                  parameters: Object.fromEntries((api?.parameters || []).filter((parameter) => !parameter.hidden).map((parameter) => [parameter.key, parameter.default ?? ''])),
                };
              }
              if (node.type === 'match' && pointer.startsWith('/cases/')) {
                const validPorts = new Set(getNodeOutputs({ ...node, config: nextConfig }).map((item) => item.id));
                for (const edge of document.edges) {
                  if (edge.source === node.id && !validPorts.has(edge.source_port || 'default')) onDisconnectOutput(node.id, edge.source_port || 'default');
                }
              }
              onChangeNodeConfig(node.id, nextConfig);
            };
            return (
              <div
                key={node.id}
                data-canvas-item
                role="button"
                tabIndex={0}
                aria-label={meta.label}
                className={`absolute flex w-[286px] touch-none select-none flex-col items-start rounded-xl border bg-surface px-4 py-3 text-left shadow-sm transition-[border-color,box-shadow] ${selected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/60'} ${running ? 'ring-2 ring-success shadow-md' : ''}`}
                style={{ left: node.x, top: node.y, height }}
                onContextMenu={(event) => openContextMenu(event, node.id)}
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest('[data-port], [data-node-control]')) return;
                  if (tool === 'hand') return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const point = clientToCanvas(event.clientX, event.clientY);
                  onBeginMove();
                  setDrag({ id: node.id, startX: point.x, startY: point.y, nodeX: node.x, nodeY: node.y });
                  onSelect(node.id);
                }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(node.id); }}
              >
                {node.type !== 'trigger' && (
                  <button
                    type="button"
                    data-port="input"
                    aria-label={`连接到${meta.label}`}
                    title="流程/主值输入；Alt 点击解除连接"
                    className={`automation-port automation-port--input absolute left-0 top-9 -translate-x-1/2 -translate-y-1/2 ${link && link.source !== node.id ? 'automation-port--ready' : ''}`}
                    style={portStyle('var(--muted)')}
                    onPointerUp={(event) => finishLink(event, node.id)}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (event.altKey) { event.preventDefault(); setLink(null); onDisconnectInput(node.id); onSelect(node.id); }
                    }}
                  />
                )}
                <span className="text-sm font-semibold text-foreground">{meta.label}</span>
                <span className="mt-0.5 text-[10px] text-muted">{meta.description}</span>
                {node.type === 'match' && <Button size="sm" variant="ghost" className="absolute right-9 top-2 h-6 px-2 text-[10px]" data-node-control onPress={() => {
                  const id = crypto.randomUUID();
                  onChangeNodeConfig(node.id, { ...node.config, cases: { ...((node.config.cases as Record<string, unknown> | undefined) || {}), [id]: { label: `分支 ${Object.keys((node.config.cases as object | undefined) || {}).length + 1}`, operator: 'eq', value: '' } } });
                }}>添加分支</Button>}
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="absolute right-2 top-2 size-6 min-w-6 text-muted hover:text-danger"
                  aria-label={`删除${meta.label}`}
                  data-node-control
                  onPointerDown={(event) => event.stopPropagation()}
                  onPress={() => onDeleteNode(node.id)}
                >
                  <Trash2 size={12} />
                </Button>

                <InlineNodeSettings
                  settings={settings}
                  connectedPorts={connectedPorts}
                  linking={Boolean(link && link.source !== node.id)}
                  allowConnections={node.type !== 'trigger'}
                  onChange={changeSetting}
                  onConnectInput={(event, pointer) => finishLink(event, node.id, pointer)}
                  onDisconnectInput={(pointer) => onDisconnectInput(node.id, pointer)}
                />

                {outputs.length > 0 && <div className="mt-auto flex w-full flex-col gap-1 text-[10px]">
                  {outputs.map((output) => <div key={output.id} className="relative flex h-[30px] items-center gap-1.5 rounded-md bg-surface-secondary px-2 text-muted">
                    <span className="shrink-0 font-semibold" style={{ color: output.color }}>{output.label}</span>
                    <span className="truncate">{output.description}</span>
                    {node.type === 'match' && output.id.startsWith('case:') && <Button isIconOnly size="sm" variant="ghost" className="ml-auto size-5 min-w-5" aria-label={`删除${output.label}`} onPress={() => {
                      const id = output.id.slice(5);
                      const cases = { ...((node.config.cases as Record<string, unknown> | undefined) || {}) };
                      delete cases[id];
                      onDisconnectOutput(node.id, output.id);
                      onChangeNodeConfig(node.id, { ...node.config, cases });
                    }}><Trash2 size={10} /></Button>}
                    <button type="button" data-port={`output-${output.id}`} aria-label={`从${output.label}分支拉出连接`} title="可连接多个节点；Alt 点击解除全部" className="automation-port automation-port--output absolute right-[-16px] top-1/2 translate-x-1/2 -translate-y-1/2 cursor-crosshair" style={portStyle(output.color)} onPointerDown={(event) => startLink(event, node.id, output.id)} />
                  </div>)}
                </div>}
              </div>
            );
          })}
        </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex items-end justify-between gap-3 px-3">
        <div className="pointer-events-auto rounded-xl border border-border bg-surface/95 p-1 shadow-md backdrop-blur">
          <ButtonGroup size="sm" variant="ghost">
            <Tooltip><Button variant={tool === 'default' ? 'secondary' : 'ghost'} onPress={() => onToolChange('default')}><MousePointer2 size={15} />默认</Button><Tooltip.Content>选择工具 (V)</Tooltip.Content></Tooltip>
            <Tooltip><Button variant={tool === 'hand' ? 'secondary' : 'ghost'} onPress={() => onToolChange('hand')}><ButtonGroup.Separator /><Move size={15} />抓手</Button><Tooltip.Content>移动页面 (H)</Tooltip.Content></Tooltip>
            <Tooltip><Button variant={tool === 'annotation' ? 'secondary' : 'ghost'} onPress={() => onToolChange('annotation')}><ButtonGroup.Separator /><StickyNote size={15} />注释</Button><Tooltip.Content>点击创建注释 (C)</Tooltip.Content></Tooltip>
          </ButtonGroup>
        </div>
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border bg-surface/95 p-1 shadow-md backdrop-blur">
        <Tooltip><Button size="sm" variant="ghost" onPress={organizeNodes}><WandSparkles size={15} />一键整理</Button><Tooltip.Content>按流程层级整理节点 (Shift + 1)</Tooltip.Content></Tooltip>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Tooltip><Button isIconOnly size="sm" variant="ghost" isDisabled={zoom <= MIN_ZOOM} onPress={() => setClampedZoom(zoom - 0.1)}><ZoomOut size={15} /></Button><Tooltip.Content>缩小画布</Tooltip.Content></Tooltip>
        <Button size="sm" variant="ghost" className="w-16 px-1 text-xs tabular-nums" onPress={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button>
        <Tooltip><Button isIconOnly size="sm" variant="ghost" isDisabled={zoom >= MAX_ZOOM} onPress={() => setClampedZoom(zoom + 0.1)}><ZoomIn size={15} /></Button><Tooltip.Content>放大画布</Tooltip.Content></Tooltip>
        <Tooltip><Button isIconOnly size="sm" variant="ghost" onPress={() => setZoom(0.7)}><Maximize2 size={15} /></Button><Tooltip.Content>概览画布</Tooltip.Content></Tooltip>
        </div>
      </div>
      {contextMenu && (
        <div
          className="context-menu-enter fixed z-50 w-[216px] rounded-xl border border-border bg-background/98 p-1.5 shadow-xl backdrop-blur"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <ListBox aria-label="节点图操作" selectionMode="none" onAction={(key) => {
            const action = String(key);
            if (action === 'annotation') onAddAnnotation(contextMenu.canvasX - 110, contextMenu.canvasY - 24);
            else if (action === 'organize') organizeNodes();
            else if (action === 'undo') onUndo();
            else if (action === 'redo') onRedo();
            else if (action === 'default' || action === 'hand') onToolChange(action);
            else if (action === 'disconnect-inputs' && contextMenu.nodeId) onDisconnectAllInputs(contextMenu.nodeId);
            else if (action === 'disconnect-outputs' && contextMenu.nodeId) onDisconnectAllOutputs(contextMenu.nodeId);
            else if (action === 'delete' && contextMenu.nodeId) onDeleteNode(contextMenu.nodeId);
            setContextMenu(null);
          }}>
            {contextMenu.nodeId ? <>
              <ListBox.Item id="organize" textValue="整理节点图"><WandSparkles size={15} className="text-muted" /><Label>整理节点图</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>⇧1</Kbd.Content></Kbd></ListBox.Item>
              <Separator />
              <ListBox.Item id="disconnect-inputs" textValue="清除左端全部连接"><Unlink2 size={15} className="text-muted" /><Label>清除左端连接</Label><span className="ms-auto text-[10px] text-muted">全部</span></ListBox.Item>
              <ListBox.Item id="disconnect-outputs" textValue="清除右端全部连接"><Unlink2 size={15} className="text-muted" /><Label>清除右端连接</Label><span className="ms-auto text-[10px] text-muted">全部</span></ListBox.Item>
              <Separator />
              <ListBox.Item id="delete" textValue="删除节点" className="text-danger"><Trash2 size={15} /><Label>删除节点</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>Del</Kbd.Content></Kbd></ListBox.Item>
            </> : <>
              <ListBox.Item id="undo" textValue="撤销" isDisabled={!canUndo}><Undo2 size={15} className="text-muted" /><Label>撤销</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>Ctrl Z</Kbd.Content></Kbd></ListBox.Item>
              <ListBox.Item id="redo" textValue="恢复" isDisabled={!canRedo}><Redo2 size={15} className="text-muted" /><Label>恢复</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>Ctrl ⇧ Z</Kbd.Content></Kbd></ListBox.Item>
              <Separator />
              <ListBox.Item id="annotation" textValue="创建注释"><StickyNote size={15} className="text-muted" /><Label>创建注释</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>C</Kbd.Content></Kbd></ListBox.Item>
              <ListBox.Item id="organize" textValue="整理节点图"><WandSparkles size={15} className="text-muted" /><Label>整理节点图</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>⇧1</Kbd.Content></Kbd></ListBox.Item>
              <Separator />
              <ListBox.Item id="default" textValue="默认工具"><MousePointer2 size={15} className="text-muted" /><Label>默认工具</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>V</Kbd.Content></Kbd></ListBox.Item>
              <ListBox.Item id="hand" textValue="抓手工具"><Move size={15} className="text-muted" /><Label>抓手工具</Label><Kbd className="ms-auto" variant="light"><Kbd.Content>H</Kbd.Content></Kbd></ListBox.Item>
            </>}
          </ListBox>
        </div>
      )}
    </div>
  );
}
