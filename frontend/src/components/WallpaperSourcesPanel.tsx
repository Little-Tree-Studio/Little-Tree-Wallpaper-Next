import { useState, useEffect, useMemo } from 'react';
import {
  Card, Button, Tabs, ComboBox, Input, Label, ListBox,
  Drawer, Switch, TextArea, TextField, FieldError, Description, Accordion, Tooltip, Modal, toast,
} from '@heroui/react';
import {
  Image as ImageIcon, Heart, Copy, RefreshCw,
  Plus, Trash2, Upload, Pencil,
  Play, AlertCircle, Wand2, ChevronDown, ChevronRight, Braces,
} from 'lucide-react';
import {
  getWallpaperSources, setWallpaperSourceEnabled, deleteWallpaperSource,
  executeWallpaperSource, pickAndImportSource, createWallpaperSource, updateWallpaperSource,
  downloadFile, setWallpaper, addFavorite, copyToClipboard, localPreviewUrl,
} from '@/api/backend';
import { useImageViewer } from '@/components/ImageViewer';
import { logError } from '@/lib/log';
import type {
  WallpaperSource, WallpaperSourceApiParameter,
  WallpaperSourceCreatorPayload, WallpaperSourceCategory,
} from '@/api/backend';

interface WallpaperSourcesPanelProps {
  onExecute?: (items: any[]) => void;
  mode?: 'main' | 'management';
}

function getSourceParameterDefaultValue(param: WallpaperSourceApiParameter): string | boolean {
  const type = String(param.type ?? 'text').toLowerCase();
  if (type === 'boolean') return Boolean(param.default);
  if (type === 'list') {
    if (Array.isArray(param.default)) return param.default.map((item) => String(item)).join('\n');
    return String(param.default ?? '');
  }
  return String(param.default ?? '');
}

function normalizeSourceParameterValue(param: WallpaperSourceApiParameter, value: unknown): unknown {
  const type = String(param.type ?? 'text').toLowerCase();
  if (type === 'boolean') return Boolean(value);
  if (type === 'list') {
    return String(value ?? '').split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
  }
  if (type === 'number') {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw;
  }
  return value;
}

/* ───── 路径生成器类型 ───── */
interface PathSegment {
  type: 'property' | 'index' | 'wildcard' | 'slice' | 'recursive';
  key?: string;
  index?: number;
  start?: number;
  end?: number;
}

interface PipeFunction {
  name: string;
  args: string[];
}

interface PathGenState {
  mode: 'json' | 'html';
  segments: PathSegment[];
  cssSelector: string;
  pipes: PipeFunction[];
}

/* ───── JSON 树解析类型 ───── */
interface JsonTreeNode {
  key: string;
  path: string;
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  value: unknown;
  children?: JsonTreeNode[];
}

function getJsonType(value: unknown): JsonTreeNode['type'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'object') return 'object';
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'null';
}

function parseJsonToTree(value: unknown, key: string, path: string): JsonTreeNode {
  const node: JsonTreeNode = { key, path, value, type: getJsonType(value) };
  if (Array.isArray(value)) {
    node.children = value.slice(0, 20).map((v, i) => parseJsonToTree(v, String(i), `${path}[${i}]`));
  } else if (typeof value === 'object' && value !== null) {
    node.children = Object.entries(value).map(([k, v]) => parseJsonToTree(v, k, `${path}.${k}`));
  }
  return node;
}

function pathToSegments(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let remaining = path;
  if (remaining.startsWith('$')) remaining = remaining.slice(1);
  while (remaining.length > 0) {
    if (remaining.startsWith('.')) {
      const m = remaining.match(/\.[a-zA-Z0-9_]+/);
      if (m) { segments.push({ type: 'property', key: m[0].slice(1) }); remaining = remaining.slice(m[0].length); continue; }
    }
    if (remaining.startsWith('[')) {
      const end = remaining.indexOf(']');
      if (end > 0) {
        const inner = remaining.slice(1, end);
        if (inner === '*') segments.push({ type: 'wildcard' });
        else { const n = Number(inner); if (Number.isFinite(n)) segments.push({ type: 'index', index: n }); }
        remaining = remaining.slice(end + 1);
        continue;
      }
    }
    break;
  }
  return segments;
}

function buildPathExpression(state: PathGenState): string {
  if (state.mode === 'html') {
    let path = state.cssSelector ? `html:${state.cssSelector}` : '';
    for (const pipe of state.pipes) {
      if (pipe.args.length > 0) path += ` | ${pipe.name}('${pipe.args[0]}')`;
      else path += ` | ${pipe.name}`;
    }
    return path;
  }
  let path = '$';
  for (const seg of state.segments) {
    switch (seg.type) {
      case 'property': path += `.${seg.key || ''}`; break;
      case 'index': path += `[${seg.index ?? 0}]`; break;
      case 'wildcard': path += '[*]'; break;
      case 'slice': path += `[${seg.start ?? ''}:${seg.end ?? ''}]`; break;
      case 'recursive': path += `..${seg.key || ''}`; break;
    }
  }
  for (const pipe of state.pipes) {
    if (pipe.args.length > 0) path += ` | ${pipe.name}('${pipe.args[0]}')`;
    else path += ` | ${pipe.name}`;
  }
  return path;
}

