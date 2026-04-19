export type WallpaperItem = {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  image_url: string;
  preview_url?: string | null;
  width?: number | null;
  height?: number | null;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type FavoriteFolder = {
  id: string;
  name: string;
  description?: string;
  order?: number;
  created_at?: string | null;
  updated_at?: string | null;
  item_count?: number;
  metadata?: Record<string, unknown>;
};

export type FavoriteItem = WallpaperItem & {
  folder_id: string;
  created_at?: string | null;
  updated_at?: string | null;
  local_path?: string | null;
  localized?: boolean;
  is_local_source?: boolean;
  can_localize?: boolean;
  localization_status?: 'absent' | 'idle' | 'pending' | 'completed' | 'failed' | string;
  localization_updated_at?: string | null;
  localization_message?: string | null;
  localization_file_size?: number | null;
  tags?: string[];
};

export type FavoritePayload = {
  version?: number;
  folder_order?: string[];
  folders: FavoriteFolder[];
  items: FavoriteItem[];
};

export type WallpaperSource = {
  identifier: string;
  name: string;
  version: string;
  description?: string;
  details?: string;
  categories?: Array<Record<string, unknown>>;
  apis?: Array<Record<string, unknown>>;
  invalid?: boolean;
  error?: string;
};

export type IntelligentMarketParameter = {
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
};

export type IntelligentMarketSource = {
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
};

export type IntelligentMarketHealthUpdate = {
  id: string;
  health_status?: 'healthy' | 'unknown' | 'unhealthy' | string;
  health_message?: string | null;
  health_checked_at?: string | null;
  health_status_code?: number | null;
  health_probe_url?: string | null;
};

export type CurrentWallpaperInfo = {
  local_path: string;
  exists: boolean;
  preview_url?: string | null;
  refreshed_at?: string | null;
};

export type DebugLogPayload = {
  path: string;
  content: string;
  truncated: boolean;
  lines: number;
};

export type StorageEntry = {
  id: string;
  scope: 'data' | 'cache' | string;
  path: string;
  file_count: number;
  size_bytes: number;
  clear_supported: boolean;
  optimize_supported: boolean;
};

export type StorageOverviewPayload = {
  download_directory: string;
  default_download_directory: string;
  total_size_bytes: number;
  data_size_bytes: number;
  cache_size_bytes: number;
  items: StorageEntry[];
};

export type StorageCleanupResult = {
  results: Array<{
    id: string;
    removed_files: number;
    freed_bytes: number;
    updated_items?: number;
  }>;
  storage: StorageOverviewPayload;
};

export type StorageOptimizeResult = {
  quality: number;
  processed_count: number;
  converted_count: number;
  skipped_count: number;
  error_count: number;
  before_bytes: number;
  after_bytes: number;
  delta_bytes: number;
  results: Array<{
    id: string;
    processed_count: number;
    converted_count: number;
    skipped_count: number;
    error_count: number;
    before_bytes: number;
    after_bytes: number;
    delta_bytes: number;
  }>;
  storage: StorageOverviewPayload;
};

export type StoreResourceAuthor = {
  name: string;
  email?: string | null;
  url?: string | null;
  links?: Record<string, string>;
};

export type StoreResourceAsset = {
  name: string;
  path?: string | null;
  url?: string | null;
  sha256?: string | null;
  size_bytes?: number | null;
};

export type StoreResource = {
  type: string;
  id: string;
  name: string;
  version: string;
  summary: string;
  description_md: string;
  icon_url?: string | null;
  download_url?: string | null;
  download_type?: string;
  homepage_url?: string | null;
  repository_url?: string | null;
  license?: string | null;
  author?: StoreResourceAuthor | null;
  tags?: string[];
  changelog_url?: string | null;
  assets?: StoreResourceAsset[];
  protocol_version?: number | null;
  plugin?: Record<string, unknown> | null;
  theme?: { preview_url?: string | null } | null;
};

export type BootstrapPayload = {
  settings: Record<string, unknown>;
  favorites: FavoritePayload;
  history: Array<Record<string, unknown>>;
  sources: WallpaperSource[];
  plugins: Array<Record<string, unknown>>;
  runtime: {
    auto_change: {
      enabled: boolean;
      mode: string;
      interval: number;
      strategy: string;
      sources: string[];
      running: boolean;
      last_run_at?: string | null;
      last_item_title?: string | null;
      last_error?: string | null;
      next_run_at?: string | null;
    };
    debug: {
      enabled: boolean;
      session_enabled: boolean;
      open_devtools_on_start: boolean;
      log_file: string;
      log_directory: string;
    };
    window: {
      hide_on_close: boolean;
      minimize_to_tray: boolean;
    };
    display: {
      width: number;
      height: number;
    };
  };
  home: {
    bing: WallpaperItem[];
    spotlight: WallpaperItem[];
    quote: { text: string; author: string; source: string };
    current_wallpaper?: CurrentWallpaperInfo | null;
  };
};
