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
  enabled?: boolean;
  source_kind?: 'builtin' | 'custom';
  is_builtin?: boolean;
  can_delete?: boolean;
  description?: string;
  details?: string;
  logo?: string;
  footer_text?: string;
  categories?: Array<Record<string, unknown>>;
  category_groups?: Array<Record<string, unknown>>;
  config?: Record<string, unknown>;
  merge?: Record<string, unknown>;
  apis?: WallpaperSourceApi[];
  invalid?: boolean;
  error?: string;
};

export type WallpaperSourceApiParameter = {
  key: string;
  type: string;
  label?: string;
  default?: unknown;
  choices?: string[];
  hidden?: boolean;
  description?: string;
  placeholder?: string;
  min_length?: number;
  max_length?: number;
};

export type WallpaperSourceApi = {
  name: string;
  description?: string;
  logo?: string;
  categories?: string[];
  parameters?: WallpaperSourceApiParameter[];
  request?: {
    url?: string;
    method?: string;
    timeout_seconds?: number;
    interval_seconds?: number;
    headers?: Record<string, string>;
    body?: string;
    body_type?: string;
  };
  response?: {
    format?: string;
    type?: string;
  };
  mapping?: {
    items?: string;
    item_mapping?: Record<string, string>;
  };
  post_process?: Record<string, string>;
  validation?: {
    required_fields?: string[];
    field_patterns?: Array<Record<string, unknown>>;
    quality_rules?: Array<Record<string, unknown>>;
  };
  error_handling?: {
    http_codes?: Array<Record<string, unknown>>;
    on_empty_response?: string;
    on_mapping_failed?: string;
    fallback_to?: string;
  };
  cache?: {
    enabled?: boolean;
    ttl_seconds?: number;
    key_template?: string;
  };
  static_list?: {
    urls?: string[];
  };
  static_dict?: {
    items?: Array<Record<string, unknown>>;
  };
};

export type WallpaperSourceHeaderDraft = {
  key: string;
  value: string;
};

export type WallpaperSourceParameterDraft = {
  key: string;
  label: string;
  type: string;
  default: string | boolean;
  choices: string;
  hidden?: boolean;
  description?: string;
  placeholder?: string;
  min_length?: string;
  max_length?: string;
};

export type WallpaperSourceKeyValueDraft = {
  key: string;
  value: string;
};

export type WallpaperSourceRuleDraft = {
  path: string;
  regex: string;
  min_length: string;
  max_length: string;
  min: string;
  max: string;
};

export type WallpaperSourceHttpCodeDraft = {
  code: string;
  message: string;
  retry_after: string;
  fallback: boolean;
};

export type WallpaperSourceCategoryDraft = {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  subsubcategory: string;
  icon: string;
  description: string;
};

export type WallpaperSourceCategoryGroupDraft = {
  name: string;
  category_ids: string[];
};

export type WallpaperSourceStaticDictItemDraft = {
  image: string;
  title: string;
  preview: string;
  description: string;
  width: string;
  height: string;
};

export type WallpaperSourceExternalExportFormat = 'apicore_v1' | 'apicore_v2' | 'openapi_3_2';

export type WallpaperSourceExportOptions = {
  openapi?: {
    servers?: string[];
    tags_by_api?: Record<string, string[]>;
  };
};

