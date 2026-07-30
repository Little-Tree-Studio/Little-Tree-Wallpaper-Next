import type { ImageProviderConfig } from '@/types';

const MODELS_DEV_API = 'https://models.dev/api.json';
export const POLLINATIONS_PROVIDER_ID = 'pollinations';

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

export interface GenerateImageOptions {
  size?: string;
  n?: number;
  responseFormat?: 'url' | 'b64_json';
  /** Quality tier: auto/low/medium/high, forwarded as-is. */
  quality?: string;
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
  if (provider.format === 'pollinations') {
    return generatePollinationsImage(provider, prompt, options);
  }

  const endpoint = provider.endpoint.replace(/\/$/, '');
  const url = `${endpoint}/images/generations`;
  const body: Record<string, unknown> = {
    model: provider.model,
    prompt,
    n: options?.n ?? 1,
  };
  if (options?.size) body.size = options.size;
  if (options?.responseFormat) body.response_format = options.responseFormat;
  if (options?.quality) body.quality = options.quality;
  if (options?.negativePrompt?.trim()) {
    body.negative_prompt = options.negativePrompt.trim();
  }
  if (typeof options?.seed === 'number' && Number.isFinite(options.seed)) {
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

  const json: ImageGenerationResponse = await resp.json();
  const target = parseSize(options?.size);
  if (target && Array.isArray(json.data)) {
    json.data = await Promise.all(json.data.map((item) => enforceSize(item, target, options?.signal)));
  }
  return json;
}

async function generatePollinationsImage(
  provider: ImageProviderConfig,
  prompt: string,
  options?: GenerateImageOptions,
): Promise<ImageGenerationResponse> {
  const params = new URLSearchParams({
    model: provider.model || 'flux',
  });
  const endpoint = provider.endpoint.replace(/\/$/, '');
  const url = `${endpoint}/${encodeURIComponent(prompt.trim())}?${params}`;
  const headers: Record<string, string> = { ...provider.customHeaders };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

  const response = await fetch(url, { headers, signal: options?.signal });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pollinations API 错误 (${response.status}): ${text}`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error('Pollinations 未返回图片');
  }
  return { data: [{ b64_json: await blobToDataUrl(blob, options?.signal) }] };
}

function blobToDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => reader.abort();
    reader.onload = () => {
      cleanup();
      resolve(String(reader.result));
    };
    reader.onerror = () => {
      cleanup();
      reject(reader.error || new Error('读取图片失败'));
    };
    reader.onabort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    reader.readAsDataURL(blob);
  });
}

function parseSize(size?: string): { width: number; height: number } | null {
  const match = /^(\d+)\s*[x*×]\s*(\d+)$/i.exec(size?.trim() || '');
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

async function enforceSize(
  item: ImageGenerationResult,
  target: { width: number; height: number },
  signal?: AbortSignal,
): Promise<ImageGenerationResult> {
  const source = item.url
    || (item.b64_json
      ? (item.b64_json.startsWith('data:') ? item.b64_json : `data:image/png;base64,${item.b64_json}`)
      : '');
  if (!source) return item;
  try {
    const dataUrl = await resizeImage(source, target.width, target.height, signal);
    if (!dataUrl) return item;
    return { ...item, url: undefined, b64_json: dataUrl };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    // CORS-tainted or undecodable images are returned as-is.
    return item;
  }
}

function loadImage(source: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const onAbort = () => {
      img.src = '';
      reject(new DOMException('Aborted', 'AbortError'));
    };
    img.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(img);
    };
    img.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('图片加载失败'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    img.src = source;
  });
}

async function resizeImage(
  source: string,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const img = await loadImage(source, signal);
  if (img.naturalWidth === width && img.naturalHeight === height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Cover: fill the target exactly, cropping overflow from the center.
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const drawWidth = img.naturalWidth * scale;
  const drawHeight = img.naturalHeight * scale;
  ctx.drawImage(img, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  return canvas.toDataURL('image/png');
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
    format: 'openai-compatible',
    endpoint,
    apiKey,
    model: modelId,
    modelName: model?.name || modelId,
  };
}

export const DEFAULT_ENDPOINT = 'https://api.openai.com/v1';

// Size tiers supported by gpt-image models; other OpenAI-compatible providers
// generally accept the same WxH values.
export const IMAGE_SIZE_OPTIONS = [
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '1792x1024',
  '1024x1792',
  '2048x1024',
  '2048x2048',
];

export const IMAGE_QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'];

export const MAX_IMAGES_PER_BATCH = 8;
