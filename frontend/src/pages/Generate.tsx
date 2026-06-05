import { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Input, ComboBox, ListBox, TextArea, NumberField,
} from '@heroui/react';
import { Wand2, Download, Image as ImageIcon, Loader2, Trash2, Settings } from 'lucide-react';
import { getSetting, downloadFile, setWallpaper, addToHistory } from '@/api/backend';
import { generateImage, SIZE_OPTIONS } from '@/api/generate';
import type { ImageProviderConfig } from '@/types';

interface GeneratedImage {
  id: string;
  url?: string;
  b64_json?: string;
  prompt: string;
  status: 'generating' | 'done' | 'error';
  error?: string;
}

export default function Generate() {
  const [providers, setProviders] = useState<ImageProviderConfig[]>([]);
  const [activeProviderId, setActiveProviderId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [n, setN] = useState(1);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getSetting('generate.providers').then((p) => setProviders(Array.isArray(p) ? p : []));
    getSetting('generate.active_provider_id').then((id) => setActiveProviderId(String(id || '')));
    getSetting('generate.default_size').then((s) => s && setSize(String(s)));
    getSetting('generate.default_n').then((v) => v && setN(Number(v)));
  }, []);

  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const sizeOptions = activeProvider ? (SIZE_OPTIONS[activeProvider.format] || SIZE_OPTIONS['openai-compatible']) : [];

  const handleGenerate = async () => {
    if (!activeProvider || !prompt.trim()) return;
    setLoading(true);

    const newImages: GeneratedImage[] = [];
    const batchIds: string[] = [];
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      const id = `${now}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      batchIds.push(id);
      newImages.push({
        id,
        prompt: prompt.trim(),
        status: 'generating',
      });
    }
    setImages((prev) => [...prev, ...newImages]);

    try {
      const resp = await generateImage(activeProvider, prompt.trim(), {
        size,
        n,
        responseFormat: 'url',
      });

      setImages((prev) =>
        prev.map((img) => {
          const idx = batchIds.indexOf(img.id);
          if (idx === -1) return img;
          const item = resp.data?.[idx];
          if (item?.url || item?.b64_json) {
            return { ...img, url: item.url, b64_json: item.b64_json, status: 'done' };
          }
          return { ...img, status: 'error', error: '未返回图片' };
        })
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setImages((prev) =>
        prev.map((img) =>
          batchIds.includes(img.id) ? { ...img, status: 'error', error: msg } : img
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = useCallback(async (img: GeneratedImage) => {
    if (!img.url) return;
    try {
      await downloadFile(img.url, `generated-${img.id}.png`);
    } catch {
      // ignore
    }
  }, []);

  const handleSetWallpaper = useCallback(async (img: GeneratedImage) => {
    if (!img.url) return;
    try {
      const path = await downloadFile(img.url, `generated-${img.id}.png`);
      if (path) {
        await setWallpaper(path);
        await addToHistory(path, img.prompt.slice(0, 30), 'generated');
      }
    } catch {
      // ignore
    }
  }, []);

  const handleRemove = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const handleClear = useCallback(() => {
    setImages([]);
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">生成</h1>
        {images.length > 0 && (
          <Button variant="ghost" size="sm" onPress={handleClear} isDisabled={loading}>
            <Trash2 size={14} /> 清空
          </Button>
        )}
      </div>

      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <ImageIcon size={18} className="text-muted" />
          <span className="text-sm text-muted">提供商</span>
          {providers.length === 0 ? (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-danger">未配置</span>
              <Button size="sm" variant="ghost" onPress={() => window.location.hash = '#/settings/generate'}>
                <Settings size={14} /> 去配置
              </Button>
            </div>
          ) : (
            <ComboBox
              className="ml-auto w-48"
              selectedKey={activeProviderId || null}
              onSelectionChange={(key) => setActiveProviderId(String(key || ''))}
            >
              <ComboBox.InputGroup>
                <Input />
                <ComboBox.Trigger />
              </ComboBox.InputGroup>
              <ComboBox.Popover>
                <ListBox>
                  {providers.map((p) => (
                    <ListBox.Item key={p.id} id={p.id} textValue={p.name}>
                      {p.name}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </ComboBox.Popover>
            </ComboBox>
          )}
        </div>

        <div>
          <TextArea
            className="w-full"
            rows={3}
            placeholder="描述你想要生成的图片..."
            value={prompt}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">尺寸</span>
            <ComboBox
              className="w-32"
              selectedKey={size}
              onSelectionChange={(key) => setSize(String(key))}
            >
              <ComboBox.InputGroup>
                <Input />
                <ComboBox.Trigger />
              </ComboBox.InputGroup>
              <ComboBox.Popover>
                <ListBox>
                  {sizeOptions.map((s) => (
                    <ListBox.Item key={s} id={s} textValue={s}>{s}</ListBox.Item>
                  ))}
                  {sizeOptions.length === 0 && <ListBox.Item id={size} textValue={size}>{size}</ListBox.Item>}
                </ListBox>
              </ComboBox.Popover>
            </ComboBox>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">数量</span>
            <NumberField
              minValue={1}
              maxValue={4}
              value={n}
              onChange={(value) => setN(value ?? 1)}
            >
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input className="w-16" />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
          </div>
          <Button
            className="ml-auto"
            onPress={handleGenerate}
            isDisabled={!activeProvider || !prompt.trim() || loading}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
            {loading ? '生成中...' : '生成'}
          </Button>
        </div>
      </Card>

      {images.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {images.map((img) => (
            <Card key={img.id} className="overflow-hidden">
              <div className="aspect-square bg-muted flex items-center justify-center">
                {img.status === 'generating' && (
                  <div className="flex flex-col items-center gap-2 text-muted">
                    <Loader2 size={32} className="animate-spin" />
                    <span className="text-sm">生成中...</span>
                  </div>
                )}
                {img.status === 'error' && (
                  <div className="flex flex-col items-center gap-2 text-danger">
                    <span className="text-sm">生成失败</span>
                    <span className="max-w-[200px] truncate text-xs">{img.error}</span>
                  </div>
                )}
                {img.status === 'done' && img.url && (
                  <img
                    src={img.url}
                    alt={img.prompt}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
                {img.status === 'done' && img.b64_json && !img.url && (
                  <img
                    src={`data:image/png;base64,${img.b64_json}`}
                    alt={img.prompt}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              {img.status === 'done' && (
                <div className="flex items-center gap-1 p-2">
                  <Button size="sm" variant="ghost" onPress={() => handleDownload(img)}>
                    <Download size={14} />
                  </Button>
                  <Button size="sm" variant="ghost" onPress={() => handleSetWallpaper(img)}>
                    设为壁纸
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto" onPress={() => handleRemove(img.id)} isDisabled={loading}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              )}
              {img.status === 'error' && (
                <div className="flex justify-end p-2">
                  <Button size="sm" variant="ghost" onPress={() => handleRemove(img.id)} isDisabled={loading}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