export type WallpaperSourceCreatorPayload = {
  source: {
    identifier: string;
    name: string;
    version: string;
    description: string;
    details: string;
    logo: string;
    footer_text: string;
    merge: {
      enabled: boolean;
      strategy: string;
      priority: number;
      metadata_source: string;
      allow_metadata_override: boolean;
    };
  };
  config: {
    request: {
      global_interval_seconds: number;
      timeout_seconds: number;
      max_concurrent: number;
      skip_ssl_verify: boolean;
      user_agent: string;
      headers: WallpaperSourceKeyValueDraft[];
      retry: {
        max_attempts: number;
        backoff_base: number;
        initial_delay_ms: number;
      };
      cache: {
        enabled: boolean;
        default_ttl_seconds: number;
        max_memory_mb: number;
      };
      variables: WallpaperSourceKeyValueDraft[];
    };
  };
  categories: {
    template: {
      icon: string;
      category: string;
    };
    categories: WallpaperSourceCategoryDraft[];
    category_groups: WallpaperSourceCategoryGroupDraft[];
    level_icons: {
      category: WallpaperSourceKeyValueDraft[];
      subcategory: WallpaperSourceKeyValueDraft[];
      subsubcategory: WallpaperSourceKeyValueDraft[];
    };
  };
  apis: Array<{
    name: string;
    description: string;
    logo: string;
    categories: string[];
    parameters: Array<{
      key: string;
      label: string;
      type: string;
      default: string | boolean;
      choices: string[];
      hidden: boolean;
      description: string;
      placeholder: string;
      min_length: number | null;
      max_length: number | null;
    }>;
    request: {
      url: string;
      method: string;
      timeout_seconds: number;
      interval_seconds: number;
      headers: WallpaperSourceHeaderDraft[];
      body: string;
      body_type: string;
    };
    response: {
      format: string;
      type: string;
    };
    mapping: {
      items: string;
      item_mapping: WallpaperSourceKeyValueDraft[];
    };
    post_process: WallpaperSourceKeyValueDraft[];
    validation: {
      required_fields: string[];
      field_patterns: WallpaperSourceRuleDraft[];
      quality_rules: WallpaperSourceRuleDraft[];
    };
    error_handling: {
      http_codes: WallpaperSourceHttpCodeDraft[];
      on_empty_response: string;
      on_mapping_failed: string;
      fallback_to: string;
    };
    cache: {
      enabled: boolean;
      ttl_seconds: number;
      key_template: string;
    };
    static_list_urls: string[];
    static_dict_items: WallpaperSourceStaticDictItemDraft[];
  }>;
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

export type AutoChangeStrategy = 'random' | 'sequential' | 'non_repeat_random' | 'weighted_random';

export type AutoChangeTriggerKind = 'interval' | 'schedule';

export type AutoChangeLocalSourceItem = {
  id: string;
  name: string;
  path: string;
  weight: number;
};

export type AutoChangeLocalSource = {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  selection: {
    mode: AutoChangeStrategy;
    avoid_repeats: boolean;
    weights: Record<string, number>;
  };
  item_count?: number;
  items?: AutoChangeLocalSourceItem[];
};

export type AutoChangePlan = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: {
    kind: AutoChangeTriggerKind;
    interval_seconds: number;
    time_of_day: string;
  };
  sources: string[];
  selection: {
    mode: AutoChangeStrategy;
    avoid_repeats: boolean;
    source_weights: Record<string, number>;
  };
};

export type AutoChangeConfig = {
  enabled: boolean;
  plans: AutoChangePlan[];
  local_sources: AutoChangeLocalSource[];
};

export type BootstrapPayload = {
  settings: Record<string, unknown>;
  favorites: FavoritePayload;
  history: Array<Record<string, unknown>>;
  sources: WallpaperSource[];
  plugins: Array<Record<string, unknown>>;
  runtime: {
    auto_change: AutoChangeConfig & {
      enabled: boolean;
      mode: string;
      interval: number;
      schedule?: string;
      strategy: string;
      sources: string[];
      running: boolean;
      last_run_at?: string | null;
      last_item_title?: string | null;
      last_error?: string | null;
      last_plan_id?: string | null;
      last_plan_name?: string | null;
      next_run_at?: string | null;
      next_plan_id?: string | null;
      next_plan_name?: string | null;
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

export type ScreenBingQuality = `screen:${number}x${number}`;
export type BingQuality = 'highDef' | 'ultraHighDef' | ScreenBingQuality;
export type FavoriteLocalizationFilter = 'all' | 'localized' | 'remote' | 'failed';
export type DownloadBehavior = 'directory' | 'prompt';
