import { IS_RELEASE, getVersionLabel } from '@/constants/version';

/**
 * 右下角版本水印
 *
 * 仅在非 release 版本（beta / alpha / dev）下显示。
 */
export default function Watermark() {
  if (IS_RELEASE) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed bottom-3 right-4 z-50 select-none"
      style={{
        color: 'var(--color-foreground)',
        opacity: 0.45,
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        padding: '2px 6px',
        borderRadius: '4px',
        backgroundColor: 'color-mix(in srgb, var(--color-background) 60%, transparent)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      {getVersionLabel()}
    </div>
  );
}
