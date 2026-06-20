/**
 * Lightweight frontend logger.
 *
 * In development (or when a future debug setting is enabled) messages are
 * forwarded to the browser console. In production only warnings and errors are
 * emitted by default, so the console stays quiet during normal operation.
 */

/// <reference types="vite/client" />

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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

export function log(level: LogLevel, message: string, ...args: unknown[]): void {
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
