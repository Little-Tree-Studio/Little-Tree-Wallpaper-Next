import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();

async function loadLogger() {
  vi.resetModules();
  return await import('./log');
}

function stubWindow(token: string | null) {
  vi.stubGlobal('window', {
    location: new URL('http://127.0.0.1:49152/'),
    sessionStorage: {
      getItem: (key: string) => (key === '__ltw_api_token__' ? token : null),
    },
  });
}

function lastReport(): { level: string; message: string; details: string | null } {
  const calls = fetchMock.mock.calls;
  const [, init] = calls[calls.length - 1] ?? [];
  const body = JSON.parse(String(init?.body)) as { args: [string, string, string | null] };
  return { level: body.args[0], message: body.args[1], details: body.args[2] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(Response.json({ result: { ok: true } }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('frontend log forwarding', () => {
  it('forwards errors to the backend with context, message and stack', async () => {
    stubWindow('test-token');
    const { logError } = await loadLogger();
    logError('下载失败，请重试', new Error('HTTP 404: https://example.com/a.jpg'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/rpc/log_frontend');
    expect(init?.headers).toMatchObject({ 'X-Api-Token': 'test-token' });
    expect(lastReport().level).toBe('error');
    expect(lastReport().message).toBe('下载失败，请重试: HTTP 404: https://example.com/a.jpg');
    expect(lastReport().details).toContain('Error: HTTP 404: https://example.com/a.jpg');
  });

  it('forwards warnings as warning level', async () => {
    stubWindow('test-token');
    const { warn } = await loadLogger();
    warn('镜像不可用', 'https://example.com');
    expect(lastReport().level).toBe('warning');
    expect(lastReport().message).toBe('镜像不可用');
    expect(lastReport().details).toBe('https://example.com');
  });

  it('does not forward debug or info messages', async () => {
    stubWindow('test-token');
    const { debug, info } = await loadLogger();
    debug('调试');
    info('提示');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not forward without an api token', async () => {
    stubWindow(null);
    const { error } = await loadLogger();
    error('后端未就绪');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deduplicates identical messages within the throttle window', async () => {
    stubWindow('test-token');
    const { error } = await loadLogger();
    error('重复错误');
    error('重复错误');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps reports per window so unique errors cannot flood the backend', async () => {
    stubWindow('test-token');
    const { error } = await loadLogger();
    for (let index = 0; index < 25; index += 1) error(`错误 ${index}`);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it('never surfaces transport failures from reporting', async () => {
    stubWindow('test-token');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { error } = await loadLogger();
    expect(() => error('下载失败')).not.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
