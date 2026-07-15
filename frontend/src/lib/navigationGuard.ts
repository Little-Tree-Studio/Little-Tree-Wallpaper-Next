export const BEFORE_NAVIGATE_EVENT = 'ltw:before-navigate';

export interface NavigationRequestDetail {
  targetId: string;
  proceed: () => void;
}

export function requestNavigation(targetId: string, proceed: () => void): void {
  const event = new CustomEvent<NavigationRequestDetail>(BEFORE_NAVIGATE_EVENT, {
    cancelable: true,
    detail: { targetId, proceed },
  });
  if (window.dispatchEvent(event)) proceed();
}
