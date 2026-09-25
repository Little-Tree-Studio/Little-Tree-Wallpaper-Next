import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmStaticWallpaperSwitch } from '@/lib/staticWallpaperConfirmation';
import { fetchBlobWithProgress } from '@/lib/download';

vi.mock('@heroui/react', () => ({ toast: { success: vi.fn() } }));
vi.mock('@/lib/log', () => ({ logError: vi.fn() }));
vi.mock('@/lib/staticWallpaperConfirmation', () => ({
  confirmStaticWallpaperSwitch: vi.fn(),
}));
vi.mock('@/lib/download', () => ({
  fetchBlobWithProgress: vi.fn(),
  formatProgressDescription: vi.fn(),
  runWithProgressToast: async (_options: unknown, run: () => Promise<unknown>) => {
    try {
      return await run();
    } catch {
      return null;
    }
  },
}));

let backend: typeof import('./backend');
let events: string[];
let responses: Map<string, unknown>;
const rpc = vi.fn<(method: string, args: unknown[]) => Promise<unknown>>();
const fetchMock = vi.fn<typeof fetch>();
const path = 'C:/wallpapers/test.jpg';

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  events = [];
  responses = new Map([
    ['get_dynamic_wallpaper_status', { running: false, operation_busy: false }],
  ]);
  rpc.mockImplementation(async (method) => {
    if (!responses.has(method)) throw new Error(`Unexpected RPC: ${method}`);
    return responses.get(method);
  });
  fetchMock.mockImplementation(async (input, init) => {
    if (input === '/api/health') return Response.json({});
    if (String(input).startsWith('/api/save-download?')) return Response.json({ path });
    const method = String(input).replace('/api/rpc/', '');
    const result = await rpc(method, JSON.parse(String(init?.body)).args);
    if (result instanceof Error) {
      return Response.json({ error: { message: result.message } }, { status: 500 });
    }
    return Response.json({ result });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', Object.assign(new EventTarget(), {
    location: new URL('http://localhost/?token=test-token'),
    sessionStorage: { getItem: () => 'test-token' },
  }));
  vi.mocked(confirmStaticWallpaperSwitch).mockResolvedValue(false);
  vi.mocked(fetchBlobWithProgress).mockResolvedValue(new Blob(['image'], { type: 'image/jpeg' }));
  backend = await import('./backend');
  for (const event of [
    backend.WALLPAPER_CHANGED_EVENT,
    backend.HISTORY_CHANGED_EVENT,
    backend.FAVORITES_CHANGED_EVENT,
  ]) {
    window.addEventListener(event, () => events.push(event));
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('wallpaper events', () => {
  it('exports stable event names', () => {
    expect(backend.WALLPAPER_CHANGED_EVENT).toBe('ltw:wallpaper-changed');
    expect(backend.HISTORY_CHANGED_EVENT).toBe('ltw:history-changed');
  });

  it('notifies only after application succeeds, without another history write', async () => {
    let finish!: (result: unknown) => void;
    const result = new Promise((resolve) => { finish = resolve; });
    responses.set('set_wallpaper', result);
    const request = backend.setWallpaper(path);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('set_wallpaper', [path, false]));
    expect(events).toEqual([]);
    finish({ success: true });
    await expect(request).resolves.toEqual({ success: true });
    expect(events).toEqual([backend.WALLPAPER_CHANGED_EVENT, backend.HISTORY_CHANGED_EVENT]);
    expect(rpc.mock.calls).toEqual([
      ['get_dynamic_wallpaper_status', []],
      ['set_wallpaper', [path, false]],
    ]);
  });

  it.each([
    { success: false, error: 'Cannot apply' },
    { success: false, cancelled: true },
    { success: true, cancelled: true },
  ])('does not notify for setWallpaper result %j', async (result) => {
    responses.set('set_wallpaper', result);
    await expect(backend.setWallpaper(path)).resolves.toEqual(result);
    expect(events).toEqual([]);
  });

  it.each([false, true])('does not notify while confirmation is required (success=%s)', async (success) => {
    responses.set('set_wallpaper', { success, requires_confirmation: true });
    await expect(backend.setWallpaper(path)).resolves.toEqual({ success: false, cancelled: true });
    expect(confirmStaticWallpaperSwitch).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    { success: true },
    { success: false, error: 'Cannot apply' },
    { success: true, cancelled: true },
    { success: true, requires_confirmation: true },
  ])('notifies only for the successful confirmed retry: %j', async (result) => {
    responses.set('set_wallpaper', { success: true, requires_confirmation: true });
    vi.mocked(confirmStaticWallpaperSwitch).mockImplementationOnce(async () => {
      expect(events).toEqual([]);
      responses.set('set_wallpaper', result);
      return true;
    });
    await expect(backend.setWallpaper(path)).resolves.toEqual(result);
    expect(rpc.mock.calls).toEqual([
      ['get_dynamic_wallpaper_status', []],
      ['set_wallpaper', [path, false]],
      ['set_wallpaper', [path, true]],
    ]);
    expect(events).toEqual(
      result.success && !('cancelled' in result) && !('requires_confirmation' in result)
        ? [backend.WALLPAPER_CHANGED_EVENT, backend.HISTORY_CHANGED_EVENT] : [],
    );
  });

  it.each([false, true])('preserves dynamic wallpaper preflight confirmation: %s', async (confirmed) => {
    responses.set('get_dynamic_wallpaper_status', { running: true, operation_busy: false });
    responses.set('set_wallpaper', { success: true });
    vi.mocked(confirmStaticWallpaperSwitch).mockResolvedValue(confirmed);
    await expect(backend.setWallpaper(path)).resolves.toEqual(
      confirmed ? { success: true } : { success: false, cancelled: true },
    );
    expect(rpc.mock.calls).toEqual(confirmed ? [
      ['get_dynamic_wallpaper_status', []], ['set_wallpaper', [path, true]],
    ] : [['get_dynamic_wallpaper_status', []]]);
    expect(events).toEqual(confirmed
      ? [backend.WALLPAPER_CHANGED_EVENT, backend.HISTORY_CHANGED_EVENT] : []);
  });

  it.each([
    { confirmed: true, result: { success: true }, changed: true },
    { confirmed: false, result: { success: true, cancelled: true }, changed: false },
    { confirmed: true, result: { success: false, error: 'Expired task' }, changed: false },
    { confirmed: true, result: { success: false, cancelled: true }, changed: false },
    { confirmed: true, result: { success: true, requires_confirmation: true }, changed: false },
  ])('handles pending wallpaper resolution: %j', async ({ confirmed, result, changed }) => {
    responses.set('resolve_pending_static_wallpaper', result);
    await expect(backend.resolvePendingStaticWallpaper('task-id', confirmed)).resolves.toEqual(result);
    expect(rpc.mock.calls).toEqual([['resolve_pending_static_wallpaper', ['task-id', confirmed]]]);
    expect(events).toEqual(changed
      ? [backend.WALLPAPER_CHANGED_EVENT, backend.HISTORY_CHANGED_EVENT] : []);
  });

  describe.each(['local', 'download'] as const)('%s progress wrapper', (source) => {
    it.each([
      { result: { success: true }, changed: true },
      { result: { success: false, error: 'Cannot apply' }, changed: false },
      { result: { success: true, cancelled: true }, changed: false },
      { result: { success: false, requires_confirmation: true }, changed: false },
    ])('notifies through setWallpaperRaw: %j', async ({ result, changed }) => {
      responses.set('set_wallpaper', result);
      responses.set('get_setting', {});
      await expect(backend.setWallpaperWithProgress(
        'https://example.com/test.jpg', 'test.jpg', source === 'local' ? path : null,
      )).resolves.toBe(changed ? path : null);
      expect(events).toEqual(changed
        ? [backend.WALLPAPER_CHANGED_EVENT, backend.HISTORY_CHANGED_EVENT] : []);
      expect(rpc.mock.calls.map(([method]) => method)).toEqual(source === 'local'
        ? ['get_dynamic_wallpaper_status', 'set_wallpaper']
        : ['get_dynamic_wallpaper_status', 'get_setting', 'set_wallpaper']);
    });
  });
});

