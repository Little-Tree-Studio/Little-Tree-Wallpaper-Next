import { createContext, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  invokePluginAction,
  listPlugins,
  PLUGIN_REGISTRY_CHANGED_EVENT,
} from '@/api/backend';
import { logError } from '@/lib/log';
import type {
  BoundPluginContribution,
  BoundPluginContributions,
  Plugin,
  PluginContributionMap,
  PluginOperationResult,
} from '@/types';

interface PluginContextValue {
  plugins: Plugin[];
  contributions: BoundPluginContributions;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  invoke: (pluginId: string, action: string, payload?: unknown) => Promise<PluginOperationResult>;
}

const emptyContributions = (): BoundPluginContributions => ({
  pages: [],
  navigation: [],
  resource_pages: [],
  buttons: [],
  overlays: [],
  styles: [],
  theme: [],
  widgets: [],
});

const PluginContext = createContext<PluginContextValue | null>(null);
const contributionKinds = [
  'pages',
  'navigation',
  'resource_pages',
  'buttons',
  'overlays',
  'styles',
  'theme',
  'widgets',
] as const satisfies readonly (keyof PluginContributionMap)[];

function aggregatePlugins(plugins: Plugin[]): BoundPluginContributions {
  const aggregate = emptyContributions();
  for (const plugin of plugins) {
    if (!plugin.enabled || plugin.status !== 'started' || plugin.error || !plugin.manifest) continue;
    const metadata = {
      id: plugin.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      author: plugin.manifest.author,
    };
    for (const kind of contributionKinds) {
      const values = plugin.contributions[kind] ?? [];
      for (const value of values) {
        (aggregate[kind] as BoundPluginContribution<typeof value>[]).push({
          ...value,
          pluginId: plugin.id,
          packageHash: plugin.package_hash,
          plugin: metadata,
        });
      }
    }
  }
  return aggregate;
}

function safeThemeValue(value: string | number): string | null {
  const scalar = String(value).trim();
  if (
    !scalar
    || scalar.length > 512
    || /[;{}<>\\@\u0000-\u001f]|\/\*|\*\/|!important|(?:url|expression)\s*\(|javascript:/i.test(scalar)
  ) return null;
  return scalar;
}

function scopedCss(pluginId: string, css: string): string | null {
  if (css.includes('@')) return null;
  const candidate = `@scope ([data-plugin-id="${pluginId}"]) {\n${css}\n}`;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(candidate);
    if (sheet.cssRules.length !== 1 || !sheet.cssRules[0].cssText.trimStart().startsWith('@scope')) return null;
    return candidate;
  } catch {
    return null;
  }
}

function installContributionStyles(contributions: BoundPluginContributions): () => void {
  const style = document.createElement('style');
  style.id = 'little-tree-plugin-styles';
  const rules: string[] = [];
  for (const contribution of contributions.styles) {
    if (contribution.scope === 'global') {
      rules.push(contribution.css);
      continue;
    }
    const scoped = scopedCss(contribution.pluginId, contribution.css);
    if (scoped) rules.push(scoped);
  }
  const themeVariables: string[] = [];
  for (const contribution of contributions.theme) {
    for (const [name, rawValue] of Object.entries(contribution.variables)) {
      if (!/^--[A-Za-z0-9_-]+$/.test(name)) continue;
      const value = safeThemeValue(rawValue);
      if (value !== null) themeVariables.push(`${name}: ${value} !important;`);
    }
  }
  if (themeVariables.length) rules.push(`:root {\n${themeVariables.join('\n')}\n}`);
  style.textContent = rules.join('\n\n');
  document.getElementById(style.id)?.remove();
  document.head.appendChild(style);
  return () => style.remove();
}

export function PluginProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const contributions = aggregatePlugins(plugins);

  const refresh = () => setRefreshVersion((version) => version + 1);
  const invoke = (pluginId: string, action: string, payload?: unknown) => (
    invokePluginAction(pluginId, action, payload)
  );

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
        if (controller.signal.aborted) return;
        logError('Plugin registry load failed', reason);
        setError(reason instanceof Error ? reason.message : '插件注册表加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    const handleRegistryChange = () => refresh();
    window.addEventListener(PLUGIN_REGISTRY_CHANGED_EVENT, handleRegistryChange);
    return () => window.removeEventListener(PLUGIN_REGISTRY_CHANGED_EVENT, handleRegistryChange);
  }, []);

  useEffect(() => {
    let cleanUp: () => void = () => undefined;
    let disposed = false;
    const apply = () => {
      if (disposed) return;
      cleanUp();
      cleanUp = installContributionStyles(contributions);
    };
    queueMicrotask(apply);
    window.addEventListener('ltw:host-theme-applied', apply);
    return () => {
      disposed = true;
      window.removeEventListener('ltw:host-theme-applied', apply);
      cleanUp();
    };
  }, [plugins, location.pathname]);

  return (
    <PluginContext.Provider value={{ plugins, contributions, loading, error, refresh, invoke }}>
      {children}
    </PluginContext.Provider>
  );
}

export function usePlugins(): PluginContextValue {
  const context = useContext(PluginContext);
  if (!context) throw new Error('usePlugins must be used within PluginProvider');
  return context;
}
