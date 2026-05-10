import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ApiRoundedIcon from '@mui/icons-material/ApiRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';
import RouteRoundedIcon from '@mui/icons-material/RouteRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useEffect, useMemo, useState } from 'react';

import type { TranslateFn } from '../i18n';
import type {
  WallpaperSourceCategoryDraft,
  WallpaperSourceCategoryGroupDraft,
  WallpaperSourceCreatorPayload,
  WallpaperSourceExternalExportFormat,
  WallpaperSourceExportOptions,
  WallpaperSourceHeaderDraft,
  WallpaperSourceHttpCodeDraft,
  WallpaperSourceKeyValueDraft,
  WallpaperSourceParameterDraft,
  WallpaperSourceRuleDraft,
  WallpaperSourceStaticDictItemDraft,
} from '../types';

type WallpaperSourceCreatorPanelProps = {
  t: TranslateFn;
  open: boolean;
  working: boolean;
  initialPayload?: WallpaperSourceCreatorPayload | null;
  onClose: () => void;
  onSubmit: (payload: WallpaperSourceCreatorPayload) => Promise<void>;
  onExport: (payload: WallpaperSourceCreatorPayload, exportFormat: WallpaperSourceExternalExportFormat, exportOptions?: WallpaperSourceExportOptions) => Promise<void>;
};

type CreatorProtocolMode = 'ltws' | WallpaperSourceExternalExportFormat;

type CreatorParameterDraft = WallpaperSourceParameterDraft & {
  hidden: boolean;
  description: string;
  placeholder: string;
  min_length: string;
  max_length: string;
};

type CreatorApiDraft = {
  id: string;
  name: string;
  description: string;
  logo: string;
  categoriesText: string;
  method: string;
  url: string;
  timeout_seconds: number;
  interval_seconds: number;
  body: string;
  body_type: string;
  headers: WallpaperSourceHeaderDraft[];
  response_format: string;
  response_type: string;
  items_path: string;
  item_mapping: WallpaperSourceKeyValueDraft[];
  post_process: WallpaperSourceKeyValueDraft[];
  parameters: CreatorParameterDraft[];
  required_fields_text: string;
  field_patterns: WallpaperSourceRuleDraft[];
  quality_rules: WallpaperSourceRuleDraft[];
  http_codes: WallpaperSourceHttpCodeDraft[];
  on_empty_response: string;
  on_mapping_failed: string;
  fallback_to: string;
  cache_enabled: boolean;
  cache_ttl_seconds: number;
  cache_key_template: string;
  static_list_text: string;
  static_dict_items: WallpaperSourceStaticDictItemDraft[];
};

type CreatorDraft = {
  source: {
    identifier: string;
    name: string;
    version: string;
    description: string;
    details: string;
    logo: string;
    footer_text: string;
    merge_enabled: boolean;
    merge_strategy: string;
    merge_priority: number;
    merge_metadata_source: string;
    merge_allow_override: boolean;
  };
  config: {
    request: {
      global_interval_seconds: number;
      timeout_seconds: number;
      max_concurrent: number;
      skip_ssl_verify: boolean;
      user_agent: string;
      headers: WallpaperSourceHeaderDraft[];
      retry_max_attempts: number;
      retry_backoff_base: number;
      retry_initial_delay_ms: number;
      cache_enabled: boolean;
      cache_default_ttl_seconds: number;
      cache_max_memory_mb: number;
      variables: WallpaperSourceKeyValueDraft[];
    };
  };
  categories: {
    template_icon: string;
    template_category: string;
    categories: WallpaperSourceCategoryDraft[];
    category_groups: WallpaperSourceCategoryGroupDraft[];
    level_icons: {
      category: WallpaperSourceKeyValueDraft[];
      subcategory: WallpaperSourceKeyValueDraft[];
      subsubcategory: WallpaperSourceKeyValueDraft[];
    };
  };
  apis: CreatorApiDraft[];
};

type CreatorValidationState = {
  sourceNameError: string | null;
  identifierError: string | null;
  versionError: string | null;
  categoryErrors: Array<{
    idError: string | null;
    nameError: string | null;
  }>;
  apiErrors: Array<{
    nameError: string | null;
    categoriesError: string | null;
    urlError: string | null;
    mappingError: string | null;
    staticPayloadError: string | null;
  }>;
  summary: string[];
  canSubmit: boolean;
};

const REQUEST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const REQUEST_BODY_TYPES = ['json', 'form', 'raw'];
const RESPONSE_FORMATS = ['json', 'toml', 'image_url', 'image_raw', 'static_list', 'static_dict'];
const RESPONSE_TYPES = ['multi', 'single'];
const PARAMETER_TYPES = ['text', 'choice', 'boolean', 'number', 'list'];
const MERGE_STRATEGIES = ['same_id', 'same_name'];
const MERGE_METADATA_SOURCES = ['high_priority', 'first_loaded', 'last_updated'];
const EMPTY_RESPONSE_BEHAVIORS = ['', 'skip'];
const MAPPING_FAILURE_BEHAVIORS = ['', 'skip_item'];

let creatorApiSequence = 0;

function nextCreatorApiId(): string {
  creatorApiSequence += 1;
  return `creator-api-${creatorApiSequence}`;
}

function emptyKeyValueRow(): WallpaperSourceKeyValueDraft {
  return { key: '', value: '' };
}

function emptyRuleRow(): WallpaperSourceRuleDraft {
  return { path: '', regex: '', min_length: '', max_length: '', min: '', max: '' };
}

function emptyHttpCodeRow(): WallpaperSourceHttpCodeDraft {
  return { code: '', message: '', retry_after: '', fallback: false };
}

function emptyParameterRow(): CreatorParameterDraft {
  return {
    key: '',
    label: '',
    type: 'text',
    default: '',
    choices: '',
    hidden: false,
    description: '',
    placeholder: '',
    min_length: '',
    max_length: '',
  };
}

function emptyCategoryRow(name = ''): WallpaperSourceCategoryDraft {
  return {
    id: slugifyCategoryId(name || 'default'),
    name,
    category: '自定义',
    subcategory: '',
    subsubcategory: '',
    icon: '',
    description: '',
  };
}

function emptyCategoryGroupRow(): WallpaperSourceCategoryGroupDraft {
  return { name: '', category_ids: [] };
}

function emptyStaticDictItem(): WallpaperSourceStaticDictItemDraft {
  return {
    image: '',
    title: '',
    preview: '',
    description: '',
    width: '',
    height: '',
  };
}

