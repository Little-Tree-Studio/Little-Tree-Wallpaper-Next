import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Chip,
  Input,
  Label,
  ProgressBar,
  Spinner,
  Switch,
  toast,
} from '@heroui/react';
import {
  ArrowLeft,
  CheckCircle2,
  CircleOff,
  FileVideo2,
  FolderOpen,
  MonitorPlay,
  Play,
  Pause,
  RefreshCw,
  Square,
  TerminalSquare,
  Waypoints,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  getDynamicWallpaperStatus,
  selectDynamicWallpaperMedia,
  startDynamicWallpaper,
  stopDynamicWallpaper,
  type DynamicWallpaperStatus,
  controlDynamicWallpaper,
} from '@/api/backend';

const EMPTY_STATUS: DynamicWallpaperStatus = {
  supported: false,
  platform: '',
  windows_version: {
    major: 0,
    minor: 0,
    build: 0,
    revision: 0,
    display_version: '',
    text: '',
    modern_expected: false,
  },
  expected_structure: 'legacy_top_level',
  detected_structure: 'unsupported',
  structure_label: '',
  structure_reason: '',
  structure_matches_version: true,
  runtime_ready: false,
  host_window_ready: false,
  prepared_window_handle: '',
  operation_busy: false,
  operation_phase: 'idle',
  operation_started_at: '',
  explorer_ready: false,
  workerw_ready: false,
  progman_handle: '',
  def_view_handle: '',
  workerw_handle: '',
  desktop_host_kind: '',
  window_handle: '',
  dynamic_type: '',
  runtime_mode: '',
  window: {
    valid: false,
    visible: false,
    parent_matches: false,
    parent_handle: '',
    class_name: '',
    title: '',
    window_rect: { left: 0, top: 0, width: 0, height: 0 },
    host_rect: { left: 0, top: 0, width: 0, height: 0 },
  },
  running: false,
  media_path: '',
  media_name: '',
  media_exists: false,
  media_size: 0,
  media_modified_at: '',
  media_content_type: '',
  media_revision: 0,
  started_at: '',
  last_error: '',
  last_operation: '',
  telemetry: {
    received: false,
    event: 'idle',
    updated_at: '',
    player_loaded_at: '',
    media_revision: 0,
    current_time: 0,
    duration: 0,
    progress: 0,
    paused: true,
    ended: false,
    seeking: false,
    ready_state: 0,
    network_state: 0,
    video_width: 0,
    video_height: 0,
    buffered_start: 0,
    buffered_end: 0,
    buffered_ranges: 0,
    muted: true,
    volume: 1,
    loop: true,
    playback_rate: 1,
    fps: 0,
    fps_source: '',
    dropped_frames: 0,
    total_frames: 0,
    error_code: 0,
    error_message: '',
    visibility: '',
  },
  supported_extensions: [],
  events: [],
};

