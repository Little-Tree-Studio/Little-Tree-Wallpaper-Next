export type StaticWallpaperConfirmationHandler = () => Promise<boolean>;

let handler: StaticWallpaperConfirmationHandler | null = null;
let confirmationInFlight: Promise<boolean> | null = null;

export function registerStaticWallpaperConfirmationHandler(
  nextHandler: StaticWallpaperConfirmationHandler,
): () => void {
  handler = nextHandler;
  return () => {
    if (handler === nextHandler) handler = null;
  };
}

export function confirmStaticWallpaperSwitch(): Promise<boolean> {
  if (confirmationInFlight) return confirmationInFlight;
  if (!handler) return Promise.resolve(false);
  confirmationInFlight = handler().finally(() => {
    confirmationInFlight = null;
  });
  return confirmationInFlight;
}
