import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@heroui/react', () => ({
  toast: { success: vi.fn(), danger: vi.fn(), close: vi.fn(), info: vi.fn(), promise: vi.fn() },
}));
vi.mock('@/lib/log', () => ({ logError: vi.fn() }));

import { fetchBlobWithProgress } from './download';

const URL = 'https://example.com/wallpaper.jpg';
const noop = () => {};

function streamResponse(chunks: Uint8Array[], headers: Record<string, string>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return { ok: true, status: 200, headers: new Headers(headers), body } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchBlobWithProgress error messages', () => {
  it('includes the url when fetch rejects at the network layer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchBlobWithProgress(URL, noop)).rejects.toThrow(`Failed to fetch (${URL})`);
  });

  it('includes the url for http status errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      body: null,
    } as unknown as Response));
    await expect(fetchBlobWithProgress(URL, noop)).rejects.toThrow(`HTTP 404: ${URL}`);
  });

  it('includes the url when the body is truncated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      streamResponse([new TextEncoder().encode('12345')], { 'content-length': '10' }),
    ));
    await expect(fetchBlobWithProgress(URL, noop)).rejects.toThrow(`收到 5 字节, 预期 10 字节 (${URL})`);
  });

  it('includes the url on timeout without double wrapping', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        })
      )));
      const pending = fetchBlobWithProgress(URL, noop, { timeoutMs: 100 });
      const assertion = expect(pending).rejects.toThrow(`下载超时: ${URL}`);
      await vi.advanceTimersByTimeAsync(200);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
