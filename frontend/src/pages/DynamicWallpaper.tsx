import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Chip, Input, Label, ListBox, Select, Slider, Spinner, Switch, Tag, TagGroup, Tabs, Tooltip, toast } from '@heroui/react';
import { Bug, Circle, CloudRain, Flower2, FolderOpen, Image, Images, Leaf, MonitorPlay, Pause, Play, Puzzle, RefreshCw, Settings2, Snowflake, Sparkle, Sparkles, Square, SunDim, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DynamicDesktop, { DesktopPreviewOverlay } from '@/components/DynamicDesktop';
import {
  applyDynamicWallpaperScene,
  getDisplayResolutions,
  getDynamicWallpaperCatalog,
  getDynamicWallpaperScene,
  getDynamicWallpaperStatus,
  openDynamicWidgetEditor,
  resolveDynamicWallpaperScene,
  saveDynamicWallpaperScene,
  selectAutomationDirectory,
  selectDynamicWallpaperImage,
  selectDynamicWallpaperMedia,
  stopDynamicWallpaper,
} from '@/api/backend';
import type { DisplayResolution, DynamicBackgroundType, DynamicImageFit, DynamicOverlayEffect, DynamicTransition, DynamicWallpaperScene, DynamicWallpaperStatus } from '@/api/backend';

const TRANSITIONS: { id: DynamicTransition; label: string; description: string }[] = [
  { id: 'fade', label: '柔和淡入', description: '经典交叉淡化' },
  { id: 'slide-left', label: '横向推入', description: '从右向左推进' },
  { id: 'slide-right', label: '反向推入', description: '从左向右推进' },
  { id: 'slide-up', label: '向上揭幕', description: '从底部推入画面' },
  { id: 'slide-down', label: '向下揭幕', description: '从顶部推入画面' },
  { id: 'zoom', label: '镜头拉近', description: '缩放并淡入' },
  { id: 'zoom-out', label: '镜头拉远', description: '由远及近展开画面' },
  { id: 'blur', label: '清晰聚焦', description: '由模糊变清晰' },
  { id: 'wipe', label: '光幕擦除', description: '横向揭开新画面' },
  { id: 'diagonal-wipe', label: '斜向擦除', description: '沿对角线揭开画面' },
  { id: 'iris', label: '圆形展开', description: '从画面中心向外展开' },
  { id: 'shutter', label: '中央展开', description: '从中央向两侧打开' },
  { id: 'flip', label: '空间翻页', description: '轻微透视翻转' },
  { id: 'rotate', label: '旋转入场', description: '轻微旋转并稳定画面' },
  { id: 'grayscale', label: '黑白显色', description: '从黑白逐渐恢复色彩' },
  { id: 'ken-burns', label: '漫游镜头', description: '缓慢平移与缩放' },
];

const OVERLAY_EFFECTS: { id: DynamicOverlayEffect; label: string; description: string }[] = [
  { id: 'none', label: '无叠加', description: '只显示原始图片' },
  { id: 'snow', label: '飘雪', description: '柔和雪粒缓慢落下' },
  { id: 'petals', label: '飘花', description: '花瓣旋转飘落' },
  { id: 'rain', label: '细雨', description: '细密雨丝快速划过' },
  { id: 'leaves', label: '落叶', description: '秋叶摇曳旋转落下' },
  { id: 'fireflies', label: '萤火', description: '暖色微光随机漂浮' },
  { id: 'bubbles', label: '气泡', description: '透明气泡缓慢上升' },
  { id: 'dust', label: '浮尘', description: '细小光尘安静游动' },
  { id: 'stars', label: '星光', description: '星点闪烁并轻微漂移' },
];

const OVERLAY_ICONS = {
  none: Image,
  snow: Snowflake,
  petals: Flower2,
  rain: CloudRain,
  leaves: Leaf,
  fireflies: SunDim,
  bubbles: Circle,
  dust: Sparkles,
  stars: Sparkle,
} satisfies Record<DynamicOverlayEffect, typeof Image>;

const IMAGE_FITS: { id: DynamicImageFit; label: string; description: string }[] = [
  { id: 'cover', label: '覆盖裁剪', description: '铺满画面，必要时裁剪边缘' },
  { id: 'contain', label: '完整适应', description: '完整显示图片，保留留白' },
  { id: 'fill', label: '拉伸填满', description: '拉伸到整个画面尺寸' },
  { id: 'scale-down', label: '智能缩小', description: '过大时缩小，避免放大原图' },
  { id: 'none', label: '原始尺寸', description: '按图片原始像素居中显示' },
  { id: 'repeat', label: '平铺重复', description: '以原始尺寸重复铺满画面' },
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
  const resolveRequest = useRef(0);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState(0);

  const refreshStatus = async () => {
    if (polling.current) return;
    polling.current = true;
    try { setStatus(await getDynamicWallpaperStatus()); } catch { /* keep the last known status */ } finally { polling.current = false; }
  };

  useEffect(() => {
    let cancelled = false;
    getDynamicWallpaperScene(true).then((next) => !cancelled && setScene(next))
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
    const syncWidgets = async () => {
      try {
        const latest = await getDynamicWallpaperScene();
        setScene((current) => current ? { ...current, widgets: latest.widgets, revision: latest.revision } : latest);
      } catch { /* keep local background edits when synchronization fails */ }
    };
    window.addEventListener('focus', syncWidgets);
    return () => window.removeEventListener('focus', syncWidgets);
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
  const updateBackground = (updates: Partial<DynamicWallpaperScene['background']>, resolvePreview = false) => {
    const next = { ...scene, background: { ...scene.background, ...updates } };
    setScene(next);
    if (!resolvePreview) return;
    if (next.background.type === 'slideshow' && next.background.source === 'favorites' && !next.background.folder_id) return;
    const request = ++resolveRequest.current;
    void resolveDynamicWallpaperScene(next).then((resolved) => {
      if (request !== resolveRequest.current) return;
      if (next.background.type !== 'slideshow') return;
      setScene((current) => current ? {
        ...current,
        background: { ...current.background, items: resolved.background.items },
      } : current);
    }).catch((error: unknown) => {
      if (request === resolveRequest.current) {
        toast.warning('轮播预览加载失败', { description: error instanceof Error ? error.message : String(error) });
      }
    });
  };

  const withLatestWidgets = async () => {
    const latest = await getDynamicWallpaperScene();
    return { ...scene, widgets: latest.widgets, revision: latest.revision };
  };

  const selectSource = async () => {
    setPending('pick');
    try {
      let path: string | null = null;
      if (scene.background.type === 'video') path = await selectDynamicWallpaperMedia();
      else if (scene.background.type === 'image') path = await selectDynamicWallpaperImage();
      else if (scene.background.source === 'folder') path = await selectAutomationDirectory();
      if (path) updateBackground({ path, items: [] }, true);
    } finally { setPending(''); }
  };

  const save = async (): Promise<DynamicWallpaperScene | null> => {
    setPending('save');
    try {
      const saved = await saveDynamicWallpaperScene(await withLatestWidgets());
      setScene(saved);
      toast.success('动态场景已保存');
      return saved;
    } catch (error) {
      toast.danger('保存失败', { description: error instanceof Error ? error.message : String(error) });
      return null;
    } finally { setPending(''); }
  };

  const start = async () => {
    setPending('start');
    try {
      const result = await applyDynamicWallpaperScene(await withLatestWidgets());
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
    if (!await save()) return;
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
          <Card.Content className="min-w-0">
            <Tabs
              className="w-full"
              selectedKey={scene.background.type}
              onSelectionChange={(key) => {
                const type = String(key) as DynamicBackgroundType;
                updateBackground({ type, items: type === 'slideshow' ? [] : scene.background.items }, type === 'slideshow');
              }}
            >
              <Tabs.ListContainer>
                <Tabs.List aria-label="底图类型" className="w-full">
                  <Tabs.Tab id="video"><Video size={17} />视频<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="image"><Image size={17} />图片<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="slideshow"><Images size={17} />轮播<Tabs.Indicator /></Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="video" className="space-y-5 pt-5">
                <div className="space-y-2"><Label>视频文件</Label><div className="flex min-w-0 gap-2"><Input className="min-w-0 flex-1" variant="secondary" value={scene.background.path} readOnly placeholder="尚未选择" /><Button className="shrink-0" variant="secondary" onPress={selectSource} isPending={pending === 'pick'}><FolderOpen size={16} />浏览</Button></div></div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Switch isSelected={scene.background.muted} onChange={(muted) => updateBackground({ muted })}><Switch.Content><span className="text-sm font-medium">静音播放</span></Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                  <Switch isSelected={scene.background.loop} onChange={(loop) => updateBackground({ loop })}><Switch.Content><span className="text-sm font-medium">循环播放</span></Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                </div>
                {!scene.background.muted && (
                  <Slider
                    value={scene.background.volume}
                    minValue={0}
                    maxValue={1}
                    step={0.05}
                    formatOptions={{ style: 'percent' }}
                    onChange={(value) => updateBackground({ volume: Number(value) })}
                  >
                    <Label>播放音量</Label>
                    <Slider.Output />
                    <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
                  </Slider>
                )}
              </Tabs.Panel>
              <Tabs.Panel id="image" className="space-y-5 pt-5">
                <div className="space-y-2"><Label>图片文件</Label><div className="flex min-w-0 gap-2"><Input className="min-w-0 flex-1" variant="secondary" value={scene.background.path} readOnly placeholder="尚未选择" /><Button className="shrink-0" variant="secondary" onPress={selectSource} isPending={pending === 'pick'}><FolderOpen size={16} />浏览</Button></div></div>
                <Select className="min-w-0 w-full" value={scene.background.image_fit} onChange={(key) => updateBackground({ image_fit: String(key) as DynamicImageFit })}>
                  <Label>填充方式</Label>
                  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {IMAGE_FITS.map((fit) => (
                        <ListBox.Item key={fit.id} id={fit.id} textValue={fit.label}>
                          <div className="flex min-w-0 flex-1 flex-col"><Label>{fit.label}</Label><span className="text-xs text-muted">{fit.description}</span></div>
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </Tabs.Panel>
              <Tabs.Panel id="slideshow" className="space-y-5 pt-5">
                <TagGroup
                  aria-label="轮播来源"
                  selectionMode="single"
                  selectedKeys={new Set([scene.background.source])}
                  onSelectionChange={(keys) => {
                    if (keys === 'all') return;
                    const source = Array.from(keys)[0];
                    if (source === 'folder') updateBackground({ source, folder_id: '', items: [] }, true);
                    if (source === 'favorites') updateBackground({ source, path: '', items: [] }, true);
                  }}
                >
                  <Label>轮播来源</Label>
                  <TagGroup.List>
                    <Tag id="folder"><FolderOpen size={15} />文件夹</Tag>
                    <Tag id="favorites"><Images size={15} />收藏夹</Tag>
                  </TagGroup.List>
                </TagGroup>
                {scene.background.source === 'favorites' ? (
                  <Select
                    className="min-w-0 w-full"
                    value={scene.background.folder_id}
                    onChange={(key) => updateBackground({ folder_id: String(key), items: [] }, true)}
                    placeholder={favoriteFolders.length ? '选择收藏夹' : '正在读取收藏夹...'}
                  >
                    <Label>轮播收藏夹</Label>
                    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {favoriteFolders.map((folder) => (
                          <ListBox.Item key={folder.id} id={folder.id} textValue={folder.name}>
                            {folder.name}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                ) : (
                  <div className="space-y-2"><Label>图片文件夹</Label><div className="flex min-w-0 gap-2"><Input className="min-w-0 flex-1" variant="secondary" value={scene.background.path} readOnly placeholder="尚未选择" /><Button className="shrink-0" variant="secondary" onPress={selectSource} isPending={pending === 'pick'}><FolderOpen size={16} />浏览</Button></div></div>
                )}
                <div className="grid min-w-0 grid-cols-1 gap-3 2xl:grid-cols-2">
                  <div className="min-w-0"><Label htmlFor="dynamic-interval">停留时间（秒）</Label><Input id="dynamic-interval" className="mt-2 min-w-0 w-full" variant="secondary" type="number" min="3" value={String(scene.background.interval_seconds)} onChange={(event) => updateBackground({ interval_seconds: Number(event.target.value) || 3 })} /></div>
                  <div className="min-w-0"><Label htmlFor="dynamic-duration">动画时长（毫秒）</Label><Input id="dynamic-duration" className="mt-2 min-w-0 w-full" variant="secondary" type="number" min="100" value={String(scene.background.transition_duration)} onChange={(event) => updateBackground({ transition_duration: Number(event.target.value) || 100 })} /></div>
                </div>
                <Switch isSelected={scene.background.shuffle} onChange={(shuffle) => updateBackground({ shuffle })}><Switch.Content><span className="text-sm font-medium">随机顺序</span><span className="text-xs text-muted">每次随机选择下一张图片</span></Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
              </Tabs.Panel>
            </Tabs>
          </Card.Content>
        </Card>
      </div>

      {scene.background.type === 'image' && (
        <Card className="gap-4 p-5">
          <Card.Header className="flex-row items-center justify-between"><div><Card.Title>图片动画</Card.Title><Card.Description>在静态图片上叠加可暂停的环境动画。</Card.Description></div><Chip variant="soft">实时预览</Chip></Card.Header>
          <Card.Content className="space-y-5">
            <ListBox
              aria-label="选择图片叠加动画"
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
              selectionMode="single"
              selectedKeys={new Set([scene.background.overlay_effect])}
              onSelectionChange={(keys) => {
                if (keys === 'all') return;
                const effect = Array.from(keys)[0] as DynamicOverlayEffect | undefined;
                if (effect) updateBackground({ overlay_effect: effect });
              }}
            >
              {OVERLAY_EFFECTS.map((effect) => {
                const Icon = OVERLAY_ICONS[effect.id];
                return (
                  <ListBox.Item key={effect.id} id={effect.id} textValue={effect.label}>
                    <Icon size={18} />
                    <div className="flex min-w-0 flex-1 flex-col"><Label>{effect.label}</Label><span className="text-xs text-muted">{effect.description}</span></div>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                );
              })}
            </ListBox>
            {scene.background.overlay_effect !== 'none' && (
              <div className="grid gap-5 md:grid-cols-2">
                <Slider value={scene.background.overlay_density} minValue={8} maxValue={120} step={4} onChange={(value) => updateBackground({ overlay_density: Number(value) })}><Label>粒子数量</Label><Slider.Output /><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider>
                <Slider value={scene.background.overlay_speed} minValue={0.25} maxValue={3} step={0.25} onChange={(value) => updateBackground({ overlay_speed: Number(value) })}><Label>飘落速度</Label><Slider.Output /><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider>
                <Slider value={scene.background.overlay_size} minValue={0.5} maxValue={2} step={0.1} onChange={(value) => updateBackground({ overlay_size: Number(value) })}><Label>粒子大小</Label><Slider.Output /><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider>
                <Slider value={scene.background.overlay_opacity} minValue={0.1} maxValue={1} step={0.1} formatOptions={{ style: 'percent' }} onChange={(value) => updateBackground({ overlay_opacity: Number(value) })}><Label>不透明度</Label><Slider.Output /><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track></Slider>
              </div>
            )}
          </Card.Content>
        </Card>
      )}

      {scene.background.type === 'slideshow' && (
        <Card className="gap-4 p-5">
          <Card.Header className="flex-row items-center justify-between"><div><Card.Title>切换动画</Card.Title><Card.Description>轮播专用的场景过渡，与系统普通轮播互不影响。</Card.Description></div><Chip variant="soft">{TRANSITIONS.length} 个预设</Chip></Card.Header>
          <Card.Content>
            <ListBox
              aria-label="选择轮播切换动画"
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
              selectionMode="single"
              selectedKeys={new Set([scene.background.transition])}
              onSelectionChange={(keys) => {
                if (keys === 'all') return;
                const transition = Array.from(keys)[0] as DynamicTransition | undefined;
                if (transition) updateBackground({ transition });
              }}
            >
              {TRANSITIONS.map((preset) => (
                <ListBox.Item key={preset.id} id={preset.id} textValue={preset.label}>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Label>{preset.label}</Label>
                    <span className="text-xs text-muted">{preset.description}</span>
                  </div>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Card.Content>
        </Card>
      )}

      <div className="flex items-center justify-between rounded-xl bg-surface-secondary px-4 py-3">
        <div className="flex items-center gap-3 text-sm text-muted"><MonitorPlay size={17} /><span>{status.windows_version.text || '桌面宿主待探测'}</span>{status.running && status.telemetry.received && status.telemetry.paused && <Chip size="sm" variant="soft"><Pause size={12} />{status.dynamic_type === 'video' ? '视频已暂停' : status.dynamic_type === 'slideshow' ? '轮播已暂停' : '图片动画已暂停'}</Chip>}</div>
        <div className="flex gap-2"><Button isIconOnly variant="ghost" aria-label="刷新状态" onPress={refreshStatus}><RefreshCw size={16} /></Button><Button variant="secondary" onPress={save} isPending={pending === 'save'}>仅保存配置</Button></div>
      </div>
    </div>
  );
}
