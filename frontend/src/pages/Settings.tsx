import { useState, useEffect } from 'react';
import {
  Card, Button, Switch, Input, Tabs, Separator,
} from '@heroui/react';
import { ArrowLeft } from 'lucide-react';
import { getSettings, setSetting } from '@/api/backend';
import type { AppSettings } from '@/types';

export default function Settings() {
  const [settings, setLocalSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState('general');

  useEffect(() => {
    getSettings().then((s) => setLocalSettings(s as AppSettings));
  }, []);

  const update = (key: string, value: any) => {
    if (!settings) return;
    const parts = key.split('.');
    const next = { ...settings };
    let cur: any = next;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = { ...cur[parts[i]] };
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    setLocalSettings(next);
    setSetting(key, value);
  };

  if (!settings) return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">设置</h1>
      <Card className="flex flex-col items-center justify-center py-20">
        <p className="text-muted">无法加载设置（未连接后端）</p>
      </Card>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Button isIconOnly variant="ghost" onPress={() => window.history.back()}><ArrowLeft size={18} /></Button>
        <h1 className="text-2xl font-bold">设置</h1>
      </div>

      <Tabs selectedKey={activeTab} onSelectionChange={(k) => setActiveTab(String(k))}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="设置分类">
            <Tabs.Tab id="general">通用<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="wallpaper">壁纸<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="content">内容<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="download">下载<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="sniff">嗅探<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="appearance">外观<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="about">关于<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="general">
          <Card className="space-y-4 p-4">
            <Section title="主页内容">
              <Row label="语句来源">
                <select
                  className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                  value={settings.home_page.source}
                  onChange={(e) => update('home_page.source', e.target.value)}
                >
                  <option value="hitokoto">一言</option>
                  <option value="zhaoyu">诏预</option>
                  <option value="custom">自定义</option>
                </select>
              </Row>
              <Row label="显示作者"><Switch isSelected={settings.home_page.show_author} onChange={(v) => update('home_page.show_author', v)} /></Row>
              <Row label="显示来源"><Switch isSelected={settings.home_page.show_source} onChange={(v) => update('home_page.show_source', v)} /></Row>
            </Section>
            <Separator />
            <Section title="开机与后台">
              <Row label="开机后自动隐藏到后台"><Switch isSelected={settings.startup.hide_on_launch} onChange={(v) => update('startup.hide_on_launch', v)} /></Row>
              <Row label="开机自启动"><Switch isSelected={settings.startup.auto_start} onChange={(v) => update('startup.auto_start', v)} /></Row>
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="wallpaper">
          <Card className="space-y-4 p-4">
            <Section title="自动更换">
              <Row label="启用"><Switch isSelected={settings.wallpaper.auto_change.enabled} onChange={(v) => update('wallpaper.auto_change.enabled', v)} /></Row>
              <Row label="模式">
                <select
                  className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                  value={settings.wallpaper.auto_change.mode}
                  onChange={(e) => update('wallpaper.auto_change.mode', e.target.value)}
                >
                  <option value="off">关闭</option>
                  <option value="interval">间隔</option>
                  <option value="schedule">定时</option>
                  <option value="slideshow">轮播</option>
                </select>
              </Row>
              {settings.wallpaper.auto_change.mode === 'interval' && (
                <Row label="间隔">
                  <Input
                    type="number"
                    className="w-24"
                    value={String(settings.wallpaper.auto_change.interval.value)}
                    onChange={(e) => update('wallpaper.auto_change.interval.value', Number(e.target.value))}
                  />
                  <select
                    className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                    value={settings.wallpaper.auto_change.interval.unit}
                    onChange={(e) => update('wallpaper.auto_change.interval.unit', e.target.value)}
                  >
                    <option value="seconds">秒</option>
                    <option value="minutes">分</option>
                    <option value="hours">时</option>
                  </select>
                </Row>
              )}
            </Section>
            <Separator />
            <Section title="历史记录">
              <Row label="自动保存历史壁纸副本"><Switch isSelected={settings.wallpaper.history_save_copy} onChange={(v) => update('wallpaper.history_save_copy', v)} /></Row>
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="content">
          <Card className="space-y-4 p-4">
            <Row label="显示 NSFW 内容"><Switch isSelected={settings.wallpaper.allow_NSFW} onChange={(v) => update('wallpaper.allow_NSFW', v)} /></Row>
            <Separator />
            <Section title="商店源">
              <Row label="使用自定义源"><Switch isSelected={settings.store.use_custom_source} onChange={(v) => update('store.use_custom_source', v)} /></Row>
              {settings.store.use_custom_source && (
                <Row label="自定义源 URL">
                  <Input
                    fullWidth
                    value={settings.store.custom_source_url}
                    onChange={(e) => update('store.custom_source_url', e.target.value)}
                  />
                </Row>
              )}
            </Section>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="download">
          <Card className="space-y-4 p-4">
            <Row label="下载位置">
              <select
                className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                value={settings.storage.download_directory ? 'custom' : 'default'}
                onChange={(e) => update('storage.download_directory', e.target.value === 'custom' ? '' : '')}
              >
                <option value="default">系统下载目录</option>
                <option value="custom">自定义</option>
              </select>
            </Row>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="sniff">
          <Card className="space-y-4 p-4">
            <Row label="User-Agent">
              <Input fullWidth value={settings.sniff.user_agent} onChange={(e) => update('sniff.user_agent', e.target.value)} />
            </Row>
            <Row label="默认 Referer">
              <Input fullWidth value={settings.sniff.referer} onChange={(e) => update('sniff.referer', e.target.value)} />
            </Row>
            <Row label="自动使用输入链接作为 Referer"><Switch isSelected={settings.sniff.use_source_as_referer} onChange={(v) => update('sniff.use_source_as_referer', v)} /></Row>
            <Row label="超时时间 (秒)">
              <Input type="number" className="w-24" value={String(settings.sniff.timeout_seconds)} onChange={(e) => update('sniff.timeout_seconds', Number(e.target.value))} />
            </Row>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="appearance">
          <Card className="space-y-4 p-4">
            <Row label="界面主题">
              <select
                className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                value={settings.ui.theme}
                onChange={(e) => update('ui.theme', e.target.value)}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </Row>
          </Card>
        </Tabs.Panel>

        <Tabs.Panel id="about">
          <Card className="space-y-4 p-6 text-center">
            <div className="text-3xl font-bold">小树壁纸 Next</div>
            <div className="text-muted">v2.0.0</div>
            <div className="text-sm text-muted">Copyright 2025 Little Tree Studio</div>
            <Separator />
            <p className="text-sm text-muted">一款桌面壁纸管理应用，支持多种壁纸来源、自动更换、收藏管理等功能。</p>
          </Card>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <div className="min-w-[200px] text-right">{children}</div>
    </div>
  );
}
