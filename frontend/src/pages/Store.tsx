import { useState } from 'react';
import { Card, Tabs } from '@heroui/react';
import { Store, Package, Palette, Puzzle } from 'lucide-react';

export default function StorePage() {
  const [activeTab, setActiveTab] = useState('theme');

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">资源商店</h1>
      </div>

      <Tabs selectedKey={activeTab} onSelectionChange={(k) => setActiveTab(String(k))}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="商店分类">
            <Tabs.Tab id="theme"><Palette size={14} /> 主题<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="source"><Package size={14} /> 壁纸源<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="plugin"><Puzzle size={14} /> 插件<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="theme">
          <EmptyState text="暂无主题资源" />
        </Tabs.Panel>
        <Tabs.Panel id="source">
          <EmptyState text="暂无壁纸源资源" />
        </Tabs.Panel>
        <Tabs.Panel id="plugin">
          <EmptyState text="暂无插件资源" />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="flex flex-col items-center justify-center py-20">
      <Store size={48} className="mb-4 text-muted" />
      <p className="text-muted">{text}</p>
    </Card>
  );
}
