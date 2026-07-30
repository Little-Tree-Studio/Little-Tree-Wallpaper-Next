export type AutomationNodeType =
  | 'trigger'
  | 'condition'
  | 'match'
  | 'loop'
  | 'set_variable'
  | 'function'
  | 'calculate'
  | 'wait'
  | 'fetch_resource'
  | 'local_file'
  | 'set_wallpaper'
  | 'dynamic_wallpaper'
  | 'notification'
  | 'command'
  | 'open_target'
  | 'system_action'
  | 'read_file'
  | 'write_file'
  | 'delete_file'
  | 'data_directory'
  | 'list_directory'
  | 'datetime'
  | 'log'
  | 'stop';

export interface AutomationExpression {
  type: string;
  [key: string]: unknown;
}

export interface AutomationNode {
  id: string;
  type: AutomationNodeType;
  x: number;
  y: number;
  config: Record<string, unknown>;
}

export interface AutomationAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface AutomationEdge {
  id: string;
  source: string;
  target: string;
  source_port?: string;
  target_port?: string;
}

export interface AutomationSettingOption {
  id: string;
  label: string;
}

export interface AutomationSettingDescriptor {
  pointer: string;
  label: string;
  kind: 'text' | 'number' | 'boolean' | 'select' | 'path' | 'directory' | 'video';
  value: unknown;
  options?: AutomationSettingOption[];
}

export interface AutomationOutputDescriptor {
  id: string;
  label: string;
  description: string;
  color: string;
}

export interface AutomationResourceCatalogView {
  intelligent_market: Array<{
    id: string;
    friendly_name: string;
    parameters?: Array<{ key: string; type?: string; options?: unknown[] | null; friendly_options?: string[]; default_value?: unknown }>;
  }>;
  wallpaper_sources: Array<{
    identifier: string;
    name: string;
    enabled?: boolean;
    apis?: Array<{
      name: string;
      description?: string;
      parameters?: Array<{ key: string; label?: string; type?: string; choices?: string[]; default?: unknown; hidden?: boolean }>;
    }>;
  }>;
  favorite_folders: Array<{ id: string; name: string }>;
}

export interface AutomationDocument {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  version: number;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  annotations?: AutomationAnnotation[];
  created_at?: string;
  updated_at?: string;
}

export interface AutomationSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  node_count: number;
  updated_at: string;
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  automation_name: string;
  running: boolean;
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed';
  current_node_id: string;
  steps: number;
  started_at: string;
  finished_at: string;
  error: string;
  variables: Record<string, unknown>;
}

export interface AutomationRuntime {
  run: AutomationRun;
  events: Array<{ time: string; level: string; message: string; node_id: string }>;
  enabled_count: number;
  total_count: number;
}

export const NODE_META: Record<AutomationNodeType, { label: string; description: string }> = {
  trigger: { label: '触发器', description: '手动、启动、间隔或定时触发' },
  condition: { label: '条件分支', description: '通过表达式选择真假分支' },
  match: { label: '多分支', description: '按不同值进入自定义分支' },
  loop: { label: '循环', description: '按次数、列表或条件重复执行' },
  set_variable: { label: '设置变量', description: '保存值供后续节点使用' },
  function: { label: '执行函数', description: '运算、文本与随机函数' },
  calculate: { label: '计算', description: '对两个输入值执行数学运算' },
  wait: { label: '等待', description: '可取消的延迟执行' },
  fetch_resource: { label: '获取资源', description: '从在线资源获取一张壁纸' },
  local_file: { label: '获取本地文件', description: '输出选中的本地图片' },
  set_wallpaper: { label: '设置壁纸', description: '使用上游图片设置壁纸' },
  dynamic_wallpaper: { label: '动态壁纸', description: '启动、播放、暂停或关闭' },
  notification: { label: '系统通知', description: '发送桌面系统通知' },
  command: { label: '执行命令', description: '无 Shell 执行程序并获取输出' },
  open_target: { label: '打开目标', description: '用系统默认程序打开文件或链接' },
  system_action: { label: '系统操作', description: '关机、重启、注销或睡眠' },
  read_file: { label: '读取文本文件', description: '读取 UTF-8 等文本文件内容' },
  write_file: { label: '写入文件', description: '创建、覆盖或追加文本文件' },
  delete_file: { label: '删除文件', description: '删除文件或空文件夹' },
  data_directory: { label: '数据目录', description: '获取当前自动化独立数据目录' },
  list_directory: { label: '获取文件夹内容', description: '列出文件和子文件夹' },
  datetime: { label: '日期时间', description: '获取并格式化日期时间' },
  log: { label: '记录日志', description: '写入自动化运行日志' },
  stop: { label: '结束', description: '终止当前执行链' },
};

