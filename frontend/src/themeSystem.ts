import { alpha, createTheme, responsiveFontSizes } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';

import type { SupportedLocale } from './i18n';

export const THEME_FILE_FORMAT = 'ltw-theme';
export const THEME_SCHEMA_VERSION = 1;
export const DEFAULT_THEME_ID = 'aurora-paper';
export const THEME_CACHE_KEY = 'ltw-active-theme-cache-v1';

export type ThemeMode = 'light' | 'dark';
export type ThemeBackgroundKind = 'none' | 'image' | 'video';
export type ThemeBackgroundFit = 'cover' | 'contain';

export type ThemeMetadata = {
  id: string;
  name: string;
  icon?: string;
  summary?: string;
  description_md?: string;
  author?: string;
  version?: string;
  supported_app_version?: string;
  author_website?: string;
};

export type ThemePalette = {
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  info: string;
  background_default: string;
  background_paper: string;
  text_primary: string;
  text_secondary: string;
};

export type ThemeSurface = {
  blur: number;
  opacity: number;
  border_opacity: number;
  shadow_opacity: number;
};

export type ThemeTypography = {
  font_family: string;
};

export type ThemeBackground = {
  kind: ThemeBackgroundKind;
  source?: string;
  poster?: string;
  opacity: number;
  blur: number;
  brightness: number;
  fit: ThemeBackgroundFit;
  position: string;
  overlay_tint: string;
  overlay_strength: number;
};

export const THEME_CSS_TARGETS = {
  appShell: '[data-ltw-app-shell="true"]',
  navigationDrawer: '[data-ltw-nav-drawer="true"]',
  topBar: '[data-ltw-top-bar="true"]',
  pageSurface: '[data-ltw-page-surface="true"]',
  themeManager: '[data-ltw-theme-manager="true"]',
  muiPaper: '.MuiPaper-root',
  muiCard: '.MuiCard-root',
  muiButton: '.MuiButton-root',
  muiDialog: '.MuiDialog-paper',
} as const;

export type ThemeCssTarget = keyof typeof THEME_CSS_TARGETS;

export type ThemeCssConfig = {
  global?: string;
  components?: Partial<Record<ThemeCssTarget, string>>;
};

export type ThemeSpec = {
  mode: ThemeMode;
  palette: ThemePalette;
  shape: {
    border_radius: number;
  };
  surface: ThemeSurface;
  typography: ThemeTypography;
  background: ThemeBackground;
  css: ThemeCssConfig;
};

export type ThemeDocument = {
  format: typeof THEME_FILE_FORMAT;
  schema_version: typeof THEME_SCHEMA_VERSION;
  metadata: ThemeMetadata;
  theme: ThemeSpec;
};

export type ThemeCatalogItem = {
  id: string;
  document: ThemeDocument;
  source: 'builtin' | 'custom';
};

type BuiltinDefinition = {
  id: string;
  name: Record<SupportedLocale, string>;
  summary: Record<SupportedLocale, string>;
  description: Record<SupportedLocale, string>;
  author: string;
  version: string;
  supportedAppVersion: string;
  theme: ThemeSpec;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asFiniteNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, min, max);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pickCssTargetMap(value: unknown): Partial<Record<ThemeCssTarget, string>> {
  const raw = asObject(value);
  const result: Partial<Record<ThemeCssTarget, string>> = {};

  (Object.keys(THEME_CSS_TARGETS) as ThemeCssTarget[]).forEach((key) => {
    const nextValue = asString(raw[key]);
    if (nextValue) {
      result[key] = nextValue;
    }
  });

  return result;
}

function toHexColor(value: unknown, fallback: string): string {
  const raw = asString(value, fallback);
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(raw)) {
    return raw;
  }
  return fallback;
}

export function slugifyThemeId(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'custom-theme';
}

