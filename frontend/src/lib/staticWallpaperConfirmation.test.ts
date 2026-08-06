import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  confirmStaticWallpaperSwitch,
  registerStaticWallpaperConfirmationHandler,
} from './staticWallpaperConfirmation';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('static wallpaper confirmation', () => {
  it('returns false when no handler is registered', async () => {
    expect(await confirmStaticWallpaperSwitch()).toBe(false);
  });

  it('uses the registered handler until it is removed', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    cleanup = registerStaticWallpaperConfirmationHandler(handler);

    expect(await confirmStaticWallpaperSwitch()).toBe(true);
    expect(handler).toHaveBeenCalledOnce();

    cleanup();
    cleanup = undefined;
    expect(await confirmStaticWallpaperSwitch()).toBe(false);
  });

  it('shares one in-flight confirmation between concurrent callers', async () => {
    let resolveConfirmation: ((value: boolean) => void) | undefined;
    const handler = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve;
    }));
    cleanup = registerStaticWallpaperConfirmationHandler(handler);

    const first = confirmStaticWallpaperSwitch();
    const second = confirmStaticWallpaperSwitch();

    expect(first).toBe(second);
    expect(handler).toHaveBeenCalledOnce();
    resolveConfirmation?.(true);
    await expect(first).resolves.toBe(true);
  });
});