export function createNodeConfig(type: AutomationNodeType): Record<string, unknown> {
  if (type === 'condition') return { expression: { type: 'compare', operator: 'eq', left: { type: 'system', name: 'hour' }, right: { type: 'literal', value: '18' } } };
  if (type === 'match') return { value: { type: 'literal', value: '' }, cases: { [crypto.randomUUID()]: { label: '分支 1', operator: 'eq', value: '' } } };
  if (type === 'loop') return { mode: 'count', count: 3, items: { type: 'literal', value: '' }, condition: { type: 'literal', value: true }, item_variable: 'item', index_variable: 'index', max_iterations: 1000 };
  if (type === 'trigger') return { kind: 'manual' };
  if (type === 'set_variable') return { name: 'value', value: { type: 'literal', value: '' } };
  if (type === 'function') return { name: 'concat', args: [], result_variable: 'result' };
  if (type === 'calculate') return { operation: 'add', left: 0, right: 0, result_variable: 'result' };
  if (type === 'wait') return { seconds: 1 };
  if (type === 'fetch_resource') return { source: 'bing', category: 'daily', market: 'zh-CN', quality: 'highDef', selection: 'random' };
  if (type === 'local_file') return { path: '' };
  if (type === 'dynamic_wallpaper') return { action: 'start', loop: true, muted: true };
  if (type === 'log') return { message: '执行到此节点' };
  if (type === 'notification') return { title: '小树壁纸', message: '自动化执行完成' };
  if (type === 'command') return { executable: '', arguments: '', working_directory: '.', timeout_seconds: 60, check: true, result_variable: 'command_result' };
  if (type === 'open_target') return { kind: 'auto', target: '' };
  if (type === 'system_action') return { action: 'sleep', delay_seconds: 5 };
  if (type === 'read_file') return { path: 'data.txt', encoding: 'utf-8', errors: 'strict', result_variable: 'file_content' };
  if (type === 'write_file') return { action: 'write', path: 'data.txt', content: '', encoding: 'utf-8' };
  if (type === 'delete_file') return { path: 'data.txt', missing_ok: false };
  if (type === 'list_directory') return { path: '.', pattern: '*', recursive: false, include_files: true, include_directories: true, result_variable: 'entries' };
  if (type === 'datetime') return { value: '', format: '%Y-%m-%d %H:%M:%S', timezone: 'local', result_variable: 'datetime' };
  return {};
}

export function getNodeOutputs(node: AutomationNode): AutomationOutputDescriptor[] {
  if (node.type === 'stop' || node.type === 'system_action') return [];
  if (node.type === 'condition') return [
    { id: 'true', label: '真', description: formatNodeOutput(node, 'true'), color: 'var(--success)' },
    { id: 'false', label: '假', description: formatNodeOutput(node, 'false'), color: 'var(--danger)' },
  ];
  if (node.type === 'loop') return [
    { id: 'body', label: '循环体', description: '当前项；末端需连接回循环节点', color: 'var(--primary)' },
    { id: 'done', label: '完成', description: '循环结束后继续', color: 'var(--success)' },
  ];
  if (node.type === 'match') {
    const cases = node.config.cases && typeof node.config.cases === 'object' ? node.config.cases as Record<string, Record<string, unknown>> : {};
    return [
      ...Object.entries(cases).map(([id, item]) => ({ id: `case:${id}`, label: String(item.label || item.value || '分支'), description: `${String(item.operator || 'eq')} ${String(item.value ?? '')}`, color: 'var(--primary)' })),
      { id: 'default', label: '默认', description: '没有匹配值', color: 'var(--muted)' },
    ];
  }
  return [{ id: 'default', label: '传递', description: formatNodeOutput(node), color: 'var(--primary)' }];
}

const COMPARISON_LABELS: Record<string, string> = {
  eq: '=',
  ne: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  contains: '包含',
  in: '属于',
  starts_with: '开头是',
  ends_with: '结尾是',
  matches: '匹配',
};

const SYSTEM_LABELS: Record<string, string> = {
  datetime: '当前日期时间',
  date: '当前日期',
  time: '当前时间',
  hour: '当前小时',
  minute: '当前分钟',
  weekday: '星期',
  timestamp: '时间戳',
  platform: '系统平台',
};

