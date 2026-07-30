import { useEffect, useRef, useState } from 'react';
import {
  AlertDialog,
  Button,
  Card,
  Chip,
  ComboBox,
  Input,
  ListBox,
  NumberField,
  Select,
  TextArea,
  Tooltip,
  toast,
} from '@heroui/react';
import {
  Check,
  Clipboard,
  ClipboardCopy,
  Download,
  Image as ImageIcon,
  ImagePlus,
  RefreshCw,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  XCircle,
  ZoomIn,
} from 'lucide-react';
import {
  addToHistory,
  clearGeneratedImages,
  copyImageToClipboardWithProgress,
  copyToClipboard,
  deleteGeneratedImage,
  downloadWithProgress,
  getGeneratedImages,
  getSetting,
  localFileUrl,
  localPreviewUrl,
  saveAsWithProgress,
  saveGeneratedImage,
  setSetting,
  setWallpaperWithProgress,
} from '@/api/backend';
import type { GeneratedImageRecord } from '@/api/backend';
import {
  generateImage,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  MAX_IMAGES_PER_BATCH,
} from '@/api/generate';
import { useImageViewer } from '@/components/ImageViewer';
import { safeNameForFile } from '@/lib/download';
import type { ImageProviderConfig } from '@/types';

interface GeneratedImage {
  id: string;
  /** Local file path for persisted records. */
  path?: string;
  url?: string;
  b64_json?: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  size: string;
  responseFormat: 'url' | 'b64_json';
  providerName?: string;
  modelName?: string;
  revisedPrompt?: string;
  createdAt: number;
  status: 'generating' | 'done' | 'error';
  error?: string;
}

interface GenerationOptions {
  prompt: string;
  size: string;
  n: number;
  responseFormat: 'url' | 'b64_json';
  quality: string;
  negativePrompt?: string;
  seed?: number;
}

const PROMPT_HISTORY_KEY = 'ltw:generate:prompt-history';
const DEFAULT_PROMPT_HISTORY_LIMIT = 12;

function readPromptHistory(limit = DEFAULT_PROMPT_HISTORY_LIMIT): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(PROMPT_HISTORY_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}

function rememberPrompt(value: string, limit: number): string[] {
  const next = [value.trim(), ...readPromptHistory(limit).filter((item) => item !== value.trim())]
    .filter(Boolean)
    .slice(0, Math.max(1, limit));
  try {
    window.localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be disabled or full; prompt editing must still work.
  }
  return next;
}

function createImageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function imageSource(image: GeneratedImage): string {
  if (image.path) return localPreviewUrl(image.path, 960);
  if (image.url) return image.url;
  if (!image.b64_json) return '';
  return image.b64_json.startsWith('data:')
    ? image.b64_json
    : `data:image/png;base64,${image.b64_json}`;
}

/** Original-quality source for downloads, clipboard and wallpaper actions. */
function imageRawSource(image: GeneratedImage): string {
  if (image.path) return localFileUrl(image.path);
  return imageSource(image);
}

