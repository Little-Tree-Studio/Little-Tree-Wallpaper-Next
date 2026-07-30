import { useState } from 'react';
import { Button, Card, Separator, Spinner, toast } from '@heroui/react';
import { pluginAssetUrl } from '@/api/backend';
import type { PluginBlock, PluginOperationResult } from '@/types';
import { usePlugins } from './context';

interface PluginRendererProps {
  pluginId: string;
  pluginName: string;
  packageHash?: string | null;
  blocks: PluginBlock[];
  className?: string;
  root?: boolean;
}

export function safePluginClassName(value?: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256) return '';
  const names = value.trim().split(/\s+/);
  if (names.length > 16 || names.some((name) => (
    name.length > 64 || !/^-?[_A-Za-z]+[_A-Za-z0-9-]*$/.test(name)
  ))) return '';
  return names.join(' ');
}

function describeResult(operation: PluginOperationResult): string {
  const result = operation.result;
  if (result === null || result === undefined) return operation.status || '操作完成';
  if (typeof result === 'string') return result.slice(0, 160);
  if (typeof result === 'number' || typeof result === 'boolean') return String(result);
  try {
    const serialized = JSON.stringify(result);
    return serialized.length > 160 ? `${serialized.slice(0, 157)}...` : serialized;
  } catch {
    return '操作完成';
  }
}

function ActionButton({ pluginId, block }: { pluginId: string; block: Extract<PluginBlock, { type: 'button' }> }) {
  const { invoke } = usePlugins();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    try {
      const operation = await invoke(pluginId, block.action, block.payload);
      if (operation.error || operation.status === 'error') {
        throw new Error(operation.error || '插件动作执行失败');
      }
      toast.success(block.label, { description: describeResult(operation), timeout: 3500 });
    } catch (error) {
      toast.danger(`${block.label}失败`, {
        description: error instanceof Error ? error.message : '插件动作执行失败',
        timeout: 0,
      });
    } finally {
      setPending(false);
    }
  };
  return (
    <Button
      className={safePluginClassName(block.className)}
      isPending={pending}
      onPress={run}
    >
      {pending && <Spinner color="current" size="sm" />}
      {block.label}
    </Button>
  );
}

function Block({ block, pluginId, pluginName, packageHash }: {
  block: PluginBlock;
  pluginId: string;
  pluginName: string;
  packageHash?: string | null;
}) {
  const className = safePluginClassName(block.className);
  switch (block.type) {
    case 'heading': {
      const level = block.level ?? 2;
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      return <Tag className={`${level <= 2 ? 'text-2xl font-bold' : 'text-lg font-semibold'} ${className}`}>{block.text}</Tag>;
    }
    case 'text':
      return <p className={`whitespace-pre-wrap text-wrap-pretty text-sm leading-6 ${className}`}>{block.text}</p>;
    case 'image':
      return (
        <img
          className={`h-auto max-h-[70vh] w-full rounded-xl object-contain ${className}`}
          src={pluginAssetUrl(pluginId, block.src, packageHash)}
          alt={block.alt?.trim() || `${pluginName} 提供的图片`}
          loading="lazy"
        />
      );
    case 'card':
      return (
        <Card className={className}>
          {block.title && <Card.Header><Card.Title>{block.title}</Card.Title></Card.Header>}
          <Card.Content className="space-y-4">
            <PluginRenderer pluginId={pluginId} pluginName={pluginName} packageHash={packageHash} blocks={block.blocks} />
          </Card.Content>
        </Card>
      );
    case 'button':
      return <ActionButton pluginId={pluginId} block={block} />;
    case 'divider':
      return <Separator className={className} />;
  }
}

export default function PluginRenderer({
  pluginId,
  pluginName,
  packageHash,
  blocks,
  className,
  root = false,
}: PluginRendererProps) {
  const content = blocks.map((block, index) => (
    <Block key={`${block.type}-${index}`} block={block} pluginId={pluginId} pluginName={pluginName} packageHash={packageHash} />
  ));
  if (!root) return <div className="space-y-4">{content}</div>;
  return (
    <div data-plugin-id={pluginId} className={`space-y-4 ${safePluginClassName(className)}`}>
      {content}
    </div>
  );
}