const historyMutations = [
  { method: 'add_to_history', run: () => backend.addToHistory(path, 'Test', 'manual'), args: [path, 'Test', 'manual'], result: null },
  { method: 'clear_history', run: () => backend.clearHistory(), args: [], result: null },
  { method: 'delete_history_item', run: () => backend.deleteHistoryItem(path), args: [path], result: true },
  { method: 'record_current_wallpaper', run: () => backend.recordCurrentWallpaper(), args: [], result: { path, filename: 'test.jpg' } },
];

describe('history events', () => {
  it.each(historyMutations)('notifies history only after $method succeeds', async ({ method, run, args, result }) => {
    let finish!: (value: unknown) => void;
    responses.set(method, new Promise((resolve) => { finish = resolve; }));
    const request = run();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith(method, args));
    expect(events).toEqual([]);
    finish(result);
    await expect(request).resolves.toEqual(result);
    expect(events).toEqual([backend.HISTORY_CHANGED_EVENT]);
    expect(rpc.mock.calls).toEqual([[method, args]]);
  });

  it('does not notify when deletion returns false', async () => {
    responses.set('delete_history_item', false);
    await expect(backend.deleteHistoryItem(path)).resolves.toBe(false);
    expect(events).toEqual([]);
  });

  it.each([null, {}, { path: '' }, { path: null }, { path: false }])(
    'does not notify when recording returns no actual path: %j', async (result) => {
      responses.set('record_current_wallpaper', result);
      await expect(backend.recordCurrentWallpaper()).resolves.toEqual(result);
      expect(events).toEqual([]);
    },
  );
});