function parsePathExpression(expr: string): PathGenState {
  const state: PathGenState = { mode: 'json', segments: [], cssSelector: '', pipes: [] };
  if (!expr.trim()) return state;
  if (expr.startsWith('html:')) {
    state.mode = 'html';
    let rest = expr.slice(5);
    const pipeIdx = rest.indexOf(' | ');
    if (pipeIdx >= 0) {
      state.cssSelector = rest.slice(0, pipeIdx).trim();
      const pipeParts = rest.slice(pipeIdx).split(' | ').filter(Boolean);
      for (const p of pipeParts) {
        const m = p.trim().match(/^([a-zA-Z_]+)\((['"])(.+?)\2\)$/);
        if (m) state.pipes.push({ name: m[1], args: [m[3]] });
        else state.pipes.push({ name: p.trim(), args: [] });
      }
    } else {
      state.cssSelector = rest.trim();
    }
    return state;
  }
  let remaining = expr;
  const pipeMatch = remaining.match(/\s*\|/);
  if (pipeMatch) {
    const pipeStr = remaining.slice(pipeMatch.index);
    remaining = remaining.slice(0, pipeMatch.index);
    const pipeParts = pipeStr.split('|').map((s) => s.trim()).filter(Boolean);
    for (const p of pipeParts) {
      const m = p.match(/^([a-zA-Z_]+)\((['"])(.+?)\2\)$/);
      if (m) state.pipes.push({ name: m[1], args: [m[3]] });
      else state.pipes.push({ name: p, args: [] });
    }
  }
  if (remaining.startsWith('$')) remaining = remaining.slice(1);
  while (remaining.length > 0) {
    if (remaining.startsWith('..')) {
      const m = remaining.match(/^\.\.[a-zA-Z0-9_]+/);
      if (m) { state.segments.push({ type: 'recursive', key: m[0].slice(2) }); remaining = remaining.slice(m[0].length); continue; }
    }
    if (remaining.startsWith('.')) {
      const m = remaining.match(/\.[a-zA-Z0-9_]+/);
      if (m) { state.segments.push({ type: 'property', key: m[0].slice(1) }); remaining = remaining.slice(m[0].length); continue; }
    }
    if (remaining.startsWith('[')) {
      const end = remaining.indexOf(']');
      if (end > 0) {
        const inner = remaining.slice(1, end);
        if (inner === '*') state.segments.push({ type: 'wildcard' });
        else if (inner.includes(':')) {
          const [s, e] = inner.split(':');
          state.segments.push({ type: 'slice', start: s ? Number(s) : undefined, end: e ? Number(e) : undefined });
        } else if (!isNaN(Number(inner))) {
          state.segments.push({ type: 'index', index: Number(inner) });
        }
        remaining = remaining.slice(end + 1);
        continue;
      }
    }
    break;
  }
  return state;
}

/* ───── 壁纸源分类树辅助 ───── */
interface CreatorCategory extends WallpaperSourceCategory {
  parentId?: string | null;
}

interface CategoryTreeNode extends CreatorCategory {
  children: CategoryTreeNode[];
  depth: number;
}

function buildCategoryTree(cats: CreatorCategory[]): CategoryTreeNode[] {
  const map = new Map<string, CategoryTreeNode>();
  cats.forEach((cat) => {
    map.set(cat.id, { ...cat, children: [], depth: 0 });
  });
  const roots: CategoryTreeNode[] = [];
  cats.forEach((cat) => {
    const node = map.get(cat.id)!;
    if (cat.parentId && map.has(cat.parentId)) {
      const parent = map.get(cat.parentId)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const setDepth = (nodes: CategoryTreeNode[], depth: number) => {
    nodes.forEach((node) => {
      node.depth = depth;
      setDepth(node.children, depth + 1);
    });
  };
  setDepth(roots, 0);
  return roots;
}

function getCategoryDepth(cats: CreatorCategory[], id: string, visited = new Set<string>()): number {
  if (visited.has(id)) return Infinity;
  const cat = cats.find((c) => c.id === id);
  if (!cat || !cat.parentId) return 0;
  visited.add(id);
  return 1 + getCategoryDepth(cats, cat.parentId, visited);
}

function validateCategories(cats: CreatorCategory[]): string | null {
  if (cats.length === 0) return '请至少添加一个分类';
  const ids = cats.map((c) => c.id.trim());
  if (ids.some((id) => !id)) return '每个分类的 ID 都必须填写';
  if (new Set(ids).size !== ids.length) return '分类 ID 不能重复';
  if (cats.some((c) => !c.name.trim())) return '每个分类的名称都必须填写';
  for (const cat of cats) {
    const depth = getCategoryDepth(cats, cat.id);
    if (depth === Infinity) return '分类层级存在循环引用';
    if (depth >= 3) return '分类层级最多支持 3 级';
  }
  return null;
}

function flattenCategoryTreeForBackend(
  cats: CreatorCategory[],
): WallpaperSourceCategory[] {
  const tree = buildCategoryTree(cats);
  const rows: WallpaperSourceCategory[] = [];
  const walk = (node: CategoryTreeNode, ancestors: CategoryTreeNode[]) => {
    const category = ancestors[0]?.name ?? node.name;
    const subcategory = ancestors[1]?.name ?? (ancestors.length >= 1 ? node.name : '');
    const subsubcategory = ancestors[2]?.name ?? (ancestors.length >= 2 ? node.name : '');
    rows.push({
      id: node.id,
      name: node.name,
      category,
      subcategory,
      subsubcategory,
      icon: node.icon,
      description: node.description,
    });
    node.children.forEach((child) => walk(child, [...ancestors, node]));
  };
  tree.forEach((node) => walk(node, []));
  return rows;
}

const PIPE_CATEGORIES = [
  {
    label: '字符串',
    options: [
      { name: 'prepend', label: '前缀', args: 1, placeholder: 'https://', desc: '在前添加字符串' },
      { name: 'append', label: '后缀', args: 1, placeholder: '?w=1920', desc: '在后添加字符串' },
      { name: 'replace', label: '替换', args: 2, placeholder: '查找,替换', desc: '正则替换' },
      { name: 'regexExtract', label: '正则提取', args: 1, placeholder: '/\\d+/', desc: '正则提取首个捕获组' },
      { name: 'truncate', label: '截断', args: 1, placeholder: '20', desc: '截断到指定长度' },
      { name: 'clean', label: '清理空白', args: 0, desc: '去除多余空白' },
    ],
  },
  {
    label: '类型转换',
    options: [
      { name: 'toInt', label: '转整数', args: 0, desc: '转为整数' },
      { name: 'toFloat', label: '转浮点', args: 0, desc: '转为浮点数' },
      { name: 'dateFormat', label: '日期格式化', args: 1, placeholder: 'YYYY-MM-DD', desc: '格式化日期' },
    ],
  },
  {
    label: 'HTML DOM',
    options: [
      { name: 'attr', label: '取属性', args: 1, placeholder: 'src', desc: '取 DOM 属性' },
      { name: 'text', label: '取文本', args: 0, desc: '提取文本内容' },
      { name: 'html', label: '取HTML', args: 0, desc: '提取 innerHTML' },
    ],
  },
];

const PIPE_OPTIONS = PIPE_CATEGORIES.flatMap((c) => c.options);

const PRESET_PATHS = [
  { label: '通用列表', segments: [{ type: 'property' as const, key: 'data' }, { type: 'property' as const, key: 'list' }, { type: 'wildcard' as const }], pipes: [] },
  { label: '数组通配', segments: [{ type: 'property' as const, key: 'data' }, { type: 'wildcard' as const }], pipes: [] },
  { label: 'Items', segments: [{ type: 'property' as const, key: 'items' }, { type: 'wildcard' as const }], pipes: [] },
  { label: 'Results', segments: [{ type: 'property' as const, key: 'results' }, { type: 'wildcard' as const }], pipes: [] },
  { label: '根数组', segments: [{ type: 'wildcard' as const }], pipes: [] },
  { label: '嵌套数据', segments: [{ type: 'property' as const, key: 'response' }, { type: 'property' as const, key: 'data' }, { type: 'wildcard' as const }], pipes: [] },
  { label: '单图', segments: [{ type: 'property' as const, key: 'data' }], pipes: [] },
];

const PRESET_IMAGE_PATHS = [
  { label: 'url', segments: [{ type: 'property' as const, key: 'url' }], pipes: [] },
  { label: 'image_url', segments: [{ type: 'property' as const, key: 'image_url' }], pipes: [] },
  { label: 'image', segments: [{ type: 'property' as const, key: 'image' }], pipes: [] },
  { label: 'img', segments: [{ type: 'property' as const, key: 'img' }], pipes: [] },
  { label: 'src', segments: [{ type: 'property' as const, key: 'src' }], pipes: [] },
  { label: 'download_url', segments: [{ type: 'property' as const, key: 'download_url' }], pipes: [] },
  { label: 'links.download', segments: [{ type: 'property' as const, key: 'links' }, { type: 'property' as const, key: 'download' }], pipes: [] },
];

const MAPPING_FIELD_KEYS: { key: string; label: string; required?: boolean }[] = [
  { key: 'image', label: '图片 URL', required: true },
  { key: 'title', label: '标题' },
  { key: 'copyright', label: '版权' },
  { key: 'description', label: '描述' },
  { key: 'preview', label: '预览图' },
  { key: 'author', label: '作者' },
  { key: 'source_url', label: '来源链接' },
  { key: 'tags', label: '标签' },
];

const PARAMETER_TYPES = [
  { value: 'text', label: '文本' },
  { value: 'choice', label: '选项' },
  { value: 'boolean', label: '布尔' },
];

/* ───── 请求/响应方法选项 ───── */
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const RESPONSE_FORMATS_WITH_DESC = [
  { value: 'json', label: 'JSON', desc: '解析 JSON 响应并通过路径表达式提取字段' },
  { value: 'html', label: 'HTML', desc: '解析 HTML 响应并通过 CSS 选择器提取字段' },
  { value: 'binary', label: 'BINARY', desc: '响应体本身就是图片二进制数据，无需字段映射' },
];
const RESPONSE_TYPES = ['single', 'multi'];
/* ───── 分页策略（含说明） ───── */
interface PaginationOption {
  value: string;
  label: string;
  desc: string;
  longDesc: string;
}

const PAGINATION_OPTIONS: PaginationOption[] = [
  {
    value: 'offset',
    label: '页码 / 偏移 (offset)',
    desc: 'URL 中按页码递增，如 ?page={{page}}',
    longDesc: '适合大多数 REST API。客户端从起始值开始，每次按增量递增请求下一页，直到结果为空或达到最大页数。',
  },
  {
    value: 'cursor',
    label: '游标 (cursor)',
    desc: '下一页标识由上一页响应返回',
    longDesc: '适合返回 next_cursor / next_token 等字段的接口。每次请求后从响应中提取游标，带入下一次请求。',
  },
  {
    value: 'link_header',
    label: 'Link 头 (link_header)',
    desc: '自动解析响应 Link 头中的下一页链接',
    longDesc: '适合遵循 RFC 5988、在 HTTP Link 头中返回 rel="next" 的接口，无需额外配置。',
  },
  {
    value: 'selector',
    label: '选择器 (selector)',
    desc: '从 HTML 页面提取「下一页」链接',
    longDesc: '适合 HTML 网页抓取。通过 CSS 选择器定位「下一页」按钮并取其链接地址。',
  },
];

const CURSOR_IN_OPTIONS = [
  { value: 'query', label: '查询参数' },
  { value: 'header', label: '请求头' },
  { value: 'body', label: '请求体' },
];
/* ───── 错误处理场景（含本地化的可选动作） ───── */
interface ErrorAction { value: string; label: string; desc?: string }
interface ErrorScenario {
  key: 'on_http_4xx' | 'on_http_5xx' | 'on_empty_response' | 'on_mapping_failure';
  label: string;
  desc: string;
  actions: ErrorAction[];
}

const ERROR_SCENARIOS: ErrorScenario[] = [
  {
    key: 'on_http_4xx',
    label: 'HTTP 4xx 错误',
    desc: '收到 4xx 状态码（如 404 未找到、403 无权限）时',
    actions: [
      { value: '', label: '默认 (跳过)' },
      { value: 'skip', label: '跳过', desc: '丢弃本次结果' },
      { value: 'fallback', label: '降级', desc: '改用备用接口' },
      { value: 'retry', label: '重试', desc: '重新发起请求' },
    ],
  },
  {
    key: 'on_http_5xx',
    label: 'HTTP 5xx 错误',
    desc: '收到 5xx 状态码（如 500 服务器错误、502 网关错误）时',
    actions: [
      { value: '', label: '默认 (重试)' },
      { value: 'skip', label: '跳过', desc: '丢弃本次结果' },
      { value: 'fallback', label: '降级', desc: '改用备用接口' },
      { value: 'retry', label: '重试', desc: '重新发起请求' },
    ],
  },
  {
    key: 'on_empty_response',
    label: '空响应',
    desc: '响应体为空或不含有效数据时',
    actions: [
      { value: '', label: '默认 (跳过)' },
      { value: 'skip', label: '跳过', desc: '丢弃本次结果' },
      { value: 'fallback', label: '降级', desc: '改用备用接口' },
      { value: 'retry', label: '重试', desc: '重新发起请求' },
    ],
  },
  {
    key: 'on_mapping_failure',
    label: '映射失败',
    desc: '多条结果中单个条目映射失败时',
    actions: [
      { value: '', label: '默认 (丢弃单条)' },
      { value: 'skip_item', label: '丢弃单条', desc: '仅丢弃失败的条目' },
      { value: 'skip', label: '丢弃全部', desc: '丢弃整个接口的结果' },
    ],
  },
];

/* ───── 验证约束动作 ───── */
const VALIDATION_ACTIONS: ErrorAction[] = [
  { value: 'skip', label: '丢弃', desc: '移除不满足条件的条目' },
  { value: 'warn', label: '警告', desc: '保留但记录警告' },
  { value: 'ignore', label: '忽略', desc: '不处理，照常保留' },
];

const SPECIAL_VALUE_CATEGORIES = [
  {
    label: '时间',
    values: [
      { key: '{{timestamp_ms}}', label: '时间戳(ms)', desc: '1704067200000' },
      { key: '{{timestamp_s}}', label: '时间戳(s)', desc: '1704067200' },
      { key: '{{date_iso}}', label: 'ISO日期', desc: '2024-01-01' },
      { key: '{{date_cn}}', label: '中文日期', desc: '2024年01月01日' },
      { key: '{{year}}', label: '年', desc: '2024' },
      { key: '{{month}}', label: '月', desc: '01' },
      { key: '{{day}}', label: '日', desc: '01' },
      { key: '{{hour}}', label: '时', desc: '12' },
      { key: '{{minute}}', label: '分', desc: '30' },
      { key: '{{second}}', label: '秒', desc: '45' },
    ],
  },
  {
    label: '随机',
    values: [
      { key: '{{random_string:8}}', label: '随机字符串', desc: '8位随机字符' },
      { key: '{{random_int:1:100}}', label: '随机整数', desc: '1~100' },
      { key: '{{random_hex:8}}', label: '随机十六进制', desc: '8位hex' },
    ],
  },
  {
    label: '屏幕',
    values: [
      { key: '{{screen_width}}', label: '屏幕宽度', desc: '设备宽度' },
      { key: '{{screen_height}}', label: '屏幕高度', desc: '设备高度' },
      { key: '{{screen_ratio}}', label: '屏幕比例', desc: '宽高比' },
    ],
  },
  {
    label: '分页',
    values: [
      { key: '{{page}}', label: '页码', desc: 'offset策略' },
      { key: '{{offset}}', label: '偏移量', desc: 'offset策略' },
      { key: '{{cursor}}', label: '游标', desc: 'cursor策略' },
    ],
  },
];

/* ───── JSON 树组件 ───── */
interface JsonTreeViewProps {
  node: JsonTreeNode;
  selectedPath?: string;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (node: JsonTreeNode) => void;
}

function JsonTreeView({ node, selectedPath, expandedPaths, onToggle, onSelect }: JsonTreeViewProps) {
  const isExpanded = expandedPaths.has(node.path);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedPath === node.path;
  const depth = node.path === '$' ? 0 : (node.path.match(/[.\[]/g)?.length ?? 0);

  const typeLabel: Record<string, string> = {
    object: '{}',
    array: '[]',
    string: '""',
    number: '#',
    boolean: '?!',
    null: 'null',
  };

  const preview = (() => {
    if (node.type === 'object') return `{${node.children?.length ?? 0}}`;
    if (node.type === 'array') return `[${Array.isArray(node.value) ? node.value.length : 0}]`;
    if (node.type === 'string') {
      const s = String(node.value);
      return s.length > 30 ? JSON.stringify(s.slice(0, 30)) + '…' : JSON.stringify(s);
    }
    return String(node.value);
  })();

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-1 rounded py-0.5 pr-2 cursor-pointer hover:bg-primary/10 ${isSelected ? 'bg-primary/15' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggle(node.path);
          onSelect(node);
        }}
      >
        {hasChildren ? (
          isExpanded ? <ChevronDown size={13} className="shrink-0 text-muted" /> : <ChevronRight size={13} className="shrink-0 text-muted" />
        ) : <span className="w-[13px] shrink-0" />}
        <span className="text-[10px] text-muted w-5 shrink-0 text-center font-mono">{typeLabel[node.type]}</span>
        <span className="text-xs font-medium truncate">{node.key}</span>
        <span className="text-xs text-muted truncate ml-1">{preview}</span>
      </div>
      {isExpanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <JsonTreeView
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ───── 主组件 ───── */
export default function WallpaperSourcesPanel({ onExecute, mode = 'main' }: WallpaperSourcesPanelProps) {
  const [sources, setSources] = useState<WallpaperSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedApiName, setSelectedApiName] = useState('');
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({});
  const [results, setResults] = useState<any[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);

  /* 创建器状态 */
  const [showCreator, setShowCreator] = useState(false);
  const [creatorStep, setCreatorStep] = useState(1);
  const [creatorTab, setCreatorTab] = useState('categories');
  const [showValidation, setShowValidation] = useState(false);
  const [creatorPayload, setCreatorPayload] = useState<WallpaperSourceCreatorPayload>({
    source: { identifier: '', name: '', version: '1.0.0' },
    config: { request: { global_interval_seconds: 1800, timeout_seconds: 20, max_concurrent: 2, skip_ssl_verify: false, user_agent: 'LittleTreeWallpaper/2.0' } },
    categories: { categories: [{ id: 'default', name: '默认分类' }] },
    apis: [],
  });
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);

  const startCreate = () => {
    setEditingSourceId(null);
    setCreatorPayload({
      source: { identifier: '', name: '', version: '1.0.0' },
      config: { request: { global_interval_seconds: 1800, timeout_seconds: 20, max_concurrent: 2, skip_ssl_verify: false, user_agent: 'LittleTreeWallpaper/2.0' } },
      categories: { categories: [{ id: 'default', name: '默认分类' }] },
      apis: [],
    });
    setShowValidation(false);
    setCreatorStep(1);
    setCreatorTab('categories');
    setShowCreator(true);
  };

  const sourceToCreatorPayload = (source: WallpaperSource): WallpaperSourceCreatorPayload => {
    const categories: WallpaperSourceCategory[] = (source.categories || []).map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      subcategory: c.subcategory,
      subsubcategory: c.subsubcategory,
      icon: c.icon,
      description: c.description,
    }));

    const apis = (source.apis || []).map((api) => ({
      name: api.name || '',
      description: api.description,
      logo: api.logo,
      categories: api.categories || [],
      contains_nsfw: api.contains_nsfw,
      parameters: api.parameters || [],
      request: {
        url: api.request?.url,
        method: api.request?.method,
        timeout_seconds: api.request?.timeout_seconds,
        interval_seconds: api.request?.interval_seconds,
        body: api.request?.body,
        body_type: api.request?.body_type,
        headers: api.request?.headers
          ? Object.entries(api.request.headers).map(([key, value]) => ({ key, value: String(value) }))
          : undefined,
      },
      response: {
        format: api.response?.format,
        type: api.response?.type,
        charset: undefined as string | undefined,
      },
      mapping: {
        items: api.mapping?.items,
        fields: api.mapping?.item_mapping,
      },
      post_process: api.post_process,
      validation: api.validation
        ? {
            required_fields: api.validation.required_fields,
            constraints: (api.validation.field_patterns || []).map((p: any) => ({
              path: p.path,
              regex: p.regex,
              min_length: p.min_length,
              max_length: p.max_length,
              min: p.min,
              max: p.max,
              action: p.action || 'skip',
            })),
          }
        : undefined,
      error_handling: api.error_handling
        ? {
            on_http_4xx: api.error_handling.http_codes?.find((c: any) => c.code >= 400 && c.code < 500)?.fallback ? 'fallback' : undefined,
            on_http_5xx: api.error_handling.http_codes?.find((c: any) => c.code >= 500)?.fallback ? 'fallback' : undefined,
            on_empty_response: api.error_handling.on_empty_response,
            on_mapping_failed: api.error_handling.on_mapping_failed,
            fallback_api: api.error_handling.fallback_to,
          }
        : undefined,
      cache: api.cache,
      static_list_urls: api.static_list?.urls,
      static_dict_items: api.static_dict?.items,
    }));

    return {
      source: {
        identifier: source.identifier || '',
        name: source.name || '',
        version: source.version || '1.0.0',
        description: source.description,
        details: source.details,
        logo: source.logo,
        footer_text: source.footer_text,
      },
      config: {
        request: {
          global_interval_seconds: source.config?.request?.global_interval_seconds ?? 1800,
          timeout_seconds: source.config?.request?.timeout_seconds ?? 20,
          max_concurrent: source.config?.request?.max_concurrent ?? 2,
          skip_ssl_verify: source.config?.request?.skip_ssl_verify ?? false,
          user_agent: source.config?.request?.user_agent ?? 'LittleTreeWallpaper/2.0',
          headers: source.config?.request?.headers
            ? Object.entries(source.config.request.headers).map(([key, value]) => ({ key, value: String(value) }))
            : undefined,
          retry: source.config?.request?.retry,
          cache: source.config?.request?.cache,
          variables: source.config?.request?.variables
            ? Object.entries(source.config.request.variables).map(([key, value]) => ({ key, value: String(value) }))
            : undefined,
        },
      },
      categories: {
        categories,
        category_groups: source.category_groups,
      },
      apis,
    };
  };

  const startEdit = (source: WallpaperSource) => {
    setEditingSourceId(source.identifier);
    setCreatorPayload(sourceToCreatorPayload(source));
    setShowValidation(false);
    setCreatorStep(1);
    setCreatorTab('categories');
    setShowCreator(true);
  };

  /* API 折叠状态 */
  const [apiExpanded, setApiExpanded] = useState<Set<number>>(new Set());

  /* 路径生成器状态 */
  const [pathGenOpen, setPathGenOpen] = useState(false);
  const [pathGenTarget, setPathGenTarget] = useState<{ fieldKey: string; apiIndex: number } | null>(null);
  const [pathGenState, setPathGenState] = useState<PathGenState>({ mode: 'json', segments: [], cssSelector: '', pipes: [] });
  const [jsonSample, setJsonSample] = useState('');
  const [jsonTree, setJsonTree] = useState<JsonTreeNode | null>(null);
  const [jsonTreeExpanded, setJsonTreeExpanded] = useState<Set<string>>(new Set());
  const [jsonTreeSelected, setJsonTreeSelected] = useState('');
  const [editPipeIdx, setEditPipeIdx] = useState<number>(-1);

  /* 特殊值模板生成器状态 */
  const [specialGenOpen, setSpecialGenOpen] = useState(false);
  const [specialGenTarget, setSpecialGenTarget] = useState<{ target: 'mapping' | 'cache'; fieldKey: string; apiIndex: number } | null>(null);

  /* 分类创建器状态 */
  const [expandedCategoryRows, setExpandedCategoryRows] = useState<Set<string>>(new Set());

  const toggleCategoryRow = (id: string) => {
    setExpandedCategoryRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addCategory = (parentId?: string | null) => {
    setCreatorPayload((p) => {
      const cats = [...(p.categories?.categories || [])] as CreatorCategory[];
      let id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      while (cats.some((c) => c.id === id)) {
        id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      }
      cats.push({ id, name: '', parentId: parentId || null });
      return { ...p, categories: { ...p.categories, categories: cats } };
    });
  };

  const updateCategory = (id: string, patch: Partial<CreatorCategory>) => {
    setCreatorPayload((p) => {
      const next = [...(p.categories?.categories || [])] as CreatorCategory[];
      const idx = next.findIndex((c) => c.id === id);
      if (idx < 0) return p;
      next[idx] = { ...next[idx], ...patch };
      if (patch.id && patch.id !== id) {
        next.forEach((c) => { if (c.parentId === id) c.parentId = patch.id!; });
      }
      return { ...p, categories: { ...p.categories, categories: next } };
    });
  };

  const deleteCategory = (id: string) => {
    setCreatorPayload((p) => {
      const cats = [...(p.categories?.categories || [])] as CreatorCategory[];
      const idsToDelete = new Set<string>();
      const collect = (catId: string) => {
        idsToDelete.add(catId);
        cats.filter((c) => c.parentId === catId).forEach((c) => collect(c.id));
      };
      collect(id);
      const next = cats.filter((c) => !idsToDelete.has(c.id));
      return { ...p, categories: { ...p.categories, categories: next } };
    });
  };

  const renderCategoryTree = (nodes: CategoryTreeNode[]) => {
    return nodes.map((node) => (
      <div key={node.id} className="space-y-1">
        <div className="flex items-center gap-2" style={{ paddingLeft: node.depth * 16 }}>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 flex-1 items-center">
            <TextField>
              <Input className="h-8 text-sm w-full min-w-0" value={node.id}
                onChange={(e) => updateCategory(node.id, { id: e.target.value })} placeholder="分类ID"
              />
            </TextField>
            <TextField>
              <Input className="h-8 text-sm w-full min-w-0" value={node.name}
                onChange={(e) => updateCategory(node.id, { name: e.target.value })} placeholder="分类名称"
              />
            </TextField>
            <div className="flex items-center gap-1">
              <Button isIconOnly variant="ghost" size="sm" onPress={() => toggleCategoryRow(node.id)} aria-label="高级">
                {expandedCategoryRows.has(node.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </Button>
              {node.depth < 2 && (
                <Button isIconOnly variant="ghost" size="sm" onPress={() => addCategory(node.id)} aria-label="添加子分类">
                  <Plus size={14} />
                </Button>
              )}
              <Button isIconOnly variant="ghost" size="sm" onPress={() => deleteCategory(node.id)} aria-label="删除分类">
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        </div>
        {expandedCategoryRows.has(node.id) && (
          <div className="grid grid-cols-2 gap-2" style={{ paddingLeft: node.depth * 16 }}>
            <TextField>
              <Label className="text-xs text-muted">图标</Label>
              <Input className="h-8 text-sm" value={node.icon || ''}
                onChange={(e) => updateCategory(node.id, { icon: e.target.value })} placeholder="URL / Base64"
              />
            </TextField>
            <TextField>
              <Label className="text-xs text-muted">描述</Label>
              <Input className="h-8 text-sm" value={node.description || ''}
                onChange={(e) => updateCategory(node.id, { description: e.target.value })} placeholder="分类描述"
              />
            </TextField>
          </div>
        )}
        {node.children.length > 0 && renderCategoryTree(node.children)}
      </div>
    ));
  };

  const { openViewer } = useImageViewer();

  /* ───── 验证 ───── */
  const rawValidation = useMemo(() => {
    const errors: { basic: Record<string, string>; categories: string; apis: Record<number, Record<string, string>>; apisGeneral: string } =
      { basic: {}, categories: '', apis: {}, apisGeneral: '' };

    const id = creatorPayload.source.identifier.trim();
    if (!id) errors.basic.identifier = '标识符为必填项';
    else if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(id)) errors.basic.identifier = '应为反向域名格式，如 com.example.wallpaper';

    if (!creatorPayload.source.name.trim()) errors.basic.name = '名称为必填项';

    const ver = creatorPayload.source.version.trim();
    if (!ver) errors.basic.version = '版本为必填项';
    else if (!/^\d+\.\d+\.\d+$/.test(ver)) errors.basic.version = '版本格式应为 主.次.修订，如 1.0.0';

    const cats = creatorPayload.categories?.categories || [];
    const catError = validateCategories(cats as CreatorCategory[]);
    if (catError) errors.categories = catError;

    const apis = creatorPayload.apis || [];
    if (apis.length === 0) errors.apisGeneral = '请至少添加一个 API';
    else {
      const apiNames = apis.map((a) => a.name.trim()).filter(Boolean);
      if (new Set(apiNames).size !== apiNames.length) errors.apisGeneral = 'API 名称不能重复';

      apis.forEach((api, idx) => {
        const e: Record<string, string> = {};
        if (!api.name.trim()) e.name = 'API 名称为必填项';
        if (!api.categories?.length || api.categories.some((c) => !c.trim())) e.category = '必须绑定至少一个分类';

        const url = api.request?.url?.trim() || '';
        if (!url) e.url = '请求 URL 为必填项';
        else if (!/^https?:\/\/.+/.test(url)) e.url = 'URL 格式不正确，应以 http:// 或 https:// 开头';

        if (!api.response?.format?.trim()) e.format = '响应格式为必填项';

        const isRaw = api.response?.format === 'binary';
        const isMulti = api.response?.type === 'multi' && api.response?.format !== 'binary';

        if (isMulti) {
          const itemsPath = api.mapping?.items?.trim() || '';
          if (!itemsPath) e.items = '条目路径为必填项';
          else if (!itemsPath.startsWith('$')) e.items = '条目路径应以 $ 开头';
        }

        if (!isRaw) {
          const imagePath = api.mapping?.fields?.image?.trim() || '';
          if (!imagePath) e.image = '图片字段映射为必填项';
        }

        if (Object.keys(e).length > 0) errors.apis[idx] = e;
      });
    }

    const hasBasic = Object.keys(errors.basic).length > 0;
    const hasCat = !!errors.categories;
    const hasApi = !!errors.apisGeneral || Object.keys(errors.apis).length > 0;
    const hasContent = hasCat || hasApi;
    return { errors, isValid: !hasBasic && !hasContent, hasBasic, hasContent, tabErrors: { basic: hasBasic, categories: hasCat, api: hasApi } };
  }, [creatorPayload]);

  const validation = useMemo(() => {
    if (showValidation) return rawValidation;
    return { errors: { basic: {}, categories: '', apis: {}, apisGeneral: '' }, isValid: true, hasBasic: false, hasContent: false, tabErrors: { basic: false, categories: false, api: false } };
  }, [rawValidation, showValidation]);

  /* ───── 生命周期 ───── */
  useEffect(() => { loadSources(); }, []);

  useEffect(() => {
    const source = sources.find((s) => s.identifier === selectedSourceId);
    if (!source) { setSelectedApiName(''); setParameterValues({}); return; }
    const api = source.apis?.find((a) => a.name === selectedApiName) ?? source.apis?.[0];
    if (api) {
      if (selectedApiName !== api.name) setSelectedApiName(api.name);
      const next: Record<string, unknown> = {};
      api.parameters?.forEach((param, i) => {
        const key = param.key || `__param_${i}`;
        next[key] = key in parameterValues ? parameterValues[key] : getSourceParameterDefaultValue(param);
      });
      setParameterValues(next);
    } else { setSelectedApiName(''); setParameterValues({}); }
  }, [selectedSourceId, sources]);

  /* ───── 数据加载 ───── */
  const loadSources = async () => {
    setLoading(true);
    try {
      const list = await getWallpaperSources();
      setSources(list);
      if (list.length > 0 && !selectedSourceId) {
        const firstValid = list.find((s) => !s.invalid && s.enabled !== false);
        if (firstValid) setSelectedSourceId(firstValid.identifier);
      }
    } catch (e) { logError('Failed to load wallpaper sources', e); }
    finally { setLoading(false); }
  };

  const handleToggleSource = async (source: WallpaperSource) => {
    try { await setWallpaperSourceEnabled(source.identifier, !source.enabled); await loadSources(); }
    catch (e) { logError('Failed to toggle source', e); }
  };

  const handleDeleteSource = async (source: WallpaperSource) => {
    if (!confirm(`确定要删除壁纸源 "${source.name}" 吗？`)) return;
    try {
      await deleteWallpaperSource(source.identifier);
      if (selectedSourceId === source.identifier) setSelectedSourceId('');
      await loadSources();
    } catch (e) { logError('Failed to delete source', e); }
  };

  const handleExecute = async () => {
    if (!selectedSourceId || !selectedApiName) return;
    const source = sources.find((s) => s.identifier === selectedSourceId);
    const api = source?.apis?.find((a) => a.name === selectedApiName);
    if (!api) return;
    setResultsLoading(true); setResults([]);
    try {
      const payload: Record<string, unknown> = {};
      api.parameters?.forEach((param, i) => {
        const key = param.key || `__param_${i}`;
        payload[key] = normalizeSourceParameterValue(param, parameterValues[key]);
      });
      const items = await executeWallpaperSource(selectedSourceId, selectedApiName, payload);
      setResults(items || []); onExecute?.(items || []);
    } catch (e) { logError('Execute source failed', e); }
    finally { setResultsLoading(false); }
  };

  const handleImport = async () => {
    try {
      const imported = await pickAndImportSource();
      if (imported) { await loadSources(); setSelectedSourceId(imported.identifier); }
    } catch (e) { logError('Import failed', e); }
  };

  const selectedSource = useMemo(() => sources.find((s) => s.identifier === selectedSourceId), [sources, selectedSourceId]);
  const selectedApi = useMemo(() => selectedSource?.apis?.find((a) => a.name === selectedApiName), [selectedSource, selectedApiName]);
  const validSources = sources.filter((s) => !s.invalid);
  const invalidSources = sources.filter((s) => s.invalid);

  const handleSetWallpaper = async (url: string, title: string) => {
    const safeName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || 'wallpaper';
    const path = await downloadFile(url, `${safeName}.jpg`);
    if (path) await setWallpaper(path);
  };

  const handleFavorite = async (item: any) => {
    await addFavorite({
      folder_id: 'default',
      title: item.title || '未命名',
      description: item.description || '',
      tags: [],
      preview_url: item.preview_url || item.image_url,
      local_path: null,
      source_type: item.source_id || 'unknown',
      source_url: item.image_url,
    });
  };

  const normalizeLocalImage = (url: string | undefined): string => {
    if (!url) return '';
    if (url.startsWith('/api/preview') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
    if (url.startsWith('file://')) return localPreviewUrl(decodeURIComponent(url.slice(7)));
    if (/^[a-zA-Z]:\\|^\//.test(url)) return localPreviewUrl(url);
    return url;
  };

  const openResultViewer = (startIndex = 0) => {
    openViewer(results.map((item) => {
      const imageUrl = normalizeLocalImage(item.image_url);
      const previewUrl = normalizeLocalImage(item.preview_url || imageUrl);
      return {
        src: imageUrl, title: item.title || '壁纸', description: item.description || '',
        source_url: imageUrl, preview_url: previewUrl, source_type: item.source_id || 'source',
        copyright: item.copyright || '',
      };
    }), startIndex);
  };

  /* ───── 路径生成器 ───── */
  const openPathGen = (fieldKey: string, apiIndex: number) => {
    setPathGenTarget({ fieldKey, apiIndex });
    let expr = '';
    if (fieldKey === 'items') {
      expr = creatorPayload.apis?.[apiIndex]?.mapping?.items || '';
    } else {
      expr = creatorPayload.apis?.[apiIndex]?.mapping?.fields?.[fieldKey] || '';
    }
    setPathGenState(parsePathExpression(expr));
    setPathGenOpen(true);
  };

  const applyPathGen = () => {
    if (!pathGenTarget) return;
    const { fieldKey, apiIndex } = pathGenTarget;
    const expr = buildPathExpression(pathGenState);
    const next = [...(creatorPayload.apis || [])];
    if (fieldKey === 'items') {
      next[apiIndex] = {
        ...next[apiIndex],
        mapping: { ...next[apiIndex].mapping, items: expr },
      };
    } else {
      next[apiIndex] = {
        ...next[apiIndex],
        mapping: { ...next[apiIndex].mapping, fields: { ...next[apiIndex].mapping?.fields, [fieldKey]: expr } },
      };
    }
    setCreatorPayload((prev) => ({ ...prev, apis: next }));
    setPathGenOpen(false);
  };

  const openSpecialGen = (fieldKey: string, apiIndex: number, target: 'mapping' | 'cache' = 'mapping') => {
    setSpecialGenTarget({ target, fieldKey, apiIndex });
    setSpecialGenOpen(true);
  };

  const applySpecialValue = (value: string) => {
    if (!specialGenTarget) return;
    const { target, fieldKey, apiIndex } = specialGenTarget;
    const next = [...(creatorPayload.apis || [])];
    if (target === 'cache') {
      const current = next[apiIndex]?.cache?.key_template || '';
      const nextValue = current ? `${current}${value}` : value;
      next[apiIndex] = { ...next[apiIndex], cache: { ...next[apiIndex].cache, key_template: nextValue } };
    } else {
      const current = next[apiIndex]?.mapping?.fields?.[fieldKey] || '';
      const nextValue = current ? `${current} ${value}` : value;
      next[apiIndex] = {
        ...next[apiIndex],
        mapping: { ...next[apiIndex].mapping, fields: { ...next[apiIndex].mapping?.fields, [fieldKey]: nextValue } },
      };
    }
    setCreatorPayload((prev) => ({ ...prev, apis: next }));
    setSpecialGenOpen(false);
  };

  /* ───── payload 更新辅助 ───── */
  const updateApi = (idx: number, patch: Partial<NonNullable<typeof creatorPayload.apis>[number]>) => {
    const next = [...(creatorPayload.apis || [])];
    next[idx] = { ...next[idx], ...patch };
    setCreatorPayload((prev) => ({ ...prev, apis: next }));
  };

  /* ───── 渲染 ───── */
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {mode === 'management' && (
          <>
            <Button size="sm" variant="secondary" onPress={handleImport}><Upload size={14} /> 导入</Button>
            <Button size="sm" variant="secondary" onPress={startCreate}><Plus size={14} /> 创建</Button>
          </>
        )}
        <Button size="sm" variant="ghost" onPress={loadSources} isDisabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新
        </Button>
      </div>

      {validSources.length === 0 && invalidSources.length === 0 && !loading && (
        <div className="py-10 text-center text-muted">
          {mode === 'management' ? '暂无壁纸源，点击"导入"添加 .ltws 文件' : '暂无壁纸源'}
        </div>
      )}

      {validSources.length > 0 && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {validSources.map((s) => (
              <Button key={s.identifier} size="sm"
                variant={selectedSourceId === s.identifier ? 'primary' : 'ghost'}
                onPress={() => setSelectedSourceId(s.identifier)} className="flex items-center gap-1"
              >
                {s.logo && <img src={s.logo} alt="" className="h-4 w-4 rounded" />}
                {s.name}{!s.enabled && <span className="text-xs opacity-60">(已禁用)</span>}
              </Button>
            ))}
          </div>
          {selectedSource && (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedSource.logo && <img src={selectedSource.logo} alt="" className="h-8 w-8 rounded" />}
                  <div>
                    <div className="font-medium">{selectedSource.name}</div>
                    <div className="text-xs text-muted">{selectedSource.identifier} &middot; v{selectedSource.version}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Switch isSelected={selectedSource.enabled !== false} onChange={() => handleToggleSource(selectedSource)}>
                    <Switch.Control><Switch.Thumb /></Switch.Control>
                  </Switch>
                  {mode === 'management' && selectedSource.can_delete && (
                    <Button isIconOnly variant="ghost" size="sm" onPress={() => startEdit(selectedSource)} aria-label="编辑">
                      <Pencil size={14} />
                    </Button>
                  )}
                  {selectedSource.can_delete && (
                    <Button isIconOnly variant="ghost" size="sm" onPress={() => handleDeleteSource(selectedSource)}>
                      <Trash2 size={14} className="text-danger" />
                    </Button>
                  )}
                </div>
              </div>
              {selectedSource.apis && selectedSource.apis.length > 0 && (
                <div className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    {selectedSource.apis.map((api) => (
                      <Button key={api.name} size="sm"
                        variant={selectedApiName === api.name ? 'primary' : 'ghost'}
                        onPress={() => setSelectedApiName(api.name)}
                      >{api.name}</Button>
                    ))}
                  </div>
                  {selectedApi && selectedApi.parameters && selectedApi.parameters.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {selectedApi.parameters.map((param, i) => {
                        const key = param.key || `__param_${i}`;
                        if (param.hidden) return null;
                        const label = param.label || param.key;
                        const type = param.type || 'text';
                        return (
                          <div key={key} className="space-y-1">
                            <Label className="text-xs text-muted">{label}</Label>
                            {type === 'choice' && param.choices ? (
                              <ComboBox selectedKey={String(parameterValues[key] || '')}
                                onSelectionChange={(k) => setParameterValues((p) => ({ ...p, [key]: String(k || '') }))}
                              >
                                <ComboBox.InputGroup><Input className="h-8 text-sm" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                <ComboBox.Popover><ListBox>
                                  {param.choices.map((c) => <ListBox.Item key={c} id={c} textValue={c}>{c}</ListBox.Item>)}
                                </ListBox></ComboBox.Popover>
                              </ComboBox>
                            ) : type === 'boolean' ? (
                              <Switch isSelected={Boolean(parameterValues[key])} onChange={(v) => setParameterValues((p) => ({ ...p, [key]: v }))}>
                                <Switch.Control><Switch.Thumb /></Switch.Control>
                              </Switch>
                            ) : (
                              <Input className="h-8 text-sm" value={String(parameterValues[key] || '')}
                                onChange={(e) => setParameterValues((p) => ({ ...p, [key]: e.target.value }))} placeholder={param.placeholder || ''}
                              />
                            )}
                            {param.description && <div className="text-xs text-muted">{param.description}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {mode !== 'management' && (
                    <Button size="sm" onPress={handleExecute} isDisabled={resultsLoading}>
                      <Play size={14} /> {resultsLoading ? '执行中...' : '执行查询'}
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {invalidSources.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-danger">加载失败的源</div>
          {invalidSources.map((s) => (
            <Card key={s.identifier} className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="text-danger" />
                <div><div className="text-sm">{s.name || s.identifier}</div><div className="text-xs text-muted">{s.error}</div></div>
              </div>
              {s.can_delete && <Button isIconOnly variant="ghost" size="sm" onPress={() => handleDeleteSource(s)}><Trash2 size={14} className="text-danger" /></Button>}
            </Card>
          ))}
        </div>
      )}

      {mode !== 'management' && results.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium">查询结果 ({results.length})</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {results.map((item, idx) => {
              const imageUrl = normalizeLocalImage(item.image_url);
              const previewUrl = normalizeLocalImage(item.preview_url || imageUrl);
              return (
                <div key={item.id || idx} className="group relative overflow-hidden rounded-lg cursor-pointer"
                  onClick={() => openResultViewer(idx)}
                >
                  <img src={previewUrl} alt={item.title}
                    className="h-[120px] w-full object-cover transition-transform group-hover:scale-105" loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                    <div className="text-xs text-white truncate">{item.title}</div>
                    <div className="flex gap-1 mt-1">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-white"
                        onPress={() => handleSetWallpaper(imageUrl, item.title)}><ImageIcon size={12} /></Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-white"
                        onPress={() => handleFavorite(item)}><Heart size={12} /></Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-white"
                        onPress={() => copyToClipboard(imageUrl)}><Copy size={12} /></Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════ 创建器 Drawer ═══════════ */}
      {showCreator && (
        <Drawer.Backdrop isOpen={showCreator} onOpenChange={setShowCreator} isDismissable={false}>
          <Drawer.Content placement="right">
            <Drawer.Dialog>
              <Drawer.Header><Drawer.Heading>{editingSourceId ? '编辑壁纸源' : '创建壁纸源'}</Drawer.Heading></Drawer.Header>
              <Drawer.Body>
                {/* 面包屑导航 */}
                <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border">
                  <div className={`flex items-center gap-2 ${creatorStep === 1 ? 'text-primary font-medium' : 'text-muted'}`}>
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${creatorStep === 1 ? 'bg-accent text-accent-foreground' : 'bg-surface-tertiary text-foreground'}`}>1</span>
                    <span className="text-sm">基本信息</span>
                  </div>
                  <span className="text-muted text-sm">›</span>
                  <div className={`flex items-center gap-2 ${creatorStep === 2 ? 'text-primary font-medium' : 'text-muted'}`}>
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${creatorStep === 2 ? 'bg-accent text-accent-foreground' : 'bg-surface-tertiary text-foreground'}`}>2</span>
                    <span className="text-sm">内容设置</span>
                  </div>
                </div>

                {creatorStep === 1 ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-muted mb-2">基本信息</h3>
                    <div className="space-y-3">
                        <TextField isInvalid={!!validation.errors.basic.identifier}>
                          <Label>标识符 (反向域名格式)</Label>
                          <Input value={creatorPayload.source?.identifier || ''}
                            disabled={!!editingSourceId}
                            onChange={(e) => setCreatorPayload((p) => ({ ...p, source: { ...p.source, identifier: e.target.value } }))}
                            placeholder="com.example.my_source"
                          />
                          <FieldError>{validation.errors.basic.identifier}</FieldError>
                        </TextField>
                      <TextField isInvalid={!!validation.errors.basic.name}>
                        <Label>名称</Label>
                        <Input value={creatorPayload.source?.name || ''}
                          onChange={(e) => setCreatorPayload((p) => ({ ...p, source: { ...p.source, name: e.target.value } }))}
                          placeholder="我的壁纸源"
                        />
                        <FieldError>{validation.errors.basic.name}</FieldError>
                      </TextField>
                      <TextField isInvalid={!!validation.errors.basic.version}>
                        <Label>版本</Label>
                        <Input value={creatorPayload.source?.version || '1.0.0'}
                          onChange={(e) => setCreatorPayload((p) => ({ ...p, source: { ...p.source, version: e.target.value } }))}
                        />
                        <FieldError>{validation.errors.basic.version}</FieldError>
                      </TextField>
                      <TextField>
                        <Label>描述</Label>
                        <TextArea value={creatorPayload.source?.description || ''}
                          onChange={(e) => setCreatorPayload((p) => ({ ...p, source: { ...p.source, description: e.target.value } }))} rows={2}
                        />
                      </TextField>
                      <TextField>
                        <Label>详细说明 (Markdown)</Label>
                        <TextArea value={creatorPayload.source?.details || ''}
                          onChange={(e) => setCreatorPayload((p) => ({ ...p, source: { ...p.source, details: e.target.value } }))} rows={3}
                        />
                      </TextField>
                      <TextField>
                        <Label>Logo (Base64 或 URL)</Label>
                        <Input value={creatorPayload.source?.logo || ''}
                          onChange={(e) => setCreatorPayload((p) => ({ ...p, source: { ...p.source, logo: e.target.value } }))}
                          placeholder="data:image/svg+xml;base64,..."
                        />
                      </TextField>
                      <TextField>
                        <Label>底部文案</Label>
                        <Input value={creatorPayload.source?.footer_text || ''}
                          onChange={(e) => setCreatorPayload((p) => ({ ...p, source: { ...p.source, footer_text: e.target.value } }))}
                          placeholder="© 2026 示例壁纸源"
                        />
                      </TextField>

                      <Accordion variant="surface">
                        <Accordion.Item id="config">
                          <Accordion.Heading>
                            <Accordion.Trigger>
                              <ChevronDown size={14} className="text-muted shrink-0" />
                              <span>全局配置</span>
                              <Accordion.Indicator><ChevronDown size={14} /></Accordion.Indicator>
                            </Accordion.Trigger>
                          </Accordion.Heading>
                          <Accordion.Panel>
                            <Accordion.Body>
                              <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-2">
                                  <TextField>
                                    <Label className="text-xs">请求间隔 (秒)</Label>
                                    <Input type="number" className="h-8 text-sm"
                                      value={String(creatorPayload.config?.request?.global_interval_seconds ?? 1800)}
                                      onChange={(e) => setCreatorPayload((p) => ({ ...p, config: { request: { ...p.config?.request, global_interval_seconds: Number(e.target.value) } } }))}
                                    />
                                  </TextField>
                                  <TextField>
                                    <Label className="text-xs">超时 (秒)</Label>
                                    <Input type="number" className="h-8 text-sm"
                                      value={String(creatorPayload.config?.request?.timeout_seconds ?? 20)}
                                      onChange={(e) => setCreatorPayload((p) => ({ ...p, config: { request: { ...p.config?.request, timeout_seconds: Number(e.target.value) } } }))}
                                    />
                                  </TextField>
                                  <TextField>
                                    <Label className="text-xs">最大并发</Label>
                                    <Input type="number" className="h-8 text-sm"
                                      value={String(creatorPayload.config?.request?.max_concurrent ?? 2)}
                                      onChange={(e) => setCreatorPayload((p) => ({ ...p, config: { request: { ...p.config?.request, max_concurrent: Number(e.target.value) } } }))}
                                    />
                                  </TextField>
                                  <TextField>
                                    <Label className="text-xs">最大响应 (MB)</Label>
                                    <Input type="number" className="h-8 text-sm"
                                      value={String(creatorPayload.config?.request?.max_response_size_mb ?? 10)}
                                      onChange={(e) => setCreatorPayload((p) => ({ ...p, config: { request: { ...p.config?.request, max_response_size_mb: Number(e.target.value) } } }))}
                                    />
                                  </TextField>
                                </div>
                                <TextField>
                                  <Label className="text-xs">User-Agent</Label>
                                  <Input className="h-8 text-sm"
                                    value={creatorPayload.config?.request?.user_agent || 'LittleTreeWallpaper/2.0'}
                                    onChange={(e) => setCreatorPayload((p) => ({ ...p, config: { request: { ...p.config?.request, user_agent: e.target.value } } }))}
                                  />
                                </TextField>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm">跳过 SSL 验证</span>
                                  <Switch isSelected={creatorPayload.config?.request?.skip_ssl_verify ?? false}
                                    onChange={(v) => setCreatorPayload((p) => ({ ...p, config: { request: { ...p.config?.request, skip_ssl_verify: v } } }))}
                                  ><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                                </div>
                              </div>
                            </Accordion.Body>
                          </Accordion.Panel>
                        </Accordion.Item>
                      </Accordion>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Tabs selectedKey={creatorTab} onSelectionChange={(k) => setCreatorTab(String(k))}>
                      <Tabs.ListContainer>
                        <Tabs.List>
                          <Tabs.Tab id="categories"><span className="flex items-center gap-1">分类{validation.tabErrors.categories && <span className="h-2 w-2 rounded-full bg-danger inline-block" />}</span><Tabs.Indicator /></Tabs.Tab>
                          <Tabs.Tab id="api"><span className="flex items-center gap-1">API{validation.tabErrors.api && <span className="h-2 w-2 rounded-full bg-danger inline-block" />}</span><Tabs.Indicator /></Tabs.Tab>
                        </Tabs.List>
                      </Tabs.ListContainer>

                      {/* ─── 分类 ─── */}
                      <Tabs.Panel id="categories">
                        <div className="space-y-3">
                          {validation.errors.categories && <div className="text-sm text-danger">{validation.errors.categories}</div>}
                          {renderCategoryTree(buildCategoryTree((creatorPayload.categories?.categories || []) as CreatorCategory[]))}
                          <Button size="sm" variant="secondary" onPress={() => addCategory(null)}>
                            <Plus size={14} /> 添加分类
                          </Button>
                        </div>
                      </Tabs.Panel>

                  {/* ─── API ─── */}
                  <Tabs.Panel id="api">
                    <div className="space-y-3">
                      {validation.errors.apisGeneral && <div className="text-sm text-danger">{validation.errors.apisGeneral}</div>}
                      {(creatorPayload.apis || []).map((api, idx) => {
                        const e = validation.errors.apis[idx] || {};
                        const catTree = buildCategoryTree((creatorPayload.categories?.categories || []) as CreatorCategory[]);
                        const renderCatOptions = (nodes: CategoryTreeNode[]): React.ReactNode[] =>
                          nodes.flatMap((node) => [
                            <ListBox.Item key={node.id} id={node.id} textValue={node.name}>
                              <span style={{ paddingLeft: node.depth * 12 }}>{node.name}</span>
                            </ListBox.Item>,
                            ...(node.children.length > 0 ? renderCatOptions(node.children) : []),
                          ]);
                        const pOpt = PAGINATION_OPTIONS.find((o) => o.value === (api.pagination?.strategy || ''));
                        return (
                          <div key={idx} className="rounded-lg border border-border bg-surface p-0 overflow-hidden">
                            {/* API 标题栏（可点击展开/折叠） */}
                            <div
                              className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-surface-secondary transition-colors"
                              onClick={() => {
                                setApiExpanded((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(idx)) next.delete(idx);
                                  else next.add(idx);
                                  return next;
                                });
                              }}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {apiExpanded.has(idx) ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
                                <span className="text-sm font-medium truncate">{api.name || '未命名接口'}</span>
                                {Object.keys(e).length > 0 && <span className="h-2 w-2 rounded-full bg-danger shrink-0" />}
                              </div>
                              <div onClick={(e) => e.stopPropagation()}>
                                <Button isIconOnly variant="ghost" size="sm" className="h-6 w-6"
                                  onPress={() => {
                                    const next = (creatorPayload.apis || []).filter((_, i) => i !== idx);
                                    setCreatorPayload((p) => ({ ...p, apis: next }));
                                  }}
                                ><Trash2 size={14} /></Button>
                              </div>
                            </div>

                            {/* 折叠内容 */}
                            {apiExpanded.has(idx) && (
                              <div className="px-3 pb-3 space-y-2 border-t border-border">
                                {/* 名称 */}
                                <TextField className="pt-2" isInvalid={!!e.name}>
                                  <Label className="text-xs text-muted">API 名称</Label>
                                  <Input className="h-8 text-sm" value={api.name}
                                    onChange={(ev) => updateApi(idx, { name: ev.target.value })} placeholder="API名称"
                                  />
                                  <FieldError>{e.name}</FieldError>
                                </TextField>

                                {/* 描述 / Logo */}
                            <TextField>
                              <Label className="text-xs text-muted">描述</Label>
                              <Input className="h-8 text-sm" value={api.description || ''}
                                onChange={(ev) => updateApi(idx, { description: ev.target.value })} placeholder="接口简要描述"
                              />
                            </TextField>
                            <TextField>
                              <Label className="text-xs text-muted">Logo</Label>
                              <Input className="h-8 text-sm" value={api.logo || ''}
                                onChange={(ev) => updateApi(idx, { logo: ev.target.value })} placeholder="Base64 或 URL"
                              />
                            </TextField>

                            {/* 分类 */}
                            <TextField isInvalid={!!e.category}>
                              <Label className="text-xs text-muted">绑定分类</Label>
                              <ComboBox className="w-full" selectedKey={api.categories?.[0] || ''}
                                onSelectionChange={(k) => updateApi(idx, { categories: k ? [String(k)] : [] })}
                              >
                                <ComboBox.InputGroup><Input className="h-8 text-sm" placeholder="选择分类" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                <ComboBox.Popover><ListBox>
                                  {renderCatOptions(catTree)}
                                </ListBox></ComboBox.Popover>
                              </ComboBox>
                              <FieldError>{e.category}</FieldError>
                            </TextField>

                            {/* Request */}
                            <TextField isInvalid={!!e.url}>
                              <Label className="text-xs text-muted">请求 URL</Label>
                              <Input className="h-8 text-sm" value={api.request?.url || ''}
                                onChange={(ev) => updateApi(idx, { request: { ...api.request, url: ev.target.value } })} placeholder="https://api.example.com/..."
                              />
                              <FieldError>{e.url}</FieldError>
                            </TextField>
                            <div className="grid grid-cols-3 gap-2">
                              <TextField>
                                <Label className="text-xs text-muted">请求方法</Label>
                                <ComboBox selectedKey={api.request?.method || 'GET'}
                                  onSelectionChange={(k) => updateApi(idx, { request: { ...api.request, method: String(k) } })}
                                >
                                  <ComboBox.InputGroup><Input className="h-8 text-sm" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                  <ComboBox.Popover><ListBox>
                                    {HTTP_METHODS.map((m) => <ListBox.Item key={m} id={m} textValue={m}>{m}</ListBox.Item>)}
                                  </ListBox></ComboBox.Popover>
                                </ComboBox>
                              </TextField>
                              <TextField>
                                <Label className="text-xs text-muted">超时(秒)</Label>
                                <Input type="number" className="h-8 text-sm"
                                  value={String(api.request?.timeout_seconds ?? '')}
                                  onChange={(ev) => updateApi(idx, { request: { ...api.request, timeout_seconds: Number(ev.target.value) } })}
                                  placeholder="20"
                                />
                              </TextField>
                              <TextField>
                                <Label className="text-xs text-muted">间隔(秒)</Label>
                                <Input type="number" className="h-8 text-sm"
                                  value={String(api.request?.interval_seconds ?? '')}
                                  onChange={(ev) => updateApi(idx, { request: { ...api.request, interval_seconds: Number(ev.target.value) } })}
                                  placeholder="0"
                                />
                              </TextField>
                            </div>
                            {api.request?.method !== 'GET' && (
                              <TextField>
                                <Label className="text-xs text-muted">请求体</Label>
                                <TextArea className="text-sm" value={api.request?.body || ''}
                                  onChange={(ev) => updateApi(idx, { request: { ...api.request, body: ev.target.value } })} rows={3}
                                />
                              </TextField>
                            )}

                            {/* Headers */}
                            <div className="space-y-1">
                              <Label className="text-xs text-muted">请求头</Label>
                              {(api.request?.headers || []).map((h, hi) => (
                                <div key={hi} className="flex items-center gap-2">
                                  <Input className="h-7 text-xs flex-1 min-w-0" value={h.key}
                                    onChange={(ev) => {
                                      const next = [...(api.request?.headers || [])];
                                      next[hi] = { ...next[hi], key: ev.target.value };
                                      updateApi(idx, { request: { ...api.request, headers: next } });
                                    }} placeholder="Key"
                                  />
                                  <Input className="h-7 text-xs flex-1 min-w-0" value={h.value}
                                    onChange={(ev) => {
                                      const next = [...(api.request?.headers || [])];
                                      next[hi] = { ...next[hi], value: ev.target.value };
                                      updateApi(idx, { request: { ...api.request, headers: next } });
                                    }} placeholder="Value"
                                  />
                                  <Button isIconOnly variant="ghost" size="sm" className="h-7 w-7 shrink-0"
                                    onPress={() => {
                                      const next = (api.request?.headers || []).filter((_, i) => i !== hi);
                                      updateApi(idx, { request: { ...api.request, headers: next } });
                                    }}
                                  ><Trash2 size={12} /></Button>
                                </div>
                              ))}
                              <Button size="sm" variant="secondary" className="h-7 text-xs"
                                onPress={() => updateApi(idx, { request: { ...api.request, headers: [...(api.request?.headers || []), { key: '', value: '' }] } })}
                              ><Plus size={12} /> 添加 Header</Button>
                            </div>

                            {/* 用户参数 */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <div>
                                  <Label className="text-xs text-muted block">用户参数</Label>
                                  <Description className="text-[10px] text-muted">声明在 URL / 请求体中使用的模板变量，客户端会展示给用户填写</Description>
                                </div>
                                <Button size="sm" variant="secondary" className="h-7 text-xs"
                                  onPress={() => updateApi(idx, { parameters: [...(api.parameters || []), { key: '', label: '', type: 'text', default: '' }] })}
                                ><Plus size={12} /> 添加参数</Button>
                              </div>
                              {(api.parameters || []).map((param, pi) => {
                                const pkey = param.key || `__param_${pi}`;
                                const ptype = param.type || 'text';
                                return (
                                  <div key={pkey} className="rounded-lg border border-border bg-surface-secondary p-2 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[10px] text-muted shrink-0">参数 #{pi + 1}</span>
                                      <Button isIconOnly variant="ghost" size="sm" className="h-6 w-6 shrink-0"
                                        onPress={() => {
                                          const next = (api.parameters || []).filter((_, i) => i !== pi);
                                          updateApi(idx, { parameters: next });
                                        }}
                                      ><Trash2 size={12} /></Button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <TextField>
                                        <Label className="text-[10px] text-muted">变量名 (key)</Label>
                                        <Input className="h-8 text-sm" value={param.key || ''}
                                          onChange={(ev) => {
                                            const next = [...(api.parameters || [])];
                                            next[pi] = { ...next[pi], key: ev.target.value };
                                            updateApi(idx, { parameters: next });
                                          }} placeholder="如 resolution"
                                        />
                                      </TextField>
                                      <TextField>
                                        <Label className="text-[10px] text-muted">显示标签</Label>
                                        <Input className="h-8 text-sm" value={param.label || ''}
                                          onChange={(ev) => {
                                            const next = [...(api.parameters || [])];
                                            next[pi] = { ...next[pi], label: ev.target.value };
                                            updateApi(idx, { parameters: next });
                                          }} placeholder="如 分辨率"
                                        />
                                      </TextField>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <Label className="text-[10px] text-muted block">类型</Label>
                                        <ComboBox selectedKey={ptype}
                                          onSelectionChange={(k) => {
                                            const next = [...(api.parameters || [])];
                                            const nextType = String(k || 'text') as 'text' | 'choice' | 'boolean';
                                            next[pi] = { ...next[pi], type: nextType };
                                            updateApi(idx, { parameters: next });
                                          }}
                                        >
                                          <ComboBox.InputGroup><Input className="h-8 text-sm" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                          <ComboBox.Popover><ListBox>
                                            {PARAMETER_TYPES.map((t) => <ListBox.Item key={t.value} id={t.value} textValue={t.label}>{t.label}</ListBox.Item>)}
                                          </ListBox></ComboBox.Popover>
                                        </ComboBox>
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-[10px] text-muted block">默认值</Label>
                                        {ptype === 'boolean' ? (
                                          <Switch isSelected={Boolean(param.default)}
                                            onChange={(v) => {
                                              const next = [...(api.parameters || [])];
                                              next[pi] = { ...next[pi], default: v };
                                              updateApi(idx, { parameters: next });
                                            }}
                                          ><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                                        ) : (
                                          <Input className="h-8 text-sm w-full min-w-0" value={String(param.default ?? '')}
                                            onChange={(ev) => {
                                              const next = [...(api.parameters || [])];
                                              next[pi] = { ...next[pi], default: ev.target.value };
                                              updateApi(idx, { parameters: next });
                                            }} placeholder="默认值"
                                          />
                                        )}
                                      </div>
                                    </div>
                                    {ptype === 'choice' && (
                                      <TextField>
                                        <Label className="text-[10px] text-muted">可选项（英文逗号分隔）</Label>
                                        <Input className="h-8 text-sm" value={(param.choices || []).join(', ')}
                                          onChange={(ev) => {
                                            const next = [...(api.parameters || [])];
                                            next[pi] = { ...next[pi], choices: ev.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) };
                                            updateApi(idx, { parameters: next });
                                          }} placeholder="如 1920x1080, 2560x1440"
                                        />
                                      </TextField>
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                      <TextField>
                                        <Label className="text-[10px] text-muted">占位提示</Label>
                                        <Input className="h-8 text-sm" value={param.placeholder || ''}
                                          onChange={(ev) => {
                                            const next = [...(api.parameters || [])];
                                            next[pi] = { ...next[pi], placeholder: ev.target.value };
                                            updateApi(idx, { parameters: next });
                                          }} placeholder="输入提示"
                                        />
                                      </TextField>
                                      <TextField>
                                        <Label className="text-[10px] text-muted">说明</Label>
                                        <Input className="h-8 text-sm" value={param.description || ''}
                                          onChange={(ev) => {
                                            const next = [...(api.parameters || [])];
                                            next[pi] = { ...next[pi], description: ev.target.value };
                                            updateApi(idx, { parameters: next });
                                          }} placeholder="参数说明"
                                        />
                                      </TextField>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Switch isSelected={Boolean(param.hidden)}
                                        onChange={(v) => {
                                          const next = [...(api.parameters || [])];
                                          next[pi] = { ...next[pi], hidden: v };
                                          updateApi(idx, { parameters: next });
                                        }}
                                      ><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                                      <span className="text-xs text-muted">隐藏参数（不展示在 UI，但仍以默认值参与模板）</span>
                                    </div>
                                    {(ptype === 'text') && (
                                      <div className="grid grid-cols-2 gap-2">
                                        <TextField>
                                          <Label className="text-[10px] text-muted">最小长度</Label>
                                          <Input type="number" className="h-8 text-sm" value={String(param.min_length ?? '')}
                                            onChange={(ev) => {
                                              const next = [...(api.parameters || [])];
                                              next[pi] = { ...next[pi], min_length: ev.target.value ? Number(ev.target.value) : undefined };
                                              updateApi(idx, { parameters: next });
                                            }} placeholder="可选"
                                          />
                                        </TextField>
                                        <TextField>
                                          <Label className="text-[10px] text-muted">最大长度</Label>
                                          <Input type="number" className="h-8 text-sm" value={String(param.max_length ?? '')}
                                            onChange={(ev) => {
                                              const next = [...(api.parameters || [])];
                                              next[pi] = { ...next[pi], max_length: ev.target.value ? Number(ev.target.value) : undefined };
                                              updateApi(idx, { parameters: next });
                                            }} placeholder="可选"
                                          />
                                        </TextField>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Response */}
                            <div className="space-y-2">
                              <div>
                                <Label className="text-xs text-muted block">返回设置</Label>
                                <Description className="text-[10px] text-muted block">选择 API 响应格式，决定客户端如何解析返回数据</Description>
                              </div>
                              <div className="space-y-2">
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted block">响应格式</Label>
                                  <ComboBox selectedKey={api.response?.format || 'json'}
                                    onSelectionChange={(k) => {
                                      const format = String(k);
                                      const isBinary = format === 'binary';
                                      updateApi(idx, {
                                        response: {
                                          ...api.response,
                                          format,
                                          type: isBinary ? 'single' : (api.response?.type === 'single' && api.response?.format === 'binary' ? 'multi' : (api.response?.type || 'multi')),
                                          charset: isBinary ? undefined : api.response?.charset,
                                        },
                                      });
                                    }}
                                  >
                                    <ComboBox.InputGroup><Input className="h-8 text-sm" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                    <ComboBox.Popover><ListBox>
                                      {RESPONSE_FORMATS_WITH_DESC.map((f) => (
                                        <ListBox.Item key={f.value} id={f.value} textValue={f.label}>
                                          <div className="flex flex-col">
                                            <Label>{f.label}</Label>
                                            <Description>{f.desc}</Description>
                                          </div>
                                        </ListBox.Item>
                                      ))}
                                    </ListBox></ComboBox.Popover>
                                  </ComboBox>
                                  {e.format && <div className="text-sm text-danger">{e.format}</div>}
                                </div>
                                {api.response?.format !== 'binary' ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                      <Label className="text-[10px] text-muted block">返回类型</Label>
                                      <ComboBox selectedKey={api.response?.type || 'multi'}
                                        onSelectionChange={(k) => updateApi(idx, { response: { ...api.response, type: String(k) } })}
                                      >
                                        <ComboBox.InputGroup><Input className="h-8 text-sm" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                        <ComboBox.Popover><ListBox>
                                          {RESPONSE_TYPES.map((t) => <ListBox.Item key={t} id={t} textValue={t === 'single' ? '单条' : '多条'}>{t === 'single' ? '单条' : '多条'}</ListBox.Item>)}
                                        </ListBox></ComboBox.Popover>
                                      </ComboBox>
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-[10px] text-muted block">字符编码</Label>
                                      <Input className="h-8 text-sm w-full min-w-0" value={api.response?.charset || ''}
                                        onChange={(ev) => updateApi(idx, { response: { ...api.response, charset: ev.target.value } })}
                                        placeholder="如 utf-8"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="rounded-lg border border-border bg-surface-secondary p-2 text-xs text-muted leading-relaxed">
                                    当前格式为 <strong>BINARY</strong>，响应体即图片数据，条目类型固定为「单条」，无需设置字符编码。
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Mapping Fields */}
                            {api.response?.type === 'multi' && api.response?.format !== 'binary' && (
                              <TextField isInvalid={!!e.items}>
                                <Label className="text-xs text-muted">条目路径 (items)</Label>
                                <Description className="text-[10px] text-muted block">
                                  指定如何从响应中提取壁纸条目列表的路径表达式，如 $.data.list[*]
                                </Description>
                                <div className="flex items-start gap-2">
                                  <Input className="h-8 text-sm flex-1" value={api.mapping?.items || ''}
                                    onChange={(ev) => updateApi(idx, { mapping: { ...api.mapping, items: ev.target.value } })}
                                    placeholder="$.data.list[*]"
                                  />
                                  <Tooltip delay={0}>
                                    <Tooltip.Trigger>
                                      <Button isIconOnly variant="ghost" size="sm" className="mt-0.5" onPress={() => openPathGen('items', idx)}><Wand2 size={14} /></Button>
                                    </Tooltip.Trigger>
                                    <Tooltip.Content placement="right">
                                      <p>路径生成器</p>
                                    </Tooltip.Content>
                                  </Tooltip>
                                </div>
                                <FieldError>{e.items}</FieldError>
                              </TextField>
                            )}

                            {api.response?.format !== 'binary' ? (
                              <div className="space-y-2">
                                <Label className="text-xs text-muted block mb-1">字段映射 (fields)</Label>
                                <Description className="text-[10px] text-muted">
                                  {api.response?.type === 'multi' ? '定义从每个条目中提取哪些字段，image 字段必填' : '定义从响应中提取哪些字段，image 字段必填'}
                                </Description>
                                {MAPPING_FIELD_KEYS.map((field) => (
                                  <div key={field.key} className="flex items-center gap-2">
                                    <TextField className="flex-1" isInvalid={field.key === 'image' && !!e.image}>
                                      <Label className="text-xs text-muted">{field.label}{field.required && <span className="text-danger"> *</span>}</Label>
                                      <Input className="h-8 text-sm"
                                        value={api.mapping?.fields?.[field.key] || ''}
                                        onChange={(ev) => updateApi(idx, {
                                          mapping: { ...api.mapping, fields: { ...api.mapping?.fields, [field.key]: ev.target.value } },
                                        })}
                                        placeholder={`${field.key} 路径`}
                                      />
                                      {field.key === 'image' && <FieldError>{e.image}</FieldError>}
                                    </TextField>
                                    <div className="flex flex-col gap-1">
                                      <Tooltip delay={0}>
                                        <Tooltip.Trigger>
                                          <Button isIconOnly variant="ghost" size="sm"
                                            onPress={() => openPathGen(field.key, idx)}><Wand2 size={14} /></Button>
                                        </Tooltip.Trigger>
                                        <Tooltip.Content placement="right">
                                          <p>路径生成器</p>
                                        </Tooltip.Content>
                                      </Tooltip>
                                      {field.key !== 'image' ? (
                                        <Tooltip delay={0}>
                                          <Tooltip.Trigger>
                                            <Button isIconOnly variant="ghost" size="sm"
                                              onPress={() => openSpecialGen(field.key, idx)}><Braces size={14} /></Button>
                                          </Tooltip.Trigger>
                                          <Tooltip.Content placement="right">
                                            <p>特殊值模板</p>
                                          </Tooltip.Content>
                                        </Tooltip>
                                      ) : (
                                        <Button isIconOnly variant="ghost" size="sm" className="opacity-0 pointer-events-none"><Braces size={14} /></Button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-lg border border-border bg-surface-secondary p-3 text-sm text-muted">
                                当前响应格式为 <strong>{api.response?.format?.toUpperCase()}</strong>，响应体本身就是图片数据，无需配置字段映射。
                              </div>
                            )}

                            {/* 高级配置 Accordion */}
                            <Accordion variant="surface">
                              {/* Pagination */}
                              <Accordion.Item id={`pagination-${idx}`}>
                                <Accordion.Heading>
                                  <Accordion.Trigger>
                                    <ChevronDown size={14} className="text-muted shrink-0" />
                                    <span className="text-sm">分页配置</span>
                                    <Accordion.Indicator><ChevronDown size={14} /></Accordion.Indicator>
                                  </Accordion.Trigger>
                                </Accordion.Heading>
                                <Accordion.Panel><Accordion.Body>
                                  <div className="space-y-3">
                                    <Description className="text-[10px] text-muted block">启用分页后，客户端会按策略连续请求多页并合并结果。仅需单页数据时选择「无分页」。</Description>
                                    <div className="space-y-1">
                                      <Label className="text-xs text-muted block">分页策略</Label>
                                      <ComboBox selectedKey={api.pagination?.strategy || ''}
                                        onSelectionChange={(k) => updateApi(idx, { pagination: { ...api.pagination, strategy: String(k || '') } })}
                                      >
                                        <ComboBox.InputGroup><Input className="h-8 text-sm" placeholder="选择策略" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                        <ComboBox.Popover><ListBox>
                                          <ListBox.Item id="" textValue="无分页">无分页</ListBox.Item>
                                          {PAGINATION_OPTIONS.map((o) => (
                                            <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                                              <div className="flex flex-col">
                                                <Label>{o.label}</Label>
                                                <Description>{o.desc}</Description>
                                              </div>
                                            </ListBox.Item>
                                          ))}
                                        </ListBox></ComboBox.Popover>
                                      </ComboBox>
                                    </div>

                                    {api.pagination?.strategy && pOpt && (
                                      <>
                                        <div className="rounded-lg border border-border bg-surface-secondary p-2 text-[11px] text-muted leading-relaxed">{pOpt.longDesc}</div>

                                        <div className="grid grid-cols-2 gap-2">
                                          <TextField>
                                            <Label className="text-xs text-muted">最大页数</Label>
                                            <Description className="text-[10px] text-muted">最多翻多少页，防止无限请求</Description>
                                            <Input type="number" className="h-8 text-sm"
                                              value={String(api.pagination?.max_pages ?? '')}
                                              onChange={(ev) => updateApi(idx, { pagination: { ...api.pagination, max_pages: Number(ev.target.value) } })}
                                              placeholder="如 10"
                                            />
                                          </TextField>
                                          <TextField>
                                            <Label className="text-xs text-muted">每页数量</Label>
                                            <Description className="text-[10px] text-muted">每页期望的条目数</Description>
                                            <Input type="number" className="h-8 text-sm"
                                              value={String(api.pagination?.page_size ?? '')}
                                              onChange={(ev) => updateApi(idx, { pagination: { ...api.pagination, page_size: Number(ev.target.value) } })}
                                              placeholder="如 20"
                                            />
                                          </TextField>
                                          <TextField>
                                            <Label className="text-xs text-muted">请求间隔 (毫秒)</Label>
                                            <Description className="text-[10px] text-muted">分页请求之间的最小延迟</Description>
                                            <Input type="number" className="h-8 text-sm"
                                              value={String(api.pagination?.delay_ms ?? '')}
                                              onChange={(ev) => updateApi(idx, { pagination: { ...api.pagination, delay_ms: Number(ev.target.value) } })}
                                              placeholder="如 200"
                                            />
                                          </TextField>
                                        </div>

                                        {api.pagination.strategy === 'offset' && (
                                          <div className="space-y-2 rounded-lg border border-border bg-surface-secondary p-2">
                                            <div className="text-xs font-medium">页码递增设置</div>
                                            <Description className="text-[10px] text-muted block">{'在请求 URL 中用变量占位（如 ?page={{page}}），客户端会按起始值递增地请求下一页'}</Description>
                                            <TextField>
                                              <Label className="text-xs text-muted">页码变量名</Label>
                                              <Description className="text-[10px] text-muted">{'该名称会成为 URL 中的 {{变量}}，默认 page'}</Description>
                                              <Input className="h-8 text-sm"
                                                value={String(api.pagination?.param_name ?? '')}
                                                onChange={(ev) => updateApi(idx, { pagination: { ...api.pagination, param_name: ev.target.value } })}
                                                placeholder="page"
                                              />
                                            </TextField>
                                            <div className="grid grid-cols-2 gap-2">
                                              <TextField>
                                                <Label className="text-xs text-muted">起始值</Label>
                                                <Input type="number" className="h-8 text-sm"
                                                  value={String(api.pagination?.start_value ?? '')}
                                                  onChange={(ev) => updateApi(idx, { pagination: { ...api.pagination, start_value: Number(ev.target.value) } })}
                                                  placeholder="如 1"
                                                />
                                              </TextField>
                                              <TextField>
                                                <Label className="text-xs text-muted">每次增量</Label>
                                                <Input type="number" className="h-8 text-sm"
                                                  value={String(api.pagination?.increment ?? '')}
                                                  onChange={(ev) => updateApi(idx, { pagination: { ...api.pagination, increment: Number(ev.target.value) } })}
                                                  placeholder="如 1"
                                                />
                                              </TextField>
                                            </div>
                                          </div>
                                        )}

                                        {api.pagination.strategy === 'cursor' && (
                                          <div className="space-y-2 rounded-lg border border-border bg-surface-secondary p-2">
                                            <div className="text-xs font-medium">游标分页设置</div>
                                            <Description className="text-[10px] text-muted block">{'从响应中提取游标（如 next_cursor），并作为变量（默认 {{cursor}}）带入下一次请求'}</Description>
                                            <TextField>
                                              <Label className="text-xs text-muted">游标路径</Label>
                                              <Description className="text-[10px] text-muted">从响应 JSON 中提取游标的路径表达式</Description>
                                              <Input className="h-8 text-sm"
                                                value={api.pagination?.cursor_path || ''}
                                                onChange={(ev) => updateApi(idx, { pagination: { ...api.pagination, cursor_path: ev.target.value } })}
                                                placeholder="$.next_cursor"
                                              />
                                            </TextField>
                                            <div className="grid grid-cols-2 gap-2">
                                              <TextField>
                                                <Label className="text-xs text-muted">游标变量名</Label>
                                                <Description className="text-[10px] text-muted">{'带入请求的变量名，默认 cursor'}</Description>
                                                <Input className="h-8 text-sm"
                                                  value={api.pagination?.cursor_param || ''}
                                                  onChange={(ev) => updateApi(idx, { pagination: { ...api.pagination, cursor_param: ev.target.value } })}
                                                  placeholder="cursor"
                                                />
                                              </TextField>
                                              <div className="space-y-1">
                                                <Label className="text-xs text-muted">游标位置</Label>
                                                <Description className="text-[10px] text-muted">游标放入请求的哪个部分</Description>
                                                <ComboBox selectedKey={api.pagination?.cursor_in || 'query'}
                                                  onSelectionChange={(k) => updateApi(idx, { pagination: { ...api.pagination, cursor_in: String(k) } })}
                                                >
                                                  <ComboBox.InputGroup><Input className="h-8 text-sm" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                                  <ComboBox.Popover><ListBox>
                                                    {CURSOR_IN_OPTIONS.map((o) => <ListBox.Item key={o.value} id={o.value} textValue={o.label}>{o.label}</ListBox.Item>)}
                                                  </ListBox></ComboBox.Popover>
                                                </ComboBox>
                                              </div>
                                            </div>
                                            <TextField>
                                              <Label className="text-xs text-muted">首次游标（可选）</Label>
                                              <Description className="text-[10px] text-muted">第一次请求携带的游标值，留空则不带</Description>
                                              <Input className="h-8 text-sm"
                                                value={api.pagination?.initial_cursor || ''}
                                                onChange={(ev) => updateApi(idx, { pagination: { ...api.pagination, initial_cursor: ev.target.value } })}
                                                placeholder="留空"
                                              />
                                            </TextField>
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs">游标为空时停止翻页</span>
                                              <Switch isSelected={api.pagination?.stop_on_missing ?? true}
                                                onChange={(v) => updateApi(idx, { pagination: { ...api.pagination, stop_on_missing: v } })}
                                              ><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                                            </div>
                                          </div>
                                        )}

                                        {api.pagination.strategy === 'selector' && (
                                          <div className="space-y-2 rounded-lg border border-border bg-surface-secondary p-2">
                                            <div className="text-xs font-medium">HTML 选择器设置</div>
                                            <Description className="text-[10px] text-muted block">仅用于 HTML 响应。通过 CSS 选择器定位「下一页」按钮并取其链接地址</Description>
                                            <TextField>
                                              <Label className="text-xs text-muted">「下一页」选择器</Label>
                                              <Description className="text-[10px] text-muted">定位下一页链接的 CSS 选择器</Description>
                                              <Input className="h-8 text-sm"
                                                value={api.pagination?.next_selector || ''}
                                                onChange={(ev) => updateApi(idx, { pagination: { ...api.pagination, next_selector: ev.target.value } })}
                                                placeholder="a.next-page"
                                              />
                                            </TextField>
                                            <TextField>
                                              <Label className="text-xs text-muted">链接属性</Label>
                                              <Description className="text-[10px] text-muted">从该属性取链接地址，默认 href</Description>
                                              <Input className="h-8 text-sm"
                                                value={api.pagination?.attr || ''}
                                                onChange={(ev) => updateApi(idx, { pagination: { ...api.pagination, attr: ev.target.value } })}
                                                placeholder="href"
                                              />
                                            </TextField>
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs">找不到链接时停止</span>
                                              <Switch isSelected={api.pagination?.stop_on_missing ?? true}
                                                onChange={(v) => updateApi(idx, { pagination: { ...api.pagination, stop_on_missing: v } })}
                                              ><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                                            </div>
                                          </div>
                                        )}

                                        {api.pagination.strategy === 'link_header' && (
                                          <div className="rounded-lg border border-border bg-surface-secondary p-2 text-[11px] text-muted leading-relaxed">此策略无需额外配置，客户端会自动解析响应头中 rel="next" 的链接作为下一页。</div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </Accordion.Body></Accordion.Panel>
                              </Accordion.Item>

                              {/* Post Process */}
                              <Accordion.Item id={`postprocess-${idx}`}>
                                <Accordion.Heading>
                                  <Accordion.Trigger>
                                    <ChevronDown size={14} className="text-muted shrink-0" />
                                    <span className="text-sm">后处理</span>
                                    <Accordion.Indicator><ChevronDown size={14} /></Accordion.Indicator>
                                  </Accordion.Trigger>
                                </Accordion.Heading>
                                <Accordion.Panel><Accordion.Body><div className="space-y-2">
                                  <TextField>
                                    <Label className="text-xs text-muted">过滤表达式</Label>
                                    <Description className="text-[10px] text-muted">使用路径条件过滤映射后的条目列表，不符合条件的条目将被丢弃</Description>
                                    <Input className="h-8 text-sm" value={api.post_process?.filter || ''}
                                      onChange={(ev) => updateApi(idx, { post_process: { ...api.post_process, filter: ev.target.value } })}
                                      placeholder="$.[?(@.width >= 1920)]"
                                    />
                                  </TextField>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted block">合并字段</Label>
                                    <Description className="text-[10px] text-muted block">为每个条目添加或覆盖固定字段值，如统一标注来源</Description>
                                    {(Object.entries(api.post_process?.merge || {})).map(([k, v], mi) => (
                                      <div key={mi} className="flex items-center gap-2">
                                        <Input className="h-7 text-xs flex-1 min-w-0" value={k}
                                          onChange={(ev) => {
                                            const old = api.post_process?.merge || {};
                                            const next: Record<string, string> = {};
                                            Object.entries(old).forEach(([ok, ov], oi) => { if (oi === mi) next[ev.target.value] = String(ov); else next[ok] = String(ov); });
                                            updateApi(idx, { post_process: { ...api.post_process, merge: next } });
                                        }} placeholder="字段名 (如 source)"
                                      />
                                      <Input className="h-7 text-xs flex-1 min-w-0" value={String(v)}
                                        onChange={(ev) => {
                                          const next = { ...(api.post_process?.merge || {}), [k]: ev.target.value };
                                          updateApi(idx, { post_process: { ...api.post_process, merge: next } });
                                        }} placeholder="字段值 (如 Bing)"
                                        />
                                        <Button isIconOnly variant="ghost" size="sm" className="h-7 w-7 shrink-0"
                                          onPress={() => {
                                            const next = { ...(api.post_process?.merge || {}) };
                                            delete next[k];
                                            updateApi(idx, { post_process: { ...api.post_process, merge: next } });
                                          }}
                                        ><Trash2 size={12} /></Button>
                                      </div>
                                    ))}
                                    <Button size="sm" variant="secondary" className="h-7 text-xs"
                                      onPress={() => updateApi(idx, { post_process: { ...api.post_process, merge: { ...(api.post_process?.merge || {}), '': '' } } })}
                                    ><Plus size={12} /> 添加</Button>
                                  </div>
                                </div></Accordion.Body></Accordion.Panel>
                              </Accordion.Item>

                              {/* Validation */}
                              <Accordion.Item id={`validation-${idx}`}>
                                <Accordion.Heading>
                                  <Accordion.Trigger>
                                    <ChevronDown size={14} className="text-muted shrink-0" />
                                    <span className="text-sm">验证规则</span>
                                    <Accordion.Indicator><ChevronDown size={14} /></Accordion.Indicator>
                                  </Accordion.Trigger>
                                </Accordion.Heading>
                                <Accordion.Panel><Accordion.Body><div className="space-y-2">
                                  <TextField>
                                    <Label className="text-xs text-muted">必填字段 (逗号分隔)</Label>
                                    <Input className="h-8 text-sm"
                                      value={(api.validation?.required_fields || []).join(', ')}
                                      onChange={(ev) => updateApi(idx, { validation: { ...api.validation, required_fields: ev.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })}
                                      placeholder="image, title"
                                    />
                                  </TextField>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted block">约束规则</Label>
                                    <Description className="text-[10px] text-muted block">为指定字段设置正则、长度或数值范围约束，不满足时按动作处理</Description>
                                    {(api.validation?.constraints || []).map((c, ci) => (
                                      <div key={ci} className="rounded-lg border border-border bg-surface-secondary p-2 space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-[10px] text-muted shrink-0">规则 #{ci + 1}</span>
                                          <Button isIconOnly variant="ghost" size="sm" className="h-6 w-6 shrink-0"
                                            onPress={() => {
                                              const next = (api.validation?.constraints || []).filter((_, i) => i !== ci);
                                              updateApi(idx, { validation: { ...api.validation, constraints: next } });
                                            }}
                                          ><Trash2 size={12} /></Button>
                                        </div>
                                        <TextField>
                                          <Label className="text-xs text-muted">字段路径 *</Label>
                                          <Input className="h-8 text-sm" value={c.path}
                                            onChange={(ev) => {
                                              const next = [...(api.validation?.constraints || [])];
                                              next[ci] = { ...next[ci], path: ev.target.value };
                                              updateApi(idx, { validation: { ...api.validation, constraints: next } });
                                            }} placeholder="$.image"
                                          />
                                        </TextField>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="space-y-1">
                                            <Label className="text-xs text-muted">失败动作</Label>
                                            <ComboBox selectedKey={c.action || 'skip'}
                                              onSelectionChange={(k) => {
                                                const next = [...(api.validation?.constraints || [])];
                                                next[ci] = { ...next[ci], action: String(k) };
                                                updateApi(idx, { validation: { ...api.validation, constraints: next } });
                                              }}
                                            >
                                              <ComboBox.InputGroup><Input className="h-8 text-sm" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                              <ComboBox.Popover><ListBox>
                                                {VALIDATION_ACTIONS.map((a) => (
                                                  <ListBox.Item key={a.value} id={a.value} textValue={a.label}>
                                                    <div className="flex flex-col">
                                                      <Label>{a.label}</Label>
                                                      <Description>{a.desc}</Description>
                                                    </div>
                                                  </ListBox.Item>
                                                ))}
                                              </ListBox></ComboBox.Popover>
                                            </ComboBox>
                                          </div>
                                          <TextField>
                                            <Label className="text-xs text-muted">正则匹配</Label>
                                            <Input className="h-8 text-sm" value={c.regex || ''}
                                              onChange={(ev) => {
                                                const next = [...(api.validation?.constraints || [])];
                                                next[ci] = { ...next[ci], regex: ev.target.value };
                                                updateApi(idx, { validation: { ...api.validation, constraints: next } });
                                              }} placeholder="^https://"
                                            />
                                          </TextField>
                                        </div>
                                        <div>
                                          <div className="text-[10px] text-muted mb-1">范围约束（可选）</div>
                                          <div className="grid grid-cols-2 gap-2">
                                            <TextField>
                                              <Label className="text-[10px] text-muted">最小长度</Label>
                                              <Input type="number" className="h-8 text-sm" value={String(c.min_length ?? '')}
                                                onChange={(ev) => {
                                                  const next = [...(api.validation?.constraints || [])];
                                                  next[ci] = { ...next[ci], min_length: ev.target.value ? Number(ev.target.value) : undefined };
                                                  updateApi(idx, { validation: { ...api.validation, constraints: next } });
                                                }} placeholder="最小长度"
                                              />
                                            </TextField>
                                            <TextField>
                                              <Label className="text-[10px] text-muted">最大长度</Label>
                                              <Input type="number" className="h-8 text-sm" value={String(c.max_length ?? '')}
                                                onChange={(ev) => {
                                                  const next = [...(api.validation?.constraints || [])];
                                                  next[ci] = { ...next[ci], max_length: ev.target.value ? Number(ev.target.value) : undefined };
                                                  updateApi(idx, { validation: { ...api.validation, constraints: next } });
                                                }} placeholder="最大长度"
                                              />
                                            </TextField>
                                            <TextField>
                                              <Label className="text-[10px] text-muted">最小值</Label>
                                              <Input type="number" className="h-8 text-sm" value={String(c.min ?? '')}
                                                onChange={(ev) => {
                                                  const next = [...(api.validation?.constraints || [])];
                                                  next[ci] = { ...next[ci], min: ev.target.value ? Number(ev.target.value) : undefined };
                                                  updateApi(idx, { validation: { ...api.validation, constraints: next } });
                                                }} placeholder="最小值"
                                              />
                                            </TextField>
                                            <TextField>
                                              <Label className="text-[10px] text-muted">最大值</Label>
                                              <Input type="number" className="h-8 text-sm" value={String(c.max ?? '')}
                                                onChange={(ev) => {
                                                  const next = [...(api.validation?.constraints || [])];
                                                  next[ci] = { ...next[ci], max: ev.target.value ? Number(ev.target.value) : undefined };
                                                  updateApi(idx, { validation: { ...api.validation, constraints: next } });
                                                }} placeholder="最大值"
                                              />
                                            </TextField>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                    <Button size="sm" variant="secondary" className="h-7 text-xs"
                                      onPress={() => updateApi(idx, { validation: { ...api.validation, constraints: [...(api.validation?.constraints || []), { path: '', action: 'skip' }] } })}
                                    ><Plus size={12} /> 添加规则</Button>
                                  </div>
                                </div></Accordion.Body></Accordion.Panel>
                              </Accordion.Item>

                              {/* Error Handling */}
                              <Accordion.Item id={`error-${idx}`}>
                                <Accordion.Heading>
                                  <Accordion.Trigger>
                                    <ChevronDown size={14} className="text-muted shrink-0" />
                                    <span className="text-sm">错误处理</span>
                                    <Accordion.Indicator><ChevronDown size={14} /></Accordion.Indicator>
                                  </Accordion.Trigger>
                                </Accordion.Heading>
                                <Accordion.Panel><Accordion.Body>
                                  <div className="space-y-3">
                                    <Description className="text-[10px] text-muted">定义当请求或映射出现异常时的应对策略。留空表示使用客户端默认值。</Description>
                                    {ERROR_SCENARIOS.map((scenario) => (
                                      <div key={scenario.key} className="space-y-1">
                                        <Label className="text-xs text-muted block">{scenario.label}</Label>
                                        <Description className="text-[10px] text-muted block">{scenario.desc}</Description>
                                        <ComboBox
                                          selectedKey={api.error_handling?.[scenario.key] || ''}
                                          onSelectionChange={(k) => updateApi(idx, { error_handling: { ...api.error_handling, [scenario.key]: String(k || '') } })}
                                        >
                                          <ComboBox.InputGroup><Input className="h-8 text-sm" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                          <ComboBox.Popover><ListBox>
                                            {scenario.actions.map((a) => (
                                              <ListBox.Item key={a.value || 'default'} id={a.value} textValue={a.label}>
                                                {a.desc ? (
                                                  <div className="flex flex-col">
                                                    <Label>{a.label}</Label>
                                                    <Description>{a.desc}</Description>
                                                  </div>
                                                ) : <Label>{a.label}</Label>}
                                              </ListBox.Item>
                                            ))}
                                          </ListBox></ComboBox.Popover>
                                        </ComboBox>
                                      </div>
                                    ))}
                                    <div className="space-y-1">
                                      <Label className="text-xs text-muted block">备用接口</Label>
                                      <Description className="text-[10px] text-muted block">当主接口失败且策略为「降级」时，改用此备用接口（须为同一源内的其它接口）</Description>
                                      <ComboBox
                                        selectedKey={api.error_handling?.fallback_api || ''}
                                        onSelectionChange={(k) => updateApi(idx, { error_handling: { ...api.error_handling, fallback_api: String(k || '') } })}
                                      >
                                        <ComboBox.InputGroup><Input className="h-8 text-sm" placeholder="选择备用接口" /><ComboBox.Trigger /></ComboBox.InputGroup>
                                        <ComboBox.Popover><ListBox>
                                          <ListBox.Item id="" textValue="无">无</ListBox.Item>
                                          {(creatorPayload.apis || []).map((a) => a.name.trim()).filter((n) => n && n !== api.name.trim()).map((n) => (
                                            <ListBox.Item key={n} id={n} textValue={n}>{n}</ListBox.Item>
                                          ))}
                                        </ListBox></ComboBox.Popover>
                                      </ComboBox>
                                    </div>
                                  </div>
                                </Accordion.Body></Accordion.Panel>
                              </Accordion.Item>

                              {/* Cache */}
                              <Accordion.Item id={`cache-${idx}`}>
                                <Accordion.Heading>
                                  <Accordion.Trigger>
                                    <ChevronDown size={14} className="text-muted shrink-0" />
                                    <span className="text-sm">缓存配置</span>
                                    <Accordion.Indicator><ChevronDown size={14} /></Accordion.Indicator>
                                  </Accordion.Trigger>
                                </Accordion.Heading>
                                <Accordion.Panel><Accordion.Body>
                                  <div className="space-y-3">
                                    <Description className="text-[10px] text-muted">为该接口单独设置缓存策略，优先级高于全局缓存配置</Description>
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm">启用缓存</span>
                                      <Switch isSelected={api.cache?.enabled ?? true}
                                        onChange={(v) => updateApi(idx, { cache: { ...api.cache, enabled: v } })}
                                      ><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                                    </div>
                                    <TextField>
                                      <Label className="text-xs text-muted">缓存时长 (TTL)</Label>
                                      <Description className="text-[10px] text-muted">该接口结果缓存的存活时间，过期后重新请求</Description>
                                      <Input type="number" className="h-8 text-sm"
                                        value={String(api.cache?.ttl_seconds ?? '')}
                                        onChange={(ev) => updateApi(idx, { cache: { ...api.cache, ttl_seconds: Number(ev.target.value) } })}
                                        placeholder="单位：秒，如 300"
                                      />
                                    </TextField>
                                    <div className="space-y-1">
                                      <Label className="text-xs text-muted block">缓存键模板</Label>
                                      <Description className="text-[10px] text-muted block">{'用于区分不同请求结果的缓存标识。相同键会命中同一份缓存，建议拼接参数与日期变量以保证唯一性，如 bing_{{page}}_{{date_iso}}'}</Description>
                                      <div className="flex items-center gap-2">
                                        <Input className="h-8 text-sm flex-1"
                                          value={api.cache?.key_template || ''}
                                          onChange={(ev) => updateApi(idx, { cache: { ...api.cache, key_template: ev.target.value } })}
                                          placeholder="如 bing_{{page}}_{{date_iso}}"
                                        />
                                        <Tooltip delay={0}>
                                          <Tooltip.Trigger>
                                            <Button isIconOnly variant="ghost" size="sm"
                                              onPress={() => openSpecialGen('key_template', idx, 'cache')}><Braces size={14} /></Button>
                                          </Tooltip.Trigger>
                                          <Tooltip.Content placement="left">
                                            <p>插入特殊值变量</p>
                                          </Tooltip.Content>
                                        </Tooltip>
                                      </div>
                                    </div>
                                  </div>
                                </Accordion.Body></Accordion.Panel>
                              </Accordion.Item>
                            </Accordion>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <Button size="sm" variant="secondary" onPress={() => {
                        const newIdx = creatorPayload.apis?.length || 0;
                        setCreatorPayload((p) => ({
                          ...p,
                          apis: [...(p.apis || []), {
                            name: '新接口',
                            categories: [],
                            request: { url: '', method: 'GET' },
                            response: { format: 'json', type: 'multi' },
                            mapping: { items: '', fields: { image: '' } },
                          }],
                        }));
                        setApiExpanded((prev) => new Set(prev).add(newIdx));
                      }}>
                        <Plus size={14} /> 添加API
                      </Button>
                    </div>
                  </Tabs.Panel>
                </Tabs>
              </div>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            {creatorStep === 1 ? (
              <>
                <Button variant="ghost" onPress={() => setShowCreator(false)}>取消</Button>
                <Button onPress={() => {
                  setShowValidation(true);
                  if (rawValidation.hasBasic) return;
                  setCreatorStep(2);
                  setShowValidation(false);
                }}>下一步</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onPress={() => { setCreatorStep(1); setShowValidation(false); }}>上一步</Button>
                <Button onPress={async () => {
                  setShowValidation(true);
                  if (rawValidation.hasContent) {
                    if (rawValidation.tabErrors.categories) setCreatorTab('categories');
                    else if (rawValidation.tabErrors.api) setCreatorTab('api');
                    return;
                  }
                  try {
                    const payloadForBackend: WallpaperSourceCreatorPayload = {
                      ...creatorPayload,
                      categories: {
                        ...creatorPayload.categories,
                        categories: flattenCategoryTreeForBackend((creatorPayload.categories?.categories || []) as CreatorCategory[]),
                      },
                    };
                    if (editingSourceId) {
                      const result = await updateWallpaperSource(editingSourceId, payloadForBackend);
                      if (result && typeof result === 'object' && 'error' in result) {
                        throw new Error(String((result as any).error));
                      }
                    } else {
                      const result = await createWallpaperSource(payloadForBackend);
                      if (result && typeof result === 'object' && 'error' in result) {
                        throw new Error(String((result as any).error));
                      }
                    }
                    setShowCreator(false);
                    setShowValidation(false);
                    setCreatorStep(1);
                    setEditingSourceId(null);
                    await loadSources();
                  } catch (e) {
                    logError(editingSourceId ? 'Update source failed' : 'Create source failed', e);
                    alert((editingSourceId ? '更新失败: ' : '创建失败: ') + (e instanceof Error ? e.message : String(e)));
                  }
                }}>{editingSourceId ? '保存' : '完成'}</Button>
              </>
            )}
          </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      )}

      {/* ═══════════ 路径生成器 Modal ═══════════ */}
      {pathGenOpen && (
        <Modal.Backdrop isOpen={pathGenOpen} onOpenChange={setPathGenOpen}>
          <Modal.Container size="cover">
            <Modal.Dialog>
              <Modal.Header><Modal.Heading>路径生成器</Modal.Heading></Modal.Header>
              <Modal.Body>
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted">模式</Label>
                    <div className="flex gap-1">
                      <Button size="sm" variant={pathGenState.mode === 'json' ? 'primary' : 'secondary'}
                        onPress={() => setPathGenState((s) => ({ ...s, mode: 'json' }))}>JSON</Button>
                      <Button size="sm" variant={pathGenState.mode === 'html' ? 'primary' : 'secondary'}
                        onPress={() => setPathGenState((s) => ({ ...s, mode: 'html' }))}>HTML</Button>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs text-muted mb-1 block">快速预设</Label>
                    <div className="flex flex-wrap gap-2">
                      {(pathGenTarget?.fieldKey === 'items' ? PRESET_PATHS : PRESET_IMAGE_PATHS).map((p, i) => (
                        <Button key={i} size="sm" variant="secondary"
                          onPress={() => setPathGenState({ mode: 'json', segments: p.segments, cssSelector: '', pipes: p.pipes || [] })}
                        >{p.label}</Button>
                      ))}
                    </div>
                  </div>

                  {/* JSON 样本解析 */}
                  {pathGenState.mode === 'json' && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted block">JSON 样本（粘贴 API 响应以可视化选择路径）</Label>
                      <TextArea
                        className="min-h-[200px] text-xs font-mono w-full"
                        value={jsonSample}
                        onChange={(e) => setJsonSample(e.target.value)}
                        placeholder={`{\n  "data": {\n    "list": [\n      { "url": "https://...", "title": "..." }\n    ]\n  }\n}`}
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="secondary" onPress={() => {
                          try {
                            const parsed = JSON.parse(jsonSample);
                            setJsonTree(parseJsonToTree(parsed, 'root', '$'));
                            setJsonTreeExpanded(new Set(['$']));
                            setJsonTreeSelected('');
                          } catch (e) {
                            toast.danger('JSON 解析失败', { description: String(e), timeout: 3000 });
                          }
                        }}>解析 JSON</Button>
                        <Button size="sm" variant="ghost" onPress={() => { setJsonSample(''); setJsonTree(null); setJsonTreeExpanded(new Set()); setJsonTreeSelected(''); }}>清空</Button>
                      </div>
                      {jsonTree && (
                        <div className="rounded-lg border border-border bg-surface-secondary p-2 max-h-[240px] overflow-y-auto">
                          <JsonTreeView
                            node={jsonTree}
                            selectedPath={jsonTreeSelected}
                            expandedPaths={jsonTreeExpanded}
                            onToggle={(path) => {
                              setJsonTreeExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(path)) next.delete(path);
                                else next.add(path);
                                return next;
                              });
                            }}
                            onSelect={(node) => {
                              setJsonTreeSelected(node.path);
                              const wildcardPath = node.path.replace(/\[(\d+)]/g, '[*]');
                              setPathGenState((s) => ({ ...s, segments: pathToSegments(wildcardPath) }));
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {pathGenState.mode === 'json' ? (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted">路径段</Label>
                      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface-secondary p-3">
                        <span className="text-sm font-mono text-primary">$</span>
                        {pathGenState.segments.map((seg, idx) => (
                          <div key={idx} className="flex items-center gap-1">
                            <ComboBox selectedKey={seg.type}
                              onSelectionChange={(k) => {
                                const type = String(k) as PathSegment['type'];
                                const next = [...pathGenState.segments];
                                next[idx] = { type } as PathSegment;
                                setPathGenState((s) => ({ ...s, segments: next }));
                              }}
                            >
                              <ComboBox.InputGroup><Input className="h-7 w-20 text-xs" /><ComboBox.Trigger /></ComboBox.InputGroup>
                              <ComboBox.Popover><ListBox>
                                <ListBox.Item id="property" textValue=".属性">.属性</ListBox.Item>
                                <ListBox.Item id="index" textValue="[索引]">[索引]</ListBox.Item>
                                <ListBox.Item id="wildcard" textValue="[*]">[*]</ListBox.Item>
                                <ListBox.Item id="slice" textValue="[切片]">[切片]</ListBox.Item>
                                <ListBox.Item id="recursive" textValue="..递归">..递归</ListBox.Item>
                              </ListBox></ComboBox.Popover>
                            </ComboBox>
                            {seg.type === 'property' && (
                              <Input className="h-7 w-24 text-xs" value={seg.key || ''}
                                onChange={(e) => {
                                  const next = [...pathGenState.segments];
                                  next[idx] = { ...seg, type: 'property', key: e.target.value };
                                  setPathGenState((s) => ({ ...s, segments: next }));
                                }} placeholder="key"
                              />
                            )}
                            {seg.type === 'index' && (
                              <Input type="number" className="h-7 w-16 text-xs" value={String(seg.index ?? 0)}
                                onChange={(e) => {
                                  const next = [...pathGenState.segments];
                                  next[idx] = { ...seg, type: 'index', index: Number(e.target.value) };
                                  setPathGenState((s) => ({ ...s, segments: next }));
                                }}
                              />
                            )}
                            {seg.type === 'slice' && (
                              <>
                                <Input type="number" className="h-7 w-14 text-xs"
                                  value={seg.start !== undefined ? String(seg.start) : ''}
                                  onChange={(e) => {
                                    const next = [...pathGenState.segments];
                                    next[idx] = { ...seg, type: 'slice', start: e.target.value ? Number(e.target.value) : undefined };
                                    setPathGenState((s) => ({ ...s, segments: next }));
                                  }} placeholder="start"
                                />
                                <span className="text-xs text-muted">:</span>
                                <Input type="number" className="h-7 w-14 text-xs"
                                  value={seg.end !== undefined ? String(seg.end) : ''}
                                  onChange={(e) => {
                                    const next = [...pathGenState.segments];
                                    next[idx] = { ...seg, type: 'slice', end: e.target.value ? Number(e.target.value) : undefined };
                                    setPathGenState((s) => ({ ...s, segments: next }));
                                  }} placeholder="end"
                                />
                              </>
                            )}
                            {seg.type === 'recursive' && (
                              <Input className="h-7 w-24 text-xs" value={seg.key || ''}
                                onChange={(e) => {
                                  const next = [...pathGenState.segments];
                                  next[idx] = { ...seg, type: 'recursive', key: e.target.value };
                                  setPathGenState((s) => ({ ...s, segments: next }));
                                }} placeholder="key"
                              />
                            )}
                            <Button isIconOnly variant="ghost" size="sm" className="h-6 w-6"
                              onPress={() => setPathGenState((s) => ({ ...s, segments: s.segments.filter((_, i) => i !== idx) }))}
                            ><Trash2 size={12} /></Button>
                          </div>
                        ))}
                        <Button size="sm" variant="secondary" className="h-7 text-xs"
                          onPress={() => setPathGenState((s) => ({ ...s, segments: [...s.segments, { type: 'property', key: '' }] }))}
                        ><Plus size={12} /> 添加段</Button>
                      </div>
                    </div>
                  ) : (
                    <TextField>
                      <Label>CSS 选择器</Label>
                      <Input value={pathGenState.cssSelector}
                        onChange={(e) => setPathGenState((s) => ({ ...s, cssSelector: e.target.value }))}
                        placeholder="div.wallpaper img"
                      />
                    </TextField>
                  )}

                  {/* 管道函数 */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted">管道函数（可选）</Label>

                    {/* 已添加的管道函数列表 */}
                    {pathGenState.pipes.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-surface-secondary p-2">
                        {pathGenState.pipes.map((pipe, idx) => {
                          const opt = PIPE_OPTIONS.find((o) => o.name === pipe.name);
                          const label = pipe.args.length > 0
                            ? `${opt?.label || pipe.name}(${pipe.args.map((a) => a ? JSON.stringify(a) : '').join(', ')})`
                            : (opt?.label || pipe.name);
                          const isEditing = editPipeIdx === idx;
                          return (
                            <div
                              key={idx}
                              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs cursor-pointer transition-colors ${
                                isEditing ? 'bg-accent text-accent-foreground' : 'bg-accent/10 text-accent'
                              }`}
                              onClick={() => setEditPipeIdx(isEditing ? -1 : idx)}
                            >
                              <span>{label}</span>
                              <button
                                className={`ml-0.5 ${isEditing ? 'text-accent-foreground/70 hover:text-accent-foreground' : 'text-accent/60 hover:text-accent'}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPathGenState((s) => {
                                    const filtered = s.pipes.filter((_, i) => i !== idx);
                                    return { ...s, pipes: filtered };
                                  });
                                  if (editPipeIdx === idx) setEditPipeIdx(-1);
                                  else if (editPipeIdx > idx) setEditPipeIdx(editPipeIdx - 1);
                                }}
                              >×</button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 按类别添加管道函数 */}
                    <div className="space-y-2 rounded-lg border border-border bg-surface-secondary p-2">
                      {PIPE_CATEGORIES.map((cat) => (
                        <div key={cat.label}>
                          <div className="text-[10px] text-muted uppercase tracking-wider mb-1">{cat.label}</div>
                          <div className="flex flex-wrap gap-1">
                            {cat.options.map((opt) => (
                              <Button
                                key={opt.name}
                                size="sm"
                                variant="secondary"
                                className="h-6 text-[11px] px-2"
                                onPress={() => {
                                  if (opt.args === 0) {
                                    setPathGenState((s) => ({ ...s, pipes: [...s.pipes, { name: opt.name, args: [] }] }));
                                  } else {
                                    const newIdx = pathGenState.pipes.length;
                                    setPathGenState((s) => ({ ...s, pipes: [...s.pipes, { name: opt.name, args: Array(opt.args).fill('') }] }));
                                    setEditPipeIdx(newIdx);
                                  }
                                }}
                              >
                                {opt.label}
                              </Button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* 参数编辑（当前选中的管道函数） */}
                    {editPipeIdx >= 0 && pathGenState.pipes[editPipeIdx] && (() => {
                      const pipe = pathGenState.pipes[editPipeIdx];
                      const opt = PIPE_OPTIONS.find((o) => o.name === pipe.name);
                      if (!opt || opt.args === 0) return null;
                      return (
                        <div className="rounded-lg border border-border bg-surface-secondary p-2 space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="text-xs text-muted">编辑 {opt.label} 参数</div>
                            <button className="text-xs text-muted hover:text-foreground" onClick={() => setEditPipeIdx(-1)}>完成</button>
                          </div>
                          {pipe.args.map((arg, ai) => (
                            <Input
                              key={ai}
                              className="h-7 text-xs"
                              value={arg}
                              onChange={(e) => {
                                const next = [...pathGenState.pipes];
                                next[editPipeIdx] = { ...pipe, args: pipe.args.map((a, i) => i === ai ? e.target.value : a) };
                                setPathGenState((s) => ({ ...s, pipes: next }));
                              }}
                              placeholder={opt.placeholder}
                            />
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="rounded-lg border border-border bg-surface-secondary p-3">
                    <Label className="text-xs text-muted mb-1 block">预览</Label>
                    <code className="block text-sm font-mono break-all">{buildPathExpression(pathGenState) || '(空)'}</code>
                  </div>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setPathGenOpen(false)}>取消</Button>
                <Button onPress={applyPathGen}>确定</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      )}

      {/* ═══════════ 特殊值模板生成器 Drawer ═══════════ */}
      {specialGenOpen && (
        <Drawer.Backdrop isOpen={specialGenOpen} onOpenChange={setSpecialGenOpen}>
          <Drawer.Content placement="bottom">
            <Drawer.Dialog className="h-[500px]">
              <Drawer.Handle />
              <Drawer.Header><Drawer.Heading>特殊值模板</Drawer.Heading></Drawer.Header>
              <Drawer.Body>
                <div className="space-y-4">
                  {SPECIAL_VALUE_CATEGORIES.map((cat) => (
                    <div key={cat.label}>
                      <Label className="text-xs text-muted mb-2 block">{cat.label}</Label>
                      <div className="flex flex-wrap gap-2">
                        {cat.values.map((v) => (
                          <Button
                            key={v.key}
                            size="sm"
                            variant="secondary"
                            className="h-8 text-xs"
                            onPress={() => applySpecialValue(v.key)}
                          >
                            <div className="flex flex-col items-start">
                              <span>{v.label}</span>
                              <span className="text-[10px] text-muted">{v.desc}</span>
                            </div>
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Drawer.Body>
              <Drawer.Footer>
                <Button variant="ghost" onPress={() => setSpecialGenOpen(false)}>取消</Button>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      )}
    </div>
  );
}
