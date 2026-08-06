import { describe, expect, it } from 'vitest';

import { DEFAULT_DOCUMENT } from './types';
import { decodeWallpaperProject, encodeWallpaperProject, isValidWallpaperDocument } from './projectFormat';

describe('wallpaper project format', () => {
  it('round-trips a valid document', async () => {
    const document = structuredClone(DEFAULT_DOCUMENT);
    document.width = 2560;
    document.background.color = '#123456';

    const encoded = encodeWallpaperProject(document);
    const decoded = await decodeWallpaperProject(encoded as File);

    expect(encoded.type).toBe('application/x-little-tree-wallpaper-project');
    expect(decoded).toEqual(document);
    expect(decoded).not.toBe(document);
  });

  it('rejects invalid document dimensions before encoding', () => {
    const document = structuredClone(DEFAULT_DOCUMENT);
    document.width = 63;

    expect(isValidWallpaperDocument(document)).toBe(false);
    expect(() => encodeWallpaperProject(document)).toThrow('当前项目包含无效数据');
  });

  it('detects payload corruption', async () => {
    const encoded = encodeWallpaperProject(structuredClone(DEFAULT_DOCUMENT));
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    bytes[bytes.length - 1] ^= 0xff;

    await expect(decodeWallpaperProject(new Blob([bytes]) as File)).rejects.toThrow('项目文件校验失败');
  });

  it('rejects unsupported format versions', async () => {
    const encoded = encodeWallpaperProject(structuredClone(DEFAULT_DOCUMENT));
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    new DataView(bytes.buffer).setUint16(4, 99, true);

    await expect(decodeWallpaperProject(new Blob([bytes]) as File)).rejects.toThrow('暂不支持项目格式版本 99');
  });
});
