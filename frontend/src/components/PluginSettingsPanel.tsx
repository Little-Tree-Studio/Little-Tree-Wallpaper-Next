import { useEffect, useState } from 'react';
import {
  AlertDialog,
  Button,
  Card,
  Chip,
  Spinner,
  Switch,
  toast,
} from '@heroui/react';
import { PackagePlus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import {
  installPluginPackage,
  listPlugins,
  PLUGIN_REGISTRY_CHANGED_EVENT,
  reloadPlugin,
  removePlugin,
  setPluginEnabled,
} from '@/api/backend';
import type { Plugin, PluginOperationResult, PluginPermission } from '@/types';

const permissionLabels: Record<PluginPermission, string> = {
  'ui.buttons': '添加界面按钮',
  'ui.global_style': '修改全局样式',
  'ui.navigation': '添加侧栏导航',
  'ui.overlay': '显示全局悬浮层',
  'ui.pages': '添加插件页面',
  'ui.resource_pages': '添加资源页签',
  'ui.theme': '覆盖界面主题变量',
};

const elevatedPermissions = new Set<PluginPermission>([
  'ui.global_style',
  'ui.overlay',
  'ui.theme',
]);

function resultError(result: Plugin | PluginOperationResult): string | null {
  return result.error || (result.status === 'error' ? '插件操作失败' : null);
}

function statusLabel(plugin: Plugin): string {
  if (plugin.error || plugin.status === 'error') return '错误';
  if (plugin.status === 'started') return '运行中';
  if (plugin.state === 'disabled' || plugin.status === 'disabled') return '已停用';
  return '已安装';
}

function statusColor(plugin: Plugin): 'success' | 'danger' | 'default' | 'warning' {
  if (plugin.error || plugin.status === 'error') return 'danger';
  if (plugin.status === 'started') return 'success';
  if (plugin.state === 'disabled' || plugin.status === 'disabled') return 'default';
  return 'warning';
}

export default function PluginSettingsPanel() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [enableTarget, setEnableTarget] = useState<Plugin | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Plugin | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  const refresh = () => setLoadVersion((version) => version + 1);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listPlugins(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.error) throw new Error(result.error);
        setPlugins(result.plugins ?? []);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : '插件列表加载失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadVersion]);

  useEffect(() => {
    const handleRegistryChange = () => refresh();
    window.addEventListener(PLUGIN_REGISTRY_CHANGED_EVENT, handleRegistryChange);
    return () => window.removeEventListener(PLUGIN_REGISTRY_CHANGED_EVENT, handleRegistryChange);
  }, []);

  const install = async () => {
    setInstallDialogOpen(false);
    setPending('install');
    try {
      const result = await installPluginPackage(undefined, false);
      if (result.state === 'cancelled' || result.status === 'cancelled') return;
      const failure = resultError(result);
      if (failure) throw new Error(failure);
      toast.success('插件已安装', {
        description: result.manifest ? `${result.manifest.name} ${result.manifest.version}` : undefined,
        timeout: 3500,
      });
      refresh();
    } catch (reason) {
      toast.danger('插件安装失败', {
        description: reason instanceof Error ? reason.message : '无法安装插件包',
        timeout: 0,
      });
    } finally {
      setPending(null);
    }
  };

  const toggle = async (plugin: Plugin, enabled: boolean) => {
    setPending(plugin.id);
    try {
      const result = await setPluginEnabled(plugin.id, enabled);
      const failure = resultError(result);
      if (failure) throw new Error(failure);
      toast.success(enabled ? '插件已启用' : '插件已停用', {
        description: plugin.manifest?.name || plugin.id,
        timeout: 3000,
      });
      refresh();
    } catch (reason) {
      toast.danger(enabled ? '启用失败' : '停用失败', {
        description: reason instanceof Error ? reason.message : '插件状态更新失败',
        timeout: 0,
      });
    } finally {
      setPending(null);
    }
  };

  const requestToggle = (plugin: Plugin, enabled: boolean) => {
    if (enabled) {
      setEnableTarget(plugin);
      return;
    }
    void toggle(plugin, false);
  };

  const reload = async (plugin: Plugin) => {
    setPending(plugin.id);
    try {
      const result = await reloadPlugin(plugin.id);
      const failure = resultError(result);
      if (failure) throw new Error(failure);
      toast.success('插件已重新加载', { description: plugin.manifest?.name || plugin.id, timeout: 3000 });
      refresh();
    } catch (reason) {
      toast.danger('重新加载失败', {
        description: reason instanceof Error ? reason.message : '插件重新加载失败',
        timeout: 0,
      });
    } finally {
      setPending(null);
    }
  };

  const confirmRemove = async () => {
    const plugin = removeTarget;
    if (!plugin) return;
    setRemoveTarget(null);
    setPending(plugin.id);
    try {
      const result = await removePlugin(plugin.id);
      const failure = resultError(result);
      if (failure) throw new Error(failure);
      toast.success('插件已移除', { description: plugin.manifest?.name || plugin.id, timeout: 3000 });
      refresh();
    } catch (reason) {
      toast.danger('移除失败', {
        description: reason instanceof Error ? reason.message : '请先停用插件后再移除',
        timeout: 0,
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <Card.Header className="flex-row items-start justify-between gap-4">
          <div>
            <Card.Title>插件管理</Card.Title>
            <Card.Description>安装和管理受信任的声明式插件。插件代码在本机运行，请仅安装可信来源的软件包。</Card.Description>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              isIconOnly
              aria-label="刷新插件列表"
              isDisabled={loading || pending !== null}
              onPress={refresh}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </Button>
            <Button size="sm" isPending={pending === 'install'} onPress={() => setInstallDialogOpen(true)}>
              {pending === 'install' ? <Spinner color="current" size="sm" /> : <PackagePlus size={16} />}
              安装插件
            </Button>
          </div>
        </Card.Header>
      </Card>

      {loading && plugins.length === 0 && (
        <Card className="flex items-center justify-center gap-3 py-16">
          <Spinner size="sm" />
          <p className="text-sm text-muted">正在加载插件...</p>
        </Card>
      )}

      {error && (
        <Card className="items-start">
          <Card.Header>
            <Card.Title className="text-danger">插件列表加载失败</Card.Title>
            <Card.Description>{error}</Card.Description>
          </Card.Header>
          <Card.Footer><Button size="sm" variant="secondary" onPress={refresh}>重试</Button></Card.Footer>
        </Card>
      )}

      {!loading && !error && plugins.length === 0 && (
        <Card className="py-10 text-center">
          <Card.Header>
            <Card.Title>尚未安装插件</Card.Title>
            <Card.Description>安装 `.ltp` 软件包后，可在这里启用并查看其权限。</Card.Description>
          </Card.Header>
        </Card>
      )}

      {plugins.map((plugin) => {
        const manifest = plugin.manifest;
        const isPending = pending === plugin.id;
        const enabled = plugin.enabled;
        return (
          <Card key={plugin.id}>
            <Card.Header className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Card.Title>{manifest?.name || plugin.id}</Card.Title>
                  <Chip size="sm" color={statusColor(plugin)} variant="soft">
                    <Chip.Label>{statusLabel(plugin)}</Chip.Label>
                  </Chip>
                  {manifest?.version && (
                    <Chip size="sm" variant="secondary"><Chip.Label>v{manifest.version}</Chip.Label></Chip>
                  )}
                </div>
                <Card.Description className="mt-1 text-wrap-pretty">
                  {manifest?.description || '插件清单不可用'}
                </Card.Description>
              </div>
              <Switch
                aria-label={`${enabled ? '停用' : '启用'} ${manifest?.name || plugin.id}`}
                isSelected={enabled}
                isDisabled={pending !== null}
                onChange={(selected) => requestToggle(plugin, selected)}
              >
                <Switch.Content>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                  {enabled ? '已启用' : '已停用'}
                </Switch.Content>
              </Switch>
            </Card.Header>
            <Card.Content className="space-y-4">
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-muted">作者</dt><dd>{manifest?.author || '未知'}</dd></div>
                <div><dt className="text-muted">插件 ID</dt><dd className="break-all font-mono text-xs">{plugin.id}</dd></div>
                <div><dt className="text-muted">来源</dt><dd className="break-all">{plugin.source || '已安装'}</dd></div>
                <div><dt className="text-muted">包哈希</dt><dd className="font-mono text-xs">{plugin.package_hash ? `${plugin.package_hash.slice(0, 12)}...` : '不可用'}</dd></div>
              </dl>

              <div>
                <h4 className="mb-2 text-sm font-medium">权限</h4>
                {manifest?.permissions.length ? (
                  <div className="flex flex-wrap gap-2">
                    {manifest.permissions.map((permission) => (
                      <Chip
                        key={permission}
                        size="sm"
                        color={elevatedPermissions.has(permission) ? 'warning' : 'default'}
                        variant={elevatedPermissions.has(permission) ? 'soft' : 'secondary'}
                      >
                        <Chip.Label>{permissionLabels[permission] ?? permission}</Chip.Label>
                      </Chip>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted">无界面权限</p>}
                {manifest?.permissions.some((permission) => elevatedPermissions.has(permission)) && (
                  <p className="mt-2 flex items-start gap-2 text-xs text-warning">
                    <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                    此插件可影响全局样式、主题或悬浮界面，请确认来源可信。
                  </p>
                )}
              </div>

              {plugin.error && (
                <div className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">
                  {plugin.error}
                </div>
              )}
            </Card.Content>
            <Card.Footer className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                isPending={isPending}
                isDisabled={pending !== null}
                onPress={() => void reload(plugin)}
              >
                <RefreshCw size={15} />重新加载
              </Button>
              <Button
                size="sm"
                variant="danger"
                isDisabled={enabled || pending !== null}
                onPress={() => setRemoveTarget(plugin)}
              >
                <Trash2 size={15} />移除
              </Button>
              {enabled && <span className="w-full text-right text-xs text-muted">请先停用插件，再将其移除。</span>}
            </Card.Footer>
          </Card>
        );
      })}

      <AlertDialog.Backdrop isOpen={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning"><ShieldAlert size={20} /></AlertDialog.Icon>
              <AlertDialog.Heading>安装受信任的插件？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">
                插件包含会在本机运行的 Python 代码。声明式界面会限制前端能力，但无法替代对插件来源和代码的信任审查。确认后将打开文件选择器。
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="ghost" onPress={() => setInstallDialogOpen(false)}>取消</Button>
              <Button variant="danger" onPress={() => void install()}>我信任此插件，选择文件</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      <AlertDialog.Backdrop isOpen={enableTarget !== null} onOpenChange={(open) => !open && setEnableTarget(null)}>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning"><ShieldAlert size={20} /></AlertDialog.Icon>
              <AlertDialog.Heading>运行此插件？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <div className="space-y-3 text-sm text-muted">
                <p>
                  “{enableTarget?.manifest?.name || enableTarget?.id}”的 Python 代码将以应用当前权限在本机运行。
                  界面权限清单不是 Python 沙箱，请仅启用已审查且来源可信的插件。
                </p>
                {enableTarget?.package_hash && (
                  <p className="break-all font-mono text-xs">SHA-256: {enableTarget.package_hash}</p>
                )}
              </div>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="ghost" onPress={() => setEnableTarget(null)}>取消</Button>
              <Button variant="danger" onPress={() => {
                const plugin = enableTarget;
                setEnableTarget(null);
                if (plugin) void toggle(plugin, true);
              }}>我信任并运行此插件</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      <AlertDialog.Backdrop isOpen={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger"><Trash2 size={20} /></AlertDialog.Icon>
              <AlertDialog.Heading>移除插件？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">
                将移除“{removeTarget?.manifest?.name || removeTarget?.id}”及其插件数据、设置和缓存。此操作不可撤销，且插件必须处于停用状态。
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="ghost" onPress={() => setRemoveTarget(null)}>取消</Button>
              <Button variant="danger" onPress={() => void confirmRemove()}>确认移除</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}
