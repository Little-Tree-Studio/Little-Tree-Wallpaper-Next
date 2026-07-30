import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  activateThemeProfile,
  getActiveTheme,
  setSetting,
  themeMediaUrl,
} from '@/api/backend';
import { DEFAULT_THEME } from '@/theme/defaults';
import type {
  ResolvedTheme,
  ThemeMode,
  ThemePreviewAssets,
  ThemeProfile,
} from '@/theme/types';

interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  activeTheme: ThemeProfile;
  isPreviewing: boolean;
  setTheme: (theme: ThemeMode) => Promise<void>;
  activateTheme: (themeId: string) => Promise<ThemeProfile>;
  previewTheme: (theme: ThemeProfile, assets?: ThemePreviewAssets) => void;
  clearThemePreview: () => void;
  syncTheme: (theme: ThemeProfile) => void;
}

interface PreviewState {
  theme: ThemeProfile;
  assets: ThemePreviewAssets;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolve(theme: ThemeMode): ResolvedTheme {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function ensureStyle(id: string): HTMLStyleElement {
  let element = document.getElementById(id) as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement('style');
    element.id = id;
    document.head.appendChild(element);
  }
  return element;
}

function assetUrl(theme: ThemeProfile, role: 'background' | 'font', preview?: string): string {
  if (preview) return preview;
  const source = role === 'font' ? theme.typography.source : theme.background.source;
  if (!source || !source.value.trim()) return '';
  if (source.mode === 'installed') return '';
  return source.mode === 'url' ? source.value : themeMediaUrl(theme.id, role);
}

function pageIdFromPath(pathname: string): string {
  const path = pathname.replace(/^\/+|\/+$/g, '');
  if (!path) return 'home';
  if (/^resource\/cnu\/[^/]+/.test(path)) return 'resource-cnu-detail';
  if (/^resource\/pixivel\/[^/]+/.test(path)) return 'resource-pixivel-detail';
  if (path === 'resource/source-management') return 'resource-source-management';
  if (path === 'tools/color-palette') return 'tools-color-palette';
  return path.split('/')[0] || 'home';
}

export function cssForPage(css: string, pageId: string): string {
  const pageBlock = /\/\*\s*@page\s+([^*]+?)\s*\*\/([\s\S]*?)\/\*\s*@endpage\s*\*\//gi;
  const scoped: string[] = [];
  const global = css.replace(pageBlock, (_block, rawPages: string, body: string) => {
    const pages = rawPages
      .split(',')
      .map((page) => page.trim().toLowerCase())
      .filter(Boolean);
    if (pages.includes('*') || pages.includes(pageId)) scoped.push(body.trim());
    return '';
  });
  return [global.trim(), ...scoped].filter(Boolean).join('\n\n');
}

function applyTheme(theme: ThemeProfile, resolved: ResolvedTheme, assets: ThemePreviewAssets, pageId: string) {
  const html = document.documentElement;
  const palette = theme.colors[resolved];
  html.classList.toggle('dark', resolved === 'dark');
  html.setAttribute('data-theme', resolved);
  html.setAttribute('data-theme-profile', theme.id);
  html.setAttribute('data-theme-background', theme.background.type);
  html.setAttribute('data-app-page', pageId);

  const variables: Record<string, string> = {
    '--background': palette.background,
    '--foreground': palette.foreground,
    '--surface': palette.surface,
    '--surface-foreground': palette.foreground,
    '--surface-secondary': palette.surface_secondary,
    '--surface-secondary-foreground': palette.foreground,
    '--surface-tertiary': palette.surface_tertiary,
    '--surface-tertiary-foreground': palette.foreground,
    '--overlay': palette.surface,
    '--overlay-foreground': palette.foreground,
    '--muted': palette.muted,
    '--default': palette.surface_secondary,
    '--default-foreground': palette.foreground,
    '--accent': theme.colors.accent,
    '--accent-foreground': theme.colors.accent_foreground,
    '--field-background': palette.surface,
    '--field-foreground': palette.foreground,
    '--field-placeholder': palette.muted,
    '--border': palette.border,
    '--separator': palette.separator,
    '--focus': theme.colors.accent,
    '--link': theme.colors.accent,
    '--segment': palette.surface,
    '--segment-foreground': palette.foreground,
    '--primary': theme.colors.accent,
    '--primary-foreground': theme.colors.accent_foreground,
    '--popover': palette.surface,
    '--popover-foreground': palette.foreground,
    '--divider': palette.separator,
    '--muted-foreground': palette.muted,
  };
  for (const [name, value] of Object.entries(variables)) html.style.setProperty(name, value);

  const fontSource = assetUrl(theme, 'font', assets.font);
  const fontStyle = ensureStyle('little-tree-theme-font');
  if (theme.typography.source?.mode === 'installed') {
    fontStyle.textContent = '';
    html.style.setProperty(
      '--theme-font-family',
      `${JSON.stringify(theme.typography.source.value)}, ${theme.typography.font_family}`,
    );
  } else if (theme.typography.source && fontSource) {
    fontStyle.textContent = `@font-face { font-family: "LittleTreeThemeFont"; src: url(${JSON.stringify(fontSource)}); font-display: swap; }`;
    html.style.setProperty('--theme-font-family', `"LittleTreeThemeFont", ${theme.typography.font_family}`);
  } else {
    fontStyle.textContent = '';
    html.style.setProperty('--theme-font-family', theme.typography.font_family);
  }
  ensureStyle('little-tree-theme-custom-css').textContent = cssForPage(theme.custom_css, pageId);
}

function ThemeBackground({ theme, resolved, preview }: {
  theme: ThemeProfile;
  resolved: ResolvedTheme;
  preview: ThemePreviewAssets;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const background = theme.background;
  const palette = theme.colors[resolved];
  const source = assetUrl(theme, 'background', preview.background);
  const mediaStyle = {
    objectFit: background.fit,
    objectPosition: background.position,
    opacity: background.media_opacity,
  } as const;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || background.type !== 'video' || !source) return;

    let disposed = false;
    let resumeTimer: number | undefined;

    const resume = () => {
      if (disposed || document.visibilityState === 'hidden') return;
      const volume = Math.max(0, Math.min(1, background.video_volume ?? 0));
      video.volume = volume;
      video.muted = volume === 0;
      if (video.paused) void video.play().catch(() => undefined);
    };
    const scheduleResume = () => {
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(resume, 100);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleResume();
    };

    video.addEventListener('pause', scheduleResume);
    video.addEventListener('canplay', resume);
    window.addEventListener('focus', scheduleResume);
    window.addEventListener('pageshow', scheduleResume);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    resume();

    return () => {
      disposed = true;
      window.clearTimeout(resumeTimer);
      video.removeEventListener('pause', scheduleResume);
      video.removeEventListener('canplay', resume);
      window.removeEventListener('focus', scheduleResume);
      window.removeEventListener('pageshow', scheduleResume);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [background.type, background.video_volume, source]);

  return (
    <div className="theme-background" aria-hidden="true" style={{ backgroundColor: palette.background }}>
      {background.type === 'gradient' && (
        <div className="theme-background__fill" style={{ backgroundImage: background.gradient }} />
      )}
      {background.type === 'image' && source && (
        <img className="theme-background__media" src={source} alt="" style={mediaStyle} />
      )}
      {background.type === 'video' && source && (
        <video
          ref={videoRef}
          key={source}
          className="theme-background__media"
          src={source}
          style={mediaStyle}
          autoPlay
          muted={(background.video_volume ?? 0) === 0}
          loop
          playsInline
          disableRemotePlayback
        />
      )}
      {background.overlay_opacity > 0 && (
        <div
          className="theme-background__overlay"
          style={{ backgroundColor: palette.background, opacity: background.overlay_opacity }}
        />
      )}
    </div>
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [theme, setThemeState] = useState<ThemeMode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolve('system'));
  const [activeTheme, setActiveTheme] = useState<ThemeProfile>(DEFAULT_THEME);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  useEffect(() => {
    let cancelled = false;
    getActiveTheme()
      .then((response) => {
        if (cancelled) return;
        setThemeState(response.mode);
        setResolvedTheme(resolve(response.mode));
        setActiveTheme(response.theme);
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedTheme(resolve('system'));
        setActiveTheme(DEFAULT_THEME);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setResolvedTheme(resolve(theme));
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const effectiveTheme = preview?.theme ?? activeTheme;
  const previewAssets = preview?.assets ?? {};
  const pageId = pageIdFromPath(location.pathname);

  useEffect(() => {
    applyTheme(effectiveTheme, resolvedTheme, previewAssets, pageId);
    window.dispatchEvent(new Event('ltw:host-theme-applied'));
  }, [effectiveTheme, pageId, previewAssets, resolvedTheme]);

  const setTheme = useCallback(async (next: ThemeMode) => {
    const previous = theme;
    setThemeState(next);
    setResolvedTheme(resolve(next));
    try {
      await setSetting('ui.theme', next);
    } catch (error) {
      setThemeState(previous);
      setResolvedTheme(resolve(previous));
      throw error;
    }
  }, [theme]);

  const activateTheme = useCallback(async (themeId: string) => {
    const activated = await activateThemeProfile(themeId);
    setActiveTheme(activated);
    setPreview(null);
    return activated;
  }, []);

  const previewTheme = useCallback((next: ThemeProfile, assets: ThemePreviewAssets = {}) => {
    setPreview({ theme: next, assets });
  }, []);

  const clearThemePreview = useCallback(() => setPreview(null), []);

  const syncTheme = useCallback((next: ThemeProfile) => {
    setActiveTheme((current) => current.id === next.id ? next : current);
  }, []);

  return (
    <ThemeContext.Provider value={{
      theme,
      resolvedTheme,
      activeTheme,
      isPreviewing: preview !== null,
      setTheme,
      activateTheme,
      previewTheme,
      clearThemePreview,
      syncTheme,
    }}>
      <ThemeBackground theme={effectiveTheme} resolved={resolvedTheme} preview={previewAssets} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useThemeContext must be used within ThemeProvider');
  return context;
}