export function formatAutomationExpression(expression: unknown, depth = 0): string {
  if (depth > 4) return '...';
  if (expression === null) return '空值';
  if (typeof expression === 'string') return `“${expression}”`;
  if (typeof expression !== 'object') return String(expression);
  const value = expression as AutomationExpression;
  if (value.type === 'literal') return formatAutomationExpression(value.value, depth + 1);
  if (value.type === 'variable') return `变量.${String(value.name || '?')}`;
  if (value.type === 'system') return SYSTEM_LABELS[String(value.name)] || `系统.${String(value.name || '?')}`;
  if (value.type === 'not') return `非 (${formatAutomationExpression(value.value, depth + 1)})`;
  if (value.type === 'compare') {
    return `${formatAutomationExpression(value.left, depth + 1)} ${COMPARISON_LABELS[String(value.operator)] || String(value.operator || '=')} ${formatAutomationExpression(value.right, depth + 1)}`;
  }
  if (value.type === 'all' || value.type === 'any') {
    const values = Array.isArray(value.values) ? value.values : [];
    const separator = value.type === 'all' ? ' 且 ' : ' 或 ';
    return values.map((item) => formatAutomationExpression(item, depth + 1)).join(separator) || '无条件';
  }
  if (value.type === 'call') {
    const args = Array.isArray(value.args) ? value.args : [];
    return `${String(value.name || '函数')}(${args.map((item) => formatAutomationExpression(item, depth + 1)).join(', ')})`;
  }
  return '条件未配置';
}

const SOURCE_LABELS: Record<string, string> = {
  im: 'Intelligent Market',
  bing: 'Bing',
  spotlight: 'Windows 聚焦',
  cnu: 'CNU',
  pixiv: 'Pixiv 排行榜',
  ltws: '壁纸源 API',
  folder: '本地文件夹',
  favorites: '收藏轮换',
};

export function formatNodeSummary(node: AutomationNode): string {
  const config = node.config;
  if (node.type === 'condition') return formatAutomationExpression(config.expression);
  if (node.type === 'match') return `${Object.keys((config.cases as object | undefined) || {}).length} 个分支`;
  if (node.type === 'loop') return config.mode === 'count' ? `循环 ${Number(config.count || 0)} 次` : config.mode === 'while' ? '条件循环' : '遍历列表';
  if (node.type === 'trigger') {
    const kind = String(config.kind || 'manual');
    if (kind === 'interval') return `每 ${Number(config.seconds || 60)} 秒`;
    if (kind === 'schedule') return `每天 ${String(config.time || '00:00')}`;
    return kind === 'startup' ? '程序启动时' : '手动触发';
  }
  if (node.type === 'set_variable') return `${String(config.name || '变量')} = ${formatAutomationExpression(config.value)}`;
  if (node.type === 'function') return `${String(config.name || '函数')} -> ${String(config.result_variable || 'result')}`;
  if (node.type === 'calculate') return `${String(config.operation || 'add')} -> ${String(config.result_variable || 'result')}`;
  if (node.type === 'wait') return `等待 ${Number(config.seconds || 0)} 秒`;
  if (node.type === 'fetch_resource') {
    const source = String(config.source || 'bing');
    const detail = source === 'bing' ? String(config.category || 'daily')
      : source === 'spotlight' ? String(config.spotlight_source || 'online')
      : source === 'cnu' ? String(config.section || 'selected')
      : source === 'pixiv' ? String(config.mode || 'day')
      : source === 'im' ? String(config.source_name || config.source_id || '请选择来源')
      : source === 'folder' ? String(config.path || '未选择文件夹').split(/[\\/]/).pop()
      : source === 'favorites' ? config.scope === 'selected' ? `${Array.isArray(config.item_ids) ? config.item_ids.length : 0} 条收藏` : String(config.folder_name || '收藏夹')
      : String(config.api_name || config.source_name || '请选择 API');
    return `${SOURCE_LABELS[source] || source} · ${detail}`;
  }
  if (node.type === 'local_file') {
    const path = String(config.path || '尚未选择图片');
    return path.split(/[\\/]/).pop() || path;
  }
  if (node.type === 'set_wallpaper') return '使用上游图片';
  if (node.type === 'dynamic_wallpaper') return config.action === 'start'
    ? `启动 · ${String(config.path || '未选择视频').split(/[\\/]/).pop()}`
    : String(config.action || 'play');
  if (node.type === 'log') return String(config.message || '空日志');
  if (node.type === 'notification') return String(config.title || '系统通知');
  if (node.type === 'command') return String(config.executable || '未配置可执行文件');
  if (node.type === 'open_target') return String(config.target || '未配置目标');
  if (node.type === 'system_action') return String(config.action || 'sleep');
  if (node.type === 'read_file' || node.type === 'write_file' || node.type === 'delete_file' || node.type === 'list_directory') return String(config.path || '.');
  if (node.type === 'data_directory') return '当前自动化专属目录';
  if (node.type === 'datetime') return String(config.format || '%Y-%m-%d %H:%M:%S');
  if (node.type === 'stop') return '结束当前执行链';
  return '';
}

