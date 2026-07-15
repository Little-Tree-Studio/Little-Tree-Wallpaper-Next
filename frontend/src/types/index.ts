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

export interface CnuWorkSummary {
  id: string;
  title: string;
  description: string;
  preview_url: string;
  author: string;
  author_id: string;
  category: string;
  category_id: string;
  selected_date: string;
  work_type: string;
  section: 'selected' | 'inspiration' | 'discovery';
  order: 'selected' | 'hot' | 'recommend' | 'recent';
  detail_url: string;
}

export interface CnuWallpaperMetadata {
  work_id: string;
  detail_url: string;
  click_url: string;
  referer: string;
  author: string;
  author_url: string;
  published_at: string;
  category: string;
  category_id: string;
  selected_date: string;
  image_index: number;
  image_count: number;
  image_description: string;
  image_text: string;
  image_path: string;
}

export interface PixivelWorkSummary {
  id: string;
  title: string;
  author: string;
  author_id: string;
  preview_url: string;
  mode: string;
  mode_label: string;
  page_count: number;
  width: number | null;
  height: number | null;
  total_view: number | null;
  total_bookmarks: number | null;
  create_date: string;
  ranking_date: string;
  tags: string[];
  detail_url: string;
  source_id: string;
  source_name: string;
}

export interface PixivelWallpaperMetadata {
  work_id: string;
  detail_url: string;
  click_url: string;
  referer: string;
  author: string;
  author_id: string;
  author_url: string;
  tags: string[];
  page_count: number;
  page_index: number;
  create_date: string;
  total_view: number | null;
  total_bookmarks: number | null;
}

export interface TimelineTopicSummary {
  id: string;
  title: string;
  description: string;
  preview_url: string;
  width: number | null;
  height: number | null;
  category_type: string;
  category_subject: string;
  detail_url: string;
}

export interface TimelineWallpaperMetadata {
  raw_id: string;
  no: number | null;
  topics: string[];
  released_at: string;
  copyright: string;
  provider: string;
  provider_id: string;
  source_page_url: string;
  gallery_url: string;
  score: number | null;
  rank: number | null;
  tone: string | null;
  tags: string[];
  original_image_url?: string;
  original_preview_url?: string;
}

export interface WallpaperItem {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  image_url: string;
  preview_url: string | null;
  width: number | null;
  height: number | null;
  description: string;
  metadata: CnuWallpaperMetadata | PixivelWallpaperMetadata | TimelineWallpaperMetadata | Record<string, unknown>;
}

export interface TimelineWallpaperPage {
  items: WallpaperItem[];
  next_cursor: number | null;
  has_more: boolean;
  seed: number;
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
  source_name?: string;
  source_url: string;
  source_page_url?: string;
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
  system_tags?: string[];
}

export interface SniffedImage {
  id: string;
  url: string;
  preview_url?: string;
  filename: string;
  content_type: string;
  title?: string;
  author?: string;
  author_id?: string;
  pixiv_id?: string;
  width?: number;
  height?: number;
  tags?: string[];
  source_url?: string;
  source_page_url?: string;
  referer?: string;
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
    sources: { merge_display: boolean };
    pixiv?: { include_artwork_tags_in_favorites: boolean };
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
    favorites_directory: string;
    auto_clear_cache: { enabled: boolean; max_mb: number };
    auto_clear_logs: { enabled: boolean; max_files: number };
    auto_compress: { enabled: boolean; format: string; quality: number };
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

export type StorageAction = 'none' | 'safe' | 'confirm' | 'risk';

export interface StorageCategory {
  id: string;
  title: string;
  description: string;
  path: string;
  disk: string;
  disk_bytes: Record<string, number>;
  additional_paths: string[];
  size_bytes: number;
  file_count: number;
  reclaimable_bytes: number;
  action: StorageAction;
  optimize_supported: boolean;
}

export interface StorageDisk {
  id: string;
  path: string;
  kind: 'disk' | 'mount';
  total_bytes: number;
  free_bytes: number;
  used_bytes: number;
  reserved_bytes: number;
  other_used_bytes: number;
  app_bytes: number;
  is_system: boolean;
  item_ids: string[];
}

export interface StorageCompressionFormat {
  id: string;
  title: string;
  extension: string;
  available: boolean;
}

export interface StorageOverview {
  download_directory: string;
  default_download_directory: string;
  default_favorites_directory: string;
  total_bytes: number;
  reclaimable_bytes: number;
  items: StorageCategory[];
  disks: StorageDisk[];
  compression: StorageCompressionFormat[];
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
