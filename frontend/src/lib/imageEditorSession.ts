import type { ImageViewerItem } from '@/components/ImageViewer';

export interface ImageEditorSession extends ImageViewerItem {
  returnPath: string;
}

let activeSession: ImageEditorSession | null = null;

export function setImageEditorSession(session: ImageEditorSession): void {
  activeSession = session;
}

export function getImageEditorSession(): ImageEditorSession | null {
  return activeSession;
}