export function formatNodeOutput(node: AutomationNode, port: string = 'default'): string {
  const config = node.config;
  if (node.type === 'trigger') return '流程信号';
  if (node.type === 'condition') return port === 'false' ? '上游值（条件为假）' : '上游值（条件为真）';
  if (node.type === 'set_variable') return `变量值 · ${String(config.name || 'value')}`;
  if (node.type === 'function') return `函数结果 · ${String(config.result_variable || 'result')}`;
  if (node.type === 'calculate') return `计算结果 · ${String(config.result_variable || 'result')}`;
  if (node.type === 'read_file') return '文本内容';
  if (node.type === 'write_file' || node.type === 'delete_file' || node.type === 'data_directory') return '文件系统路径';
  if (node.type === 'list_directory') return '文件条目列表';
  if (node.type === 'datetime') return '格式化日期时间';
  if (node.type === 'command') return '退出码、标准输出和错误输出';
  if (node.type === 'open_target') return '已打开的目标';
  if (node.type === 'fetch_resource') return '本地图片路径 + 资源信息';
  if (node.type === 'local_file') return '本地图片路径';
  if (node.type === 'wait' || node.type === 'set_wallpaper' || node.type === 'dynamic_wallpaper' || node.type === 'log') {
    return '上游值（原样）';
  }
  return '无输出';
}

const options = (items: Array<[string, string]>): AutomationSettingOption[] => items.map(([id, label]) => ({ id, label }));

