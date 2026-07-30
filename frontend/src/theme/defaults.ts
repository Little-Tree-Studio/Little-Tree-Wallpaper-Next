import type { ThemeProfile } from './types';

export const DEFAULT_THEME: ThemeProfile = {
  format: 'little-tree-theme',
  format_version: 1,
  id: 'default',
  name: '小树默认',
  description: '小树壁纸的标准界面主题。',
  author: 'Little Tree Studio',
  version: '1.0.0',
  colors: {
    accent: '#0485F7',
    accent_foreground: '#FCFCFC',
    light: {
      background: '#F7F7F7',
      foreground: '#18181B',
      surface: '#FFFFFF',
      surface_secondary: '#F2F2F3',
      surface_tertiary: '#EEEEEF',
      muted: '#71717A',
      border: '#DEDEE0',
      separator: '#E6E6E8',
    },
    dark: {
      background: '#0D0D0F',
      foreground: '#FAFAFA',
      surface: '#18181B',
      surface_secondary: '#252527',
      surface_tertiary: '#29292B',
      muted: '#A1A1AA',
      border: '#2D2D30',
      separator: '#252527',
    },
  },
  background: {
    type: 'solid',
    gradient: 'linear-gradient(135deg, #F7F7F7 0%, #EDEDEF 100%)',
    source: null,
    fit: 'cover',
    position: 'center center',
    media_opacity: 1,
    overlay_opacity: 0,
    video_volume: 0,
  },
  typography: {
    font_family: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    source: null,
  },
  custom_css: '',
  created_at: '',
  updated_at: '',
  is_builtin: true,
};

export function createThemeDraft(source: ThemeProfile = DEFAULT_THEME): ThemeProfile {
  const copy = structuredClone(source);
  copy.id = `theme-${Date.now().toString(36)}`;
  copy.name = source.id === 'default' ? '我的主题' : `${source.name} 副本`;
  copy.description = '';
  copy.created_at = '';
  copy.updated_at = '';
  copy.is_builtin = false;
  return copy;
}
