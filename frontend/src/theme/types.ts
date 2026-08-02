export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type ThemeBackgroundType = 'solid' | 'gradient' | 'image' | 'video';
export type ThemeAssetMode = 'bundled' | 'path' | 'url' | 'installed';

export interface ThemeAssetSource {
  mode: ThemeAssetMode;
  value: string;
}

export interface ThemePalette {
  background: string;
  foreground: string;
  surface: string;
  surface_secondary: string;
  surface_tertiary: string;
  muted: string;
  border: string;
  separator: string;
}

export interface ThemeColors {
  accent: string;
  accent_foreground: string;
  light: ThemePalette;
  dark: ThemePalette;
}

export interface ThemeBackground {
  type: ThemeBackgroundType;
  gradient: string;
  source: ThemeAssetSource | null;
  fit: 'cover' | 'contain' | 'fill' | 'none';
  position: string;
  media_opacity: number;
  overlay_opacity: number;
  video_volume: number;
}

export interface ThemeTypography {
  font_family: string;
  source: ThemeAssetSource | null;
}

export type ThemeWindowIconSlot = 'minimize' | 'maximize' | 'restore' | 'close';

export interface ThemeWindowChrome {
  icons: Record<ThemeWindowIconSlot, ThemeAssetSource | null>;
  close_hover: {
    background: string | null;
    foreground: string | null;
  };
}

export interface ThemeNavigationChrome {
  acrylic: boolean;
  background_opacity: number;
  backdrop_blur: number;
}

export interface ThemeProfile {
  format: 'little-tree-theme';
  format_version: 1;
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  colors: ThemeColors;
  background: ThemeBackground;
  typography: ThemeTypography;
  window_chrome: ThemeWindowChrome;
  navigation_chrome: ThemeNavigationChrome;
  custom_css: string;
  created_at: string;
  updated_at: string;
  is_builtin: boolean;
}

export interface ThemeSummary {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  accent: string;
  background_type: ThemeBackgroundType;
  is_builtin: boolean;
  size_bytes: number;
  updated_at: string;
}

export interface ThemeAssetSelection {
  source: ThemeAssetSource;
  preview_token: string;
  filename: string;
}

export interface ThemePreviewAssets {
  background?: string;
  font?: string;
  window_minimize?: string;
  window_maximize?: string;
  window_restore?: string;
  window_close?: string;
}

export interface ActiveThemeResponse {
  mode: ThemeMode;
  theme: ThemeProfile;
}