export function ensureUniqueThemeId(themeDocument: ThemeDocument, existingIds: Iterable<string>): ThemeDocument {
  const usedIds = new Set(Array.from(existingIds, (item) => item.toLowerCase()));
  const baseId = slugifyThemeId(themeDocument.metadata.id || themeDocument.metadata.name);
  let nextId = baseId;
  let suffix = 2;

  while (usedIds.has(nextId.toLowerCase())) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return {
    ...themeDocument,
    metadata: {
      ...themeDocument.metadata,
      id: nextId,
    },
  };
}

function defaultPalette(mode: ThemeMode): ThemePalette {
  if (mode === 'dark') {
    return {
      primary: '#8ab4ff',
      secondary: '#f3a86b',
      success: '#62c79a',
      warning: '#f7c46d',
      info: '#7cc8ff',
      background_default: '#09111c',
      background_paper: '#132132',
      text_primary: '#f3f7fb',
      text_secondary: '#9fb1c4',
    };
  }

  return {
    primary: '#4d6bfe',
    secondary: '#db8f49',
    success: '#2f8f69',
    warning: '#bf7b1d',
    info: '#2e83c6',
    background_default: '#f5f2eb',
    background_paper: '#fffaf3',
    text_primary: '#1f2a37',
    text_secondary: '#5c6b7a',
  };
}

function defaultThemeSpec(mode: ThemeMode): ThemeSpec {
  return {
    mode,
    palette: defaultPalette(mode),
    shape: {
      border_radius: 22,
    },
    surface: {
      blur: 20,
      opacity: mode === 'dark' ? 0.76 : 0.82,
      border_opacity: mode === 'dark' ? 0.2 : 0.12,
      shadow_opacity: mode === 'dark' ? 0.35 : 0.14,
    },
    typography: {
      font_family: mode === 'dark'
        ? '"Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif'
        : '"Segoe UI Variable", "Segoe UI", "Noto Sans SC", sans-serif',
    },
    background: {
      kind: 'none',
      source: '',
      poster: '',
      opacity: 0.56,
      blur: mode === 'dark' ? 14 : 0,
      brightness: mode === 'dark' ? 0.7 : 1,
      fit: 'cover',
      position: 'center center',
      overlay_tint: mode === 'dark' ? '#050b13' : '#fff9f1',
      overlay_strength: mode === 'dark' ? 0.68 : 0.48,
    },
    css: {
      global: '',
      components: {},
    },
  };
}

