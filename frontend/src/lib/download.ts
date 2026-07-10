/**
 * Shared helpers for the download / copy / set-wallpaper surface.
 *
 * The previous code had five near-identical `*WithProgress` functions (one per
 * action), each managing its own toast lifecycle. They all suffered the same
 * bugs: no Content-Length check, no timeout, no AbortController, no success
 * toast for the "open" action. This module centralises:
 *
 *   - the underlying streaming fetch (`fetchBlobWithProgress`)
 *   - a `safeNameForFile` helper used everywhere a UI label becomes a filename
 *   - a `runWithProgressToast` higher-order function that wraps any async
 *     operation in a single, consistent loading/success/error toast
 *
 * Action-specific functions live in `@/api/backend.ts` and now delegate here.
 */

import { toast } from '@heroui/react';
import { logError } from '@/lib/log';

// 120s default: a 4K JPEG on a slow CDN (≈ 1 Mbps) is ~80s; a 200 MiB
// raw image would be longer but the server already caps uploads at 200 MiB.
const DEFAULT_TIMEOUT_MS = 120_000;

export interface FetchProgress {
  /** Percentage 0..100 when the server advertised Content-Length, else null. */
  percent: number | null;
  /** Bytes received so far. */
  received: number;
  /** Total bytes declared by the server, or null when missing. */
  total: number | null;
}

export interface FetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * Stream ``url`` into a Blob, calling ``onProgress`` as chunks arrive.
 *
 * Validates that the received byte count matches the advertised
 * ``Content-Length`` so that a silently-truncated response (server crash,
 * CDN edge hiccup) cannot produce a half-written Blob. Supports an external
 * ``AbortSignal`` plus an internal timeout (default 120s).
 */
export async function fetchBlobWithProgress(
  url: string,
  onProgress: (progress: FetchProgress) => void,
  options: FetchOptions = {}
): Promise<Blob> {
  const { signal: externalSignal, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = options;

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', onExternalAbort);
  const timeoutId = setTimeout(() => controller.abort(new Error('fetch timeout')), timeoutMs);

  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const totalHeader = res.headers.get('content-length');
    const total = totalHeader && /^\d+$/.test(totalHeader) ? Number(totalHeader) : null;
    if (!res.body) {
      // Server returned no body — treat as empty download.
      if (total !== null && total !== 0) {
        throw new Error('下载不完整: 服务器未返回正文');
      }
      onProgress({ percent: 100, received: 0, total: 0 });
      return new Blob();
    }

    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;

    // Avoid holding a huge array in memory for very large downloads; for the
    // 200 MiB cap enforced on the server, this stays well within browser
    // memory limits. A streaming-to-disk variant can be slotted in later
    // without changing the public signature.
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress({
        percent: total ? Math.round((received / total) * 100) : null,
        received,
        total,
      });
    }

    if (total !== null && received !== total) {
      throw new Error(`下载不完整: 收到 ${received} 字节, 预期 ${total} 字节`);
    }

    return new Blob(chunks);
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Build a safe, deterministic filename from a UI label.
 *
 * Mirrors the backend ``sanitize_filename`` rule (strip path separators and
 * reserved characters) so the filename the UI shows is the filename the
 * server actually writes to disk. Truncates the label to 50 characters to
 * avoid OS-level filename-length errors on Windows.
 */
export function safeNameForFile(label: string | null | undefined, fallback = 'wallpaper'): string {
  const raw = (label || '').trim() || fallback;
  return raw.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 50) || fallback;
}

export interface RunWithProgressOptions {
  /** Toast title shown while the action runs. */
  loadingLabel: string;
  /** Toast description template; receives the latest progress. */
  loadingDescription?: (progress: FetchProgress) => string;
  /** Toast title when the action succeeds. */
  successLabel?: string;
  /** Toast title when the action fails. */
  failureLabel?: string;
  /** Optional override for the success toast timeout. */
  successTimeout?: number;
  /** Optional override for the failure toast timeout. */
  failureTimeout?: number;
}

type ProgressAwareStep = (onProgress: (progress: FetchProgress) => void) => Promise<unknown>;

/**
 * Run ``action`` while a single Hero UI toast shows progress. Replaces the
 * five hand-rolled `toast.close` / `toast(...)` / `toast.success` blocks that
 * used to live inside every `*WithProgress` function.
 *
 * On success: dismisses the loading toast and emits ``successLabel``.
 * On error: dismisses the loading toast and emits ``failureLabel``.
 */
export async function runWithProgressToast<T>(
  options: RunWithProgressOptions,
  action: (updateProgress: (p: FetchProgress) => void) => Promise<T>
): Promise<T | null> {
  let toastId: string | undefined;
  try {
    toastId = toast(options.loadingLabel, { isLoading: true, timeout: 0 });
    const updateProgress = (p: FetchProgress) => {
      if (toastId === undefined) return;
      const desc = options.loadingDescription?.(p);
      const current = toastId;
      toast.close(current);
      toastId = toast(options.loadingLabel, {
        isLoading: true,
        timeout: 0,
        ...(desc ? { description: desc } : {}),
      });
    };
    const result = await action(updateProgress);
    if (toastId !== undefined) {
      toast.close(toastId);
      toastId = undefined;
    }
    if (options.successLabel) {
      toast.success(options.successLabel, { timeout: options.successTimeout ?? 3000 });
    }
    return result;
  } catch (e) {
    if (toastId !== undefined) {
      toast.close(toastId);
      toastId = undefined;
    }
    logError(options.loadingLabel, e);
    toast.danger(options.failureLabel ?? '操作失败', {
      timeout: options.failureTimeout ?? 0,
    });
    return null;
  }
}

export function formatProgressDescription(p: FetchProgress): string {
  return p.percent !== null
    ? `已下载 ${p.percent}%`
    : `已下载 ${(p.received / 1024).toFixed(1)} KB`;
}

export type { ProgressAwareStep };
