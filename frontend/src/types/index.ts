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
  wallpaper_refresh_seconds: number;
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
    minimize_to_tray: boolean;
    release_webview_on_close: boolean;
  };
  wallpaper: {
    auto_change: {
      enabled: boolean;
      mode: 'off' | 'interval' | 'schedule' | 'slideshow';
      interval: { value: number; unit: string };
    };
    allow_NSFW: boolean;
    history_save_copy: boolean;
    history: { max_items: number; preview_items: number };
    sources: { merge_display: boolean };
    pixiv?: { include_artwork_tags_in_favorites: boolean };
    dynamic: {
      static_snapshot: { enabled: boolean };
      performance: DynamicWallpaperPerformanceSettings;
    };
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
    max_results: number;
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
  download: {
    timeout_seconds: number;
    concurrent_tasks: number;
  };
  create: {
    show_grid: boolean;
    snap_to_guides: boolean;
    export_format: 'png' | 'jpeg';
    jpeg_quality: number;
  };
  generate: {
    providers: ImageProviderConfig[];
    active_provider_id: string;
    default_size: string;
    default_n: number;
    default_response_format: 'url' | 'b64_json';
    default_quality: string;
    remember_prompts: boolean;
    prompt_history_limit: number;
    history_max_items: number;
  };
  im?: {
    mirror_preference?: string;
    show_disclaimer?: boolean;
    auto_health_check?: boolean;
  };
}

export type DynamicWallpaperPerformanceAction = 'keep_running' | 'mute' | 'pause' | 'stop';

export interface DynamicWallpaperPerformanceSettings {
  other_application_focused: DynamicWallpaperPerformanceAction;
  other_application_maximized: DynamicWallpaperPerformanceAction;
  other_application_fullscreen: DynamicWallpaperPerformanceAction;
  other_application_audio: DynamicWallpaperPerformanceAction;
  on_battery: DynamicWallpaperPerformanceAction;
}

export interface AutostartStatus {
  supported: boolean;
  enabled: boolean;
  registered: boolean;
  command_matches: boolean;
  preference_enabled: boolean;
  platform: string;
  mechanism: string;
  reason: string;
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
  format: 'openai-compatible' | 'pollinations';
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

export type PluginState = 'enabled' | 'disabled' | 'error';
export type PluginStatus = 'started' | 'installed' | 'disabled' | 'error';
export type PluginPermission =
  | 'ui.buttons'
  | 'ui.global_style'
  | 'ui.navigation'
  | 'ui.overlay'
  | 'ui.pages'
  | 'ui.resource_pages'
  | 'ui.theme'
  | 'ui.widgets';

export interface PluginHeadingBlock {
  type: 'heading';
  text: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
}

export interface PluginTextBlock {
  type: 'text';
  text: string;
  className?: string;
}

export interface PluginImageBlock {
  type: 'image';
  src: string;
  alt?: string;
  className?: string;
}

export interface PluginCardBlock {
  type: 'card';
  title?: string;
  blocks: PluginBlock[];
  className?: string;
}

export interface PluginButtonBlock {
  type: 'button';
  label: string;
  action: string;
  payload?: unknown;
  className?: string;
}

export interface PluginDividerBlock {
  type: 'divider';
  className?: string;
}

export type PluginBlock =
  | PluginHeadingBlock
  | PluginTextBlock
  | PluginImageBlock
  | PluginCardBlock
  | PluginButtonBlock
  | PluginDividerBlock;

export interface PluginPageContribution {
  id: string;
  label: string;
  route: string;
  blocks: PluginBlock[];
  className?: string;
}

export interface PluginNavigationContribution {
  id: string;
  label: string;
  route?: string;
  page?: string;
  location?: 'sidebar' | string;
}

export interface PluginButtonContribution {
  id: string;
  label: string;
  action: string;
  payload?: unknown;
  location?: 'global' | string;
}

export type PluginOverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface PluginOverlayContribution {
  id: string;
  label: string;
  blocks: PluginBlock[];
  position?: PluginOverlayPosition;
  fixed?: boolean;
  className?: string;
}

export interface PluginStyleContribution {
  id: string;
  scope: 'plugin' | 'global';
  css: string;
}

export interface PluginThemeContribution {
  id: string;
  label: string;
  variables: Record<string, string | number>;
}

export interface PluginWidgetContribution {
  id: string;
  label: string;
  description?: string;
  default_size: { width: number; height: number };
  blocks: PluginBlock[];
  className?: string;
}

export interface PluginContributionMap {
  pages?: PluginPageContribution[];
  navigation?: PluginNavigationContribution[];
  resource_pages?: PluginPageContribution[];
  buttons?: PluginButtonContribution[];
  overlays?: PluginOverlayContribution[];
  styles?: PluginStyleContribution[];
  theme?: PluginThemeContribution[];
  widgets?: PluginWidgetContribution[];
}

export interface PluginManifest {
  schema_version: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entrypoint: string;
  permissions: PluginPermission[];
  contributes: PluginContributionMap;
}

export interface Plugin {
  id: string;
  enabled: boolean;
  state: PluginState;
  status: PluginStatus;
  error: string | null;
  manifest: PluginManifest | null;
  contributions: PluginContributionMap;
  package_hash: string | null;
  source: string | null;
}

export interface PluginListResult {
  state: string;
  status: string;
  error: string | null;
  plugins: Plugin[];
}

export interface PluginOperationResult {
  id?: string;
  state: string;
  status: string;
  error: string | null;
  manifest: PluginManifest | null;
  contributions: PluginContributionMap;
  package_hash: string | null;
  source: string | null;
  result?: unknown;
}

export interface PluginContributionMetadata {
  id: string;
  name: string;
  version: string;
  author: string;
}

export type BoundPluginContribution<T> = T & {
  pluginId: string;
  packageHash: string | null;
  plugin: PluginContributionMetadata;
};

export interface BoundPluginContributions {
  pages: BoundPluginContribution<PluginPageContribution>[];
  navigation: BoundPluginContribution<PluginNavigationContribution>[];
  resource_pages: BoundPluginContribution<PluginPageContribution>[];
  buttons: BoundPluginContribution<PluginButtonContribution>[];
  overlays: BoundPluginContribution<PluginOverlayContribution>[];
  styles: BoundPluginContribution<PluginStyleContribution>[];
  theme: BoundPluginContribution<PluginThemeContribution>[];
  widgets: BoundPluginContribution<PluginWidgetContribution>[];
}