const builtinDefinitions: BuiltinDefinition[] = [
  {
    id: 'aurora-paper',
    name: {
      'zh-CN': '极光纸页',
      'en-US': 'Aurora Paper',
    },
    summary: {
      'zh-CN': '暖白纸感与高饱和蓝橙点缀的轻盈主题。',
      'en-US': 'A light editorial theme with warm paper surfaces and vivid blue-orange accents.',
    },
    description: {
      'zh-CN': '## 设计方向\n\n以纸张、柔光和轻微玻璃质感为核心，适合日间使用。\n\n- 亮色背景与偏暖纸白表面\n- 蓝色主色配合琥珀辅助色\n- 轻微模糊与半透明卡片',
      'en-US': '## Direction\n\nA daytime theme built around paper textures, soft light, and subtle glass surfaces.\n\n- Warm off-white surfaces\n- Vivid blue primary with amber support\n- Light translucency and restrained blur',
    },
    author: 'Little Tree Wallpaper Next',
    version: '1.0.0',
    supportedAppVersion: '>=0.1.0',
    theme: {
      ...defaultThemeSpec('light'),
      palette: {
        primary: '#4d6bfe',
        secondary: '#db8f49',
        success: '#2f8f69',
        warning: '#bf7b1d',
        info: '#2e83c6',
        background_default: '#f5f2eb',
        background_paper: '#fffaf3',
        text_primary: '#1f2a37',
        text_secondary: '#5c6b7a',
      },
    },
  },
  {
    id: 'moss-glass',
    name: {
      'zh-CN': '苔雾玻璃',
      'en-US': 'Moss Glass',
    },
    summary: {
      'zh-CN': '偏森林气质的浅色主题，绿色层次更明显。',
      'en-US': 'A light moss-toned theme with cleaner greens and stronger glass depth.',
    },
    description: {
      'zh-CN': '## 设计方向\n\n适合自然感、留白更多的界面。\n\n- 低饱和苔绿主色\n- 透明层次更明显\n- 偏冷白的背景纸面',
      'en-US': '## Direction\n\nDesigned for calmer, nature-leaning interfaces with more negative space.\n\n- Mossy green primary\n- Stronger transparent layers\n- Cooler paper backgrounds',
    },
    author: 'Little Tree Wallpaper Next',
    version: '1.0.0',
    supportedAppVersion: '>=0.1.0',
    theme: {
      ...defaultThemeSpec('light'),
      palette: {
        primary: '#4d8f79',
        secondary: '#c2885c',
        success: '#2b986b',
        warning: '#d18b3c',
        info: '#4b89b8',
        background_default: '#eef3ef',
        background_paper: '#f8fcf8',
        text_primary: '#1d3328',
        text_secondary: '#5d6f67',
      },
      surface: {
        blur: 24,
        opacity: 0.74,
        border_opacity: 0.18,
        shadow_opacity: 0.18,
      },
      background: {
        ...defaultThemeSpec('light').background,
        overlay_tint: '#eff7f1',
        overlay_strength: 0.4,
      },
    },
  },
  {
    id: 'midnight-cinema',
    name: {
      'zh-CN': '午夜放映',
      'en-US': 'Midnight Cinema',
    },
    summary: {
      'zh-CN': '低照度深色主题，适合使用视频或海报背景。',
      'en-US': 'A low-light dark theme tuned for poster and video backdrops.',
    },
    description: {
      'zh-CN': '## 设计方向\n\n强调深色对比与高亮动作色，适合夜间使用。\n\n- 深蓝黑背景\n- 偏银蓝主色\n- 表面更厚重，阴影更强',
      'en-US': '## Direction\n\nA night-first theme with stronger contrast and cinematic depth.\n\n- Deep blue-black background\n- Silver-blue primary color\n- Heavier surfaces and shadows',
    },
    author: 'Little Tree Wallpaper Next',
    version: '1.0.0',
    supportedAppVersion: '>=0.1.0',
    theme: {
      ...defaultThemeSpec('dark'),
      palette: {
        primary: '#9bb7ff',
        secondary: '#f0a866',
        success: '#64c998',
        warning: '#f3c55f',
        info: '#72c8ff',
        background_default: '#09111c',
        background_paper: '#132132',
        text_primary: '#f3f7fb',
        text_secondary: '#9fb1c4',
      },
      shape: {
        border_radius: 24,
      },
      surface: {
        blur: 18,
        opacity: 0.74,
        border_opacity: 0.22,
        shadow_opacity: 0.38,
      },
      background: {
        ...defaultThemeSpec('dark').background,
        overlay_tint: '#050b13',
        overlay_strength: 0.72,
      },
    },
  },
  {
    id: 'ink-rhyme',
    name: {
      'zh-CN': '墨韵',
      'en-US': 'Ink Rhyme',
    },
    summary: {
      'zh-CN': '取意水墨丹青，朱砂鎏金点缀其间的典雅中国风主题。',
      'en-US': 'An elegant Chinese-inspired theme evoking ink wash paintings with cinnabar and gilt accents.',
    },
    description: {
      'zh-CN': '## 设计方向\n\n以水墨画意境为灵感，融合宣纸暖色与朱砂红、鎏金等传统色彩。\n\n- 墨色深底配宣纸灰表面\n- 朱砂红主色、鎏金辅助色\n- 偏高斯模糊营造烟雨氛围\n- 支持自定义背景图片，推荐搭配山水、花鸟等国风背景',
      'en-US': '## Direction\n\nInspired by traditional Chinese ink wash painting, blending warm Xuan paper tones with cinnabar red and imperial gold.\n\n- Deep ink-black base with warm paper surfaces\n- Cinnabar red primary, gilt gold secondary\n- Generous blur for a misty atmospheric feel\n- Supports custom background images — pair with landscape or floral Chinese-style wallpapers',
    },
    author: 'Little Tree Wallpaper Next',
    version: '1.0.0',
    supportedAppVersion: '>=0.1.0',
    theme: {
      mode: 'dark',
      palette: {
        primary: '#D4564A',
        secondary: '#C9A96E',
        success: '#5B9A6F',
        warning: '#D4A03C',
        info: '#6B9ABF',
        background_default: '#0F1318',
        background_paper: '#1C2028',
        text_primary: '#E6DDD0',
        text_secondary: '#8E8378',
      },
      shape: {
        border_radius: 16,
      },
      surface: {
        blur: 26,
        opacity: 0.72,
        border_opacity: 0.14,
        shadow_opacity: 0.42,
      },
      typography: {
        font_family: '"LXGW WenKai", "Noto Serif SC", "Source Han Serif SC", "SimSun", "Microsoft YaHei UI", "PingFang SC", serif',
      },
      background: {
        kind: 'image',
        source: '',
        poster: '',
        opacity: 0.42,
        blur: 6,
        brightness: 0.62,
        fit: 'cover',
        position: 'center center',
        overlay_tint: '#0a0e14',
        overlay_strength: 0.58,
      },
      css: {
        global: '',
        components: {
          appShell: '& {\n  letter-spacing: 0.02em;\n}',
          navigationDrawer: '& {\n  border-right: 1px solid rgba(201, 169, 110, 0.12) !important;\n}',
          topBar: '& {\n  border-bottom: 1px solid rgba(201, 169, 110, 0.1) !important;\n}',
          pageSurface: '& {\n  background-image: linear-gradient(175deg, rgba(28, 32, 40, 0.0) 0%, rgba(15, 19, 24, 0.08) 100%) !important;\n}',
          muiPaper: '& {\n  border-color: rgba(201, 169, 110, 0.1) !important;\n}',
          muiCard: '& {\n  border-color: rgba(201, 169, 110, 0.1) !important;\n  box-shadow: 0 18px 52px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(201, 169, 110, 0.04) !important;\n}',
          muiButton: '&.MuiButton-contained {\n  box-shadow: 0 10px 28px rgba(212, 86, 74, 0.28) !important;\n}',
          muiDialog: '& {\n  border: 1px solid rgba(201, 169, 110, 0.1) !important;\n  box-shadow: 0 28px 72px rgba(0, 0, 0, 0.52) !important;\n}',
        },
      },
    },
  },
];

