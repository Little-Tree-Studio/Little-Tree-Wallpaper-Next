import type { ImageProviderConfig } from '@/types';

const MODELS_DEV_API = 'https://models.dev/api.json';

export interface ModelsDevProvider {
  id: string;
  name: string;
  npm: string;
  api: string | null;
  env: string[];
  doc: string;
  models: { id: string; name: string }[];
}

export interface ImageGenerationResult {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

export interface ImageGenerationResponse {
  data: ImageGenerationResult[];
}

let _modelsDevCache: ModelsDevProvider[] | null = null;

export async function fetchImageProviders(): Promise<ModelsDevProvider[]> {
  if (_modelsDevCache) return _modelsDevCache;
  const resp = await fetch(MODELS_DEV_API, { cache: 'no-store' });
  if (!resp.ok) throw new Error('无法加载模型列表');
  const data = await resp.json();
  const providers: ModelsDevProvider[] = [];
  for (const pid of Object.keys(data)) {
    const p = data[pid];
    if (!p?.models) continue;
    const imageModels: { id: string; name: string }[] = [];
    for (const mid of Object.keys(p.models)) {
      const m = p.models[mid];
      const out = m.modalities?.output;
      let hasImage = false;
      if (typeof out === 'string') {
        hasImage = out.includes('image');
      } else if (Array.isArray(out)) {
        hasImage = out.includes('image');
      }
      if (hasImage) {
        imageModels.push({ id: m.id, name: m.name });
      }
    }
    if (imageModels.length > 0) {
      providers.push({
        id: pid,
        name: p.name || pid,
        npm: p.npm || '',
        api: p.api || null,
        env: p.env || [],
        doc: p.doc || '',
        models: imageModels,
      });
    }
  }
  _modelsDevCache = providers;
  return providers;
}

export function getEndpointForProvider(provider: ModelsDevProvider): string {
  if (provider.api) return provider.api;
  switch (provider.id) {
    case 'openai':
      return 'https://api.openai.com/v1';
    default:
      return '';
  }
}

export function getFormatForNpm(npm: string, providerId: string): ImageProviderConfig['format'] {
  if (providerId === 'openai' && npm === '@ai-sdk/openai') return 'openai';
  if (providerId.includes('volcano') || providerId.includes('volces')) return 'volcano';
  return 'openai-compatible';
}

export interface GenerateImageOptions {
  size?: string;
  n?: number;
  responseFormat?: 'url' | 'b64_json';
  /** Optional negative prompt appended to the request body when supported. */
  negativePrompt?: string;
  /** Optional random seed forwarded to the provider when supported. */
  seed?: number;
  /** Abort the in-flight request. */
  signal?: AbortSignal;
}

export async function generateImage(
  provider: ImageProviderConfig,
  prompt: string,
  options?: GenerateImageOptions
): Promise<ImageGenerationResponse> {
  const endpoint = provider.endpoint.replace(/\/$/, '');
  const url = `${endpoint}/images/generations`;
  const body: Record<string, unknown> = {
    model: provider.model,
    prompt,
    n: options?.n ?? 1,
  };
  if (options?.size) body.size = options.size;
  if (options?.responseFormat) body.response_format = options.responseFormat;
  // These optional fields are not accepted by the native OpenAI image API.
  // Keep them for Volcano and compatible providers where they are commonly supported.
  if (provider.format !== 'openai' && options?.negativePrompt?.trim()) {
    body.negative_prompt = options.negativePrompt.trim();
  }
  if (provider.format !== 'openai' && typeof options?.seed === 'number' && Number.isFinite(options.seed)) {
    body.seed = options.seed;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  };
  if (provider.customHeaders) {
    Object.assign(headers, provider.customHeaders);
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API 错误 (${resp.status}): ${text}`);
  }

  return resp.json();
}

export function parseProviderFromModelsDev(
  provider: ModelsDevProvider,
  modelId: string,
  apiKey: string
): ImageProviderConfig {
  const endpoint = getEndpointForProvider(provider);
  const model = provider.models.find((m) => m.id === modelId);
  return {
    id: `${provider.id}-${modelId}`,
    name: `${provider.name} - ${model?.name || modelId}`,
    format: getFormatForNpm(provider.npm, provider.id),
    endpoint,
    apiKey,
    model: modelId,
    modelName: model?.name || modelId,
  };
}

export const VOLCANO_PRESET: Omit<ImageProviderConfig, 'id' | 'apiKey' | 'model'> = {
  name: '火山引擎',
  format: 'volcano',
  endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
};

export const OPENAI_PRESET: Omit<ImageProviderConfig, 'id' | 'apiKey' | 'model'> = {
  name: 'OpenAI',
  format: 'openai',
  endpoint: 'https://api.openai.com/v1',
};

export const SIZE_OPTIONS: Record<string, string[]> = {
  openai: ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '1536x1536'],
  volcano: ['1024x1024', '2048x2048', '2K', '3K', '4K'],
  'openai-compatible': ['1024x1024', '512x512', '256x256', '1792x1024', '1024x1792'],
};