export function getNodeSettings(node: AutomationNode, catalog?: AutomationResourceCatalogView | null): AutomationSettingDescriptor[] {
  const config = node.config;
  if (node.type === 'trigger') {
    const result: AutomationSettingDescriptor[] = [{ pointer: '/kind', label: '触发方式', kind: 'select', value: config.kind || 'manual', options: options([["manual", '手动'], ['startup', '启动'], ['interval', '间隔'], ['schedule', '定时']]) }];
    if (config.kind === 'interval') result.push({ pointer: '/seconds', label: '间隔秒数', kind: 'number', value: config.seconds ?? 60 });
    if (config.kind === 'schedule') result.push({ pointer: '/time', label: '执行时间', kind: 'text', value: config.time || '08:00' });
    return result;
  }
  if (node.type === 'condition') return [
    { pointer: '/expression/left/type', label: '左侧类型', kind: 'select', value: ((config.expression as AutomationExpression | undefined)?.left as AutomationExpression | undefined)?.type || 'system', options: options([["system", '系统值'], ['variable', '变量']]) },
    { pointer: '/expression/left/name', label: '左侧名称', kind: 'text', value: ((config.expression as AutomationExpression | undefined)?.left as AutomationExpression | undefined)?.name || 'hour' },
    { pointer: '/expression/operator', label: '比较', kind: 'select', value: (config.expression as AutomationExpression | undefined)?.operator || 'eq', options: options([["eq", '='], ['ne', '!='], ['gt', '>'], ['gte', '>='], ['lt', '<'], ['lte', '<='], ['contains', '包含'], ['matches', '匹配']]) },
    { pointer: '/expression/right/value', label: '右侧值', kind: 'text', value: ((config.expression as AutomationExpression | undefined)?.right as AutomationExpression | undefined)?.value ?? '' },
  ];
  if (node.type === 'match') {
    const cases = config.cases && typeof config.cases === 'object' ? config.cases as Record<string, Record<string, unknown>> : {};
    return [
      { pointer: '/value/value', label: '匹配值', kind: 'text', value: (config.value as AutomationExpression | undefined)?.value ?? '' },
      ...Object.entries(cases).flatMap(([id, item]) => [
        { pointer: `/cases/${id}/label`, label: '分支名称', kind: 'text' as const, value: item.label || '分支' },
        { pointer: `/cases/${id}/operator`, label: '比较方式', kind: 'select' as const, value: item.operator || 'eq', options: options([['eq', '='], ['ne', '!='], ['gt', '>'], ['gte', '>='], ['lt', '<'], ['lte', '<='], ['contains', '包含'], ['in', '属于'], ['starts_with', '开头是'], ['ends_with', '结尾是'], ['matches', '正则匹配']]) },
        { pointer: `/cases/${id}/value`, label: '分支值', kind: 'text' as const, value: item.value ?? '' },
      ]),
    ];
  }
  if (node.type === 'loop') {
    const result: AutomationSettingDescriptor[] = [{ pointer: '/mode', label: '循环方式', kind: 'select', value: config.mode || 'count', options: options([['count', '指定次数'], ['items', '遍历列表'], ['while', '满足条件']]) }];
    if (config.mode === 'items') result.push({ pointer: '/items/value', label: '列表(逗号)', kind: 'text', value: (config.items as AutomationExpression | undefined)?.value ?? '' });
    else if (config.mode === 'while') result.push({ pointer: '/condition/value', label: '循环条件', kind: 'boolean', value: (config.condition as AutomationExpression | undefined)?.value !== false }, { pointer: '/max_iterations', label: '最多次数', kind: 'number', value: config.max_iterations ?? 1000 });
    else result.push({ pointer: '/count', label: '循环次数', kind: 'number', value: config.count ?? 3 });
    result.push({ pointer: '/item_variable', label: '当前项变量', kind: 'text', value: config.item_variable || 'item' }, { pointer: '/index_variable', label: '序号变量', kind: 'text', value: config.index_variable || 'index' });
    return result;
  }
  if (node.type === 'set_variable') return [
    { pointer: '/name', label: '变量名', kind: 'text', value: config.name || 'value' },
    { pointer: '/value/value', label: '变量值', kind: 'text', value: (config.value as AutomationExpression | undefined)?.value ?? '' },
  ];
  if (node.type === 'function') return [
    { pointer: '/name', label: '函数', kind: 'select', value: config.name || 'concat', options: options([["add", '求和'], ['subtract', '相减'], ['multiply', '相乘'], ['divide', '相除'], ['mod', '取余'], ['round', '四舍五入'], ['min', '最小值'], ['max', '最大值'], ['abs', '绝对值'], ['concat', '拼接'], ['length', '长度'], ['lower', '小写'], ['upper', '大写'], ['random', '随机小数'], ['random_int', '随机整数']]) },
    { pointer: '/args', label: '参数', kind: 'text', value: Array.isArray(config.args) ? config.args.map((item) => String((item as AutomationExpression).value ?? '')).join(', ') : '' },
    { pointer: '/result_variable', label: '结果变量', kind: 'text', value: config.result_variable || 'result' },
  ];
  if (node.type === 'calculate') return [
    { pointer: '/operation', label: '运算', kind: 'select', value: config.operation || 'add', options: options([['add', '加'], ['subtract', '减'], ['multiply', '乘'], ['divide', '除'], ['mod', '取余'], ['power', '乘方'], ['min', '最小值'], ['max', '最大值']]) },
    { pointer: '/left', label: '左值', kind: 'number', value: config.left ?? 0 },
    { pointer: '/right', label: '右值', kind: 'number', value: config.right ?? 0 },
    { pointer: '/result_variable', label: '结果变量', kind: 'text', value: config.result_variable || 'result' },
  ];
  if (node.type === 'wait') return [{ pointer: '/seconds', label: '等待秒数', kind: 'number', value: config.seconds ?? 1 }];
  if (node.type === 'local_file') return [{ pointer: '/path', label: '本地图片', kind: 'path', value: config.path || '' }];
  if (node.type === 'set_wallpaper') return [{ pointer: '/path', label: '回退图片', kind: 'path', value: config.path || '' }];
  if (node.type === 'dynamic_wallpaper') {
    const result: AutomationSettingDescriptor[] = [{ pointer: '/action', label: '动作', kind: 'select', value: config.action || 'start', options: options([["start", '启动'], ['play', '播放'], ['pause', '暂停'], ['reload', '重载'], ['stop', '关闭']]) }];
    if (config.action === 'start') result.push(
      { pointer: '/path', label: '视频路径', kind: 'video', value: config.path || '' },
      { pointer: '/loop', label: '循环', kind: 'boolean', value: config.loop !== false },
    );
    return result;
  }
  if (node.type === 'log') return [{ pointer: '/message', label: '日志内容', kind: 'text', value: config.message || '' }];
  if (node.type === 'notification') return [{ pointer: '/title', label: '标题', kind: 'text', value: config.title || '小树壁纸' }, { pointer: '/message', label: '内容', kind: 'text', value: config.message || '' }];
  if (node.type === 'command') return [
    { pointer: '/executable', label: '可执行文件', kind: 'text', value: config.executable || '' },
    { pointer: '/arguments', label: '参数', kind: 'text', value: config.arguments || '' },
    { pointer: '/working_directory', label: '工作目录', kind: 'text', value: config.working_directory || '.' },
    { pointer: '/timeout_seconds', label: '超时秒数', kind: 'number', value: config.timeout_seconds ?? 60 },
    { pointer: '/check', label: '失败时报错', kind: 'boolean', value: config.check !== false },
    { pointer: '/result_variable', label: '结果变量', kind: 'text', value: config.result_variable || 'command_result' },
  ];
  if (node.type === 'open_target') return [{ pointer: '/kind', label: '目标类型', kind: 'select', value: config.kind || 'auto', options: options([['auto', '自动'], ['file', '文件'], ['folder', '文件夹'], ['url', '链接']]) }, { pointer: '/target', label: '目标', kind: 'text', value: config.target || '' }];
  if (node.type === 'system_action') return [{ pointer: '/action', label: '系统动作', kind: 'select', value: config.action || 'sleep', options: options([['shutdown', '关机'], ['restart', '重启'], ['logout', '注销'], ['sleep', '睡眠']]) }, { pointer: '/delay_seconds', label: '延迟秒数', kind: 'number', value: config.delay_seconds ?? 5 }];
  if (node.type === 'read_file') return [{ pointer: '/path', label: '文本路径', kind: 'text', value: config.path || 'data.txt' }, { pointer: '/encoding', label: '编码', kind: 'text', value: config.encoding || 'utf-8' }, { pointer: '/result_variable', label: '结果变量', kind: 'text', value: config.result_variable || 'file_content' }];
  if (node.type === 'write_file') return [{ pointer: '/action', label: '写入方式', kind: 'select', value: config.action || 'write', options: options([['create', '仅创建'], ['write', '覆盖'], ['append', '追加']]) }, { pointer: '/path', label: '文件路径', kind: 'text', value: config.path || 'data.txt' }, { pointer: '/content', label: '文件内容', kind: 'text', value: config.content || '' }, { pointer: '/encoding', label: '编码', kind: 'text', value: config.encoding || 'utf-8' }];
  if (node.type === 'delete_file') return [{ pointer: '/path', label: '文件路径', kind: 'text', value: config.path || 'data.txt' }, { pointer: '/missing_ok', label: '不存在也成功', kind: 'boolean', value: Boolean(config.missing_ok) }];
  if (node.type === 'list_directory') return [{ pointer: '/path', label: '文件夹', kind: 'text', value: config.path || '.' }, { pointer: '/pattern', label: '匹配规则', kind: 'text', value: config.pattern || '*' }, { pointer: '/recursive', label: '递归', kind: 'boolean', value: Boolean(config.recursive) }, { pointer: '/include_files', label: '包含文件', kind: 'boolean', value: config.include_files !== false }, { pointer: '/include_directories', label: '包含文件夹', kind: 'boolean', value: config.include_directories !== false }, { pointer: '/result_variable', label: '结果变量', kind: 'text', value: config.result_variable || 'entries' }];
  if (node.type === 'datetime') return [{ pointer: '/value', label: '日期/时间戳', kind: 'text', value: config.value || '' }, { pointer: '/format', label: '输出格式', kind: 'text', value: config.format || '%Y-%m-%d %H:%M:%S' }, { pointer: '/timezone', label: '时区', kind: 'select', value: config.timezone || 'local', options: options([['local', '本地'], ['utc', 'UTC']]) }, { pointer: '/result_variable', label: '结果变量', kind: 'text', value: config.result_variable || 'datetime' }];
  if (node.type === 'fetch_resource') {
    const source = String(config.source || 'bing');
    const result: AutomationSettingDescriptor[] = [{ pointer: '/source', label: '资源类型', kind: 'select', value: source, options: options([["im", 'IM'], ['bing', 'Bing'], ['spotlight', '聚焦'], ['cnu', 'CNU'], ['pixiv', 'Pixiv'], ['ltws', '壁纸源'], ['folder', '本地文件夹'], ['favorites', '收藏']]) }];
    if (source === 'folder') return [
      ...result,
      { pointer: '/path', label: '文件夹', kind: 'directory', value: config.path || '' },
      { pointer: '/recursive', label: '包含子文件夹', kind: 'boolean', value: Boolean(config.recursive) },
      { pointer: '/order', label: '轮换顺序', kind: 'select', value: config.order || 'shuffle', options: options([['shuffle', '随机不重复'], ['sequential', '按文件名']]) },
    ];
    if (source === 'favorites') {
      const favoriteScope = String(config.scope || 'folder');
      const favoriteSettings: AutomationSettingDescriptor[] = [
        ...result,
        { pointer: '/scope', label: '范围', kind: 'select', value: favoriteScope, options: options([['folder', '完整收藏夹'], ['selected', '固定收藏']]) },
      ];
      if (favoriteScope === 'folder') favoriteSettings.push({ pointer: '/folder_id', label: '收藏夹', kind: catalog?.favorite_folders.length ? 'select' : 'text', value: config.folder_id || '', options: catalog?.favorite_folders.map((folder) => ({ id: folder.id, label: folder.name })) });
      favoriteSettings.push({ pointer: '/order', label: '轮换顺序', kind: 'select', value: config.order || 'shuffle', options: options([['shuffle', '随机不重复'], ['sequential', '收藏顺序']]) });
      return favoriteSettings;
    }
    if (source === 'bing') result.push(
      { pointer: '/category', label: '范围', kind: 'select', value: config.category || 'daily', options: options([["daily", '每日'], ['recent', '近期']]) },
      { pointer: '/market', label: '区域', kind: 'select', value: config.market || 'zh-CN', options: options([["zh-CN", '中国'], ['en-US', '美国'], ['ja-JP', '日本'], ['de-DE', '德国'], ['fr-FR', '法国']]) },
      { pointer: '/quality', label: '画质', kind: 'select', value: config.quality || 'highDef', options: options([["highDef", '高清'], ['ultraHighDef', '超高清']]) },
      { pointer: '/count', label: '候选数量', kind: 'number', value: config.count ?? 8 },
    );
    if (source === 'spotlight') result.push(
      { pointer: '/spotlight_source', label: '来源', kind: 'select', value: config.spotlight_source || 'online', options: options([["online", '在线'], ['local', '本机']]) },
      { pointer: '/market', label: '区域', kind: 'select', value: config.market || 'zh-CN', options: options([["zh-CN", '中国'], ['en-US', '美国'], ['ja-JP', '日本']]) },
      { pointer: '/limit', label: '数量', kind: 'number', value: config.limit ?? 20 },
    );
    if (source === 'cnu') result.push(
      { pointer: '/section', label: '栏目', kind: 'select', value: config.section || 'selected', options: options([["selected", '精选'], ['inspiration', '灵感'], ['discovery', '发现']]) },
      { pointer: '/order', label: '排序', kind: 'select', value: config.order || 'recommend', options: options([["recommend", '推荐'], ['hot', '热门'], ['recent', '最新']]) },
      { pointer: '/category_id', label: '分类 ID', kind: 'text', value: config.category_id || '0' },
      { pointer: '/page', label: '页码', kind: 'number', value: config.page ?? 1 },
      { pointer: '/limit', label: '数量', kind: 'number', value: config.limit ?? 20 },
      { pointer: '/work_selection', label: '作品选择', kind: 'select', value: config.work_selection || 'random', options: options([["random", '随机'], ['first', '第一个'], ['index', '指定']]) },
      { pointer: '/work_selection_index', label: '作品序号', kind: 'number', value: config.work_selection_index ?? 1 },
      { pointer: '/image_selection', label: '图片选择', kind: 'select', value: config.image_selection || 'random', options: options([["random", '随机'], ['first', '第一张'], ['index', '指定']]) },
      { pointer: '/image_selection_index', label: '图片序号', kind: 'number', value: config.image_selection_index ?? 1 },
    );
    if (source === 'pixiv') result.push(
      { pointer: '/mode', label: '榜单', kind: 'select', value: config.mode || 'day', options: options([["day", '日榜'], ['week', '周榜'], ['month', '月榜'], ['day_male', '男性'], ['day_female', '女性'], ['week_original', '原创'], ['week_rookie', '新人'], ['day_manga', '漫画'], ['day_r18', 'R18 日榜'], ['week_r18', 'R18 周榜'], ['week_r18g', 'R18G']]) },
      { pointer: '/ranking_date', label: '日期', kind: 'text', value: config.ranking_date || '' },
      { pointer: '/page', label: '页码', kind: 'number', value: config.page ?? 1 },
      { pointer: '/limit', label: '数量', kind: 'number', value: config.limit ?? 30 },
      { pointer: '/work_selection', label: '作品选择', kind: 'select', value: config.work_selection || 'random', options: options([["random", '随机'], ['first', '第一个'], ['index', '指定']]) },
      { pointer: '/work_selection_index', label: '作品序号', kind: 'number', value: config.work_selection_index ?? 1 },
      { pointer: '/image_selection', label: '图片选择', kind: 'select', value: config.image_selection || 'random', options: options([["random", '随机'], ['first', '第一张'], ['index', '指定']]) },
      { pointer: '/image_selection_index', label: '图片序号', kind: 'number', value: config.image_selection_index ?? 1 },
    );
    if (source === 'im') result.push({
      pointer: '/source_id',
      label: 'IM 来源',
      kind: catalog?.intelligent_market.length ? 'select' : 'text',
      value: config.source_id || '',
      options: catalog?.intelligent_market.map((item) => ({ id: item.id, label: item.friendly_name })),
    });
    if (source === 'ltws') {
      const sources = catalog?.wallpaper_sources.filter((item) => item.enabled !== false) || [];
      const selectedSource = sources.find((item) => item.identifier === config.source_id);
      result.push({ pointer: '/source_id', label: '壁纸源', kind: sources.length ? 'select' : 'text', value: config.source_id || '', options: sources.map((item) => ({ id: item.identifier, label: item.name })) });
      result.push({ pointer: '/api_name', label: 'API', kind: selectedSource?.apis?.length ? 'select' : 'text', value: config.api_name || '', options: selectedSource?.apis?.map((item) => ({ id: item.name, label: item.description ? `${item.name} · ${item.description}` : item.name })) });
    }
    for (const [key, value] of Object.entries((config.parameters as Record<string, unknown> | undefined) || {})) {
      const imParameter = catalog?.intelligent_market.find((item) => item.id === config.source_id)?.parameters?.find((item) => item.key === key);
      const sourceParameter = catalog?.wallpaper_sources.find((item) => item.identifier === config.source_id)?.apis?.find((item) => item.name === config.api_name)?.parameters?.find((item) => item.key === key);
      const parameterType = String(imParameter?.type || sourceParameter?.type || '').toLowerCase();
      const parameterOptions = imParameter?.options?.map((item, index) => ({ id: String(item), label: imParameter.friendly_options?.[index] || String(item) }))
        || sourceParameter?.choices?.map((item) => ({ id: item, label: item }));
      result.push({
        pointer: `/parameters/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
        label: sourceParameter?.label || key,
        kind: parameterOptions?.length ? 'select' : parameterType === 'number' || parameterType === 'integer' || typeof value === 'number' ? 'number' : parameterType === 'boolean' || typeof value === 'boolean' ? 'boolean' : 'text',
        value,
        options: parameterOptions,
      });
    }
    result.push(
      { pointer: '/selection', label: '选择方式', kind: 'select', value: config.selection || 'random', options: options([["random", '随机'], ['first', '第一张'], ['index', '指定序号']]) },
      { pointer: '/selection_index', label: '图片序号', kind: 'number', value: config.selection_index ?? 1 },
      { pointer: '/force_refresh', label: '忽略缓存', kind: 'boolean', value: Boolean(config.force_refresh) },
    );
    return result;
  }
  return [];
}

export function setNodeConfigValue(config: Record<string, unknown>, pointer: string, value: unknown): Record<string, unknown> {
  const next = structuredClone(config);
  const parts = pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = next;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    current[part] = child && typeof child === 'object' ? { ...(child as Record<string, unknown>) } : {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = pointer === '/args' && typeof value === 'string'
    ? value.split(',').map((item) => ({ type: 'literal', value: item.trim() })).filter((item) => item.value)
    : value;
  return next;
}

export function createAutomation(): AutomationDocument {
  const triggerId = crypto.randomUUID();
  const stopId = crypto.randomUUID();
  return {
    id: crypto.randomUUID().replace(/-/g, ''),
    name: '新自动化',
    description: '',
    enabled: false,
    version: 1,
    nodes: [
      { id: triggerId, type: 'trigger', x: 80, y: 160, config: { kind: 'manual' } },
      { id: stopId, type: 'stop', x: 420, y: 160, config: {} },
    ],
    edges: [{ id: crypto.randomUUID(), source: triggerId, target: stopId }],
    annotations: [],
  };
}

function createLinearAutomation(
  name: string,
  description: string,
  enabled: boolean,
  steps: Array<{ type: AutomationNodeType; config: Record<string, unknown> }>,
): AutomationDocument {
  const nodes = steps.map((step, index) => ({
    id: crypto.randomUUID(),
    type: step.type,
    x: 80 + index * 280,
    y: 160,
    config: step.config,
  }));
  return {
    id: crypto.randomUUID().replace(/-/g, ''),
    name,
    description,
    enabled,
    version: 1,
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: crypto.randomUUID(),
      source: node.id,
      target: nodes[index + 1].id,
    })),
    annotations: [],
  };
}

export function createScheduledWallpaperAutomation(options: {
  time: string;
  source: 'local' | 'resource';
  path?: string;
  resourceConfig?: Record<string, unknown>;
}): AutomationDocument {
  const sourceNode = options.source === 'local'
    ? { type: 'local_file' as const, config: { path: options.path || '' } }
    : { type: 'fetch_resource' as const, config: options.resourceConfig || createNodeConfig('fetch_resource') };
  return createLinearAutomation(
    '定时换壁纸',
    options.source === 'local' ? '每天定时应用指定本地壁纸' : '每天定时从在线资源获取并应用壁纸',
    false,
    [
      { type: 'trigger', config: { kind: 'schedule', time: options.time } },
      sourceNode,
      { type: 'set_wallpaper', config: {} },
      { type: 'stop', config: {} },
    ],
  );
}

export function createScheduledDynamicWallpaperAutomation(time: string, path: string): AutomationDocument {
  return createLinearAutomation(
    '定时换动态壁纸',
    '每天定时启动指定动态壁纸',
    false,
    [
      { type: 'trigger', config: { kind: 'schedule', time } },
      { type: 'dynamic_wallpaper', config: { action: 'start', path, loop: true, muted: true, playback_rate: 1 } },
      { type: 'stop', config: {} },
    ],
  );
}

export function createWallpaperRotationAutomation(options: {
  name: string;
  description: string;
  intervalSeconds: number;
  sourceConfig: Record<string, unknown>;
  enabled?: boolean;
}): AutomationDocument {
  return createLinearAutomation(
    options.name,
    options.description,
    options.enabled ?? false,
    [
      { type: 'trigger', config: { kind: 'interval', seconds: options.intervalSeconds } },
      { type: 'fetch_resource', config: options.sourceConfig },
      { type: 'set_wallpaper', config: {} },
      { type: 'stop', config: {} },
    ],
  );
}