export function getBuiltinThemeDocuments(locale: SupportedLocale): ThemeDocument[] {
  return builtinDefinitions.map((definition) => ({
    format: THEME_FILE_FORMAT,
    schema_version: THEME_SCHEMA_VERSION,
    metadata: {
      id: definition.id,
      name: definition.name[locale],
      summary: definition.summary[locale],
      description_md: definition.description[locale],
      author: definition.author,
      version: definition.version,
      supported_app_version: definition.supportedAppVersion,
    },
    theme: definition.theme,
  }));
}

export function createDraftTheme(baseTheme?: ThemeDocument, appVersion?: string): ThemeDocument {
  const seedTheme = baseTheme ?? getBuiltinThemeDocuments('zh-CN')[0];
  return {
    ...seedTheme,
    metadata: {
      ...seedTheme.metadata,
      id: `${slugifyThemeId(seedTheme.metadata.id || seedTheme.metadata.name)}-${Date.now()}`,
      name: `${seedTheme.metadata.name} Copy`,
      version: seedTheme.metadata.version || '1.0.0',
      supported_app_version: appVersion || seedTheme.metadata.supported_app_version || '>=0.1.0',
    },
  };
}

export function normalizeThemeDocument(input: unknown, fallbackName = 'Custom Theme'): ThemeDocument {
  const raw = asObject(input);
  const metadata = asObject(raw.metadata);
  const theme = asObject(raw.theme);
  const mode = asString(theme.mode) === 'dark' ? 'dark' : 'light';
  const defaults = defaultThemeSpec(mode);
  const palette = asObject(theme.palette);
  const shape = asObject(theme.shape);
  const surface = asObject(theme.surface);
  const typography = asObject(theme.typography);
  const background = asObject(theme.background);
  const css = asObject(theme.css);
  const resolvedName = asString(metadata.name, fallbackName) || fallbackName;
  const resolvedId = slugifyThemeId(asString(metadata.id, resolvedName));

  return {
    format: THEME_FILE_FORMAT,
    schema_version: THEME_SCHEMA_VERSION,
    metadata: {
      id: resolvedId,
      name: resolvedName,
      icon: asString(metadata.icon),
      summary: asString(metadata.summary),
      description_md: asString(metadata.description_md),
      author: asString(metadata.author),
      version: asString(metadata.version, '1.0.0') || '1.0.0',
      supported_app_version: asString(metadata.supported_app_version),
      author_website: asString(metadata.author_website),
    },
    theme: {
      mode,
      palette: {
        primary: toHexColor(palette.primary, defaults.palette.primary),
        secondary: toHexColor(palette.secondary, defaults.palette.secondary),
        success: toHexColor(palette.success, defaults.palette.success),
        warning: toHexColor(palette.warning, defaults.palette.warning),
        info: toHexColor(palette.info, defaults.palette.info),
        background_default: toHexColor(palette.background_default, defaults.palette.background_default),
        background_paper: toHexColor(palette.background_paper, defaults.palette.background_paper),
        text_primary: toHexColor(palette.text_primary, defaults.palette.text_primary),
        text_secondary: toHexColor(palette.text_secondary, defaults.palette.text_secondary),
      },
      shape: {
        border_radius: asFiniteNumber(shape.border_radius, defaults.shape.border_radius, 0, 40),
      },
      surface: {
        blur: asFiniteNumber(surface.blur, defaults.surface.blur, 0, 48),
        opacity: asFiniteNumber(surface.opacity, defaults.surface.opacity, 0.15, 1),
        border_opacity: asFiniteNumber(surface.border_opacity, defaults.surface.border_opacity, 0, 1),
        shadow_opacity: asFiniteNumber(surface.shadow_opacity, defaults.surface.shadow_opacity, 0, 1),
      },
      typography: {
        font_family: asString(typography.font_family, defaults.typography.font_family) || defaults.typography.font_family,
      },
      background: {
        kind: asString(background.kind) === 'video'
          ? 'video'
          : asString(background.kind) === 'image'
            ? 'image'
            : 'none',
        source: asString(background.source),
        poster: asString(background.poster),
        opacity: asFiniteNumber(background.opacity, defaults.background.opacity, 0, 1),
        blur: asFiniteNumber(background.blur, defaults.background.blur, 0, 40),
        brightness: asFiniteNumber(background.brightness, defaults.background.brightness, 0.2, 1.4),
        fit: asString(background.fit) === 'contain' ? 'contain' : 'cover',
        position: asString(background.position, defaults.background.position) || defaults.background.position,
        overlay_tint: toHexColor(background.overlay_tint, defaults.background.overlay_tint),
        overlay_strength: asFiniteNumber(background.overlay_strength, defaults.background.overlay_strength, 0, 1),
      },
      css: {
        global: asString(css.global),
        components: pickCssTargetMap(css.components),
      },
    },
  };
}

