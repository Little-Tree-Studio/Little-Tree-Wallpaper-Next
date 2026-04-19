import { useEffect, useState } from 'react';

import { desktopApi } from './api';
import { isLocalThemeAssetReference, resolveThemeAssetSource } from './themeSystem';

const themeAssetSourceCache = new Map<string, Promise<string>>();

function decodeBase64ToBlobUrl(base64Value: string, mimeType: string): string {
  const binary = window.atob(base64Value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' });
  return URL.createObjectURL(blob);
}

async function loadThemeAssetSource(assetRef: string): Promise<string> {
  const normalizedRef = String(assetRef).trim();
  if (!normalizedRef) {
    return '';
  }
  if (!isLocalThemeAssetReference(normalizedRef)) {
    return resolveThemeAssetSource(normalizedRef);
  }
  const payload = await desktopApi.readThemeAsset(normalizedRef);
  if (!payload?.data_base64) {
    return '';
  }
  return decodeBase64ToBlobUrl(payload.data_base64, payload.mime_type);
}

function getOrCreateThemeAssetSource(assetRef: string): Promise<string> {
  const normalizedRef = String(assetRef).trim();
  const cached = themeAssetSourceCache.get(normalizedRef);
  if (cached) {
    return cached;
  }
  const pending = loadThemeAssetSource(normalizedRef);
  themeAssetSourceCache.set(normalizedRef, pending);
  return pending;
}

export function useResolvedThemeAssetSource(assetRef?: string | null): string {
  const [resolvedSource, setResolvedSource] = useState(() => {
    if (!assetRef || isLocalThemeAssetReference(assetRef)) {
      return '';
    }
    return resolveThemeAssetSource(assetRef);
  });

  useEffect(() => {
    let disposed = false;
    const normalizedRef = String(assetRef ?? '').trim();
    if (!normalizedRef) {
      setResolvedSource('');
      return () => {
        disposed = true;
      };
    }
    if (!isLocalThemeAssetReference(normalizedRef)) {
      setResolvedSource(resolveThemeAssetSource(normalizedRef));
      return () => {
        disposed = true;
      };
    }

    void getOrCreateThemeAssetSource(normalizedRef)
      .then((nextSource) => {
        if (!disposed) {
          setResolvedSource(nextSource);
        }
      })
      .catch(() => {
        if (!disposed) {
          setResolvedSource('');
        }
      });

    return () => {
      disposed = true;
    };
  }, [assetRef]);

  return resolvedSource;
}