function parseTextList(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinTextList(values: string[]): string {
  return values.join('\n');
}

function tryResolveUrlOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function slugifyIdentifier(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, '')
    .replace(/[\s_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'custom_source';
}

function slugifyCategoryId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'default';
}

function createDefaultApiDraft(index: number): CreatorApiDraft {
  return {
    id: nextCreatorApiId(),
    name: index === 0 ? '默认接口' : `接口 ${index + 1}`,
    description: '',
    logo: '',
    categoriesText: 'default',
    method: 'GET',
    url: '',
    timeout_seconds: 20,
    interval_seconds: 3600,
    body: '',
    body_type: 'json',
    headers: [emptyKeyValueRow()],
    response_format: 'json',
    response_type: 'multi',
    items_path: '/items',
    item_mapping: [
      { key: 'image', value: '/image' },
      { key: 'title', value: '/title' },
    ],
    post_process: [],
    parameters: [],
    required_fields_text: 'image',
    field_patterns: [],
    quality_rules: [],
    http_codes: [],
    on_empty_response: 'skip',
    on_mapping_failed: 'skip_item',
    fallback_to: '',
    cache_enabled: true,
    cache_ttl_seconds: 21600,
    cache_key_template: '',
    static_list_text: '',
    static_dict_items: [emptyStaticDictItem()],
  };
}

function createDefaultDraft(): CreatorDraft {
  return {
    source: {
      identifier: 'com.littletree.custom_source',
      name: '',
      version: '1.0.0',
      description: '',
      details: '',
      logo: '',
      footer_text: '',
      merge_enabled: true,
      merge_strategy: 'same_id',
      merge_priority: 120,
      merge_metadata_source: 'high_priority',
      merge_allow_override: true,
    },
    config: {
      request: {
        global_interval_seconds: 1800,
        timeout_seconds: 20,
        max_concurrent: 2,
        skip_ssl_verify: false,
        user_agent: 'LittleTreeWallpaperNext/0.1.0',
        headers: [{ key: 'Accept', value: 'application/json, text/plain, */*' }],
        retry_max_attempts: 2,
        retry_backoff_base: 1.5,
        retry_initial_delay_ms: 600,
        cache_enabled: true,
        cache_default_ttl_seconds: 21600,
        cache_max_memory_mb: 32,
        variables: [
          { key: 'timestamp', value: '{{timestamp_ms}}' },
          { key: 'date', value: '{{date_iso}}' },
        ],
      },
    },
    categories: {
      template_icon: '',
      template_category: '自定义',
      categories: [
        {
          ...emptyCategoryRow('默认分类'),
          id: 'default',
          subcategory: '自定义源',
        },
      ],
      category_groups: [{ name: '默认分组', category_ids: ['default'] }],
      level_icons: {
        category: [],
        subcategory: [],
        subsubcategory: [],
      },
    },
    apis: [createDefaultApiDraft(0)],
  };
}

function createDraftFromPayload(payload: WallpaperSourceCreatorPayload): CreatorDraft {
  const firstCategory = payload.categories.categories[0];
  return {
    source: {
      identifier: payload.source.identifier,
      name: payload.source.name,
      version: payload.source.version,
      description: payload.source.description,
      details: payload.source.details,
      logo: payload.source.logo,
      footer_text: payload.source.footer_text,
      merge_enabled: payload.source.merge.enabled,
      merge_strategy: payload.source.merge.strategy,
      merge_priority: payload.source.merge.priority,
      merge_metadata_source: payload.source.merge.metadata_source,
      merge_allow_override: payload.source.merge.allow_metadata_override,
    },
    config: {
      request: {
        global_interval_seconds: payload.config.request.global_interval_seconds,
        timeout_seconds: payload.config.request.timeout_seconds,
        max_concurrent: payload.config.request.max_concurrent,
        skip_ssl_verify: payload.config.request.skip_ssl_verify,
        user_agent: payload.config.request.user_agent,
        headers: payload.config.request.headers.length > 0 ? payload.config.request.headers : [emptyKeyValueRow()],
        retry_max_attempts: payload.config.request.retry.max_attempts,
        retry_backoff_base: payload.config.request.retry.backoff_base,
        retry_initial_delay_ms: payload.config.request.retry.initial_delay_ms,
        cache_enabled: payload.config.request.cache.enabled,
        cache_default_ttl_seconds: payload.config.request.cache.default_ttl_seconds,
        cache_max_memory_mb: payload.config.request.cache.max_memory_mb,
        variables: payload.config.request.variables.length > 0 ? payload.config.request.variables : [emptyKeyValueRow()],
      },
    },
    categories: {
      template_icon: payload.categories.template.icon,
      template_category: payload.categories.template.category,
      categories: payload.categories.categories.length > 0
        ? payload.categories.categories
        : [{ ...emptyCategoryRow('默认分类'), id: 'default', subcategory: firstCategory?.subcategory ?? '自定义源' }],
      category_groups: payload.categories.category_groups.length > 0 ? payload.categories.category_groups : [emptyCategoryGroupRow()],
      level_icons: {
        category: payload.categories.level_icons.category,
        subcategory: payload.categories.level_icons.subcategory,
        subsubcategory: payload.categories.level_icons.subsubcategory,
      },
    },
    apis: payload.apis.length > 0
      ? payload.apis.map((api, index) => ({
        id: nextCreatorApiId(),
        name: api.name,
        description: api.description,
        logo: api.logo,
        categoriesText: joinTextList(api.categories),
        method: api.request.method,
        url: api.request.url,
        timeout_seconds: api.request.timeout_seconds,
        interval_seconds: api.request.interval_seconds,
        body: api.request.body,
        body_type: api.request.body_type,
        headers: api.request.headers.length > 0 ? api.request.headers : [emptyKeyValueRow()],
        response_format: api.response.format,
        response_type: api.response.type,
        items_path: api.mapping.items,
        item_mapping: api.mapping.item_mapping,
        post_process: api.post_process,
        parameters: api.parameters.map((parameter) => ({
          ...parameter,
          default: parameter.default,
          choices: joinTextList(parameter.choices),
          hidden: parameter.hidden,
          description: parameter.description,
          placeholder: parameter.placeholder,
          min_length: parameter.min_length === null ? '' : String(parameter.min_length),
          max_length: parameter.max_length === null ? '' : String(parameter.max_length),
        })),
        required_fields_text: joinTextList(api.validation.required_fields),
        field_patterns: api.validation.field_patterns,
        quality_rules: api.validation.quality_rules,
        http_codes: api.error_handling.http_codes,
        on_empty_response: api.error_handling.on_empty_response,
        on_mapping_failed: api.error_handling.on_mapping_failed,
        fallback_to: api.error_handling.fallback_to,
        cache_enabled: api.cache.enabled,
        cache_ttl_seconds: api.cache.ttl_seconds,
        cache_key_template: api.cache.key_template,
        static_list_text: joinTextList(api.static_list_urls),
        static_dict_items: api.static_dict_items.length > 0 ? api.static_dict_items : [emptyStaticDictItem()],
      }))
      : [createDefaultApiDraft(0)],
  };
}

export function WallpaperSourceCreatorPanel({
  t,
  open,
  working,
  initialPayload,
  onClose,
  onSubmit,
  onExport,
}: WallpaperSourceCreatorPanelProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));
  const [draft, setDraft] = useState<CreatorDraft>(() => createDefaultDraft());
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const [protocolMode, setProtocolMode] = useState<CreatorProtocolMode>('ltws');
  const [selectedProtocolApiId, setSelectedProtocolApiId] = useState('');
  const [openApiServersText, setOpenApiServersText] = useState('');
  const [openApiTagsTextByApiId, setOpenApiTagsTextByApiId] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState(0);
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextDraft = initialPayload ? createDraftFromPayload(initialPayload) : createDefaultDraft();
    setDraft(nextDraft);
    setIdentifierTouched(Boolean(initialPayload));
    setProtocolMode('ltws');
    setSelectedProtocolApiId('');
    setOpenApiServersText(joinTextList(Array.from(new Set(nextDraft.apis.map((api) => tryResolveUrlOrigin(api.url.trim())).filter(Boolean)))));
    setOpenApiTagsTextByApiId(Object.fromEntries(nextDraft.apis.map((api) => {
      const categoryNameMap = new Map(nextDraft.categories.categories.map((category) => [category.id.trim(), category.name.trim() || category.id.trim()]));
      const tags = parseTextList(api.categoriesText).map((categoryId) => categoryNameMap.get(categoryId) ?? categoryId).filter(Boolean);
      return [api.id, joinTextList(tags)];
    })));
    setActiveTab(0);
    setSelectedCategoryIndex(0);
  }, [initialPayload, open]);

  useEffect(() => {
    if (draft.apis.length === 0) {
      if (selectedProtocolApiId) {
        setSelectedProtocolApiId('');
      }
      return;
    }
    if (draft.apis.some((api) => api.id === selectedProtocolApiId)) {
      return;
    }
    setSelectedProtocolApiId(draft.apis[0]?.id ?? '');
  }, [draft.apis, selectedProtocolApiId]);

  const categoryIdSet = useMemo(
    () => new Set(draft.categories.categories.map((item) => item.id.trim()).filter(Boolean)),
    [draft.categories.categories],
  );

  const validationState = useMemo<CreatorValidationState>(() => {
    const summary = new Set<string>();
    const sourceNameError = draft.source.name.trim() ? null : t('resource.import.editor.validationSourceNameRequired');
    const identifier = draft.source.identifier.trim();
    let identifierError: string | null = null;
    if (!identifier) {
      identifierError = t('resource.import.editor.validationIdentifierRequired');
    } else if (!/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/.test(identifier)) {
      identifierError = t('resource.import.editor.validationIdentifierInvalid');
    }
    const versionError = draft.source.version.trim() && !/^\d+\.\d+\.\d+$/.test(draft.source.version.trim())
      ? t('resource.import.editor.validationVersionInvalid')
      : null;

    if (sourceNameError) {
      summary.add(sourceNameError);
    }
    if (identifierError) {
      summary.add(identifierError);
    }
    if (versionError) {
      summary.add(versionError);
    }

    const categoryIdCounts = new Map<string, number>();
    draft.categories.categories.forEach((category) => {
      const trimmedId = category.id.trim();
      if (!trimmedId) {
        return;
      }
      categoryIdCounts.set(trimmedId, (categoryIdCounts.get(trimmedId) ?? 0) + 1);
    });

    const categoryErrors = draft.categories.categories.map((category) => {
      const touched = [category.id, category.name, category.category, category.subcategory, category.subsubcategory, category.icon, category.description]
        .some((value) => value.trim().length > 0);
      const trimmedId = category.id.trim();
      const trimmedName = category.name.trim();
      const duplicateId = trimmedId ? (categoryIdCounts.get(trimmedId) ?? 0) > 1 : false;
      const idError = !touched
        ? null
        : !trimmedId
          ? t('resource.import.editor.validationCategoryIdRequired')
          : duplicateId
            ? t('resource.import.editor.validationCategoryIdDuplicate')
            : null;
      const nameError = touched && !trimmedName ? t('resource.import.editor.validationCategoryNameRequired') : null;
      if (idError) {
        summary.add(idError);
      }
      if (nameError) {
        summary.add(nameError);
      }
      return { idError, nameError };
    });

    const apiNameCounts = new Map<string, number>();
    draft.apis.forEach((api) => {
      const trimmedName = api.name.trim();
      if (!trimmedName) {
        return;
      }
      apiNameCounts.set(trimmedName, (apiNameCounts.get(trimmedName) ?? 0) + 1);
    });

    const apiErrors = draft.apis.map((api) => {
      const selectedCategories = parseTextList(api.categoriesText);
      const requiresRequest = !['static_list', 'static_dict'].includes(api.response_format);
      const hasStaticPayload = api.response_format === 'static_list'
        ? parseTextList(api.static_list_text).length > 0
        : api.response_format === 'static_dict'
          ? api.static_dict_items.some((item) => item.image.trim())
          : true;
      const hasMapping = ['image_url', 'image_raw', 'static_list', 'static_dict'].includes(api.response_format)
        ? true
        : api.item_mapping.some((row) => row.key.trim() === 'image' && row.value.trim());
      const trimmedName = api.name.trim();

      const nameError = !trimmedName
        ? t('resource.import.editor.validationApiNameRequired')
        : (apiNameCounts.get(trimmedName) ?? 0) > 1
          ? t('resource.import.editor.validationApiNameDuplicate')
          : null;
      const categoriesError = selectedCategories.length === 0
        ? t('resource.import.editor.validationApiCategoriesRequired')
        : selectedCategories.every((categoryId) => categoryIdSet.has(categoryId))
          ? null
          : t('resource.import.editor.validationApiCategoriesInvalid');
      const urlError = requiresRequest && !api.url.trim() ? t('resource.import.editor.validationApiUrlRequired') : null;
      const mappingError = hasMapping ? null : t('resource.import.editor.validationApiMappingRequired');
      const staticPayloadError = hasStaticPayload ? null : t('resource.import.editor.validationApiStaticPayloadRequired');

      [nameError, categoriesError, urlError, mappingError, staticPayloadError]
        .filter((value): value is string => Boolean(value))
        .forEach((value) => summary.add(value));

      return {
        nameError,
        categoriesError,
        urlError,
        mappingError,
        staticPayloadError,
      };
    });

    const hasValidCategory = draft.categories.categories.some((category, index) => {
      const errors = categoryErrors[index];
      return category.id.trim() && category.name.trim() && !errors.idError && !errors.nameError;
    });
    if (!hasValidCategory) {
      summary.add(t('resource.import.editor.validationCategoryRequired'));
    }

    return {
      sourceNameError,
      identifierError,
      versionError,
      categoryErrors,
      apiErrors,
      summary: Array.from(summary),
      canSubmit: !sourceNameError && !identifierError && !versionError && hasValidCategory && apiErrors.every((errors) => !errors.nameError && !errors.categoriesError && !errors.urlError && !errors.mappingError && !errors.staticPayloadError),
    };
  }, [categoryIdSet, draft, t]);

  useEffect(() => {
    if (draft.categories.categories.length === 0) {
      if (selectedCategoryIndex !== 0) {
        setSelectedCategoryIndex(0);
      }
      return;
    }
    if (selectedCategoryIndex >= draft.categories.categories.length) {
      setSelectedCategoryIndex(draft.categories.categories.length - 1);
    }
  }, [draft.categories.categories.length, selectedCategoryIndex]);

  const selectedCategory = draft.categories.categories[selectedCategoryIndex] ?? null;
  const categoryTree = useMemo(() => {
    const tree = new Map<string, Map<string, WallpaperSourceCategoryDraft[]>>();
    draft.categories.categories.forEach((category) => {
      const level1 = category.category.trim() || '未设置一级分类';
      const level2 = category.subcategory.trim() || '未设置二级分类';
      const level2Map = tree.get(level1) ?? new Map<string, WallpaperSourceCategoryDraft[]>();
      const items = level2Map.get(level2) ?? [];
      items.push(category);
      level2Map.set(level2, items);
      tree.set(level1, level2Map);
    });
    return Array.from(tree.entries()).map(([level1, level2Map]) => ({
      level1,
      groups: Array.from(level2Map.entries()).map(([level2, items]) => ({ level2, items })),
    }));
  }, [draft.categories.categories]);

  const selectedCategoryIconHints = useMemo(() => {
    if (!selectedCategory) {
      return [] as Array<{ label: string; value: string; matched: boolean }>;
    }
    const candidates: Array<{ label: string; value: string; source: WallpaperSourceKeyValueDraft[] }> = [
      {
        label: t('resource.import.editor.levelIconCategory'),
        value: selectedCategory.category.trim(),
        source: draft.categories.level_icons.category,
      },
      {
        label: t('resource.import.editor.levelIconSubcategory'),
        value: selectedCategory.subcategory.trim(),
        source: draft.categories.level_icons.subcategory,
      },
      {
        label: t('resource.import.editor.levelIconSubsubcategory'),
        value: selectedCategory.subsubcategory.trim(),
        source: draft.categories.level_icons.subsubcategory,
      },
    ];
    return candidates
      .filter((item) => item.value)
      .map((item) => ({
        label: item.label,
        value: item.value,
        matched: item.source.some((row) => row.key.trim() === item.value && row.value.trim()),
      }));
  }, [draft.categories.level_icons, selectedCategory, t]);

  function updateSourceField<Key extends keyof CreatorDraft['source']>(key: Key, value: CreatorDraft['source'][Key]) {
    setDraft((current) => {
      const nextSource = { ...current.source, [key]: value };
      if (key === 'name' && !identifierTouched) {
        nextSource.identifier = `com.littletree.${slugifyIdentifier(String(value))}`;
      }
      return { ...current, source: nextSource };
    });
  }

  function updateConfigField<Key extends keyof CreatorDraft['config']['request']>(key: Key, value: CreatorDraft['config']['request'][Key]) {
    setDraft((current) => ({
      ...current,
      config: {
        request: {
          ...current.config.request,
          [key]: value,
        },
      },
    }));
  }

  function updateCategory(categoryIndex: number, key: keyof WallpaperSourceCategoryDraft, value: string) {
    setDraft((current) => ({
      ...current,
      categories: {
        ...current.categories,
        categories: current.categories.categories.map((category, index) => {
          if (index !== categoryIndex) {
            return category;
          }
          const next = { ...category, [key]: value };
          if (key === 'name' && !category.id.trim()) {
            next.id = slugifyCategoryId(value);
          }
          return next;
        }),
      },
    }));
  }

  function addCategory() {
    setSelectedCategoryIndex(draft.categories.categories.length);
    setDraft((current) => ({
      ...current,
      categories: {
        ...current.categories,
        categories: [...current.categories.categories, emptyCategoryRow()],
      },
    }));
  }

  function removeCategory(categoryIndex: number) {
    setDraft((current) => ({
      ...current,
      categories: {
        ...current.categories,
        categories: current.categories.categories.filter((_, index) => index !== categoryIndex),
      },
    }));
  }

  function updateCategoryGroup(groupIndex: number, key: keyof WallpaperSourceCategoryGroupDraft, value: string | string[]) {
    setDraft((current) => ({
      ...current,
      categories: {
        ...current.categories,
        category_groups: current.categories.category_groups.map((group, index) => (
          index === groupIndex ? { ...group, [key]: value } : group
        )),
      },
    }));
  }

  function addCategoryGroup() {
    setDraft((current) => ({
      ...current,
      categories: {
        ...current.categories,
        category_groups: [...current.categories.category_groups, emptyCategoryGroupRow()],
      },
    }));
  }

  function removeCategoryGroup(groupIndex: number) {
    setDraft((current) => ({
      ...current,
      categories: {
        ...current.categories,
        category_groups: current.categories.category_groups.filter((_, index) => index !== groupIndex),
      },
    }));
  }

  function updateApiField<Key extends keyof CreatorApiDraft>(apiIndex: number, key: Key, value: CreatorApiDraft[Key]) {
    setDraft((current) => ({
      ...current,
      apis: current.apis.map((api, index) => (
        index === apiIndex ? { ...api, [key]: value } : api
      )),
    }));
  }

  function addApi() {
    setDraft((current) => ({
      ...current,
      apis: [...current.apis, createDefaultApiDraft(current.apis.length)],
    }));
  }

  function removeApi(apiIndex: number) {
    setDraft((current) => ({
      ...current,
      apis: current.apis.filter((_, index) => index !== apiIndex),
    }));
  }

  function updateArrayRow<T extends object>(
    scope: 'configHeaders' | 'configVariables' | 'levelIcons' | 'apiHeaders' | 'apiItemMapping' | 'apiPostProcess' | 'apiParameters' | 'apiRules' | 'apiHttpCodes' | 'apiStaticDictItems',
    rowIndex: number,
    key: keyof T,
    value: T[keyof T],
    apiIndex?: number,
    level?: keyof CreatorDraft['categories']['level_icons'],
    collection?: 'field_patterns' | 'quality_rules',
  ) {
    setDraft((current) => {
      if (scope === 'configHeaders') {
        return {
          ...current,
          config: {
            request: {
              ...current.config.request,
              headers: current.config.request.headers.map((row, index) => (
                index === rowIndex ? { ...row, [key]: value } : row
              )),
            },
          },
        };
      }
      if (scope === 'configVariables') {
        return {
          ...current,
          config: {
            request: {
              ...current.config.request,
              variables: current.config.request.variables.map((row, index) => (
                index === rowIndex ? { ...row, [key]: value } : row
              )),
            },
          },
        };
      }
      if (scope === 'levelIcons' && level) {
        return {
          ...current,
          categories: {
            ...current.categories,
            level_icons: {
              ...current.categories.level_icons,
              [level]: current.categories.level_icons[level].map((row, index) => (
                index === rowIndex ? { ...row, [key]: value } : row
              )),
            },
          },
        };
      }
      return {
        ...current,
        apis: current.apis.map((api, index) => {
          if (index !== apiIndex) {
            return api;
          }
          if (scope === 'apiHeaders') {
            return {
              ...api,
              headers: api.headers.map((row, currentRow) => (
                currentRow === rowIndex ? { ...row, [key]: value } : row
              )),
            };
          }
          if (scope === 'apiItemMapping' || scope === 'apiPostProcess') {
            const target = scope === 'apiItemMapping' ? 'item_mapping' : 'post_process';
            return {
              ...api,
              [target]: api[target].map((row, currentRow) => (
                currentRow === rowIndex ? { ...row, [key]: value } : row
              )),
            };
          }
          if (scope === 'apiParameters') {
            return {
              ...api,
              parameters: api.parameters.map((row, currentRow) => (
                currentRow === rowIndex ? { ...row, [key]: value } : row
              )),
            };
          }
          if (scope === 'apiRules' && collection) {
            return {
              ...api,
              [collection]: api[collection].map((row, currentRow) => (
                currentRow === rowIndex ? { ...row, [key]: value } : row
              )),
            };
          }
          if (scope === 'apiHttpCodes') {
            return {
              ...api,
              http_codes: api.http_codes.map((row, currentRow) => (
                currentRow === rowIndex ? { ...row, [key]: value } : row
              )),
            };
          }
          if (scope === 'apiStaticDictItems') {
            return {
              ...api,
              static_dict_items: api.static_dict_items.map((row, currentRow) => (
                currentRow === rowIndex ? { ...row, [key]: value } : row
              )),
            };
          }
          return api;
        }),
      };
    });
  }

  function addArrayRow(
    scope: 'configHeaders' | 'configVariables' | 'levelIcons' | 'apiHeaders' | 'apiItemMapping' | 'apiPostProcess' | 'apiParameters' | 'apiRules' | 'apiHttpCodes' | 'apiStaticDictItems',
    apiIndex?: number,
    level?: keyof CreatorDraft['categories']['level_icons'],
    collection?: 'field_patterns' | 'quality_rules',
  ) {
    setDraft((current) => {
      if (scope === 'configHeaders') {
        return {
          ...current,
          config: {
            request: {
              ...current.config.request,
              headers: [...current.config.request.headers, emptyKeyValueRow()],
            },
          },
        };
      }
      if (scope === 'configVariables') {
        return {
          ...current,
          config: {
            request: {
              ...current.config.request,
              variables: [...current.config.request.variables, emptyKeyValueRow()],
            },
          },
        };
      }
      if (scope === 'levelIcons' && level) {
        return {
          ...current,
          categories: {
            ...current.categories,
            level_icons: {
              ...current.categories.level_icons,
              [level]: [...current.categories.level_icons[level], emptyKeyValueRow()],
            },
          },
        };
      }
      return {
        ...current,
        apis: current.apis.map((api, index) => {
          if (index !== apiIndex) {
            return api;
          }
          if (scope === 'apiHeaders') {
            return { ...api, headers: [...api.headers, emptyKeyValueRow()] };
          }
          if (scope === 'apiItemMapping') {
            return { ...api, item_mapping: [...api.item_mapping, emptyKeyValueRow()] };
          }
          if (scope === 'apiPostProcess') {
            return { ...api, post_process: [...api.post_process, emptyKeyValueRow()] };
          }
          if (scope === 'apiParameters') {
            return { ...api, parameters: [...api.parameters, emptyParameterRow()] };
          }
          if (scope === 'apiRules' && collection) {
            return { ...api, [collection]: [...api[collection], emptyRuleRow()] };
          }
          if (scope === 'apiHttpCodes') {
            return { ...api, http_codes: [...api.http_codes, emptyHttpCodeRow()] };
          }
          if (scope === 'apiStaticDictItems') {
            return { ...api, static_dict_items: [...api.static_dict_items, emptyStaticDictItem()] };
          }
          return api;
        }),
      };
    });
  }

  function removeArrayRow(
    scope: 'configHeaders' | 'configVariables' | 'levelIcons' | 'apiHeaders' | 'apiItemMapping' | 'apiPostProcess' | 'apiParameters' | 'apiRules' | 'apiHttpCodes' | 'apiStaticDictItems',
    rowIndex: number,
    apiIndex?: number,
    level?: keyof CreatorDraft['categories']['level_icons'],
    collection?: 'field_patterns' | 'quality_rules',
  ) {
    setDraft((current) => {
      if (scope === 'configHeaders') {
        const nextRows = current.config.request.headers.filter((_, index) => index !== rowIndex);
        return {
          ...current,
          config: {
            request: {
              ...current.config.request,
              headers: nextRows.length > 0 ? nextRows : [emptyKeyValueRow()],
            },
          },
        };
      }
      if (scope === 'configVariables') {
        const nextRows = current.config.request.variables.filter((_, index) => index !== rowIndex);
        return {
          ...current,
          config: {
            request: {
              ...current.config.request,
              variables: nextRows.length > 0 ? nextRows : [emptyKeyValueRow()],
            },
          },
        };
      }
      if (scope === 'levelIcons' && level) {
        return {
          ...current,
          categories: {
            ...current.categories,
            level_icons: {
              ...current.categories.level_icons,
              [level]: current.categories.level_icons[level].filter((_, index) => index !== rowIndex),
            },
          },
        };
      }
      return {
        ...current,
        apis: current.apis.map((api, index) => {
          if (index !== apiIndex) {
            return api;
          }
          if (scope === 'apiHeaders') {
            const nextRows = api.headers.filter((_, currentRow) => currentRow !== rowIndex);
            return { ...api, headers: nextRows.length > 0 ? nextRows : [emptyKeyValueRow()] };
          }
          if (scope === 'apiItemMapping') {
            return { ...api, item_mapping: api.item_mapping.filter((_, currentRow) => currentRow !== rowIndex) };
          }
          if (scope === 'apiPostProcess') {
            return { ...api, post_process: api.post_process.filter((_, currentRow) => currentRow !== rowIndex) };
          }
          if (scope === 'apiParameters') {
            return { ...api, parameters: api.parameters.filter((_, currentRow) => currentRow !== rowIndex) };
          }
          if (scope === 'apiRules' && collection) {
            return { ...api, [collection]: api[collection].filter((_, currentRow) => currentRow !== rowIndex) };
          }
          if (scope === 'apiHttpCodes') {
            return { ...api, http_codes: api.http_codes.filter((_, currentRow) => currentRow !== rowIndex) };
          }
          if (scope === 'apiStaticDictItems') {
            const nextRows = api.static_dict_items.filter((_, currentRow) => currentRow !== rowIndex);
            return { ...api, static_dict_items: nextRows.length > 0 ? nextRows : [emptyStaticDictItem()] };
          }
          return api;
        }),
      };
    });
  }

  function toNumberOrNull(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }

  const protocolErrors = useMemo<Record<CreatorProtocolMode, string[]>>(() => {
    const openApiServers = parseTextList(openApiServersText);
    const sharedErrors = {
      ltws: [] as string[],
      apicore_v1: [] as string[],
      apicore_v2: [] as string[],
      openapi_3_2: [] as string[],
    };
    if (draft.apis.length === 0) {
      sharedErrors.apicore_v1.push(t('resource.import.editor.protocolApiRequired'));
      sharedErrors.apicore_v2.push(t('resource.import.editor.protocolApiRequired'));
      sharedErrors.openapi_3_2.push(t('resource.import.editor.protocolApiRequired'));
    }
    if (draft.apis.some((api) => ['static_list', 'static_dict'].includes(api.response_format))) {
      sharedErrors.apicore_v1.push(t('resource.import.editor.protocolStaticNotSupported'));
      sharedErrors.apicore_v2.push(t('resource.import.editor.protocolStaticNotSupported'));
      sharedErrors.openapi_3_2.push(t('resource.import.editor.protocolStaticNotSupported'));
    }
    if (openApiServers.some((server) => !/^https?:\/\//i.test(server))) {
      sharedErrors.openapi_3_2.push(t('resource.import.editor.protocolOpenapiServerInvalid'));
    }
    return sharedErrors;
  }, [draft.apis, openApiServersText, t]);

  const selectedProtocolApi = useMemo(
    () => draft.apis.find((api) => api.id === selectedProtocolApiId) ?? draft.apis[0] ?? null,
    [draft.apis, selectedProtocolApiId],
  );
  const selectedProtocolApiIndex = useMemo(
    () => draft.apis.findIndex((api) => api.id === selectedProtocolApiId),
    [draft.apis, selectedProtocolApiId],
  );

  const openApiOperationPreview = useMemo(
    () => draft.apis.map((api) => {
      const rawUrl = api.url.trim();
      let path = rawUrl || '/';
      try {
        const parsed = rawUrl ? new URL(rawUrl) : null;
        path = parsed ? (parsed.pathname || '/') : path;
      } catch {
        const withoutQuery = rawUrl.split('?')[0]?.trim();
        path = withoutQuery || '/';
      }
      return {
        id: api.id,
        name: api.name.trim(),
        method: api.method,
        path,
      };
    }),
    [draft.apis],
  );
  const openApiServerPreview = useMemo(() => parseTextList(openApiServersText), [openApiServersText]);

  const protocolProfiles = useMemo<Record<CreatorProtocolMode, {
    title: string;
    output: string;
    structure: string;
    preservation: string;
    chips: string[];
  }>>(() => ({
    ltws: {
      title: t('resource.import.editor.protocolProfileLtwsTitle'),
      output: t('resource.import.editor.protocolProfileLtwsOutput'),
      structure: t('resource.import.editor.protocolProfileLtwsStructure'),
      preservation: t('resource.import.editor.protocolProfileLtwsPreservation'),
      chips: [
        t('resource.import.editor.protocolChipInstallable'),
        t('resource.import.editor.protocolChipFullDraft'),
      ],
    },
    apicore_v1: {
      title: t('resource.import.editor.protocolProfileApicoreV1Title'),
      output: t('resource.import.editor.protocolProfileApicoreV1Output'),
      structure: t('resource.import.editor.protocolProfileApicoreV1Structure'),
      preservation: t('resource.import.editor.protocolProfileApicoreV1Preservation'),
      chips: [
        t('resource.import.editor.protocolChipExportOnly'),
        t('resource.import.editor.protocolChipSingleApi'),
        t('resource.import.editor.protocolChipJsonOnly'),
      ],
    },
    apicore_v2: {
      title: t('resource.import.editor.protocolProfileApicoreV2Title'),
      output: t('resource.import.editor.protocolProfileApicoreV2Output'),
      structure: t('resource.import.editor.protocolProfileApicoreV2Structure'),
      preservation: t('resource.import.editor.protocolProfileApicoreV2Preservation'),
      chips: [
        t('resource.import.editor.protocolChipExportOnly'),
        t('resource.import.editor.protocolChipSingleApi'),
        t('resource.import.editor.protocolChipConfigs'),
      ],
    },
    openapi_3_2: {
      title: t('resource.import.editor.protocolProfileOpenapiTitle'),
      output: t('resource.import.editor.protocolProfileOpenapiOutput'),
      structure: t('resource.import.editor.protocolProfileOpenapiStructure'),
      preservation: t('resource.import.editor.protocolProfileOpenapiPreservation'),
      chips: [
        t('resource.import.editor.protocolChipExportOnly'),
        t('resource.import.editor.protocolChipMultiApi'),
        t('resource.import.editor.protocolChipVendorExtensions'),
      ],
    },
  }), [t]);

  function buildPayload(): WallpaperSourceCreatorPayload {
    return {
      source: {
        identifier: draft.source.identifier.trim(),
        name: draft.source.name.trim(),
        version: draft.source.version.trim(),
        description: draft.source.description.trim(),
        details: draft.source.details.trim(),
        logo: draft.source.logo.trim(),
        footer_text: draft.source.footer_text.trim(),
        merge: {
          enabled: draft.source.merge_enabled,
          strategy: draft.source.merge_strategy,
          priority: draft.source.merge_priority,
          metadata_source: draft.source.merge_metadata_source,
          allow_metadata_override: draft.source.merge_allow_override,
        },
      },
      config: {
        request: {
          global_interval_seconds: draft.config.request.global_interval_seconds,
          timeout_seconds: draft.config.request.timeout_seconds,
          max_concurrent: draft.config.request.max_concurrent,
          skip_ssl_verify: draft.config.request.skip_ssl_verify,
          user_agent: draft.config.request.user_agent.trim(),
          headers: draft.config.request.headers.filter((row) => row.key.trim() && row.value.trim()),
          retry: {
            max_attempts: draft.config.request.retry_max_attempts,
            backoff_base: draft.config.request.retry_backoff_base,
            initial_delay_ms: draft.config.request.retry_initial_delay_ms,
          },
          cache: {
            enabled: draft.config.request.cache_enabled,
            default_ttl_seconds: draft.config.request.cache_default_ttl_seconds,
            max_memory_mb: draft.config.request.cache_max_memory_mb,
          },
          variables: draft.config.request.variables.filter((row) => row.key.trim() && row.value.trim()),
        },
      },
      categories: {
        template: {
          icon: draft.categories.template_icon.trim(),
          category: draft.categories.template_category.trim(),
        },
        categories: draft.categories.categories
          .filter((item) => item.id.trim() && item.name.trim())
          .map((item) => ({
            id: item.id.trim(),
            name: item.name.trim(),
            category: item.category.trim(),
            subcategory: item.subcategory.trim(),
            subsubcategory: item.subsubcategory.trim(),
            icon: item.icon.trim(),
            description: item.description.trim(),
          })),
        category_groups: draft.categories.category_groups
          .filter((group) => group.name.trim() && group.category_ids.length > 0)
          .map((group) => ({ name: group.name.trim(), category_ids: group.category_ids })),
        level_icons: {
          category: draft.categories.level_icons.category.filter((row) => row.key.trim() && row.value.trim()),
          subcategory: draft.categories.level_icons.subcategory.filter((row) => row.key.trim() && row.value.trim()),
          subsubcategory: draft.categories.level_icons.subsubcategory.filter((row) => row.key.trim() && row.value.trim()),
        },
      },
      apis: draft.apis.map((api) => ({
        name: api.name.trim(),
        description: api.description.trim(),
        logo: api.logo.trim(),
        categories: parseTextList(api.categoriesText),
        parameters: api.parameters
          .filter((parameter) => parameter.key.trim())
          .map((parameter) => ({
            key: parameter.key.trim(),
            label: parameter.label.trim(),
            type: parameter.type,
            default: parameter.default,
            choices: parseTextList(parameter.choices),
            hidden: parameter.hidden,
            description: parameter.description.trim(),
            placeholder: parameter.placeholder.trim(),
            min_length: toNumberOrNull(parameter.min_length),
            max_length: toNumberOrNull(parameter.max_length),
          })),
        request: {
          url: api.url.trim(),
          method: api.method,
          timeout_seconds: api.timeout_seconds,
          interval_seconds: api.interval_seconds,
          body: api.body.trim(),
          body_type: api.body_type,
          headers: api.headers.filter((row) => row.key.trim() && row.value.trim()),
        },
        response: {
          format: api.response_format,
          type: api.response_type,
        },
        mapping: {
          items: api.items_path.trim(),
          item_mapping: api.item_mapping.filter((row) => row.key.trim() && row.value.trim()),
        },
        post_process: api.post_process.filter((row) => row.key.trim() && row.value.trim()),
        validation: {
          required_fields: parseTextList(api.required_fields_text),
          field_patterns: api.field_patterns.filter((rule) => rule.path.trim()),
          quality_rules: api.quality_rules.filter((rule) => rule.path.trim()),
        },
        error_handling: {
          http_codes: api.http_codes.filter((row) => row.code.trim()),
          on_empty_response: api.on_empty_response,
          on_mapping_failed: api.on_mapping_failed,
          fallback_to: api.fallback_to.trim(),
        },
        cache: {
          enabled: api.cache_enabled,
          ttl_seconds: api.cache_ttl_seconds,
          key_template: api.cache_key_template.trim(),
        },
        static_list_urls: parseTextList(api.static_list_text),
        static_dict_items: api.static_dict_items
          .filter((item) => item.image.trim())
          .map((item) => ({
            image: item.image.trim(),
            title: item.title.trim(),
            preview: item.preview.trim(),
            description: item.description.trim(),
            width: item.width.trim(),
            height: item.height.trim(),
          })),
      })),
    };
  }

  async function handlePrimaryAction() {
    const payload = buildPayload();
    if (protocolMode === 'ltws') {
      await onSubmit(payload);
      return;
    }
    const exportOptions: WallpaperSourceExportOptions | undefined = protocolMode === 'openapi_3_2'
      ? {
        openapi: {
          servers: parseTextList(openApiServersText),
          tags_by_api: Object.fromEntries(
            draft.apis
              .map((api) => [api.name.trim(), parseTextList(openApiTagsTextByApiId[api.id] ?? '')] as const)
              .filter(([apiName, tags]) => apiName && tags.length > 0),
          ),
        },
      }
      : undefined;
    const exportPayload = protocolMode === 'apicore_v1' || protocolMode === 'apicore_v2'
      ? {
        ...payload,
        apis: selectedProtocolApi
          ? payload.apis.filter((api) => api.name === selectedProtocolApi.name)
          : payload.apis,
      }
      : payload;
    await onExport(exportPayload, protocolMode, exportOptions);
  }

  const canSubmit = validationState.canSubmit;
  const canRunPrimaryAction = protocolMode === 'ltws'
    ? canSubmit
    : canSubmit && protocolErrors[protocolMode].length === 0;

  function categoryPathLabel(category: WallpaperSourceCategoryDraft): string {
    return [category.category, category.subcategory, category.subsubcategory]
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join(' / ');
  }

  function renderSummaryMetric(label: string, value: string) {
    return (
      <Stack spacing={0.35} sx={{ minWidth: 92 }}>
        <Typography variant="caption" sx={{ color: alpha(theme.palette.common.white, 0.76), letterSpacing: 0.2 }}>
          {label}
        </Typography>
        <Typography variant="h6" sx={{ color: theme.palette.common.white, lineHeight: 1.1 }}>
          {value}
        </Typography>
      </Stack>
    );
  }

  function renderKeyValueEditor(
    rows: WallpaperSourceKeyValueDraft[],
    onChange: (rowIndex: number, key: keyof WallpaperSourceKeyValueDraft, value: string) => void,
    onAdd: () => void,
    onRemove: (rowIndex: number) => void,
    keyLabel: string,
    valueLabel: string,
    helperText?: string,
  ) {
    return (
      <Stack spacing={1.5}>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('resource.import.editor.emptyRows')}
          </Typography>
        ) : rows.map((row, index) => (
          <Grid container spacing={1.5} key={`${keyLabel}-${index}`} alignItems="center">
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField label={keyLabel} value={row.key} onChange={(event) => onChange(index, 'key', event.target.value)} fullWidth />
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <TextField label={valueLabel} value={row.value} onChange={(event) => onChange(index, 'value', event.target.value)} fullWidth helperText={helperText} />
            </Grid>
            <Grid size={{ xs: 12, md: 1 }}>
              <Button color="inherit" onClick={() => onRemove(index)} startIcon={<DeleteOutlineRoundedIcon />}>
                {t('resource.import.editor.removeRow')}
              </Button>
            </Grid>
          </Grid>
        ))}
        <Box>
          <Button size="small" startIcon={<AddRoundedIcon />} onClick={onAdd}>{t('resource.import.editor.addRow')}</Button>
        </Box>
      </Stack>
    );
  }

  function renderRuleEditor(
    rows: WallpaperSourceRuleDraft[],
    onChange: (rowIndex: number, key: keyof WallpaperSourceRuleDraft, value: string) => void,
    onAdd: () => void,
    onRemove: (rowIndex: number) => void,
  ) {
    return (
      <Stack spacing={1.5}>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{t('resource.import.editor.emptyRules')}</Typography>
        ) : rows.map((row, index) => (
          <Card key={`rule-${index}`} variant="outlined">
            <CardContent>
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField label={t('resource.import.editor.rulePath')} value={row.path} onChange={(event) => onChange(index, 'path', event.target.value)} fullWidth />
                </Grid>
                <Grid size={{ xs: 12, md: 8 }}>
                  <TextField label={t('resource.import.editor.ruleRegex')} value={row.regex} onChange={(event) => onChange(index, 'regex', event.target.value)} fullWidth />
                </Grid>
                <Grid size={{ xs: 12, md: 3 }}>
                  <TextField label={t('resource.import.editor.ruleMinLength')} value={row.min_length} onChange={(event) => onChange(index, 'min_length', event.target.value)} fullWidth />
                </Grid>
                <Grid size={{ xs: 12, md: 3 }}>
                  <TextField label={t('resource.import.editor.ruleMaxLength')} value={row.max_length} onChange={(event) => onChange(index, 'max_length', event.target.value)} fullWidth />
                </Grid>
                <Grid size={{ xs: 12, md: 3 }}>
                  <TextField label={t('resource.import.editor.ruleMin')} value={row.min} onChange={(event) => onChange(index, 'min', event.target.value)} fullWidth />
                </Grid>
                <Grid size={{ xs: 12, md: 3 }}>
                  <TextField label={t('resource.import.editor.ruleMax')} value={row.max} onChange={(event) => onChange(index, 'max', event.target.value)} fullWidth />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Button color="inherit" onClick={() => onRemove(index)} startIcon={<DeleteOutlineRoundedIcon />}>
                    {t('resource.import.editor.removeRow')}
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        ))}
        <Box>
          <Button size="small" startIcon={<AddRoundedIcon />} onClick={onAdd}>{t('resource.import.editor.addRule')}</Button>
        </Box>
      </Stack>
    );
  }

  function renderHttpCodeEditor(
    rows: WallpaperSourceHttpCodeDraft[],
    onChange: (rowIndex: number, key: keyof WallpaperSourceHttpCodeDraft, value: string | boolean) => void,
    onAdd: () => void,
    onRemove: (rowIndex: number) => void,
  ) {
    return (
      <Stack spacing={1.5}>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{t('resource.import.editor.emptyHttpCodes')}</Typography>
        ) : rows.map((row, index) => (
          <Card key={`http-${index}`} variant="outlined">
            <CardContent>
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, md: 3 }}>
                  <TextField label={t('resource.import.editor.httpCode')} value={row.code} onChange={(event) => onChange(index, 'code', event.target.value)} fullWidth />
                </Grid>
                <Grid size={{ xs: 12, md: 5 }}>
                  <TextField label={t('resource.import.editor.httpMessage')} value={row.message} onChange={(event) => onChange(index, 'message', event.target.value)} fullWidth />
                </Grid>
                <Grid size={{ xs: 12, md: 2 }}>
                  <TextField label={t('resource.import.editor.httpRetryAfter')} value={row.retry_after} onChange={(event) => onChange(index, 'retry_after', event.target.value)} fullWidth />
                </Grid>
                <Grid size={{ xs: 12, md: 2 }}>
                  <FormControlLabel control={<Checkbox checked={row.fallback} onChange={(event) => onChange(index, 'fallback', event.target.checked)} />} label={t('resource.import.editor.httpFallback')} />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Button color="inherit" onClick={() => onRemove(index)} startIcon={<DeleteOutlineRoundedIcon />}>
                    {t('resource.import.editor.removeRow')}
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        ))}
        <Box>
          <Button size="small" startIcon={<AddRoundedIcon />} onClick={onAdd}>{t('resource.import.editor.addHttpCode')}</Button>
        </Box>
      </Stack>
    );
  }

  return (
    <Dialog open={open} onClose={working ? undefined : onClose} fullWidth maxWidth="lg" fullScreen={fullScreen}>
      <DialogTitle>{t('resource.import.editor.title')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Card
            sx={{
              overflow: 'hidden',
              border: 'none',
              background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 48%, ${theme.palette.secondary.main} 100%)`,
            }}
          >
            <CardContent sx={{ p: 3 }}>
              <Stack spacing={2.5}>
                <Box>
                  <Typography variant="overline" sx={{ color: alpha(theme.palette.common.white, 0.8), letterSpacing: 1.2 }}>
                    {t('resource.import.editor.protocolEyebrow')}
                  </Typography>
                  <Tabs
                    value={protocolMode}
                    onChange={(_, value: CreatorProtocolMode) => setProtocolMode(value)}
                    variant={fullScreen ? 'scrollable' : 'standard'}
                    textColor="inherit"
                    indicatorColor="secondary"
                    sx={{ mt: 1, '& .MuiTab-root': { color: 'rgba(255,255,255,0.86)' } }}
                  >
                    <Tab value="ltws" label={t('resource.import.editor.protocolLtws')} />
                    <Tab value="apicore_v1" label={t('resource.import.editor.protocolApicoreV1')} />
                    <Tab value="apicore_v2" label={t('resource.import.editor.protocolApicoreV2')} />
                    <Tab value="openapi_3_2" label={t('resource.import.editor.protocolOpenapi')} />
                  </Tabs>
                </Box>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between">
                  <Box>
                    <Typography variant="overline" sx={{ color: alpha(theme.palette.common.white, 0.8), letterSpacing: 1.2 }}>
                      {t('resource.import.editor.overviewEyebrow')}
                    </Typography>
                    <Typography variant="h5" sx={{ color: theme.palette.common.white, mb: 0.75 }}>
                      {draft.source.name.trim() || t('resource.import.editor.overviewUntitled')}
                    </Typography>
                    <Typography variant="body2" sx={{ color: alpha(theme.palette.common.white, 0.82), maxWidth: 720 }}>
                      {draft.source.description.trim() || t('resource.import.editor.subtitle')}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ maxWidth: { md: 360 } }}>
                    <Chip label={draft.source.identifier.trim() || 'com.littletree.custom_source'} sx={{ bgcolor: alpha(theme.palette.common.white, 0.16), color: theme.palette.common.white }} />
                    <Chip label={`v${draft.source.version.trim() || '1.0.0'}`} sx={{ bgcolor: alpha(theme.palette.common.white, 0.16), color: theme.palette.common.white }} />
                    <Chip label={draft.source.merge_enabled ? t('resource.import.editor.mergeEnabled') : t('resource.import.editor.mergeDisabled')} sx={{ bgcolor: alpha(theme.palette.common.white, 0.16), color: theme.palette.common.white }} />
                  </Stack>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
                  {renderSummaryMetric(t('resource.import.editor.overviewCategoryCount'), String(draft.categories.categories.length))}
                  {renderSummaryMetric(t('resource.import.editor.overviewApiCount'), String(draft.apis.length))}
                  {renderSummaryMetric(t('resource.import.editor.overviewVariableCount'), String(draft.config.request.variables.filter((row) => row.key.trim()).length))}
                  {renderSummaryMetric(t('resource.import.editor.overviewGroupCount'), String(draft.categories.category_groups.length))}
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent sx={{ pb: 1.5 }}>
              <Tabs
                value={activeTab}
                onChange={(_, value: number) => setActiveTab(value)}
                variant={fullScreen ? 'fullWidth' : 'standard'}
                sx={{ mb: 1.5 }}
              >
                <Tab icon={<Inventory2RoundedIcon />} iconPosition="start" label={t('resource.import.editor.stageSource')} />
                <Tab icon={<RouteRoundedIcon />} iconPosition="start" label={t('resource.import.editor.stageCategories')} />
                <Tab icon={<ApiRoundedIcon />} iconPosition="start" label={t('resource.import.editor.stageApis')} />
              </Tabs>

              {validationState.summary.length > 0 && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle2">{t('resource.import.editor.validationSummaryTitle')}</Typography>
                    {validationState.summary.map((message) => (
                      <Typography key={message} variant="body2">{message}</Typography>
                    ))}
                  </Stack>
                </Alert>
              )}

              <Alert severity={protocolMode === 'ltws' ? 'info' : 'warning'} sx={{ mb: 2 }}>
                {protocolMode === 'ltws'
                  ? t('resource.import.editor.protocolLtwsHelper')
                  : t('resource.import.editor.protocolExternalHelper')}
              </Alert>

              <Card variant="outlined" sx={{ mb: 2, bgcolor: alpha(theme.palette.primary.main, 0.03) }}>
                <CardContent>
                  <Stack spacing={1.5}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between">
                      <Box>
                        <Typography variant="h6">{protocolProfiles[protocolMode].title}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {protocolMode === 'ltws'
                            ? t('resource.import.editor.protocolLtwsHelper')
                            : t('resource.import.editor.protocolExternalHelper')}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" justifyContent={{ md: 'flex-end' }}>
                        {protocolProfiles[protocolMode].chips.map((chip) => (
                          <Chip key={chip} size="small" variant="outlined" label={chip} />
                        ))}
                      </Stack>
                    </Stack>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, md: 4 }}>
                        <Typography variant="subtitle2">{t('resource.import.editor.protocolProfileOutputLabel')}</Typography>
                        <Typography variant="body2" color="text.secondary">{protocolProfiles[protocolMode].output}</Typography>
                      </Grid>
                      <Grid size={{ xs: 12, md: 4 }}>
                        <Typography variant="subtitle2">{t('resource.import.editor.protocolProfileStructureLabel')}</Typography>
                        <Typography variant="body2" color="text.secondary">{protocolProfiles[protocolMode].structure}</Typography>
                      </Grid>
                      <Grid size={{ xs: 12, md: 4 }}>
                        <Typography variant="subtitle2">{t('resource.import.editor.protocolProfilePreservationLabel')}</Typography>
                        <Typography variant="body2" color="text.secondary">{protocolProfiles[protocolMode].preservation}</Typography>
                      </Grid>
                    </Grid>
                  </Stack>
                </CardContent>
              </Card>

              {(protocolMode === 'apicore_v1' || protocolMode === 'apicore_v2') && selectedProtocolApi && (
                <Card variant="outlined" sx={{ mb: 2 }}>
                  <CardContent>
                    <Stack spacing={2}>
                      <Box>
                        <Typography variant="h6">{t('resource.import.editor.protocolApiSelectorTitle')}</Typography>
                        <Typography variant="body2" color="text.secondary">{t('resource.import.editor.protocolApiSelectorHint')}</Typography>
                      </Box>
                      <TextField
                        select
                        label={t('resource.import.editor.protocolApiSelectorLabel')}
                        value={selectedProtocolApi.id}
                        onChange={(event) => setSelectedProtocolApiId(event.target.value)}
                        fullWidth
                      >
                        {draft.apis.map((api) => (
                          <MenuItem key={api.id} value={api.id}>{api.name.trim() || t('resource.import.editor.apiCardTitle', { index: draft.apis.indexOf(api) + 1 })}</MenuItem>
                        ))}
                      </TextField>
                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12, md: 4 }}>
                          <Typography variant="subtitle2">{t('resource.import.editor.protocolApiRequestLabel')}</Typography>
                          <Typography variant="body2" color="text.secondary">{selectedProtocolApi.method} {selectedProtocolApi.url.trim() || t('resource.import.editor.protocolApiEmptyValue')}</Typography>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                          <Typography variant="subtitle2">{t('resource.import.editor.protocolApiResponseLabel')}</Typography>
                          <Typography variant="body2" color="text.secondary">{selectedProtocolApi.response_format} / {selectedProtocolApi.response_type}</Typography>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                          <Typography variant="subtitle2">{t('resource.import.editor.protocolApiCategoriesLabel')}</Typography>
                          <Typography variant="body2" color="text.secondary">{selectedProtocolApi.categoriesText.trim() || t('resource.import.editor.protocolApiEmptyValue')}</Typography>
                        </Grid>
                      </Grid>
                    </Stack>
                  </CardContent>
                </Card>
              )}

              {protocolMode === 'openapi_3_2' && openApiOperationPreview.length > 0 && (
                <Card variant="outlined" sx={{ mb: 2 }}>
                  <CardContent>
                    <Stack spacing={2}>
                      <Box>
                        <Typography variant="h6">{t('resource.import.editor.protocolOpenapiPreviewTitle')}</Typography>
                        <Typography variant="body2" color="text.secondary">{t('resource.import.editor.protocolOpenapiPreviewHint')}</Typography>
                      </Box>
                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12, md: 4 }}>
                          <Typography variant="subtitle2">{t('resource.import.editor.protocolOpenapiOperationCount')}</Typography>
                          <Typography variant="body2" color="text.secondary">{openApiOperationPreview.length}</Typography>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                          <Typography variant="subtitle2">{t('resource.import.editor.protocolOpenapiPathCount')}</Typography>
                          <Typography variant="body2" color="text.secondary">{new Set(openApiOperationPreview.map((item) => item.path)).size}</Typography>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                          <Typography variant="subtitle2">{t('resource.import.editor.protocolOpenapiExtensionLabel')}</Typography>
                          <Typography variant="body2" color="text.secondary">{t('resource.import.editor.protocolOpenapiExtensionValue')}</Typography>
                        </Grid>
                      </Grid>
                      <Stack spacing={1}>
                        {openApiOperationPreview.map((item) => (
                          <Stack key={item.id} direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
                            <Chip size="small" color="primary" label={item.method} sx={{ width: { md: 88 } }} />
                            <Typography variant="body2" sx={{ flex: 1 }}>{item.path}</Typography>
                            <Typography variant="body2" color="text.secondary">{item.name || t('resource.import.editor.protocolApiEmptyValue')}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              )}

              {protocolMode !== 'ltws' && protocolErrors[protocolMode].length > 0 && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle2">{t('resource.import.editor.protocolValidationTitle')}</Typography>
                    {protocolErrors[protocolMode].map((message) => (
                      <Typography key={message} variant="body2">{message}</Typography>
                    ))}
                  </Stack>
                </Alert>
              )}

              {activeTab === 0 && (
                <Stack spacing={2.5}>
                  <Alert severity="info" icon={<AutoAwesomeRoundedIcon fontSize="inherit" />}>
                    {t('resource.import.editor.overviewHelper')}
                  </Alert>

                  {(protocolMode === 'apicore_v1' || protocolMode === 'apicore_v2') && selectedProtocolApi && selectedProtocolApiIndex >= 0 && (
                    <Card variant="outlined" sx={{ bgcolor: alpha(theme.palette.secondary.main, 0.04) }}>
                      <CardContent>
                        <Stack spacing={2}>
                          <Box>
                            <Typography variant="h6">{t('resource.import.editor.protocolApicoreEditorTitle')}</Typography>
                            <Typography variant="body2" color="text.secondary">{t('resource.import.editor.protocolApicoreEditorHint')}</Typography>
                          </Box>
                          <Grid container spacing={2}>
                            <Grid size={{ xs: 12, md: 6 }}>
                              <TextField
                                label={t('resource.import.editor.protocolApicoreFriendlyName')}
                                value={draft.source.name}
                                onChange={(event) => updateSourceField('name', event.target.value)}
                                fullWidth
                              />
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                              <TextField
                                label={t('resource.import.editor.protocolApicoreIcon')}
                                value={draft.source.logo}
                                onChange={(event) => updateSourceField('logo', event.target.value)}
                                fullWidth
                              />
                            </Grid>
                            <Grid size={{ xs: 12, md: 8 }}>
                              <TextField
                                label={t('resource.import.editor.protocolApicoreIntro')}
                                value={draft.source.description}
                                onChange={(event) => updateSourceField('description', event.target.value)}
                                fullWidth
                                multiline
                                minRows={3}
                              />
                            </Grid>
                            <Grid size={{ xs: 12, md: 4 }}>
                              <TextField
                                label={t('resource.import.editor.protocolApicoreExportApiName')}
                                value={selectedProtocolApi.name}
                                onChange={(event) => updateApiField(selectedProtocolApiIndex, 'name', event.target.value)}
                                fullWidth
                              />
                            </Grid>
                            <Grid size={{ xs: 12, md: 8 }}>
                              <TextField
                                label={t('resource.import.editor.protocolApicoreLink')}
                                value={selectedProtocolApi.url}
                                onChange={(event) => updateApiField(selectedProtocolApiIndex, 'url', event.target.value)}
                                fullWidth
                              />
                            </Grid>
                            <Grid size={{ xs: 12, md: 4 }}>
                              <TextField
                                select
                                label={t('resource.import.editor.protocolApicoreFunc')}
                                value={selectedProtocolApi.method}
                                onChange={(event) => updateApiField(selectedProtocolApiIndex, 'method', event.target.value)}
                                fullWidth
                              >
                                {REQUEST_METHODS.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                              </TextField>
                            </Grid>
                          </Grid>
                          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                            <Chip size="small" label={t('resource.import.editor.protocolApicoreSelectedResponse', { format: selectedProtocolApi.response_format })} />
                            <Chip size="small" variant="outlined" label={t('resource.import.editor.protocolApicoreSelectedParameters', { count: selectedProtocolApi.parameters.filter((parameter) => parameter.key.trim()).length })} />
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>
                  )}

                  {protocolMode === 'openapi_3_2' && (
                    <Card variant="outlined" sx={{ bgcolor: alpha(theme.palette.info.main, 0.04) }}>
                      <CardContent>
                        <Stack spacing={2}>
                          <Box>
                            <Typography variant="h6">{t('resource.import.editor.protocolOpenapiEditorTitle')}</Typography>
                            <Typography variant="body2" color="text.secondary">{t('resource.import.editor.protocolOpenapiEditorHint')}</Typography>
                          </Box>
                          <Grid container spacing={2}>
                            <Grid size={{ xs: 12, md: 6 }}>
                              <TextField
                                label={t('resource.import.editor.protocolOpenapiTitleField')}
                                value={draft.source.name}
                                onChange={(event) => updateSourceField('name', event.target.value)}
                                fullWidth
                              />
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                              <TextField
                                label={t('resource.import.editor.protocolOpenapiVersionField')}
                                value={draft.source.version}
                                onChange={(event) => updateSourceField('version', event.target.value)}
                                fullWidth
                              />
                            </Grid>
                            <Grid size={{ xs: 12 }}>
                              <TextField
                                label={t('resource.import.editor.protocolOpenapiDescriptionField')}
                                value={draft.source.description}
                                onChange={(event) => updateSourceField('description', event.target.value)}
                                fullWidth
                                multiline
                                minRows={3}
                              />
                            </Grid>
                            <Grid size={{ xs: 12 }}>
                              <TextField
                                label={t('resource.import.editor.protocolOpenapiServerField')}
                                value={openApiServersText}
                                onChange={(event) => setOpenApiServersText(event.target.value)}
                                fullWidth
                                multiline
                                minRows={3}
                                helperText={protocolErrors.openapi_3_2.includes(t('resource.import.editor.protocolOpenapiServerInvalid'))
                                  ? t('resource.import.editor.protocolOpenapiServerInvalid')
                                  : t('resource.import.editor.protocolOpenapiServerHint')}
                                error={protocolErrors.openapi_3_2.includes(t('resource.import.editor.protocolOpenapiServerInvalid'))}
                              />
                            </Grid>
                          </Grid>
                          <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('resource.import.editor.protocolOpenapiServersLabel')}</Typography>
                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                              {openApiServerPreview.length > 0 ? openApiServerPreview.map((server) => (
                                <Chip key={server} size="small" variant="outlined" label={server} />
                              )) : (
                                <Typography variant="body2" color="text.secondary">{t('resource.import.editor.protocolApiEmptyValue')}</Typography>
                              )}
                            </Stack>
                          </Box>
                          {selectedProtocolApi && (
                            <Stack spacing={2}>
                              <TextField
                                select
                                label={t('resource.import.editor.protocolOpenapiOperationSelectorLabel')}
                                value={selectedProtocolApi.id}
                                onChange={(event) => setSelectedProtocolApiId(event.target.value)}
                                fullWidth
                              >
                                {draft.apis.map((api) => (
                                  <MenuItem key={api.id} value={api.id}>{api.name.trim() || t('resource.import.editor.apiCardTitle', { index: draft.apis.indexOf(api) + 1 })}</MenuItem>
                                ))}
                              </TextField>
                              <TextField
                                label={t('resource.import.editor.protocolOpenapiTagsField')}
                                value={openApiTagsTextByApiId[selectedProtocolApi.id] ?? ''}
                                onChange={(event) => setOpenApiTagsTextByApiId((current) => ({
                                  ...current,
                                  [selectedProtocolApi.id]: event.target.value,
                                }))}
                                fullWidth
                                multiline
                                minRows={3}
                                helperText={t('resource.import.editor.protocolOpenapiTagsHint')}
                              />
                            </Stack>
                          )}
                        </Stack>
                      </CardContent>
                    </Card>
                  )}

                  <Card variant="outlined" sx={{ bgcolor: alpha(theme.palette.primary.main, 0.03) }}>
                    <CardContent>
                      <Stack spacing={2}>
                        <Typography variant="h6">{t('resource.import.editor.basicTitle')}</Typography>
                        <Grid container spacing={2}>
                          <Grid size={{ xs: 12, md: 6 }}>
                            <TextField label={t('resource.import.editor.sourceName')} value={draft.source.name} onChange={(event) => updateSourceField('name', event.target.value)} fullWidth required error={Boolean(validationState.sourceNameError)} helperText={validationState.sourceNameError ?? undefined} />
                          </Grid>
                          <Grid size={{ xs: 12, md: 6 }}>
                            <TextField label={t('resource.import.editor.identifier')} value={draft.source.identifier} onChange={(event) => { setIdentifierTouched(true); updateSourceField('identifier', event.target.value); }} fullWidth required error={Boolean(validationState.identifierError)} helperText={validationState.identifierError ?? undefined} />
                          </Grid>
                          <Grid size={{ xs: 12, md: 4 }}>
                            <TextField label={t('resource.import.editor.version')} value={draft.source.version} onChange={(event) => updateSourceField('version', event.target.value)} fullWidth error={Boolean(validationState.versionError)} helperText={validationState.versionError ?? undefined} />
                          </Grid>
                          <Grid size={{ xs: 12, md: 8 }}>
                            <TextField label={t('resource.import.editor.logo')} value={draft.source.logo} onChange={(event) => updateSourceField('logo', event.target.value)} fullWidth helperText={t('resource.import.editor.logoHint')} />
                          </Grid>
                          <Grid size={{ xs: 12, md: 6 }}>
                            <TextField label={t('resource.import.editor.description')} value={draft.source.description} onChange={(event) => updateSourceField('description', event.target.value)} fullWidth multiline minRows={3} />
                          </Grid>
                          <Grid size={{ xs: 12, md: 6 }}>
                            <TextField label={t('resource.import.editor.details')} value={draft.source.details} onChange={(event) => updateSourceField('details', event.target.value)} fullWidth multiline minRows={3} />
                          </Grid>
                          <Grid size={{ xs: 12 }}>
                            <TextField label={t('resource.import.editor.footerText')} value={draft.source.footer_text} onChange={(event) => updateSourceField('footer_text', event.target.value)} fullWidth />
                          </Grid>
                        </Grid>
                      </Stack>
                    </CardContent>
                  </Card>

                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, lg: 5 }}>
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                          <Stack spacing={2}>
                            <Typography variant="h6">{t('resource.import.editor.mergeTitle')}</Typography>
                            <FormControlLabel control={<Checkbox checked={draft.source.merge_enabled} onChange={(event) => updateSourceField('merge_enabled', event.target.checked)} />} label={t('resource.import.editor.mergeEnabled')} />
                            <TextField select label={t('resource.import.editor.mergeStrategy')} value={draft.source.merge_strategy} onChange={(event) => updateSourceField('merge_strategy', event.target.value)} fullWidth>
                              {MERGE_STRATEGIES.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                            </TextField>
                            <TextField type="number" label={t('resource.import.editor.mergePriority')} value={draft.source.merge_priority} onChange={(event) => updateSourceField('merge_priority', Number(event.target.value) || 0)} fullWidth />
                            <TextField select label={t('resource.import.editor.mergeMetadataSource')} value={draft.source.merge_metadata_source} onChange={(event) => updateSourceField('merge_metadata_source', event.target.value)} fullWidth>
                              {MERGE_METADATA_SOURCES.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                            </TextField>
                            <FormControlLabel control={<Checkbox checked={draft.source.merge_allow_override} onChange={(event) => updateSourceField('merge_allow_override', event.target.checked)} />} label={t('resource.import.editor.mergeAllowOverride')} />
                          </Stack>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid size={{ xs: 12, lg: 7 }}>
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                          <Stack spacing={2}>
                            <Typography variant="h6">{t('resource.import.editor.configTitle')}</Typography>
                            <Grid container spacing={2}>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField type="number" label={t('resource.import.editor.globalIntervalSeconds')} value={draft.config.request.global_interval_seconds} onChange={(event) => updateConfigField('global_interval_seconds', Number(event.target.value) || 0)} fullWidth />
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField type="number" label={t('resource.import.editor.timeoutSeconds')} value={draft.config.request.timeout_seconds} onChange={(event) => updateConfigField('timeout_seconds', Number(event.target.value) || 20)} fullWidth />
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField type="number" label={t('resource.import.editor.maxConcurrent')} value={draft.config.request.max_concurrent} onChange={(event) => updateConfigField('max_concurrent', Number(event.target.value) || 1)} fullWidth />
                              </Grid>
                              <Grid size={{ xs: 12, md: 8 }}>
                                <TextField label={t('resource.import.editor.userAgent')} value={draft.config.request.user_agent} onChange={(event) => updateConfigField('user_agent', event.target.value)} fullWidth />
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <FormControlLabel control={<Checkbox checked={draft.config.request.skip_ssl_verify} onChange={(event) => updateConfigField('skip_ssl_verify', event.target.checked)} />} label={t('resource.import.editor.skipSslVerify')} />
                              </Grid>
                            </Grid>

                            <Divider />

                            <Accordion disableGutters defaultExpanded elevation={0} sx={{ bgcolor: 'transparent' }}>
                              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                <Typography variant="subtitle1">{t('resource.import.editor.headersTitle')}</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                {renderKeyValueEditor(
                                  draft.config.request.headers,
                                  (rowIndex, key, value) => updateArrayRow('configHeaders', rowIndex, key, value),
                                  () => addArrayRow('configHeaders'),
                                  (rowIndex) => removeArrayRow('configHeaders', rowIndex),
                                  t('resource.import.editor.headerKey'),
                                  t('resource.import.editor.headerValue'),
                                )}
                              </AccordionDetails>
                            </Accordion>

                            <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
                              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                <Typography variant="subtitle1">{t('resource.import.editor.retryTitle')}</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Grid container spacing={2}>
                                  <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField type="number" label={t('resource.import.editor.retryMaxAttempts')} value={draft.config.request.retry_max_attempts} onChange={(event) => updateConfigField('retry_max_attempts', Number(event.target.value) || 1)} fullWidth />
                                  </Grid>
                                  <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField type="number" label={t('resource.import.editor.retryBackoffBase')} value={draft.config.request.retry_backoff_base} onChange={(event) => updateConfigField('retry_backoff_base', Number(event.target.value) || 1)} fullWidth />
                                  </Grid>
                                  <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField type="number" label={t('resource.import.editor.retryInitialDelayMs')} value={draft.config.request.retry_initial_delay_ms} onChange={(event) => updateConfigField('retry_initial_delay_ms', Number(event.target.value) || 0)} fullWidth />
                                  </Grid>
                                </Grid>
                              </AccordionDetails>
                            </Accordion>

                            <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
                              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                <Typography variant="subtitle1">{t('resource.import.editor.cacheSectionTitle')}</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Grid container spacing={2}>
                                  <Grid size={{ xs: 12, md: 4 }}>
                                    <FormControlLabel control={<Checkbox checked={draft.config.request.cache_enabled} onChange={(event) => updateConfigField('cache_enabled', event.target.checked)} />} label={t('resource.import.editor.cacheEnabled')} />
                                  </Grid>
                                  <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField type="number" label={t('resource.import.editor.defaultCacheTtl')} value={draft.config.request.cache_default_ttl_seconds} onChange={(event) => updateConfigField('cache_default_ttl_seconds', Number(event.target.value) || 1)} fullWidth />
                                  </Grid>
                                  <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField type="number" label={t('resource.import.editor.maxMemoryMb')} value={draft.config.request.cache_max_memory_mb} onChange={(event) => updateConfigField('cache_max_memory_mb', Number(event.target.value) || 1)} fullWidth />
                                  </Grid>
                                </Grid>
                              </AccordionDetails>
                            </Accordion>

                            <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
                              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                <Typography variant="subtitle1">{t('resource.import.editor.variablesTitle')}</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                {renderKeyValueEditor(
                                  draft.config.request.variables,
                                  (rowIndex, key, value) => updateArrayRow('configVariables', rowIndex, key, value),
                                  () => addArrayRow('configVariables'),
                                  (rowIndex) => removeArrayRow('configVariables', rowIndex),
                                  t('resource.import.editor.variableKey'),
                                  t('resource.import.editor.variableValue'),
                                )}
                              </AccordionDetails>
                            </Accordion>
                          </Stack>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>
                </Stack>
              )}

              {activeTab === 1 && (
                <Stack spacing={2.5}>
                  <Alert severity="info" icon={<RouteRoundedIcon fontSize="inherit" />}>
                    {t('resource.import.editor.categoryDesignerHelper')}
                  </Alert>

                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, lg: 4 }}>
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                          <Stack spacing={2}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Box>
                                <Typography variant="h6">{t('resource.import.editor.categoriesRowsTitle')}</Typography>
                                <Typography variant="body2" color="text.secondary">{t('resource.import.editor.categorySelectorHint')}</Typography>
                              </Box>
                              <Button size="small" startIcon={<AddRoundedIcon />} onClick={addCategory}>{t('resource.import.editor.addCategory')}</Button>
                            </Stack>

                            <Stack spacing={1.25}>
                              {draft.categories.categories.map((category, categoryIndex) => {
                                const isSelected = categoryIndex === selectedCategoryIndex;
                                return (
                                  <Card
                                    key={`category-${categoryIndex}`}
                                    variant="outlined"
                                    onClick={() => setSelectedCategoryIndex(categoryIndex)}
                                    sx={{
                                      cursor: 'pointer',
                                      borderColor: isSelected ? theme.palette.primary.main : undefined,
                                      bgcolor: isSelected ? alpha(theme.palette.primary.main, 0.06) : undefined,
                                    }}
                                  >
                                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                                      <Stack direction="row" spacing={1.5} alignItems="flex-start">
                                        <Avatar sx={{ width: 38, height: 38, bgcolor: isSelected ? theme.palette.primary.main : alpha(theme.palette.primary.main, 0.14), color: isSelected ? theme.palette.primary.contrastText : theme.palette.primary.main }}>
                                          {(category.name.trim() || category.id.trim() || 'C').slice(0, 1).toUpperCase()}
                                        </Avatar>
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                                            <Typography variant="subtitle2">{category.name.trim() || t('resource.import.editor.overviewUntitled')}</Typography>
                                            <Chip size="small" label={category.id.trim() || 'pending_id'} />
                                          </Stack>
                                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                            {categoryPathLabel(category) || t('resource.import.editor.categoryPathEmpty')}
                                          </Typography>
                                        </Box>
                                      </Stack>
                                    </CardContent>
                                  </Card>
                                );
                              })}
                            </Stack>
                          </Stack>
                        </CardContent>
                      </Card>
                    </Grid>

                    <Grid size={{ xs: 12, lg: 8 }}>
                      <Stack spacing={2}>
                        <Card variant="outlined">
                          <CardContent>
                            <Stack spacing={2}>
                              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1.5}>
                                <Box>
                                  <Typography variant="h6">{t('resource.import.editor.categoryInspectorTitle')}</Typography>
                                  <Typography variant="body2" color="text.secondary">{t('resource.import.editor.categoryInspectorSubtitle')}</Typography>
                                </Box>
                                <Button color="inherit" onClick={() => removeCategory(selectedCategoryIndex)} startIcon={<DeleteOutlineRoundedIcon />} disabled={draft.categories.categories.length <= 1 || !selectedCategory}>
                                  {t('resource.import.editor.removeRow')}
                                </Button>
                              </Stack>

                              {selectedCategory ? (
                                <>
                                  <Grid container spacing={2}>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                      <TextField label={t('resource.import.editor.categoryId')} value={selectedCategory.id} onChange={(event) => updateCategory(selectedCategoryIndex, 'id', event.target.value)} fullWidth error={Boolean(validationState.categoryErrors[selectedCategoryIndex]?.idError)} helperText={validationState.categoryErrors[selectedCategoryIndex]?.idError ?? undefined} />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 8 }}>
                                      <TextField label={t('resource.import.editor.categoryName')} value={selectedCategory.name} onChange={(event) => updateCategory(selectedCategoryIndex, 'name', event.target.value)} fullWidth error={Boolean(validationState.categoryErrors[selectedCategoryIndex]?.nameError)} helperText={validationState.categoryErrors[selectedCategoryIndex]?.nameError ?? undefined} />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                      <TextField label={t('resource.import.editor.categoryLevel1')} value={selectedCategory.category} onChange={(event) => updateCategory(selectedCategoryIndex, 'category', event.target.value)} fullWidth />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                      <TextField label={t('resource.import.editor.categoryLevel2')} value={selectedCategory.subcategory} onChange={(event) => updateCategory(selectedCategoryIndex, 'subcategory', event.target.value)} fullWidth />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                      <TextField label={t('resource.import.editor.categoryLevel3')} value={selectedCategory.subsubcategory} onChange={(event) => updateCategory(selectedCategoryIndex, 'subsubcategory', event.target.value)} fullWidth />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 6 }}>
                                      <TextField label={t('resource.import.editor.logo')} value={selectedCategory.icon} onChange={(event) => updateCategory(selectedCategoryIndex, 'icon', event.target.value)} fullWidth helperText={t('resource.import.editor.categoryIconHelper')} />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 6 }}>
                                      <TextField label={t('resource.import.editor.description')} value={selectedCategory.description} onChange={(event) => updateCategory(selectedCategoryIndex, 'description', event.target.value)} fullWidth />
                                    </Grid>
                                  </Grid>

                                  <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                                    <Stack spacing={1}>
                                      <Typography variant="subtitle2">{t('resource.import.editor.categoryPreviewTitle')}</Typography>
                                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                        {selectedCategory.category.trim() && <Chip size="small" color="primary" label={selectedCategory.category.trim()} />}
                                        {selectedCategory.subcategory.trim() && <Chip size="small" variant="outlined" label={selectedCategory.subcategory.trim()} />}
                                        {selectedCategory.subsubcategory.trim() && <Chip size="small" variant="outlined" label={selectedCategory.subsubcategory.trim()} />}
                                      </Stack>
                                      <Typography variant="body2" color="text.secondary">{t('resource.import.editor.categoryPreviewHint')}</Typography>
                                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                        {selectedCategory.icon.trim() ? (
                                          <Chip color="success" size="small" label={t('resource.import.editor.categoryOwnIcon')} />
                                        ) : (
                                          <Chip size="small" label={t('resource.import.editor.categoryUsesInheritedIcon')} />
                                        )}
                                        {selectedCategoryIconHints.map((hint) => (
                                          <Chip key={`${hint.label}-${hint.value}`} size="small" color={hint.matched ? 'success' : 'default'} variant={hint.matched ? 'filled' : 'outlined'} label={`${hint.label}: ${hint.value}`} />
                                        ))}
                                      </Stack>
                                    </Stack>
                                  </Box>
                                </>
                              ) : (
                                <Alert severity="warning">{t('resource.import.editor.categorySelectionEmpty')}</Alert>
                              )}
                            </Stack>
                          </CardContent>
                        </Card>

                        <Card variant="outlined">
                          <CardContent>
                            <Stack spacing={2}>
                              <Typography variant="h6">{t('resource.import.editor.hierarchyPreviewTitle')}</Typography>
                              <Grid container spacing={1.5}>
                                {categoryTree.map((level1) => (
                                  <Grid key={level1.level1} size={{ xs: 12, md: 6 }}>
                                    <Card variant="outlined" sx={{ height: '100%', bgcolor: alpha(theme.palette.secondary.main, 0.04) }}>
                                      <CardContent>
                                        <Stack spacing={1.25}>
                                          <Typography variant="subtitle1">{level1.level1}</Typography>
                                          {level1.groups.map((group) => (
                                            <Box key={`${level1.level1}-${group.level2}`} sx={{ pl: 1.25, borderLeft: `2px solid ${alpha(theme.palette.secondary.main, 0.3)}` }}>
                                              <Typography variant="body2" sx={{ fontWeight: 600 }}>{group.level2}</Typography>
                                              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
                                                {group.items.map((item) => (
                                                  <Chip key={item.id || item.name} size="small" variant="outlined" label={item.subsubcategory.trim() || item.name.trim() || item.id.trim()} />
                                                ))}
                                              </Stack>
                                            </Box>
                                          ))}
                                        </Stack>
                                      </CardContent>
                                    </Card>
                                  </Grid>
                                ))}
                              </Grid>
                            </Stack>
                          </CardContent>
                        </Card>

                        <Grid container spacing={2}>
                          <Grid size={{ xs: 12, xl: 6 }}>
                            <Card variant="outlined" sx={{ height: '100%' }}>
                              <CardContent>
                                <Stack spacing={2}>
                                  <Typography variant="h6">{t('resource.import.editor.categoryPresentationTitle')}</Typography>
                                  <Grid container spacing={2}>
                                    <Grid size={{ xs: 12, md: 6 }}>
                                      <TextField label={t('resource.import.editor.templateCategory')} value={draft.categories.template_category} onChange={(event) => setDraft((current) => ({ ...current, categories: { ...current.categories, template_category: event.target.value } }))} fullWidth />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 6 }}>
                                      <TextField label={t('resource.import.editor.templateIcon')} value={draft.categories.template_icon} onChange={(event) => setDraft((current) => ({ ...current, categories: { ...current.categories, template_icon: event.target.value } }))} fullWidth helperText={t('resource.import.editor.logoHint')} />
                                    </Grid>
                                  </Grid>

                                  <Typography variant="subtitle2">{t('resource.import.editor.categoryGroupsTitle')}</Typography>
                                  {draft.categories.category_groups.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary">{t('resource.import.editor.emptyGroups')}</Typography>
                                  ) : draft.categories.category_groups.map((group, groupIndex) => (
                                    <Card key={`group-${groupIndex}`} variant="outlined">
                                      <CardContent>
                                        <Grid container spacing={1.5}>
                                          <Grid size={{ xs: 12, md: 4 }}>
                                            <TextField label={t('resource.import.editor.groupName')} value={group.name} onChange={(event) => updateCategoryGroup(groupIndex, 'name', event.target.value)} fullWidth />
                                          </Grid>
                                          <Grid size={{ xs: 12, md: 7 }}>
                                            <TextField label={t('resource.import.editor.groupCategoryIds')} value={joinTextList(group.category_ids)} onChange={(event) => updateCategoryGroup(groupIndex, 'category_ids', parseTextList(event.target.value))} fullWidth multiline minRows={2} helperText={t('resource.import.editor.groupCategoryIdsHint')} />
                                          </Grid>
                                          <Grid size={{ xs: 12, md: 1 }}>
                                            <Button color="inherit" onClick={() => removeCategoryGroup(groupIndex)} startIcon={<DeleteOutlineRoundedIcon />}>
                                              {t('resource.import.editor.removeRow')}
                                            </Button>
                                          </Grid>
                                        </Grid>
                                      </CardContent>
                                    </Card>
                                  ))}
                                  <Box>
                                    <Button size="small" startIcon={<AddRoundedIcon />} onClick={addCategoryGroup}>{t('resource.import.editor.addCategoryGroup')}</Button>
                                  </Box>
                                </Stack>
                              </CardContent>
                            </Card>
                          </Grid>
                          <Grid size={{ xs: 12, xl: 6 }}>
                            <Card variant="outlined" sx={{ height: '100%' }}>
                              <CardContent>
                                <Stack spacing={2}>
                                  <Typography variant="h6">{t('resource.import.editor.levelIconsTitle')}</Typography>
                                  <Typography variant="body2" color="text.secondary">{t('resource.import.editor.levelIconsSubtitle')}</Typography>
                                  <Accordion disableGutters defaultExpanded elevation={0} sx={{ bgcolor: 'transparent' }}>
                                    <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                      <Typography variant="subtitle2">{t('resource.import.editor.levelIconCategory')}</Typography>
                                    </AccordionSummary>
                                    <AccordionDetails>
                                      {renderKeyValueEditor(
                                        draft.categories.level_icons.category,
                                        (rowIndex, key, value) => updateArrayRow('levelIcons', rowIndex, key, value, undefined, 'category'),
                                        () => addArrayRow('levelIcons', undefined, 'category'),
                                        (rowIndex) => removeArrayRow('levelIcons', rowIndex, undefined, 'category'),
                                        t('resource.import.editor.levelIconMatch'),
                                        t('resource.import.editor.levelIconValue'),
                                      )}
                                    </AccordionDetails>
                                  </Accordion>
                                  <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
                                    <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                      <Typography variant="subtitle2">{t('resource.import.editor.levelIconSubcategory')}</Typography>
                                    </AccordionSummary>
                                    <AccordionDetails>
                                      {renderKeyValueEditor(
                                        draft.categories.level_icons.subcategory,
                                        (rowIndex, key, value) => updateArrayRow('levelIcons', rowIndex, key, value, undefined, 'subcategory'),
                                        () => addArrayRow('levelIcons', undefined, 'subcategory'),
                                        (rowIndex) => removeArrayRow('levelIcons', rowIndex, undefined, 'subcategory'),
                                        t('resource.import.editor.levelIconMatch'),
                                        t('resource.import.editor.levelIconValue'),
                                      )}
                                    </AccordionDetails>
                                  </Accordion>
                                  <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
                                    <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                      <Typography variant="subtitle2">{t('resource.import.editor.levelIconSubsubcategory')}</Typography>
                                    </AccordionSummary>
                                    <AccordionDetails>
                                      {renderKeyValueEditor(
                                        draft.categories.level_icons.subsubcategory,
                                        (rowIndex, key, value) => updateArrayRow('levelIcons', rowIndex, key, value, undefined, 'subsubcategory'),
                                        () => addArrayRow('levelIcons', undefined, 'subsubcategory'),
                                        (rowIndex) => removeArrayRow('levelIcons', rowIndex, undefined, 'subsubcategory'),
                                        t('resource.import.editor.levelIconMatch'),
                                        t('resource.import.editor.levelIconValue'),
                                      )}
                                    </AccordionDetails>
                                  </Accordion>
                                </Stack>
                              </CardContent>
                            </Card>
                          </Grid>
                        </Grid>
                      </Stack>
                    </Grid>
                  </Grid>
                </Stack>
              )}

              {activeTab === 2 && (
                <Stack spacing={2.5}>
                  <Alert severity="info" icon={<ApiRoundedIcon fontSize="inherit" />}>
                    {t('resource.import.editor.apiDesignerHelper')}
                  </Alert>
                  <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }}>
                    <Box>
                      <Typography variant="h6">{t('resource.import.editor.apisTitle')}</Typography>
                      <Typography variant="body2" color="text.secondary">{t('resource.import.editor.apisSubtitle')}</Typography>
                    </Box>
                    <Button size="small" startIcon={<AddRoundedIcon />} onClick={addApi}>{t('resource.import.editor.addApi')}</Button>
                  </Stack>

                  {draft.apis.map((api, apiIndex) => {
                    const isStaticList = api.response_format === 'static_list';
                    const isStaticDict = api.response_format === 'static_dict';
                    const needsMapping = !['image_url', 'image_raw', 'static_list', 'static_dict'].includes(api.response_format);
                    const usesRequestBody = !['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(api.method);

                    return (
                      <Accordion key={api.id} defaultExpanded={apiIndex === 0} disableGutters sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.9)}`, borderRadius: 2, overflow: 'hidden', '&:before': { display: 'none' } }}>
                        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} sx={{ bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ md: 'center' }} sx={{ width: '100%' }}>
                            <Box>
                              <Typography variant="subtitle1">{api.name.trim() || t('resource.import.editor.apiCardTitle', { index: apiIndex + 1 })}</Typography>
                              <Typography variant="body2" color="text.secondary">{api.description.trim() || t('resource.import.editor.apiSummaryFallback')}</Typography>
                            </Box>
                            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" justifyContent={{ md: 'flex-end' }}>
                              <Chip size="small" color="primary" label={api.response_format} />
                              <Chip size="small" variant="outlined" label={api.response_type} />
                              {parseTextList(api.categoriesText).map((categoryId) => (
                                <Chip key={`${api.id}-${categoryId}`} size="small" variant="outlined" label={categoryId} />
                              ))}
                            </Stack>
                          </Stack>
                        </AccordionSummary>
                        <AccordionDetails>
                          <Stack spacing={2.5}>
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <Button color="inherit" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => removeApi(apiIndex)} disabled={draft.apis.length <= 1}>
                                {t('resource.import.editor.removeApi')}
                              </Button>
                            </Box>

                            <Grid container spacing={2}>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField label={t('resource.import.editor.apiName')} value={api.name} onChange={(event) => updateApiField(apiIndex, 'name', event.target.value)} fullWidth required error={Boolean(validationState.apiErrors[apiIndex]?.nameError)} helperText={validationState.apiErrors[apiIndex]?.nameError ?? undefined} />
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField label={t('resource.import.editor.apiDescription')} value={api.description} onChange={(event) => updateApiField(apiIndex, 'description', event.target.value)} fullWidth />
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField label={t('resource.import.editor.logo')} value={api.logo} onChange={(event) => updateApiField(apiIndex, 'logo', event.target.value)} fullWidth />
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField label={t('resource.import.editor.apiCategories')} value={api.categoriesText} onChange={(event) => updateApiField(apiIndex, 'categoriesText', event.target.value)} fullWidth multiline minRows={2} error={Boolean(validationState.apiErrors[apiIndex]?.categoriesError)} helperText={validationState.apiErrors[apiIndex]?.categoriesError ?? t('resource.import.editor.apiCategoriesHint')} />
                              </Grid>
                              <Grid size={{ xs: 12, md: 2 }}>
                                <TextField select label={t('resource.import.editor.requestMethod')} value={api.method} onChange={(event) => updateApiField(apiIndex, 'method', event.target.value)} fullWidth>
                                  {REQUEST_METHODS.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12, md: 6 }}>
                                <TextField label={t('resource.import.editor.requestUrl')} value={api.url} onChange={(event) => updateApiField(apiIndex, 'url', event.target.value)} fullWidth required={!isStaticList && !isStaticDict} error={Boolean(validationState.apiErrors[apiIndex]?.urlError)} helperText={validationState.apiErrors[apiIndex]?.urlError ?? undefined} />
                              </Grid>
                              <Grid size={{ xs: 12, md: 3 }}>
                                <TextField type="number" label={t('resource.import.editor.requestTimeout')} value={api.timeout_seconds} onChange={(event) => updateApiField(apiIndex, 'timeout_seconds', Number(event.target.value) || 20)} fullWidth />
                              </Grid>
                              <Grid size={{ xs: 12, md: 3 }}>
                                <TextField type="number" label={t('resource.import.editor.requestInterval')} value={api.interval_seconds} onChange={(event) => updateApiField(apiIndex, 'interval_seconds', Number(event.target.value) || 0)} fullWidth />
                              </Grid>
                              {usesRequestBody && (
                                <Grid size={{ xs: 12, md: 3 }}>
                                  <TextField select label={t('resource.import.editor.requestBodyType')} value={api.body_type} onChange={(event) => updateApiField(apiIndex, 'body_type', event.target.value)} fullWidth>
                                    {REQUEST_BODY_TYPES.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                                  </TextField>
                                </Grid>
                              )}
                              {usesRequestBody && (
                                <Grid size={{ xs: 12, md: 9 }}>
                                  <TextField
                                    label={t('resource.import.editor.requestBody')}
                                    value={api.body}
                                    onChange={(event) => updateApiField(apiIndex, 'body', event.target.value)}
                                    fullWidth
                                    multiline
                                    minRows={4}
                                    helperText={t('resource.import.editor.requestBodyHint')}
                                  />
                                </Grid>
                              )}
                              <Grid size={{ xs: 12, md: 6 }}>
                                <TextField select label={t('resource.import.editor.responseFormat')} value={api.response_format} onChange={(event) => updateApiField(apiIndex, 'response_format', event.target.value)} fullWidth>
                                  {RESPONSE_FORMATS.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12, md: 6 }}>
                                <TextField select label={t('resource.import.editor.responseType')} value={api.response_type} onChange={(event) => updateApiField(apiIndex, 'response_type', event.target.value)} fullWidth>
                                  {RESPONSE_TYPES.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                                </TextField>
                              </Grid>
                            </Grid>

                            <Accordion disableGutters defaultExpanded elevation={0} sx={{ bgcolor: 'transparent' }}>
                              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                <Typography variant="subtitle1">{t('resource.import.editor.headersTitle')}</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                {renderKeyValueEditor(
                                  api.headers,
                                  (rowIndex, key, value) => updateArrayRow('apiHeaders', rowIndex, key, value, apiIndex),
                                  () => addArrayRow('apiHeaders', apiIndex),
                                  (rowIndex) => removeArrayRow('apiHeaders', rowIndex, apiIndex),
                                  t('resource.import.editor.headerKey'),
                                  t('resource.import.editor.headerValue'),
                                )}
                              </AccordionDetails>
                            </Accordion>

                            <Accordion disableGutters defaultExpanded elevation={0} sx={{ bgcolor: 'transparent' }}>
                              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                <Typography variant="subtitle1">{t('resource.import.editor.responseTitle')}</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Stack spacing={2}>
                                  {validationState.apiErrors[apiIndex]?.mappingError && (
                                    <Alert severity="error">{validationState.apiErrors[apiIndex]?.mappingError}</Alert>
                                  )}
                                  {validationState.apiErrors[apiIndex]?.staticPayloadError && (
                                    <Alert severity="error">{validationState.apiErrors[apiIndex]?.staticPayloadError}</Alert>
                                  )}
                                  {needsMapping && (
                                    <>
                                      <TextField label={t('resource.import.editor.itemsPath')} value={api.items_path} onChange={(event) => updateApiField(apiIndex, 'items_path', event.target.value)} fullWidth helperText={api.response_type === 'single' ? t('resource.import.editor.singleTypeHint') : undefined} />
                                      <Typography variant="subtitle2">{t('resource.import.editor.itemMappingTitle')}</Typography>
                                      {renderKeyValueEditor(
                                        api.item_mapping,
                                        (rowIndex, key, value) => updateArrayRow('apiItemMapping', rowIndex, key, value, apiIndex),
                                        () => addArrayRow('apiItemMapping', apiIndex),
                                        (rowIndex) => removeArrayRow('apiItemMapping', rowIndex, apiIndex),
                                        t('resource.import.editor.mappingField'),
                                        t('resource.import.editor.mappingPath'),
                                        t('resource.import.editor.mappingHint'),
                                      )}
                                    </>
                                  )}

                                  {isStaticList && (
                                    <TextField label={t('resource.import.editor.staticListUrls')} value={api.static_list_text} onChange={(event) => updateApiField(apiIndex, 'static_list_text', event.target.value)} fullWidth multiline minRows={4} helperText={t('resource.import.editor.staticListUrlsHint')} />
                                  )}

                                  {isStaticDict && (
                                    <Stack spacing={1.5}>
                                      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }}>
                                        <Typography variant="subtitle2">{t('resource.import.editor.staticDictItems')}</Typography>
                                        <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => addArrayRow('apiStaticDictItems', apiIndex)}>{t('resource.import.editor.addStaticItem')}</Button>
                                      </Stack>
                                      {api.static_dict_items.map((item, itemIndex) => (
                                        <Card key={`static-item-${itemIndex}`} variant="outlined">
                                          <CardContent>
                                            <Grid container spacing={1.5}>
                                              <Grid size={{ xs: 12, md: 6 }}>
                                                <TextField label={t('resource.import.editor.imagePath')} value={item.image} onChange={(event) => updateArrayRow('apiStaticDictItems', itemIndex, 'image', event.target.value, apiIndex)} fullWidth />
                                              </Grid>
                                              <Grid size={{ xs: 12, md: 6 }}>
                                                <TextField label={t('resource.import.editor.titlePath')} value={item.title} onChange={(event) => updateArrayRow('apiStaticDictItems', itemIndex, 'title', event.target.value, apiIndex)} fullWidth />
                                              </Grid>
                                              <Grid size={{ xs: 12, md: 4 }}>
                                                <TextField label={t('resource.import.editor.previewPath')} value={item.preview} onChange={(event) => updateArrayRow('apiStaticDictItems', itemIndex, 'preview', event.target.value, apiIndex)} fullWidth />
                                              </Grid>
                                              <Grid size={{ xs: 12, md: 4 }}>
                                                <TextField label={t('resource.import.editor.widthPath')} value={item.width} onChange={(event) => updateArrayRow('apiStaticDictItems', itemIndex, 'width', event.target.value, apiIndex)} fullWidth />
                                              </Grid>
                                              <Grid size={{ xs: 12, md: 4 }}>
                                                <TextField label={t('resource.import.editor.heightPath')} value={item.height} onChange={(event) => updateArrayRow('apiStaticDictItems', itemIndex, 'height', event.target.value, apiIndex)} fullWidth />
                                              </Grid>
                                              <Grid size={{ xs: 12 }}>
                                                <TextField label={t('resource.import.editor.descriptionPath')} value={item.description} onChange={(event) => updateArrayRow('apiStaticDictItems', itemIndex, 'description', event.target.value, apiIndex)} fullWidth />
                                              </Grid>
                                              <Grid size={{ xs: 12 }}>
                                                <Button color="inherit" onClick={() => removeArrayRow('apiStaticDictItems', itemIndex, apiIndex)} startIcon={<DeleteOutlineRoundedIcon />}>
                                                  {t('resource.import.editor.removeRow')}
                                                </Button>
                                              </Grid>
                                            </Grid>
                                          </CardContent>
                                        </Card>
                                      ))}
                                    </Stack>
                                  )}

                                  <Typography variant="subtitle2">{t('resource.import.editor.postProcessTitle')}</Typography>
                                  {renderKeyValueEditor(
                                    api.post_process,
                                    (rowIndex, key, value) => updateArrayRow('apiPostProcess', rowIndex, key, value, apiIndex),
                                    () => addArrayRow('apiPostProcess', apiIndex),
                                    (rowIndex) => removeArrayRow('apiPostProcess', rowIndex, apiIndex),
                                    t('resource.import.editor.postProcessField'),
                                    t('resource.import.editor.postProcessTemplate'),
                                    t('resource.import.editor.imageTemplateHint'),
                                  )}
                                </Stack>
                              </AccordionDetails>
                            </Accordion>

                            <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
                              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                <Typography variant="subtitle1">{t('resource.import.editor.parametersTitle')}</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Stack spacing={2}>
                                  <Box>
                                    <Button size="small" onClick={() => addArrayRow('apiParameters', apiIndex)}>{t('resource.import.editor.addParameter')}</Button>
                                  </Box>
                                  {api.parameters.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary">{t('resource.import.editor.parametersEmpty')}</Typography>
                                  ) : api.parameters.map((parameter, parameterIndex) => (
                                    <Card key={`parameter-${parameterIndex}`} variant="outlined">
                                      <CardContent>
                                        <Grid container spacing={1.5}>
                                          <Grid size={{ xs: 12, md: 3 }}>
                                            <TextField label={t('resource.import.editor.parameterKey')} value={parameter.key} onChange={(event) => updateArrayRow('apiParameters', parameterIndex, 'key', event.target.value, apiIndex)} fullWidth />
                                          </Grid>
                                          <Grid size={{ xs: 12, md: 3 }}>
                                            <TextField label={t('resource.import.editor.parameterLabel')} value={parameter.label} onChange={(event) => updateArrayRow('apiParameters', parameterIndex, 'label', event.target.value, apiIndex)} fullWidth />
                                          </Grid>
                                          <Grid size={{ xs: 12, md: 2 }}>
                                            <TextField select label={t('resource.import.editor.parameterType')} value={parameter.type} onChange={(event) => updateArrayRow('apiParameters', parameterIndex, 'type', event.target.value, apiIndex)} fullWidth>
                                              {PARAMETER_TYPES.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                                            </TextField>
                                          </Grid>
                                          <Grid size={{ xs: 12, md: 2 }}>
                                            {parameter.type === 'boolean' ? (
                                              <FormControlLabel control={<Checkbox checked={Boolean(parameter.default)} onChange={(event) => updateArrayRow('apiParameters', parameterIndex, 'default', event.target.checked, apiIndex)} />} label={t('resource.import.editor.parameterDefault')} />
                                            ) : (
                                              <TextField label={t('resource.import.editor.parameterDefault')} value={String(parameter.default)} onChange={(event) => updateArrayRow('apiParameters', parameterIndex, 'default', event.target.value, apiIndex)} fullWidth />
                                            )}
                                          </Grid>
                                          <Grid size={{ xs: 12, md: 2 }}>
                                            <FormControlLabel control={<Checkbox checked={parameter.hidden} onChange={(event) => updateArrayRow('apiParameters', parameterIndex, 'hidden', event.target.checked, apiIndex)} />} label={t('resource.import.editor.parameterHidden')} />
                                          </Grid>
                                          <Grid size={{ xs: 12, md: 6 }}>
                                            <TextField label={t('resource.import.editor.parameterChoices')} value={parameter.choices} onChange={(event) => updateArrayRow('apiParameters', parameterIndex, 'choices', event.target.value, apiIndex)} fullWidth helperText={parameter.type === 'choice' ? t('resource.import.editor.parameterChoicesHint') : undefined} />
                                          </Grid>
                                          <Grid size={{ xs: 12, md: 6 }}>
                                            <TextField label={t('resource.import.editor.parameterDescription')} value={parameter.description} onChange={(event) => updateArrayRow('apiParameters', parameterIndex, 'description', event.target.value, apiIndex)} fullWidth />
                                          </Grid>
                                          <Grid size={{ xs: 12, md: 6 }}>
                                            <TextField label={t('resource.import.editor.parameterPlaceholder')} value={parameter.placeholder} onChange={(event) => updateArrayRow('apiParameters', parameterIndex, 'placeholder', event.target.value, apiIndex)} fullWidth />
                                          </Grid>
                                          <Grid size={{ xs: 12, md: 3 }}>
                                            <TextField label={t('resource.import.editor.parameterMinLength')} value={parameter.min_length} onChange={(event) => updateArrayRow('apiParameters', parameterIndex, 'min_length', event.target.value, apiIndex)} fullWidth />
                                          </Grid>
                                          <Grid size={{ xs: 12, md: 3 }}>
                                            <TextField label={t('resource.import.editor.parameterMaxLength')} value={parameter.max_length} onChange={(event) => updateArrayRow('apiParameters', parameterIndex, 'max_length', event.target.value, apiIndex)} fullWidth />
                                          </Grid>
                                          <Grid size={{ xs: 12 }}>
                                            <Button color="inherit" onClick={() => removeArrayRow('apiParameters', parameterIndex, apiIndex)} startIcon={<DeleteOutlineRoundedIcon />}>
                                              {t('resource.import.editor.removeRow')}
                                            </Button>
                                          </Grid>
                                        </Grid>
                                      </CardContent>
                                    </Card>
                                  ))}
                                </Stack>
                              </AccordionDetails>
                            </Accordion>

                            <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
                              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                <Typography variant="subtitle1">{t('resource.import.editor.validationTitle')}</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Stack spacing={2}>
                                  <TextField label={t('resource.import.editor.requiredFields')} value={api.required_fields_text} onChange={(event) => updateApiField(apiIndex, 'required_fields_text', event.target.value)} fullWidth multiline minRows={2} helperText={t('resource.import.editor.requiredFieldsHint')} />
                                  <Typography variant="subtitle2">{t('resource.import.editor.fieldPatternsTitle')}</Typography>
                                  {renderRuleEditor(
                                    api.field_patterns,
                                    (rowIndex, key, value) => updateArrayRow('apiRules', rowIndex, key, value, apiIndex, undefined, 'field_patterns'),
                                    () => addArrayRow('apiRules', apiIndex, undefined, 'field_patterns'),
                                    (rowIndex) => removeArrayRow('apiRules', rowIndex, apiIndex, undefined, 'field_patterns'),
                                  )}
                                  <Typography variant="subtitle2">{t('resource.import.editor.qualityRulesTitle')}</Typography>
                                  {renderRuleEditor(
                                    api.quality_rules,
                                    (rowIndex, key, value) => updateArrayRow('apiRules', rowIndex, key, value, apiIndex, undefined, 'quality_rules'),
                                    () => addArrayRow('apiRules', apiIndex, undefined, 'quality_rules'),
                                    (rowIndex) => removeArrayRow('apiRules', rowIndex, apiIndex, undefined, 'quality_rules'),
                                  )}
                                </Stack>
                              </AccordionDetails>
                            </Accordion>

                            <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
                              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                <Typography variant="subtitle1">{t('resource.import.editor.errorHandlingTitle')}</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Stack spacing={2}>
                                  <Typography variant="subtitle2">{t('resource.import.editor.httpCodesTitle')}</Typography>
                                  {renderHttpCodeEditor(
                                    api.http_codes,
                                    (rowIndex, key, value) => updateArrayRow('apiHttpCodes', rowIndex, key, value, apiIndex),
                                    () => addArrayRow('apiHttpCodes', apiIndex),
                                    (rowIndex) => removeArrayRow('apiHttpCodes', rowIndex, apiIndex),
                                  )}
                                  <Grid container spacing={2}>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                      <TextField select label={t('resource.import.editor.onEmptyResponse')} value={api.on_empty_response} onChange={(event) => updateApiField(apiIndex, 'on_empty_response', event.target.value)} fullWidth>
                                        {EMPTY_RESPONSE_BEHAVIORS.map((item) => <MenuItem key={item || 'default'} value={item}>{item || t('resource.import.editor.emptySelect')}</MenuItem>)}
                                      </TextField>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                      <TextField select label={t('resource.import.editor.onMappingFailed')} value={api.on_mapping_failed} onChange={(event) => updateApiField(apiIndex, 'on_mapping_failed', event.target.value)} fullWidth>
                                        {MAPPING_FAILURE_BEHAVIORS.map((item) => <MenuItem key={item || 'default'} value={item}>{item || t('resource.import.editor.emptySelect')}</MenuItem>)}
                                      </TextField>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                      <TextField label={t('resource.import.editor.fallbackTo')} value={api.fallback_to} onChange={(event) => updateApiField(apiIndex, 'fallback_to', event.target.value)} fullWidth helperText={t('resource.import.editor.fallbackToHint')} />
                                    </Grid>
                                  </Grid>
                                </Stack>
                              </AccordionDetails>
                            </Accordion>

                            <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
                              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                <Typography variant="subtitle1">{t('resource.import.editor.behaviorTitle')}</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Grid container spacing={2}>
                                  <Grid size={{ xs: 12, md: 4 }}>
                                    <FormControlLabel control={<Checkbox checked={api.cache_enabled} onChange={(event) => updateApiField(apiIndex, 'cache_enabled', event.target.checked)} />} label={t('resource.import.editor.cacheEnabled')} />
                                  </Grid>
                                  <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField type="number" label={t('resource.import.editor.cacheTtl')} value={api.cache_ttl_seconds} onChange={(event) => updateApiField(apiIndex, 'cache_ttl_seconds', Number(event.target.value) || 1)} fullWidth disabled={!api.cache_enabled} />
                                  </Grid>
                                  <Grid size={{ xs: 12, md: 4 }}>
                                    <TextField label={t('resource.import.editor.cacheKeyTemplate')} value={api.cache_key_template} onChange={(event) => updateApiField(apiIndex, 'cache_key_template', event.target.value)} fullWidth disabled={!api.cache_enabled} />
                                  </Grid>
                                </Grid>
                              </AccordionDetails>
                            </Accordion>
                          </Stack>
                        </AccordionDetails>
                      </Accordion>
                    );
                  })}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={working}>{t('common.cancel')}</Button>
        <Button onClick={() => void handlePrimaryAction()} variant="contained" disabled={working || !canRunPrimaryAction}>
          {protocolMode === 'ltws'
            ? t('resource.import.editor.submit')
            : t('resource.import.editor.exportProtocolAction')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