describe('event boundaries', () => {
  it.each([
    ...historyMutations,
    { method: 'set_wallpaper', run: () => backend.setWallpaper(path) },
    { method: 'resolve_pending_static_wallpaper', run: () => backend.resolvePendingStaticWallpaper('task-id', true) },
  ])('propagates RPC failure without notifications: $method', async ({ method, run }) => {
    responses.set(method, new Error('RPC failed'));
    await expect(run()).rejects.toThrow('RPC failed');
    expect(events).toEqual([]);
  });

  it('does not notify after a transport failure', async () => {
    await backend.waitForApi();
    fetchMock.mockRejectedValueOnce(new Error('Offline'));
    await expect(backend.clearHistory()).rejects.toThrow();
    expect(events).toEqual([]);
  });

  it('keeps favorites notifications caller-driven', async () => {
    responses.set('remove_favorite', null);
    await backend.removeFavorite('favorite-id');
    expect(events).toEqual([]);
    backend.notifyFavoritesChanged();
    expect(events).toEqual([backend.FAVORITES_CHANGED_EVENT]);
  });

  it('allows successful mutations without window after API readiness', async () => {
    await backend.waitForApi();
    vi.stubGlobal('window', undefined);
    responses.set('set_wallpaper', { success: true });
    await expect(backend.setWallpaper(path)).resolves.toEqual({ success: true });
    expect(events).toEqual([]);
  });
});

describe('media proxying', () => {
  it('routes remote downloads through the backend image proxy', async () => {
    responses.set('get_setting', {});
    const remote = 'https://pixiv.azuremio.top/img-original/img/a.jpg';
    await expect(backend.downloadWithProgress(remote, 'a.jpg')).resolves.toBe(path);

    const [requestedUrl] = vi.mocked(fetchBlobWithProgress).mock.calls[0];
    const parsed = new URL(requestedUrl, 'http://localhost');
    expect(parsed.pathname).toBe('/api/sniff-image');
    expect(parsed.searchParams.get('url')).toBe(remote);
  });

  it('keeps same-origin media urls direct', async () => {
    responses.set('get_setting', {});
    const local = '/api/preview?path=C%3A%2Fwallpapers%2Fa.jpg';
    await expect(backend.downloadWithProgress(local, 'a.jpg')).resolves.toBe(path);
    const [requestedUrl] = vi.mocked(fetchBlobWithProgress).mock.calls[0];
    expect(requestedUrl).toBe(local);
    expect(requestedUrl).not.toContain('/api/sniff-image');
  });
});