export default function DynamicWallpaperDebug() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<DynamicWallpaperStatus>(EMPTY_STATUS);
  const [mediaPath, setMediaPath] = useState('');
  const [muted, setMuted] = useState(true);
  const [loop, setLoop] = useState(true);
  const [playbackRate, setPlaybackRate] = useState('1');
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'start' | 'stop' | 'pick' | ''>('');
  const mediaPathRef = useRef(mediaPath);
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    mediaPathRef.current = mediaPath;
  }, [mediaPath]);

  const refresh = async (quiet = false) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    if (!quiet) setLoading(true);
    try {
      const next = await getDynamicWallpaperStatus();
      setStatus(next);
      if (!mediaPathRef.current && next.media_path) setMediaPath(next.media_path);
    } catch (error) {
      if (!quiet) {
        toast.danger('动态壁纸状态读取失败', {
          description: error instanceof Error ? error.message : String(error),
          timeout: 0,
        });
      }
    } finally {
      refreshInFlightRef.current = false;
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const pickMedia = async () => {
    setAction('pick');
    try {
      const path = await selectDynamicWallpaperMedia();
      if (path) setMediaPath(path);
    } catch (error) {
      toast.danger('无法选择视频', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setAction('');
    }
  };

  const start = async () => {
    if (!mediaPath.trim()) {
      toast.warning('请先选择动态壁纸视频');
      return;
    }
    setAction('start');
    try {
      const rate = Number(playbackRate);
      const next = await startDynamicWallpaper(mediaPath.trim(), muted, loop, Number.isFinite(rate) ? rate : 1);
      setStatus(next);
      toast.info(next.running ? '已提交视频切换' : '已提交动态壁纸启动', {
        description: '任务将在后台执行，可在状态区域查看当前阶段。',
        timeout: 3000,
      });
    } catch (error) {
      toast.danger('动态壁纸启动失败', {
        description: error instanceof Error ? error.message : String(error),
        timeout: 0,
      });
      await refresh(true);
    } finally {
      setAction('');
    }
  };

  const stop = async () => {
    setAction('stop');
    try {
      setStatus(await stopDynamicWallpaper());
      toast.success('动态壁纸已停止', { timeout: 2500 });
    } catch (error) {
      toast.danger('停止动态壁纸失败', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setAction('');
    }
  };

  const controlPlayer = async (command: 'play' | 'pause' | 'reload') => {
    try {
      setStatus(await controlDynamicWallpaper(command));
    } catch (error) {
      toast.danger('播放器操作失败', { description: error instanceof Error ? error.message : String(error) });
    }
  };

  const telemetry = status.telemetry;
  const playbackState = getPlaybackState(status);

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button isIconOnly variant="ghost" onPress={() => navigate('/tools')} aria-label="返回工具">
            <ArrowLeft size={18} />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">动态壁纸调试台</h1>
              <Chip color={status.operation_busy ? 'warning' : status.running ? 'success' : 'default'} variant="soft" size="sm">
                <span className={`size-1.5 rounded-full ${status.operation_busy ? 'bg-warning' : status.running ? 'bg-success' : 'bg-muted'}`} />
                {status.operation_busy ? operationPhaseLabel(status.operation_phase) : status.running ? '运行中' : '未运行'}
              </Chip>
              <Chip color="warning" variant="soft" size="sm">实验功能</Chip>
            </div>
            <p className="mt-1 text-sm text-muted">验证本地视频、pywebview 宿主窗口与 Windows WorkerW 桌面层的完整链路。</p>
          </div>
        </div>
        <Button variant="ghost" onPress={() => void refresh()} isPending={loading}>
          {loading ? <Spinner size="sm" color="current" /> : <RefreshCw size={16} />}
          重新探测
        </Button>
      </header>

      {!loading && !status.supported && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>当前环境不支持</Alert.Title>
            <Alert.Description>动态壁纸宿主仅在 Windows 上启用，当前页面仍可用于检查接口状态。</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {status.last_error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>最近一次启动失败</Alert.Title>
            <Alert.Description>{status.last_error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {!loading && status.supported && status.detected_structure !== 'not_initialized' && !status.structure_matches_version && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>窗口结构与版本预期不同</Alert.Title>
            <Alert.Description>
              系统版本预期使用{structureName(status.expected_structure)}，实际探测到{status.structure_label}。启动时将以实际窗口拓扑为准。
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatusTile icon={MonitorPlay} label="Windows 版本" ok={status.supported} value={status.windows_version.text || '不支持'} />
        <StatusTile icon={Waypoints} label="Explorer / Progman" ok={status.explorer_ready} value={status.progman_handle || '未找到'} />
        <StatusTile icon={Waypoints} label="桌面窗口结构" ok={status.workerw_ready || status.running} value={status.desktop_host_kind || status.structure_label || '等待探测'} />
        <StatusTile icon={MonitorPlay} label="预创建播放器宿主" ok={status.host_window_ready} value={status.window_handle || status.prepared_window_handle || '初始化中'} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <Card className="gap-4 p-5">
          <Card.Header className="gap-1">
            <div className="flex items-center gap-2 text-primary"><FileVideo2 size={20} /><Card.Title>媒体与播放参数</Card.Title></div>
            <Card.Description>选择本地视频后启动。调试宿主会覆盖虚拟桌面并置于桌面图标之后。</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="dynamic-wallpaper-path">视频文件</Label>
              <div className="flex gap-2">
                <Input
                  id="dynamic-wallpaper-path"
                  className="min-w-0 flex-1"
                  variant="secondary"
                  placeholder="选择 .mp4、.webm、.mov 或 .m4v 文件"
                  value={mediaPath}
                  onChange={(event) => setMediaPath(event.target.value)}
                />
                <Button variant="secondary" onPress={pickMedia} isPending={action === 'pick'}>
                  {action === 'pick' ? <Spinner size="sm" color="current" /> : <FolderOpen size={17} />}
                  浏览
                </Button>
              </div>
              <p className="text-xs text-muted">实际解码能力取决于系统 WebView2 媒体支持；建议优先使用 H.264/AAC MP4。</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <OptionSwitch label="静音播放" description="避免桌面持续输出声音" selected={muted} onChange={setMuted} />
              <OptionSwitch label="循环播放" description="视频结束后自动重播" selected={loop} onChange={setLoop} />
              <div className="rounded-xl bg-surface-secondary p-3">
                <Label htmlFor="dynamic-wallpaper-rate" className="text-sm font-medium">播放速度</Label>
                <Input
                  id="dynamic-wallpaper-rate"
                  className="mt-2"
                  variant="secondary"
                  type="number"
                  min="0.25"
                  max="4"
                  step="0.25"
                  value={playbackRate}
                  onChange={(event) => setPlaybackRate(event.target.value)}
                />
              </div>
            </div>
          </Card.Content>
          <Card.Footer className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button onPress={start} isDisabled={!status.supported || !status.host_window_ready || status.operation_busy || action !== ''} isPending={action === 'start' || status.operation_busy}>
              {action === 'start' ? <Spinner size="sm" color="current" /> : <Play size={17} fill="currentColor" />}
              {status.running ? '切换视频' : '启动动态壁纸'}
            </Button>
            <Button variant="danger-soft" onPress={stop} isDisabled={!status.running || status.operation_busy || action !== ''} isPending={action === 'stop'}>
              {action === 'stop' ? <Spinner size="sm" color="current" /> : <Square size={15} fill="currentColor" />}
              停止并恢复桌面
            </Button>
            <Button isIconOnly variant="ghost" onPress={() => void controlPlayer(telemetry.paused ? 'play' : 'pause')} isDisabled={!status.running} aria-label={telemetry.paused ? '继续播放' : '暂停播放'}>
              {telemetry.paused ? <Play size={16} /> : <Pause size={16} />}
            </Button>
            <Button isIconOnly variant="ghost" onPress={() => void controlPlayer('reload')} isDisabled={!status.running} aria-label="重新加载视频">
              <RefreshCw size={16} />
            </Button>
            {status.started_at && <span className="ml-auto text-xs text-muted">启动于 {formatTime(status.started_at)}</span>}
          </Card.Footer>
        </Card>

        <Card variant="secondary" className="gap-4 p-5">
          <Card.Header className="gap-1">
            <div className="flex items-center gap-2"><TerminalSquare size={20} /><Card.Title>当前会话</Card.Title></div>
            <Card.Description>用于快速核对窗口附着结果。</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-2">
            <DetailRow label="媒体" value={status.media_name || '未加载'} />
            <DetailRow label="媒体存在" value={status.media_exists ? '是' : '否'} success={status.media_exists} />
            <DetailRow label="版本预判" value={structureName(status.expected_structure)} />
            <DetailRow label="实际结构" value={status.structure_label || '-'} success={status.workerw_ready} />
            <DetailRow label="Progman" value={status.progman_handle || '-'} numeric />
            <DetailRow label="SHELLDLL_DefView" value={status.def_view_handle || '-'} numeric />
            <DetailRow label={status.desktop_host_kind || 'WorkerW'} value={status.workerw_handle || '-'} numeric />
            <DetailRow label="宿主 HWND" value={status.window_handle || '-'} numeric />
            <DetailRow label="运行时" value={status.runtime_ready ? '已连接' : '未就绪'} success={status.runtime_ready} />
            <DetailRow label="预创建宿主" value={status.host_window_ready ? '已就绪' : '初始化中'} success={status.host_window_ready} />
            <DetailRow label="操作阶段" value={operationPhaseLabel(status.operation_phase)} />
            <div className="rounded-lg bg-surface px-3 py-2">
              <p className="text-xs text-muted">判断依据</p>
              <p className="mt-1 text-xs leading-5 text-foreground">{status.structure_reason || '等待桌面窗口拓扑探测'}</p>
            </div>
          </Card.Content>
        </Card>
      </div>

      <Card className="gap-4 p-5">
        <Card.Header className="flex-row items-center justify-between gap-3">
          <div>
            <Card.Title>实时播放诊断</Card.Title>
            <Card.Description>数据由桌面宿主中的 HTMLVideoElement 实时上报。</Card.Description>
          </div>
          <Chip color={playbackState.color} variant="soft" size="sm">{playbackState.label}</Chip>
        </Card.Header>
        <Card.Content className="space-y-5">
          <ProgressBar aria-label="视频播放进度" size="sm" value={Math.max(0, Math.min(100, telemetry.progress * 100))}>
            <div className="flex justify-between gap-3 text-xs tabular-nums">
              <Label>播放进度</Label>
              <span>{formatDuration(telemetry.current_time)} / {formatDuration(telemetry.duration)}</span>
            </div>
            <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
          </ProgressBar>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <Metric label="实时帧率" value={`${telemetry.fps.toFixed(1)} FPS`} hint={telemetry.fps_source || '等待采样'} accent />
            <Metric label="视频尺寸" value={telemetry.video_width ? `${telemetry.video_width} x ${telemetry.video_height}` : '-'} />
            <Metric label="缓冲位置" value={formatDuration(telemetry.buffered_end)} hint={`${telemetry.buffered_ranges} 个区间`} />
            <Metric label="丢帧" value={String(telemetry.dropped_frames)} hint={telemetry.total_frames ? `${((telemetry.dropped_frames / telemetry.total_frames) * 100).toFixed(2)}%` : '0.00%'} />
            <Metric label="ReadyState" value={`${telemetry.ready_state} · ${readyStateLabel(telemetry.ready_state)}`} />
            <Metric label="NetworkState" value={`${telemetry.network_state} · ${networkStateLabel(telemetry.network_state)}`} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <DetailRow label="最近事件" value={telemetry.event || '-'} />
            <DetailRow label="遥测时间" value={telemetry.updated_at ? formatTime(telemetry.updated_at) : '-'} numeric />
            <DetailRow label="播放参数" value={`${telemetry.playback_rate}x · ${telemetry.muted ? '静音' : `音量 ${Math.round(telemetry.volume * 100)}%`} · ${telemetry.loop ? '循环' : '单次'}`} />
            <DetailRow label="可见性" value={telemetry.visibility || '-'} />
          </div>
          {telemetry.error_message && <Alert status="danger"><Alert.Indicator /><Alert.Content><Alert.Title>媒体播放错误 {telemetry.error_code}</Alert.Title><Alert.Description>{telemetry.error_message}</Alert.Description></Alert.Content></Alert>}
        </Card.Content>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card variant="secondary" className="gap-3 p-5">
          <Card.Header><Card.Title>媒体文件</Card.Title><Card.Description>确认切换请求实际指向的新资源。</Card.Description></Card.Header>
          <Card.Content className="space-y-2">
            <DetailRow label="文件名" value={status.media_name || '-'} />
            <DetailRow label="类型" value={status.media_content_type || '-'} />
            <DetailRow label="大小" value={formatBytes(status.media_size)} numeric />
            <DetailRow label="修改时间" value={status.media_modified_at ? formatDateTime(status.media_modified_at) : '-'} numeric />
            <DetailRow label="媒体修订" value={String(status.media_revision)} numeric />
            <DetailRow label="最近操作" value={status.last_operation || '-'} />
          </Card.Content>
        </Card>
        <Card variant="secondary" className="gap-3 p-5">
          <Card.Header><Card.Title>宿主窗口</Card.Title><Card.Description>检查 HWND 是否仍正确挂在桌面宿主下。</Card.Description></Card.Header>
          <Card.Content className="space-y-2">
            <DetailRow label="原生窗口有效" value={status.window.valid ? '是' : '否'} success={status.window.valid} />
            <DetailRow label="窗口可见" value={status.window.visible ? '是' : '否'} success={status.window.visible} />
            <DetailRow label="父窗口匹配" value={status.window.parent_matches ? '是' : '否'} success={status.window.parent_matches} />
            <DetailRow label="父 HWND" value={status.window.parent_handle || '-'} numeric />
            <DetailRow label="宿主画布" value={formatRect(status.window.host_rect)} numeric />
            <DetailRow label="播放窗口" value={formatRect(status.window.window_rect)} numeric />
          </Card.Content>
        </Card>
      </div>

      <Card className="gap-3 p-5">
        <Card.Header className="flex-row items-center justify-between gap-3">
          <div>
            <Card.Title>事件记录</Card.Title>
            <Card.Description>显示最近 80 条动态壁纸宿主事件，新事件位于顶部。</Card.Description>
          </div>
          <Chip size="sm" variant="soft">{status.events.length} 条</Chip>
        </Card.Header>
        <Card.Content>
          {status.events.length === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl bg-surface-secondary text-muted">
              <CircleOff size={22} />
              <span className="text-sm">尚无调试事件</span>
            </div>
          ) : (
            <div className="max-h-72 overflow-auto rounded-xl bg-surface-secondary p-2 text-xs tabular-nums">
              {status.events.map((event, index) => (
                <div key={`${event.time}-${index}`} className="grid grid-cols-[5.5rem_4rem_minmax(0,1fr)] gap-3 rounded-lg px-2 py-2 hover:bg-surface-tertiary">
                  <span className="text-muted">{formatTime(event.time)}</span>
                  <span className={event.level === 'error' ? 'text-danger' : event.level === 'warning' ? 'text-warning' : 'text-primary'}>
                    {event.level.toUpperCase()}
                  </span>
                  <span className="break-words text-foreground">{event.message}</span>
                </div>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}

function StatusTile({ icon: Icon, label, ok, value }: { icon: React.ElementType; label: string; ok: boolean; value: string }) {
  return (
    <Card variant="secondary" className="min-w-0 gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <Icon size={18} className={ok ? 'text-success' : 'text-muted'} />
        {ok ? <CheckCircle2 size={16} className="text-success" /> : <XCircle size={16} className="text-muted" />}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="mt-0.5 truncate text-sm font-medium tabular-nums" title={value}>{value}</p>
      </div>
    </Card>
  );
}

function OptionSwitch({ label, description, selected, onChange }: { label: string; description: string; selected: boolean; onChange: (value: boolean) => void }) {
  return (
    <Switch aria-label={label} isSelected={selected} onChange={onChange} className="rounded-xl bg-surface-secondary p-3">
      <Switch.Content>
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted">{description}</span>
      </Switch.Content>
      <Switch.Control><Switch.Thumb /></Switch.Control>
    </Switch>
  );
}

function DetailRow({ label, value, numeric = false, success }: { label: string; value: string; numeric?: boolean; success?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2">
      <span className="text-xs text-muted">{label}</span>
      <span className={`truncate text-right text-sm ${numeric ? 'tabular-nums' : ''} ${success ? 'text-success' : ''}`} title={value}>{value}</span>
    </div>
  );
}

function Metric({ label, value, hint, accent = false }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return <div className="rounded-xl bg-surface-secondary p-3"><p className="text-xs text-muted">{label}</p><p className={`mt-1 truncate text-base font-semibold tabular-nums ${accent ? 'text-primary' : ''}`} title={value}>{value}</p>{hint && <p className="mt-1 truncate text-[11px] text-muted" title={hint}>{hint}</p>}</div>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('zh-CN', { hour12: false });
}

function structureName(structure: DynamicWallpaperStatus['expected_structure']): string {
  return structure === 'modern_child' ? '24H2 子窗口结构' : '传统顶层 WorkerW 结构';
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const value = Math.floor(seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remaining = value % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 2 : 0)} ${units[exponent]}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function formatRect(rect: { left: number; top: number; width: number; height: number }): string {
  return `${rect.width} x ${rect.height} @ ${rect.left}, ${rect.top}`;
}

function readyStateLabel(value: number): string {
  return ['无数据', '元数据', '当前帧', '后续数据', '足够播放'][value] || '未知';
}

function networkStateLabel(value: number): string {
  return ['空闲', '待机', '加载中', '无来源'][value] || '未知';
}

function getPlaybackState(status: DynamicWallpaperStatus): { label: string; color: 'default' | 'success' | 'warning' | 'danger' } {
  const telemetry = status.telemetry;
  if (!status.running) return { label: '宿主未运行', color: 'default' };
  if (telemetry.error_code || telemetry.event === 'error') return { label: '播放错误', color: 'danger' };
  if (!telemetry.received) return { label: '等待播放器上报', color: 'warning' };
  if (telemetry.event === 'waiting' || telemetry.event === 'stalled') return { label: '正在缓冲', color: 'warning' };
  if (telemetry.paused) return { label: telemetry.ended ? '播放结束' : '已暂停', color: 'default' };
  return { label: '正在播放', color: 'success' };
}

function operationPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    idle: '空闲',
    queued: '等待后台启动',
    validating: '正在校验媒体',
    'finding-desktop': '正在探测桌面层',
    'loading-player': '正在加载播放器',
    attaching: '正在附着窗口',
    switching: '正在切换视频',
    stopping: '正在停止',
    'control-play': '正在继续播放',
    'control-pause': '正在暂停',
    'control-reload': '正在重新加载',
  };
  return labels[phase] || phase || '空闲';
}