export function extractCustomThemes(value: unknown): ThemeDocument[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => normalizeThemeDocument(item, `Imported Theme ${index + 1}`))
    .filter((item, index, items) => items.findIndex((candidate) => candidate.metadata.id === item.metadata.id) === index);
}

export function buildThemeCatalog(builtinThemes: ThemeDocument[], customThemes: ThemeDocument[]): ThemeCatalogItem[] {
  return [
    ...builtinThemes.map((document) => ({ id: document.metadata.id, document, source: 'builtin' as const })),
    ...customThemes.map((document) => ({ id: document.metadata.id, document, source: 'custom' as const })),
  ];
}

export function resolveThemeDocument(themeId: string | undefined, builtinThemes: ThemeDocument[], customThemes: ThemeDocument[]): ThemeDocument {
  const allThemes = [...customThemes, ...builtinThemes];
  const matched = allThemes.find((item) => item.metadata.id === themeId);
  if (matched) {
    return matched;
  }
  return builtinThemes.find((item) => item.metadata.id === DEFAULT_THEME_ID) ?? builtinThemes[0] ?? normalizeThemeDocument({}, 'Default Theme');
}

export function getThemeRiskFlags(themeDocument: ThemeDocument): { hasCustomCss: boolean; hasRemoteAsset: boolean } {
  const css = themeDocument.theme.css;
  const hasCustomCss = Boolean(css.global?.trim()) || Object.values(css.components ?? {}).some((value) => Boolean(value?.trim()));
  const assetCandidates = [themeDocument.metadata.icon, themeDocument.theme.background.source, themeDocument.theme.background.poster]
    .map((item) => asString(item))
    .filter(Boolean);
  const hasRemoteAsset = assetCandidates.some((item) => /^https?:/i.test(item));
  return { hasCustomCss, hasRemoteAsset };
}

