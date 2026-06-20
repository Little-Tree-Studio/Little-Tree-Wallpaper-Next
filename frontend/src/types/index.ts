export interface WallpaperInfo {
  path: string;
  filename: string;
}

export interface BingWallpaper {
  url: string;
  title: string;
  copyright: string;
  startdate: string;
}

export interface SpotlightImage {
  url: string;
  title: string;
  copyright: string;
}

export interface Hitokoto {
  hitokoto: string;
  from: string;
  from_who: string | null;
}

export interface CustomSentence {
  content: string;
  from: string;
  from_who: string | null;
}

export type HomePageSource = 'hitokoto' | 'zhaoyu' | 'custom';

export interface HomePageSettings {
  source: HomePageSource;
  show_author: boolean;
  show_source: boolean;
  hitokoto: { region: 'domestic' | 'international'; categories: string[] };
  zhaoyu?: { catalog: string; theme: string; author: string };
  custom: { items: CustomSentence[] };
}

export interface FavoriteItem {
  id: string;
  folder_id: string;
  title: string;
  description: string;
  tags: string[];
  preview_url: string;
  local_path: string | null;
  source_type: string;
  source_url: string;
  created_at: string;
}

export interface FavoriteFolder {
  id: string;
  name: string;
  description: string;
  order: number;
}

export interface FavoritesData {
  folders: FavoriteFolder[];
  items: FavoriteItem[];
  all_tags: string[];
}

export interface SniffedImage {
  id: string;
  url: string;
  filename: string;
  content_type: string;
}

export interface StoreResource {
  id: string;
  type: 'plugin' | 'theme' | 'wallpaper_source';
  name: string;
  version: string;
  summary: string;
  description_md: string;
  author: string;
  tags: string[];
  download_url: string;
  homepage_url: string;
  license: string;
}

export interface AppSettings {
  ui: {
    language: string;
    theme: 'system' | 'light' | 'dark';
    theme_profile: string;
    hide_on_close: boolean;
  };
  wallpaper: {
    auto_change: {
      enabled: boolean;
      mode: 'off' | 'interval' | 'schedule' | 'slideshow';
      interval: { value: number; unit: string };
    };
    allow_NSFW: boolean;
    history_save_copy: boolean;
  };
  home_page: HomePageSettings;
  startup: {
    auto_start: boolean;
    hide_on_launch: boolean;
  };
  sniff: {
    user_agent: string;
    referer: string;
    use_source_as_referer: boolean;
    timeout_seconds: number;
  };
  store: {
    use_custom_source: boolean;
    custom_source_url: string;
  };
  storage: {
    download_directory: string;
  };
  generate: {
    providers: ImageProviderConfig[];
    active_provider_id: string;
    default_size: string;
    default_n: number;
    default_response_format: 'url' | 'b64_json';
  };
  im?: {
    mirror_preference?: string;
    show_disclaimer?: boolean;
  };
}

export interface ImageProviderConfig {
  id: string;
  name: string;
  format: 'openai' | 'volcano' | 'openai-compatible';
  endpoint: string;
  apiKey: string;
  model: string;
  modelName?: string;
  customHeaders?: Record<string, string>;
}

export type NavId = 'home' | 'resource' | 'generate' | 'sniff' | 'favorite' | 'store';

export interface IntelligentMarketParameter {
  key: string;
  name?: string | null;
  type: string;
  required?: boolean;
  friendly_name?: string;
  default_value?: unknown;
  options?: unknown[] | null;
  friendly_options?: string[];
  min_value?: number | null;
  max_value?: number | null;
  split_str?: string | null;
  enabled?: boolean;
}

export interface IntelligentMarketSource {
  id: string;
  category: string;
  file_path: string;
  friendly_name: string;
  intro?: string;
  icon?: string | null;
  link: string;
  method: string;
  api_core_version: string;
  parameters: IntelligentMarketParameter[];
  raw_url?: string;
  html_url?: string;
  health_status?: 'healthy' | 'unknown' | 'unhealthy' | string;
  health_message?: string | null;
  health_checked_at?: string | null;
  health_status_code?: number | null;
  health_probe_url?: string | null;
}

export interface IntelligentMarketHealthUpdate {
  id: string;
  health_status?: 'healthy' | 'unknown' | 'unhealthy' | string;
  health_message?: string | null;
  health_checked_at?: string | null;
  health_status_code?: number | null;
  health_probe_url?: string | null;
}
