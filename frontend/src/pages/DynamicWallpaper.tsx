import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Chip, Input, Label, ListBox, Select, Spinner, Switch, Tooltip, toast } from '@heroui/react';
import { Bug, FolderOpen, Image, Images, MonitorPlay, Pause, Play, Puzzle, RefreshCw, Settings2, Square, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DynamicDesktop, { DesktopPreviewOverlay } from '@/components/DynamicDesktop';
import {
  applyDynamicWallpaperScene,
  getDisplayResolutions,
  getDynamicWallpaperCatalog,
  getDynamicWallpaperScene,
  getDynamicWallpaperStatus,
  openDynamicWidgetEditor,
  saveDynamicWallpaperScene,
  selectAutomationDirectory,
  selectDynamicWallpaperImage,
  selectDynamicWallpaperMedia,
  stopDynamicWallpaper,
} from '@/api/backend';
import type { DisplayResolution, DynamicBackgroundType, DynamicTransition, DynamicWallpaperScene, DynamicWallpaperStatus } from '@/api/backend';

const TRANSITIONS: { id: DynamicTransition; label: string; description: string }[] = [
  { id: 'fade', label: '柔和淡入', description: '经典交叉淡化' },
  { id: 'slide-left', label: '横向推入', description: '从右向左推进' },
  { id: 'slide-up', label: '向上揭幕', description: '从底部推入画面' },
  { id: 'zoom', label: '镜头拉近', description: '缩放并淡入' },
  { id: 'blur', label: '清晰聚焦', description: '由模糊变清晰' },
  { id: 'wipe', label: '光幕擦除', description: '横向揭开新画面' },
  { id: 'flip', label: '空间翻页', description: '轻微透视翻转' },
  { id: 'ken-burns', label: '漫游镜头', description: '缓慢平移与缩放' },
];

function sourceLabel(type: DynamicBackgroundType): string {
  return type === 'video' ? '本地视频' : type === 'image' ? '单张图片' : '图片轮播';
}

export default function DynamicWallpaper() {
  const navigate = useNavigate();
  const [scene, setScene] = useState<DynamicWallpaperScene | null>(null);
  const [status, setStatus] = useState<DynamicWallpaperStatus | null>(null);
  const [favoriteFolders, setFavoriteFolders] = useState<{ id: string; name: string }[]>([]);
  const [display, setDisplay] = useState<DisplayResolution | null>(null);
  const [pending, setPending] = useState('');
  const polling = useRef(false);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState(0);

  const refreshStatus = async () => {
    if (polling.current) return;
    polling.current = true;
    try { setStatus(await getDynamicWallpaperStatus()); } catch { /* keep the last known status */ } finally { polling.current = false; }
  };

  useEffect(() => {
    let cancelled = false;
    getDynamicWallpaperScene().then((next) => !cancelled && setScene(next))
      .catch((error: unknown) => toast.danger('动态场景加载失败', { description: error instanceof Error ? error.message : String(error) }));
    getDynamicWallpaperStatus().then((next) => !cancelled && setStatus(next))
      .catch((error: unknown) => toast.danger('动态服务状态读取失败', { description: error instanceof Error ? error.message : String(error) }));
    getDynamicWallpaperCatalog().then((next) => !cancelled && setFavoriteFolders(next.favorite_folders))
      .catch(() => undefined);
    getDisplayResolutions().then((items) => {
      if (!cancelled) setDisplay(items.find((item) => item.is_primary) ?? items[0] ?? null);
    }).catch(() => undefined);
    const timer = window.setInterval(refreshStatus, 1200);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return undefined;
    const update = () => setPreviewWidth(preview.getBoundingClientRect().width);
    const observer = new ResizeObserver(update);
    observer.observe(preview);
    update();
    return () => observer.disconnect();
  }, [display?.width, display?.height, scene !== null, status !== null]);

  if (!scene || !status) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const updateBackground = (updates: Partial<DynamicWallpaperScene['background']>) => setScene({ ...scene, background: { ...scene.background, ...updates } });

  const selectSource = async () => {
    setPending('pick');
    try {
      let path: string | null = null;
      if (scene.background.type === 'video') path = await selectDynamicWallpaperMedia();
      else if (scene.background.type === 'image') path = await selectDynamicWallpaperImage();
      else if (scene.background.source === 'folder') path = await selectAutomationDirectory();
      if (path) updateBackground({ path });
    } finally { setPending(''); }
  };

  const save = async () => {
    setPending('save');
    try {
      setScene(await saveDynamicWallpaperScene(scene));
      toast.success('动态场景已保存');
    } catch (error) {
      toast.danger('保存失败', { description: error instanceof Error ? error.message : String(error) });
    } finally { setPending(''); }
  };

  const start = async () => {
    setPending('start');
    try {
      const result = await applyDynamicWallpaperScene(scene);
      setStatus(result.status);
      setScene(result.scene);
      toast.info(result.status.last_operation === 'apply-scene-requested' ? '新场景已排队' : status.running ? '正在应用新场景' : '正在启动动态壁纸', {
        description: result.status.last_operation === 'apply-scene-requested' ? '当前操作完成后将自动应用最后一次提交。' : '桌面宿主将在后台完成加载。',
      });
    } catch (error) {
      toast.danger('启动失败', { description: error instanceof Error ? error.message : String(error), timeout: 0 });
    } finally { setPending(''); }
  };

  const stop = async () => {
    setPending('stop');
    try {
      const next = await stopDynamicWallpaper();
      setStatus(next);
      toast.success(next.operation_busy ? '已请求停止动态壁纸' : '动态壁纸服务已停止', {
        description: next.operation_busy ? '正在取消当前轮播加载或桌面附着操作。' : undefined,
      });
    }
    catch (error) { toast.danger('停止失败', { description: error instanceof Error ? error.message : String(error) }); }
    finally { setPending(''); }
  };

  const openEditor = async () => {
    await save();
    try { await openDynamicWidgetEditor(); }
    catch (error) { toast.danger('无法打开编辑器', { description: error instanceof Error ? error.message : String(error) }); }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">动态</h1>
            <Chip color={status.operation_busy ? 'warning' : status.running ? 'success' : 'default'} variant="soft" size="sm">
              <span className={`size-1.5 rounded-full ${status.operation_busy ? 'bg-warning' : status.running ? 'bg-success' : 'bg-muted'}`} />
              {status.operation_busy ? '正在处理' : status.running ? '服务运行中' : '服务已停止'}
            </Chip>
          </div>
          <p className="mt-1 text-sm text-muted">组合视频、图片轮播和小组件，创建一张可交互的桌面场景。</p>
        </div>
        <div className="flex gap-2">
          <Tooltip><Button isIconOnly variant="ghost" aria-label="动态壁纸调试台" onPress={() => navigate('/tools/dynamic-wallpaper')}><Bug size={18} /></Button><Tooltip.Content>保留的动态壁纸调试台</Tooltip.Content></Tooltip>
          <Button variant="secondary" onPress={openEditor}><Puzzle size={17} />编辑小组件</Button>
          <Button onPress={start} isPending={pending === 'start'} isDisabled={!status.supported}><Play size={17} fill="currentColor" />{status.running ? '应用场景' : '启动服务'}</Button>
          <Button variant="danger-soft" onPress={stop} isPending={pending === 'stop'} isDisabled={!status.running && !status.operation_busy && pending !== 'start'}><Square size={14} fill="currentColor" />停止</Button>
        </div>
      </header>

      {!status.supported && <Alert status="warning"><Alert.Indicator /><Alert.Content><Alert.Title>当前环境不支持桌面宿主</Alert.Title><Alert.Description>配置和小组件编辑仍可使用，动态壁纸服务仅在 Windows 上启动。</Alert.Description></Alert.Content></Alert>}
      {status.last_error && <Alert status="danger"><Alert.Indicator /><Alert.Content><Alert.Title>最近一次运行失败</Alert.Title><Alert.Description>{status.last_error}</Alert.Description></Alert.Content></Alert>}

      <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(340px,0.95fr)]">
        <Card className="min-w-0 self-start overflow-hidden p-0">
          <div ref={previewRef} className="relative mx-auto w-full overflow-hidden bg-black" style={{ aspectRatio: `${display?.width || 1920} / ${display?.height || 1080}` }}>
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: display?.width || 1920,
                height: display?.height || 1080,
                transform: `scale(${previewWidth / (display?.width || 1920)})`,
              }}
            >
              <DynamicDesktop scene={scene} />
            </div>
            <DesktopPreviewOverlay display={display ?? { name: '主显示器', width: 1920, height: 1080 }} />
          </div>
          <Card.Footer className="flex flex-wrap items-center gap-3 p-4">
            <div><p className="text-sm font-medium">桌面预览</p><p className="text-xs text-muted">{sourceLabel(scene.background.type)} · {scene.widgets.length} 个小组件</p></div>
            <Button className="ml-auto" variant="secondary" onPress={openEditor}><Settings2 size={16} />打开布局编辑器</Button>
          </Card.Footer>
        </Card>

        <Card className="min-w-0 gap-4 p-5">
          <Card.Header><Card.Title>底图</Card.Title><Card.Description>选择桌面场景的基础视觉层。</Card.Description></Card.Header>
          <Card.Content className="min-w-0 space-y-5">
            <div className="grid grid-cols-3 gap-2">
              {([
                ['video', Video, '视频'], ['image', Image, '图片'], ['slideshow', Images, '轮播'],
              ] as const).map(([type, Icon, label]) => (
                <Button key={type} variant={scene.background.type === type ? 'primary' : 'secondary'} onPress={() => updateBackground({ type })}><Icon size={17} />{label}</Button>
              ))}
            </div>

            {scene.background.type === 'slideshow' && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant={scene.background.source === 'folder' ? 'primary' : 'secondary'} onPress={() => updateBackground({ source: 'folder', folder_id: '' })}><FolderOpen size={16} />文件夹</Button>
                <Button variant={scene.background.source === 'favorites' ? 'primary' : 'secondary'} onPress={() => updateBackground({ source: 'favorites', path: '' })}><Images size={16} />收藏夹</Button>
              </div>
            )}

            {scene.background.type === 'slideshow' && scene.background.source === 'favorites' ? (
              <Select className="min-w-0 w-full" value={scene.background.folder_id} onChange={(key) => updateBackground({ folder_id: String(key) })} placeholder={favoriteFolders.length ? '选择收藏夹' : '正在读取收藏夹...'}>
                <Label>轮播收藏夹</Label>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>{favoriteFolders.map((folder) => <ListBox.Item key={folder.id} id={folder.id} textValue={folder.name}>{folder.name}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
              </Select>
            ) : (
              <div className="space-y-2">
                <Label>{scene.background.type === 'video' ? '视频文件' : scene.background.type === 'image' ? '图片文件' : '图片文件夹'}</Label>
                <div className="flex min-w-0 gap-2"><Input className="min-w-0 flex-1" variant="secondary" value={scene.background.path} readOnly placeholder="尚未选择" /><Button className="shrink-0" variant="secondary" onPress={selectSource} isPending={pending === 'pick'}><FolderOpen size={16} />浏览</Button></div>
              </div>
            )}

            {scene.background.type === 'video' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Switch isSelected={scene.background.muted} onChange={(muted) => updateBackground({ muted })}><Switch.Content><span className="text-sm font-medium">静音播放</span></Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                <Switch isSelected={scene.background.loop} onChange={(loop) => updateBackground({ loop })}><Switch.Content><span className="text-sm font-medium">循环播放</span></Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
              </div>
            )}

            {scene.background.type === 'slideshow' && (
              <>
                <div className="grid min-w-0 grid-cols-1 gap-3 2xl:grid-cols-2">
                  <div className="min-w-0"><Label htmlFor="dynamic-interval">停留时间（秒）</Label><Input id="dynamic-interval" className="mt-2 min-w-0 w-full" variant="secondary" type="number" min="3" value={String(scene.background.interval_seconds)} onChange={(event) => updateBackground({ interval_seconds: Number(event.target.value) || 3 })} /></div>
                  <div className="min-w-0"><Label htmlFor="dynamic-duration">动画时长（毫秒）</Label><Input id="dynamic-duration" className="mt-2 min-w-0 w-full" variant="secondary" type="number" min="100" value={String(scene.background.transition_duration)} onChange={(event) => updateBackground({ transition_duration: Number(event.target.value) || 100 })} /></div>
                </div>
                <Switch isSelected={scene.background.shuffle} onChange={(shuffle) => updateBackground({ shuffle })}><Switch.Content><span className="text-sm font-medium">随机顺序</span><span className="text-xs text-muted">每次随机选择下一张图片</span></Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
              </>
            )}
          </Card.Content>
        </Card>
      </div>

      {scene.background.type === 'slideshow' && (
        <Card className="gap-4 p-5">
          <Card.Header className="flex-row items-center justify-between"><div><Card.Title>切换动画</Card.Title><Card.Description>轮播专用的场景过渡，与系统普通轮播互不影响。</Card.Description></div><Chip variant="soft">{TRANSITIONS.length} 个预设</Chip></Card.Header>
          <Card.Content className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TRANSITIONS.map((preset) => (
              <Button key={preset.id} variant={scene.background.transition === preset.id ? 'primary' : 'secondary'} className="h-auto items-start justify-start px-4 py-3 text-left" onPress={() => updateBackground({ transition: preset.id })}>
                <span><span className="block font-medium">{preset.label}</span><span className="mt-1 block text-xs opacity-65">{preset.description}</span></span>
              </Button>
            ))}
          </Card.Content>
        </Card>
      )}

      <div className="flex items-center justify-between rounded-xl bg-surface-secondary px-4 py-3">
        <div className="flex items-center gap-3 text-sm text-muted"><MonitorPlay size={17} /><span>{status.windows_version.text || '桌面宿主待探测'}</span>{status.telemetry.paused && status.running && <Chip size="sm" variant="soft"><Pause size={12} />视频已暂停</Chip>}</div>
        <div className="flex gap-2"><Button isIconOnly variant="ghost" aria-label="刷新状态" onPress={refreshStatus}><RefreshCw size={16} /></Button><Button variant="secondary" onPress={save} isPending={pending === 'save'}>仅保存配置</Button></div>
      </div>
    </div>
  );
}