function recordToImage(record: GeneratedImageRecord): GeneratedImage {
  return {
    id: record.id,
    path: record.path,
    prompt: record.prompt || '',
    negativePrompt: record.negativePrompt,
    seed: typeof record.seed === 'number' ? record.seed : undefined,
    size: record.size || '',
    responseFormat: 'url',
    providerName: record.providerName,
    modelName: record.modelName,
    revisedPrompt: record.revisedPrompt,
    createdAt: record.createdAt || Date.now(),
    status: 'done',
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function IconAction({
  label,
  onPress,
  children,
  isDisabled = false,
  className,
}: {
  label: string;
  onPress: () => void | Promise<void>;
  children: React.ReactNode;
  isDisabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip delay={0}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={label}
        onPress={onPress}
        isDisabled={isDisabled}
        className={className}
      >
        {children}
      </Button>
      <Tooltip.Content><p>{label}</p></Tooltip.Content>
    </Tooltip>
  );
}

export default function Generate() {
  const { openViewer } = useImageViewer();
  const mountedRef = useRef(true);
  const generationController = useRef<AbortController | null>(null);
  const generationStartedAt = useRef<number | null>(null);
  const [providers, setProviders] = useState<ImageProviderConfig[]>([]);
  const [activeProviderId, setActiveProviderId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seedText, setSeedText] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [n, setN] = useState(1);
  const [responseFormat, setResponseFormat] = useState<'url' | 'b64_json'>('url');
  const [quality, setQuality] = useState('auto');
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [promptHistory, setPromptHistory] = useState<string[]>(readPromptHistory);
  const [rememberPrompts, setRememberPrompts] = useState(true);
  const [promptHistoryLimit, setPromptHistoryLimit] = useState(DEFAULT_PROMPT_HISTORY_LIMIT);
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    Promise.all([
      getSetting('generate.providers'),
      getSetting('generate.active_provider_id'),
      getSetting('generate.default_size'),
      getSetting('generate.default_n'),
      getSetting('generate.default_response_format'),
      getSetting('generate.default_quality'),
      getSetting('generate.remember_prompts'),
      getSetting('generate.prompt_history_limit'),
    ]).then(([
      savedProviders,
      savedActiveId,
      savedSize,
      savedN,
      savedFormat,
      savedQuality,
      savedRememberPrompts,
      savedPromptHistoryLimit,
    ]) => {
      if (cancelled) return;
      const nextProviders: ImageProviderConfig[] = (Array.isArray(savedProviders) ? savedProviders : [])
        .map((provider: ImageProviderConfig) => ({
          ...provider,
          format: provider.format === 'pollinations' ? 'pollinations' : 'openai-compatible',
        }));
      setProviders(nextProviders);
      const nextActiveId = String(savedActiveId || '');
      setActiveProviderId(nextProviders.some((provider) => provider.id === nextActiveId)
        ? nextActiveId
        : nextProviders[0]?.id || '');
      if (savedSize) setSize(String(savedSize));
      if (Number.isFinite(Number(savedN))) setN(Math.min(MAX_IMAGES_PER_BATCH, Math.max(1, Number(savedN))));
      if (savedFormat === 'url' || savedFormat === 'b64_json') setResponseFormat(savedFormat);
      if (IMAGE_QUALITY_OPTIONS.includes(String(savedQuality))) setQuality(String(savedQuality));
      const nextHistoryLimit = Math.max(1, Math.min(50, Number(savedPromptHistoryLimit) || DEFAULT_PROMPT_HISTORY_LIMIT));
      setRememberPrompts(savedRememberPrompts !== false);
      setPromptHistoryLimit(nextHistoryLimit);
      setPromptHistory(readPromptHistory(nextHistoryLimit));
    }).catch(() => {
      if (!cancelled) toast.danger('加载生图设置失败', { timeout: 0 });
    });

    getGeneratedImages().then((records) => {
      if (cancelled) return;
      setImages(records.map(recordToImage));
    }).catch(() => {
      if (!cancelled) toast.danger('加载生成记录失败', { timeout: 0 });
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      generationController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      setElapsedMs(0);
      return undefined;
    }
    const startedAt = generationStartedAt.current || Date.now();
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => window.clearInterval(timer);
  }, [loading]);

  const activeProvider = providers.find((provider) => provider.id === activeProviderId);
  const isPollinations = activeProvider?.format === 'pollinations';

  useEffect(() => {
    if (!isPollinations && !IMAGE_SIZE_OPTIONS.includes(size)) {
      const nextSize = IMAGE_SIZE_OPTIONS[0];
      setSize(nextSize);
      void setSetting('generate.default_size', nextSize);
    }
  }, [isPollinations, size]);

  const updateImages = (updater: (previous: GeneratedImage[]) => GeneratedImage[]) => {
    if (!mountedRef.current) return;
    setImages(updater);
  };

  const runGeneration = async (options: GenerationOptions) => {
    if (!activeProvider || !options.prompt.trim() || loading) return;

    const promptValue = options.prompt.trim();
    const effectiveNegativePrompt = activeProvider.format === 'pollinations'
      ? undefined
      : options.negativePrompt?.trim() || undefined;
    const batchIds = Array.from({ length: options.n }, () => createImageId());
    const batchImages: GeneratedImage[] = batchIds.map((id) => ({
      id,
      prompt: promptValue,
      negativePrompt: effectiveNegativePrompt,
      seed: options.seed,
      size: options.size,
      responseFormat: options.responseFormat,
      providerName: activeProvider.name,
      modelName: activeProvider.modelName || activeProvider.model,
      createdAt: Date.now(),
      status: 'generating',
    }));
    const controller = new AbortController();
    generationController.current = controller;
    generationStartedAt.current = Date.now();
    setElapsedMs(0);
    setLoading(true);
    updateImages((previous) => [...previous, ...batchImages]);
    if (rememberPrompts) setPromptHistory(rememberPrompt(promptValue, promptHistoryLimit));

    try {
      const response = await generateImage(activeProvider, promptValue, {
        size: options.size,
        n: options.n,
        responseFormat: options.responseFormat,
        quality: options.quality,
        negativePrompt: effectiveNegativePrompt,
        seed: options.seed,
        signal: controller.signal,
      });
      const results = Array.isArray(response.data) ? response.data : [];
      const successCount = results.filter((item) => item?.url || item?.b64_json).length;

      updateImages((previous) => previous.map((image) => {
        const index = batchIds.indexOf(image.id);
        if (index < 0) return image;
        const result = results[index];
        if (result?.url || result?.b64_json) {
          return {
            ...image,
            url: result.url,
            b64_json: result.b64_json,
            revisedPrompt: result.revised_prompt,
            status: 'done',
            error: undefined,
          };
        }
        return { ...image, status: 'error', error: '模型未返回图片' };
      }));

      if (successCount === options.n) {
        toast.success(`已生成 ${successCount} 张图片`, { timeout: 2500 });
      } else if (successCount > 0) {
        toast.warning(`已生成 ${successCount} 张，${options.n - successCount} 张失败`, { timeout: 0 });
      } else {
        toast.danger('模型未返回可用图片', { timeout: 0 });
      }

      if (successCount > 0) {
        const failedSaves = await Promise.all(results.map(async (result, index) => {
          if (!result?.url && !result?.b64_json) return false;
          const id = batchIds[index];
          const source = result.url || (result.b64_json!.startsWith('data:')
            ? result.b64_json!
            : `data:image/png;base64,${result.b64_json!}`);
          try {
            const res = await fetch(source);
            const blob = await res.blob();
            const record = await saveGeneratedImage(
              blob,
              `${safeNameForFile(`generated-${id}`, 'generated')}.png`,
              {
                id,
                prompt: promptValue,
                negativePrompt: effectiveNegativePrompt,
                seed: options.seed,
                size: options.size,
                providerName: activeProvider.name,
                modelName: activeProvider.modelName || activeProvider.model,
                revisedPrompt: result.revised_prompt,
                createdAt: Date.now(),
              },
            );
            if (record) {
              updateImages((previous) => previous.map((image) => (
                image.id === id
                  ? { ...image, path: record.path, url: undefined, b64_json: undefined }
                  : image
              )));
              return false;
            }
          } catch {
            // fall through to the failure toast
          }
          return true;
        }));
        const failedCount = failedSaves.filter(Boolean).length;
        if (failedCount > 0 && mountedRef.current) {
          toast.warning(`${failedCount} 张图片保存失败，刷新后将无法保留`, { timeout: 0 });
        }
      }
    } catch (error: unknown) {
      if (isAbortError(error)) {
        updateImages((previous) => previous.filter((image) => !batchIds.includes(image.id)));
        if (mountedRef.current) toast.info('已取消生成', { timeout: 2500 });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        updateImages((previous) => previous.map((image) => (
          batchIds.includes(image.id)
            ? { ...image, status: 'error', error: message }
            : image
        )));
        if (mountedRef.current) {
          toast.danger('生成失败', { description: message, timeout: 0 });
        }
      }
    } finally {
      if (generationController.current === controller) generationController.current = null;
      generationStartedAt.current = null;
      if (mountedRef.current) setLoading(false);
    }
  };

  const handleGenerate = () => {
    const parsedSeed = seedText.trim() ? Number(seedText) : undefined;
    const seed = parsedSeed !== undefined && Number.isFinite(parsedSeed) ? parsedSeed : undefined;
    void runGeneration({
      prompt,
      size: isPollinations ? '' : size,
      n: isPollinations ? 1 : n,
      responseFormat: isPollinations ? 'b64_json' : responseFormat,
      quality,
      negativePrompt: isPollinations ? undefined : negativePrompt,
      seed,
    });
  };

  const handleCancel = () => {
    generationController.current?.abort();
  };

  const handleRegenerate = (image: GeneratedImage) => {
    setPrompt(image.prompt);
    if (!isPollinations) {
      setSize(image.size);
    }
    setNegativePrompt(image.negativePrompt || '');
    setSeedText(image.seed === undefined ? '' : String(image.seed));
    void runGeneration({
      prompt: image.prompt,
      size: image.size,
      n: 1,
      responseFormat: image.responseFormat,
      quality,
      negativePrompt: image.negativePrompt,
      seed: image.seed,
    });
  };

  const handleView = (image: GeneratedImage) => {
    const completed = images.filter((item) => item.status === 'done' && imageSource(item));
    const startIndex = Math.max(0, completed.findIndex((item) => item.id === image.id));
    openViewer(completed.map((item) => ({
      src: imageRawSource(item),
      title: item.prompt.slice(0, 80),
      description: [item.providerName, item.modelName, item.size].filter(Boolean).join(' · '),
      source_type: 'generated',
      source_name: item.providerName || 'AI 生图',
      source_url: imageRawSource(item),
    })), startIndex);
  };

  const handleDownload = async (image: GeneratedImage) => {
    const source = imageRawSource(image);
    if (!source) return;
    await downloadWithProgress(source, `${safeNameForFile(`generated-${image.id}`, 'generated')}.png`);
  };

  const handleSaveAs = async (image: GeneratedImage) => {
    const source = imageRawSource(image);
    if (!source) return;
    await saveAsWithProgress(source, `${safeNameForFile(`generated-${image.id}`, 'generated')}.png`);
  };

  const handleCopyImage = async (image: GeneratedImage) => {
    const source = imageRawSource(image);
    if (!source) return;
    await copyImageToClipboardWithProgress(source);
  };

  const handleSetWallpaper = async (image: GeneratedImage) => {
    const source = imageRawSource(image);
    if (!source) return;
    const path = await setWallpaperWithProgress(
      source,
      `${safeNameForFile(`generated-${image.id}`, 'generated')}.png`,
    );
    if (path) {
      try {
        await addToHistory(path, image.prompt.slice(0, 30), 'generated');
      } catch {
        toast.warning('壁纸已应用，但历史记录保存失败', { timeout: 0 });
      }
    }
  };

  const handleCopyPrompt = async () => {
    if (!prompt.trim()) return;
    try {
      await copyToClipboard(prompt.trim());
      toast.success('提示词已复制', { timeout: 2000 });
    } catch {
      toast.danger('复制提示词失败', { timeout: 0 });
    }
  };

  const handleRemove = (id: string) => {
    const target = images.find((image) => image.id === id);
    updateImages((previous) => previous.filter((image) => image.id !== id));
    if (target?.path) {
      deleteGeneratedImage(id).catch(() => toast.danger('删除生成记录失败', { timeout: 0 }));
    }
  };

  const handleClear = () => {
    setClearDialogOpen(true);
  };

  const confirmClear = (deleteFiles: boolean) => {
    setClearDialogOpen(false);
    updateImages(() => []);
    clearGeneratedImages(deleteFiles).catch(() => toast.danger('清空生成记录失败', { timeout: 0 }));
  };

  const handleSizeChange = (key: React.Key | null) => {
    const nextSize = String(key || '');
    if (!nextSize) return;
    setSize(nextSize);
    void setSetting('generate.default_size', nextSize);
  };

  const handleCountChange = (value: number | null) => {
    const nextCount = Math.min(MAX_IMAGES_PER_BATCH, Math.max(1, value ?? 1));
    setN(nextCount);
    void setSetting('generate.default_n', nextCount);
  };

  const handleFormatChange = (key: React.Key | null) => {
    const nextFormat = String(key || 'url');
    if (nextFormat !== 'url' && nextFormat !== 'b64_json') return;
    setResponseFormat(nextFormat);
    void setSetting('generate.default_response_format', nextFormat);
  };

  const handleQualityChange = (key: React.Key | null) => {
    const nextQuality = String(key || 'auto');
    if (!IMAGE_QUALITY_OPTIONS.includes(nextQuality)) return;
    setQuality(nextQuality);
    void setSetting('generate.default_quality', nextQuality);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">AI 生图</h1>
          <p className="mt-1 text-sm text-muted">把想法变成桌面壁纸或可下载图片</p>
        </div>
        {images.length > 0 && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onPress={handleClear} isDisabled={loading}>
              <Trash2 size={14} /> 清空结果
            </Button>
            <Button variant="ghost" size="sm" onPress={() => { window.location.hash = '#/settings/generate'; }}>
              <Settings size={14} /> 生成设置
            </Button>
          </div>
        )}
      </div>

      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <ImageIcon size={18} className="text-muted" />
            <span className="text-sm font-medium">生成设置</span>
          </div>
          {activeProvider && (
            <Chip size="sm" color="success" variant="soft">
              <Check size={12} />
              <Chip.Label>{activeProvider.name}</Chip.Label>
            </Chip>
          )}
          <div className="ml-auto flex items-center gap-2">
            {providers.length === 0 ? (
              <>
                <Chip size="sm" color="warning" variant="soft"><Chip.Label>未配置提供商</Chip.Label></Chip>
                <Button size="sm" variant="ghost" onPress={() => { window.location.hash = '#/settings/generate'; }}>
                  <Settings size={14} /> 去配置
                </Button>
              </>
            ) : (
              <ComboBox
                className="w-56"
                selectedKey={activeProviderId || null}
                onSelectionChange={(key) => {
                  const nextId = String(key || '');
                  setActiveProviderId(nextId);
                  void setSetting('generate.active_provider_id', nextId);
                }}
                aria-label="选择图片生成提供商"
              >
                <ComboBox.InputGroup>
                  <Input placeholder="选择提供商" />
                  <ComboBox.Trigger />
                </ComboBox.InputGroup>
                <ComboBox.Popover>
                  <ListBox>
                    {providers.map((provider) => (
                      <ListBox.Item key={provider.id} id={provider.id} textValue={provider.name}>
                        {provider.name}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </ComboBox.Popover>
              </ComboBox>
            )}
          </div>
        </div>

        <div className="relative">
          <TextArea
            className="w-full"
            rows={4}
            placeholder="描述你想要生成的图片..."
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            aria-label="图片提示词"
          />
          <div className="absolute bottom-2 right-2">
            <IconAction label="复制提示词" onPress={handleCopyPrompt} isDisabled={!prompt.trim()}>
              <Clipboard size={15} />
            </IconAction>
          </div>
        </div>

        {promptHistory.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">最近使用</span>
            {promptHistory.slice(0, 6).map((item) => (
              <Chip
                key={item}
                size="sm"
                variant="secondary"
                className="max-w-full cursor-pointer"
                onClick={() => setPrompt(item)}
                title={item}
              >
                <Chip.Label className="max-w-[220px] truncate">{item}</Chip.Label>
              </Chip>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          {!isPollinations && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted">尺寸</span>
                <Select
                  className="w-36"
                  value={size}
                  onChange={(value) => handleSizeChange(value as React.Key | null)}
                  aria-label="图片尺寸"
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {IMAGE_SIZE_OPTIONS.map((option) => (
                        <ListBox.Item key={option} id={option} textValue={option}>{option}</ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted">数量</span>
                <NumberField
                  minValue={1}
                  maxValue={MAX_IMAGES_PER_BATCH}
                  value={n}
                  onChange={handleCountChange}
                  aria-label="生成数量"
                >
                  <NumberField.Group>
                    <NumberField.DecrementButton />
                    <NumberField.Input className="w-16" />
                    <NumberField.IncrementButton />
                  </NumberField.Group>
                </NumberField>
              </div>
            </>
          )}
          {!isPollinations && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setShowAdvanced((value) => !value)}
              aria-expanded={showAdvanced}
            >
              <SlidersHorizontal size={15} /> 高级参数
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {loading && <span className="text-xs tabular-nums text-muted">已用时 {formatElapsed(elapsedMs)}</span>}
            {loading ? (
              <Button variant="secondary" onPress={handleCancel}>
                <X size={16} /> 取消生成
              </Button>
            ) : (
              <Button
                onPress={handleGenerate}
                isDisabled={!activeProvider || !prompt.trim()}
              >
                <Sparkles size={16} /> 生成图片
              </Button>
            )}
          </div>
        </div>

        {showAdvanced && !isPollinations && (
          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs text-muted">反向提示词</span>
              <Input
                fullWidth
                value={negativePrompt}
                onChange={(event) => setNegativePrompt(event.target.value)}
                placeholder="不希望出现的内容，可留空"
                aria-label="反向提示词"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">随机种子</span>
              <Input
                type="number"
                fullWidth
                value={seedText}
                onChange={(event) => setSeedText(event.target.value)}
                placeholder="随机"
                aria-label="随机种子"
              />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs text-muted">响应格式</span>
              <Select
                value={responseFormat}
                onChange={(value) => handleFormatChange(value as React.Key | null)}
                aria-label="图片响应格式"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="url" textValue="图片 URL">图片 URL</ListBox.Item>
                    <ListBox.Item id="b64_json" textValue="Base64 图片">Base64 图片</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">质量</span>
              <Select
                value={quality}
                onChange={(value) => handleQualityChange(value as React.Key | null)}
                aria-label="图片质量"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="auto" textValue="自动">自动</ListBox.Item>
                    <ListBox.Item id="low" textValue="低（快速预览）">低（快速预览）</ListBox.Item>
                    <ListBox.Item id="medium" textValue="中（标准）">中（标准）</ListBox.Item>
                    <ListBox.Item id="high" textValue="高（精细）">高（精细）</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          </div>
        )}
      </Card>

      {images.length === 0 && (
        <div className="flex flex-col items-center justify-center py-14 text-center text-muted">
          <ImagePlus size={36} strokeWidth={1.5} />
          <p className="mt-3 text-sm">生成结果会显示在这里</p>
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image) => {
            const source = imageSource(image);
            return (
              <Card key={image.id} className="overflow-hidden p-0">
                <div className="relative aspect-square bg-muted">
                  {image.status === 'generating' && (
                    <div className="generate-haze">
                      <div className="generate-haze__blob generate-haze__blob--1" />
                      <div className="generate-haze__blob generate-haze__blob--2" />
                      <div className="generate-haze__blob generate-haze__blob--3" />
                      <div className="generate-haze__veil" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
                        <Sparkles size={20} className="generate-haze__icon" />
                        <span className="generate-haze__text text-sm">正在生成...</span>
                      </div>
                    </div>
                  )}
                  {image.status === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-danger">
                      <XCircle size={28} />
                      <span className="text-sm font-medium">生成失败</span>
                      <span className="max-w-full break-words text-xs text-muted" title={image.error}>{image.error}</span>
                    </div>
                  )}
                  {image.status === 'done' && source && (
                    <button
                      type="button"
                      className="group block h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => handleView(image)}
                      aria-label="查看大图"
                    >
                      <img
                        src={source}
                        alt={image.prompt}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/45 p-2 text-white opacity-0 transition-opacity group-hover:opacity-100">
                        <ZoomIn size={15} />
                      </span>
                    </button>
                  )}
                </div>

                <div className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm" title={image.prompt}>{image.prompt}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted">
                        <span>{image.size}</span>
                        {image.modelName && <span>· {image.modelName}</span>}
                        {image.seed !== undefined && <span>· seed {image.seed}</span>}
                      </div>
                    </div>
                    {image.status === 'done' && <Chip size="sm" color="success" variant="soft"><Chip.Label>完成</Chip.Label></Chip>}
                    {image.status === 'generating' && <Chip size="sm" color="warning" variant="soft"><Chip.Label>生成中</Chip.Label></Chip>}
                    {image.status === 'error' && <Chip size="sm" color="danger" variant="soft"><Chip.Label>失败</Chip.Label></Chip>}
                  </div>

                  {image.revisedPrompt && (
                    <p className="line-clamp-2 text-xs text-muted" title={image.revisedPrompt}>
                      模型优化：{image.revisedPrompt}
                    </p>
                  )}

                  {image.status === 'done' && source && (
                    <div className="flex flex-wrap items-center gap-1 border-t border-border pt-2">
                      <IconAction label="查看大图" onPress={() => handleView(image)}><ZoomIn size={15} /></IconAction>
                      <IconAction label="下载图片" onPress={() => handleDownload(image)}><Download size={15} /></IconAction>
                      <IconAction label="另存为" onPress={() => handleSaveAs(image)}><Save size={15} /></IconAction>
                      <IconAction label="复制图片" onPress={() => handleCopyImage(image)}><ClipboardCopy size={15} /></IconAction>
                      <IconAction label="设为壁纸" onPress={() => handleSetWallpaper(image)}><ImageIcon size={15} /></IconAction>
                      <IconAction label="重新生成" onPress={() => handleRegenerate(image)} isDisabled={loading}><RefreshCw size={15} /></IconAction>
                      <IconAction label="移除结果" onPress={() => handleRemove(image.id)} isDisabled={loading} className="ml-auto text-danger"><Trash2 size={15} /></IconAction>
                    </div>
                  )}
                  {image.status === 'error' && (
                    <div className="flex items-center justify-end gap-1 border-t border-border pt-2">
                      <Button size="sm" variant="ghost" onPress={() => handleRegenerate(image)} isDisabled={loading}>
                        <RefreshCw size={14} /> 重试
                      </Button>
                      <IconAction label="移除结果" onPress={() => handleRemove(image.id)} isDisabled={loading} className="text-danger"><Trash2 size={15} /></IconAction>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog.Backdrop isOpen={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning"><Trash2 size={20} /></AlertDialog.Icon>
              <AlertDialog.Heading>清空生成结果？</AlertDialog.Heading>
              <p className="text-sm text-muted">是否同时删除已生成的图片文件？</p>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">仅清空记录会保留图片文件；删除文件后图片将无法恢复。</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="ghost" onPress={() => setClearDialogOpen(false)}>取消</Button>
              <Button variant="secondary" onPress={() => confirmClear(false)}>仅清空记录</Button>
              <Button variant="danger" onPress={() => confirmClear(true)}>删除文件</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}