export function buildThemeExportName(themeDocument: ThemeDocument): string {
  return `${slugifyThemeId(themeDocument.metadata.name || themeDocument.metadata.id || 'theme')}.ltwtheme`;
}

function stripStyleTags(value: string): string {
  return value.replace(/<\/?style[^>]*>/gi, '').trim();
}

function compileScopedCss(selector: string, cssFragment: string): string {
  const normalized = stripStyleTags(cssFragment);
  if (!normalized) {
    return '';
  }
  if (normalized.includes('&')) {
    return normalized.split('&').join(selector);
  }
  if (/[{}]/.test(normalized)) {
    return normalized;
  }
  return `${selector} {\n${normalized}\n}`;
}

export function compileThemeStyleSheets(themeDocument: ThemeDocument): { globalCss: string; componentCss: string } {
  const globalCss = stripStyleTags(themeDocument.theme.css.global || '');
  const componentCss = (Object.keys(THEME_CSS_TARGETS) as ThemeCssTarget[])
    .map((target) => {
      const fragment = themeDocument.theme.css.components?.[target];
      if (!fragment) {
        return '';
      }
      return compileScopedCss(THEME_CSS_TARGETS[target], fragment);
    })
    .filter(Boolean)
    .join('\n\n');

  return {
    globalCss,
    componentCss,
  };
}

export function resolveThemeAssetSource(value?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  if (/^(https?:|data:|blob:|file:)/i.test(raw)) {
    return raw;
  }
  if (/^[a-zA-Z]:[\\/]/.test(raw)) {
    return encodeURI(`file:///${raw.replace(/\\/g, '/')}`);
  }
  if (raw.startsWith('\\\\')) {
    return encodeURI(`file:${raw.replace(/\\/g, '/')}`);
  }
  return raw;
}

export function isLocalThemeAssetReference(value?: string | null): boolean {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return false;
  }
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    return true;
  }
  return /^file:/i.test(raw);
}

export function loadCachedThemeDocument(): ThemeDocument | null {
  try {
    const raw = window.localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeThemeDocument(JSON.parse(raw), 'Cached Theme');
  } catch {
    return null;
  }
}

export function cacheThemeDocument(themeDocument: ThemeDocument): void {
  try {
    window.localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(themeDocument));
  } catch {
    // Ignore local cache errors in desktop webview mode.
  }
}

