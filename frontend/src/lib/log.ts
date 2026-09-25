/**
 * Lightweight frontend logger.
 *
 * In development (or when a future debug setting is enabled) messages are
 * forwarded to the browser console. In production only warnings and errors are
 * emitted by default, so the console stays quiet during normal operation.
 *
 * Warnings and errors are also forwarded to the backend so they land in the
 * application log file: packaged builds have no visible console, and failures
 * that only surface as a toast (for example a failed favorite download) must
 * stay diagnosable from the debug panel.
 */

/// <reference types="vite/client" />

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const TOKEN_STORAGE_KEY = '__ltw_api_token__';

const BACKEND_LEVELS: Record<LogLevel, string> = {
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
};

// Keep the log file readable when the same failure repeats (polling loops,
// image grids, ...): one report per distinct message per window, plus a global
// cap so a burst of unique errors cannot flood the log.
const DEDUP_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 20;
const MAX_TRACKED_MESSAGES = 200;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_DETAILS_LENGTH = 4000;

const reportedAt = new Map<string, number>();
let windowStartedAt = 0;
let windowReportCount = 0;

function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.location.search.includes('debug=true')) return true;
    if (window.sessionStorage.getItem('__ltw_debug__') === '1') return true;
  } catch {
    /* storage may be unavailable */
  }
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

function shouldEmit(level: LogLevel): boolean {
  if (level === 'error' || level === 'warn') return true;
  return isDebugEnabled();
}

function formatMessage(level: LogLevel, message: string): string {
  return `[LTW][${level.toUpperCase()}] ${message}`;
}

function serializeDetails(args: unknown[]): string | undefined {
  const parts = args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg) ?? String(arg);
      } catch {
        return String(arg);
      }
    })
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * Mirror a console log entry into the backend application log. Only warnings
 * and errors are forwarded; transport failures are swallowed so that logging
 * can never break the caller or recurse into itself.
 */
function reportToBackend(level: LogLevel, message: string, args: unknown[]): void {
  if (typeof window === 'undefined' || (level !== 'warn' && level !== 'error')) return;

  const now = Date.now();
  if (now - windowStartedAt > DEDUP_WINDOW_MS) {
    windowStartedAt = now;
    windowReportCount = 0;
  }
  if (windowReportCount >= MAX_REPORTS_PER_WINDOW) return;

  const previous = reportedAt.get(message);
  if (previous !== undefined && now - previous < DEDUP_WINDOW_MS) return;
  if (reportedAt.size >= MAX_TRACKED_MESSAGES) {
    const oldest = reportedAt.keys().next().value;
    if (oldest !== undefined) reportedAt.delete(oldest);
  }
  reportedAt.set(message, now);
  windowReportCount += 1;

  let token: string | null = null;
  try {
    token = window.sessionStorage?.getItem(TOKEN_STORAGE_KEY) ?? null;
  } catch {
    token = null;
  }
  if (!token) return;

  const details = serializeDetails(args)?.slice(0, MAX_DETAILS_LENGTH);
  try {
    void fetch('/api/rpc/log_frontend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Token': token },
      body: JSON.stringify({
        args: [BACKEND_LEVELS[level], message.slice(0, MAX_MESSAGE_LENGTH), details ?? null],
      }),
      keepalive: true,
    }).catch(() => {
      /* reporting is best-effort */
    });
  } catch {
    /* ignore synchronous fetch failures */
  }
}

export function log(level: LogLevel, message: string, ...args: unknown[]): void {
  reportToBackend(level, message, args);
  if (!shouldEmit(level)) return;
  const formatted = formatMessage(level, message);
  switch (level) {
    case 'debug':
      console.debug(formatted, ...args);
      break;
    case 'info':
      console.log(formatted, ...args);
      break;
    case 'warn':
      console.warn(formatted, ...args);
      break;
    case 'error':
      console.error(formatted, ...args);
      break;
  }
}

export function debug(message: string, ...args: unknown[]): void {
  log('debug', message, ...args);
}

export function info(message: string, ...args: unknown[]): void {
  log('info', message, ...args);
}

export function warn(message: string, ...args: unknown[]): void {
  log('warn', message, ...args);
}

export function error(message: string, ...args: unknown[]): void {
  log('error', message, ...args);
}

/**
 * Log an Error instance with its stack trace in a single line.
 */
export function logError(context: string, err: unknown): void {
  if (err instanceof Error) {
    error(`${context}: ${err.message}`, err.stack);
  } else {
    error(context, err);
  }
}
