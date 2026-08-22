import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Chip,
  Modal,
  ScrollShadow,
  Spinner,
  Tabs,
  toast,
} from '@heroui/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Download,
  ExternalLink,
  Package,
  Palette,
  Puzzle,
  RefreshCw,
  Store as StoreIcon,
  Wallpaper,
} from 'lucide-react';
import {
  getStoreResources,
  installStoreResource,
  openUrl,
  PLUGIN_REGISTRY_CHANGED_EVENT,
} from '@/api/backend';
import type { StoreResource } from '@/types';

type StoreTab = 'theme' | 'wallpaper_source' | 'plugin';

const TAB_META: Array<{ id: StoreTab; label: string; empty: string; icon: typeof Palette }> = [
  { id: 'theme', label: '主题', empty: '暂无主题资源', icon: Palette },
  { id: 'wallpaper_source', label: '壁纸源', empty: '暂无壁纸源资源', icon: Wallpaper },
  { id: 'plugin', label: '插件', empty: '暂无插件资源', icon: Puzzle },
];

export default function StorePage() {
  const [activeTab, setActiveTab] = useState<StoreTab>('theme');
  const [resources, setResources] = useState<Record<StoreTab, StoreResource[]>>({
    theme: [],
    wallpaper_source: [],
    plugin: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StoreResource | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);
    getStoreResources(activeTab)
      .then((items) => {
        if (!disposed) setResources((current) => ({ ...current, [activeTab]: items }));
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : '商店资源加载失败');
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => { disposed = true; };
  }, [activeTab, reloadVersion]);

  const currentResources = resources[activeTab];
  const activeMeta = TAB_META.find((item) => item.id === activeTab) || TAB_META[0];

  const install = async (resource: StoreResource) => {
    setInstalling(resource.id);
    try {
      await installStoreResource(resource);
      if (resource.type === 'plugin') {
        window.dispatchEvent(new Event(PLUGIN_REGISTRY_CHANGED_EVENT));
      }
      toast.success(`已安装「${resource.name}」`, { description: `版本 ${resource.version}` });
      setSelected(null);
    } catch (reason: unknown) {
      toast.danger('安装失败', {
        description: reason instanceof Error ? reason.message : '无法安装该资源',
        timeout: 0,
      });
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <StoreIcon className="size-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">资源商店</h1>
          </div>
          <p className="mt-1 text-sm text-muted">获取主题、壁纸源和插件，扩展小树壁纸的使用方式。</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          isPending={loading}
          onPress={() => setReloadVersion((version) => version + 1)}
        >
          {({ isPending }) => <>{isPending ? <Spinner color="current" size="sm" /> : <RefreshCw size={15} />}刷新</>}
        </Button>
      </header>

      <Tabs selectedKey={activeTab} onSelectionChange={(key) => setActiveTab(String(key) as StoreTab)} className="min-h-0 flex-1">
        <Tabs.ListContainer>
          <Tabs.List aria-label="商店分类">
            {TAB_META.map(({ id, label, icon: Icon }) => (
              <Tabs.Tab key={id} id={id}>
                <Icon size={15} /> {label}<Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id={activeTab} className="min-h-0 flex-1 pt-4">
          {loading && currentResources.length === 0 ? (
            <Card className="flex items-center justify-center gap-3 py-20">
              <Spinner size="sm" />
              <p className="text-sm text-muted">正在加载商店资源...</p>
            </Card>
          ) : error ? (
            <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Package className="size-10 text-danger" />
              <p className="text-sm text-danger">{error}</p>
              <Button size="sm" variant="secondary" onPress={() => setReloadVersion((version) => version + 1)}>重新加载</Button>
            </Card>
          ) : currentResources.length === 0 ? (
            <Card className="flex flex-col items-center justify-center gap-3 py-20">
              <StoreIcon className="size-12 text-muted" />
              <p className="text-sm text-muted">{activeMeta.empty}</p>
            </Card>
          ) : (
            <ScrollShadow className="h-full pr-1">
              <div className="grid gap-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
                {currentResources.map((resource) => (
                  <ResourceCard
                    key={`${resource.type}:${resource.id}`}
                    resource={resource}
                    isInstalling={installing === resource.id}
                    onOpen={() => setSelected(resource)}
                    onInstall={() => void install(resource)}
                  />
                ))}
              </div>
            </ScrollShadow>
          )}
        </Tabs.Panel>
      </Tabs>

      <ResourceDetail
        resource={selected}
        installing={selected ? installing === selected.id : false}
        onClose={() => setSelected(null)}
        onInstall={() => selected && void install(selected)}
      />
    </div>
  );
}

function ResourceCard({
  resource,
  isInstalling,
  onOpen,
  onInstall,
}: {
  resource: StoreResource;
  isInstalling: boolean;
  onOpen: () => void;
  onInstall: () => void;
}) {
  const Icon = resource.type === 'theme' ? Palette : resource.type === 'plugin' ? Puzzle : Wallpaper;
  const canInstall = Boolean(resource.download_url || resource.download_path || resource.assets?.some((asset) => asset.url));
  return (
    <Card className="flex h-full flex-col">
      <Card.Header className="flex-row items-start gap-3">
        <ResourceIcon resource={resource} fallback={<Icon className="size-6" />} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Card.Title className="line-clamp-2 text-base">{resource.name}</Card.Title>
            <Chip size="sm" variant="soft" className="shrink-0">v{resource.version}</Chip>
          </div>
          <Card.Description className="mt-1 line-clamp-2">{resource.summary || '暂无简介'}</Card.Description>
        </div>
      </Card.Header>
      <Card.Content className="flex flex-1 flex-col gap-3">
        <div className="flex min-h-6 flex-wrap gap-1.5">
          {resource.tags.slice(0, 4).map((tag) => <Chip key={tag} size="sm" variant="secondary">{tag}</Chip>)}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted">作者：{resource.author?.name || '未知'}</span>
          <Button size="sm" variant="ghost" onPress={onOpen}>查看详情</Button>
        </div>
      </Card.Content>
      <Card.Footer>
        <Button fullWidth size="sm" isPending={isInstalling} isDisabled={!canInstall} onPress={onInstall}>
          {({ isPending }) => <>{isPending ? <Spinner color="current" size="sm" /> : <Download size={15} />}{isPending ? '安装中...' : canInstall ? '安装' : '暂无下载'}</>}
        </Button>
      </Card.Footer>
    </Card>
  );
}

function ResourceIcon({ resource, fallback }: { resource: StoreResource; fallback: React.ReactNode }) {
  if (!resource.icon_url) {
    return <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{fallback}</div>;
  }
  return (
    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-secondary p-2">
      <img src={resource.icon_url} alt="" className="size-full object-contain" loading="lazy" />
    </div>
  );
}

function ResourceDetail({
  resource,
  installing,
  onClose,
  onInstall,
}: {
  resource: StoreResource | null;
  installing: boolean;
  onClose: () => void;
  onInstall: () => void;
}) {
  const canInstall = Boolean(resource && (resource.download_url || resource.download_path || resource.assets?.some((asset) => asset.url)));
  return (
    <Modal.Backdrop isOpen={resource !== null} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            {resource && <ResourceIcon resource={resource} fallback={<Package className="size-6" />} />}
            <div className="min-w-0">
              <Modal.Heading>{resource?.name || '资源详情'}</Modal.Heading>
              {resource && <p className="mt-1 text-sm text-muted">v{resource.version} · {resource.author?.name || '未知作者'}</p>}
            </div>
          </Modal.Header>
          <Modal.Body>
            {resource && (
              <ScrollShadow className="max-h-[55vh]">
                <div className="space-y-5 pr-2">
                  <div className="flex flex-wrap gap-1.5">
                    {resource.tags.map((tag) => <Chip key={tag} size="sm" variant="soft">{tag}</Chip>)}
                    {resource.license && <Chip size="sm" variant="secondary">{resource.license}</Chip>}
                  </div>
                  {resource.summary && <p className="text-sm leading-6">{resource.summary}</p>}
                  {resource.description_md ? (
                    <div className="prose prose-sm max-w-none text-sm leading-6 text-foreground">
                      <Markdown
                        skipHtml
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => (
                            <a
                              href={href}
                              className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
                              onClick={(event) => { event.preventDefault(); if (href) void openUrl(href); }}
                            >{children}<ExternalLink size={12} /></a>
                          ),
                        }}
                      >{resource.description_md}</Markdown>
                    </div>
                  ) : <p className="text-sm text-muted">暂无详细说明。</p>}
                  <div className="flex flex-wrap gap-3 text-xs">
                    {resource.homepage_url && <Button size="sm" variant="ghost" onPress={() => void openUrl(resource.homepage_url!)}><ExternalLink size={13} />官方网站</Button>}
                    {resource.repository_url && <Button size="sm" variant="ghost" onPress={() => void openUrl(resource.repository_url!)}><ExternalLink size={13} />源码仓库</Button>}
                    {resource.changelog_url && <Button size="sm" variant="ghost" onPress={() => void openUrl(resource.changelog_url!)}><ExternalLink size={13} />更新日志</Button>}
                  </div>
                </div>
              </ScrollShadow>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={onClose}>关闭</Button>
            <Button isPending={installing} isDisabled={!canInstall} onPress={onInstall}>
              {({ isPending }) => <>{isPending ? <Spinner color="current" size="sm" /> : <Download size={15} />}{isPending ? '安装中...' : canInstall ? '安装资源' : '暂无下载'}</>}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