export function buildMuiTheme(themeDocument: ThemeDocument): Theme {
  const { palette, shape, surface, typography } = themeDocument.theme;
  const surfaceBorder = alpha(palette.text_primary, surface.border_opacity);
  const appBarBackground = alpha(palette.background_paper, surface.opacity);
  const elevatedSurface = alpha(palette.background_paper, Math.min(0.96, surface.opacity + 0.08));
  const shadowColor = alpha(themeDocument.theme.mode === 'dark' ? '#000000' : palette.primary, surface.shadow_opacity);

  let theme = createTheme({
    cssVariables: true,
    palette: {
      mode: themeDocument.theme.mode,
      primary: { main: palette.primary },
      secondary: { main: palette.secondary },
      success: { main: palette.success },
      warning: { main: palette.warning },
      info: { main: palette.info },
      background: {
        default: palette.background_default,
        paper: palette.background_paper,
      },
      text: {
        primary: palette.text_primary,
        secondary: palette.text_secondary,
      },
      divider: surfaceBorder,
    },
    shape: {
      borderRadius: shape.border_radius,
    },
    typography: {
      fontFamily: typography.font_family,
      h3: { fontWeight: 700, lineHeight: 1.08, letterSpacing: '-0.02em' },
      h4: { fontWeight: 700, lineHeight: 1.12, letterSpacing: '-0.02em' },
      h5: { fontWeight: 700, lineHeight: 1.18 },
      h6: { fontWeight: 700, lineHeight: 1.24 },
      subtitle1: { fontWeight: 600 },
      button: {
        fontWeight: 700,
        textTransform: 'none',
        letterSpacing: '0.01em',
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            height: '100%',
            scrollbarGutter: 'stable',
          },
          body: {
            minHeight: '100vh',
            backgroundColor: 'transparent',
            color: palette.text_primary,
            overflowY: 'scroll',
            scrollbarGutter: 'stable',
          },
          '#root': {
            minHeight: '100vh',
            backgroundColor: 'transparent',
            position: 'relative',
            isolation: 'isolate',
          },
          '::selection': {
            backgroundColor: alpha(palette.primary, 0.24),
          },
        },
      },
      MuiAppBar: {
        defaultProps: {
          color: 'default',
          elevation: 0,
        },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: appBarBackground,
            backdropFilter: `blur(${surface.blur}px) saturate(1.15)`,
            borderBottom: `1px solid ${surfaceBorder}`,
          },
        },
      },
      MuiCard: {
        defaultProps: {
          elevation: 0,
          variant: 'outlined',
        },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: elevatedSurface,
            borderColor: surfaceBorder,
            backdropFilter: `blur(${surface.blur}px) saturate(1.08)`,
            boxShadow: `0 22px 60px ${shadowColor}`,
          },
        },
      },
      MuiPaper: {
        defaultProps: {
          elevation: 0,
        },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: elevatedSurface,
            borderColor: surfaceBorder,
            backdropFilter: `blur(${surface.blur}px) saturate(1.08)`,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundImage: 'none',
            backgroundColor: alpha(palette.background_paper, Math.min(0.98, surface.opacity + 0.12)),
            backdropFilter: `blur(${surface.blur + 4}px) saturate(1.15)`,
          },
        },
      },
      MuiMenu: {
        defaultProps: {
          disableScrollLock: true,
        },
      },
      MuiPopover: {
        defaultProps: {
          disableScrollLock: true,
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundImage: 'none',
            backgroundColor: alpha(palette.background_paper, Math.min(0.98, surface.opacity + 0.14)),
            backdropFilter: `blur(${surface.blur + 4}px) saturate(1.1)`,
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            borderRadius: Math.max(10, shape.border_radius - 6),
          },
          contained: {
            boxShadow: `0 12px 30px ${alpha(palette.primary, 0.26)}`,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            backdropFilter: `blur(${Math.max(8, surface.blur / 2)}px)`,
          },
        },
      },
    },
  });

  theme = responsiveFontSizes(theme);
  return theme;
}
