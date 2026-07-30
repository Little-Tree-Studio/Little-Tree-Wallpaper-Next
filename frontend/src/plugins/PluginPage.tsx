import { Card, Spinner } from '@heroui/react';
import { useLocation } from 'react-router-dom';
import PluginRenderer from './PluginRenderer';
import { usePlugins } from './context';

export default function PluginPage() {
  const location = useLocation();
  const { contributions, loading } = usePlugins();
  const page = [...contributions.pages, ...contributions.resource_pages]
    .find((contribution) => contribution.route === location.pathname);

  if (loading) {
    return (
      <Card className="mx-auto flex max-w-2xl items-center justify-center gap-3 py-16">
        <Spinner size="sm" />
        <p className="text-sm text-muted">正在加载插件页面...</p>
      </Card>
    );
  }

  if (!page) {
    return (
      <Card className="mx-auto max-w-2xl">
        <Card.Header>
          <Card.Title>页面不存在</Card.Title>
          <Card.Description>没有核心页面或已启用插件处理此地址。</Card.Description>
        </Card.Header>
      </Card>
    );
  }

  return (
    <section className="mx-auto max-w-5xl space-y-4" aria-labelledby="plugin-page-title">
      <div data-plugin-id={page.pluginId}>
        <h1 id="plugin-page-title" className="text-2xl font-bold">{page.label}</h1>
        <p className="mt-1 text-sm text-muted">由 {page.plugin.name} 提供</p>
      </div>
      <PluginRenderer
        root
        pluginId={page.pluginId}
        pluginName={page.plugin.name}
        packageHash={page.packageHash}
        blocks={page.blocks}
        className={page.className}
      />
    </section>
  );
}
