import { useSyncExternalStore } from 'react';
import { useLocation } from 'wouter';

type SearchParamsInit = Record<string, string> | URLSearchParams;

const subscribeToHash = (callback: () => void) => {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
};

const hashRoute = () => `/${window.location.hash.replace(/^#?\/?/, '')}`;
const hashPathname = () => hashRoute().split('?')[0];
const hashSearch = () => hashRoute().split('?').slice(1).join('?');

export function useHashRouterLocation(): [string, (to: string, options?: { replace?: boolean; state?: unknown }) => void] {
  const pathname = useSyncExternalStore(subscribeToHash, hashPathname, () => '/');

  const navigate = (to: string, { replace = false, state = null }: { replace?: boolean; state?: unknown } = {}) => {
    const oldURL = window.location.href;
    const url = new URL(window.location.href);
    url.hash = `/${to.replace(/^#?\/?/, '')}`;
    const newURL = url.href;
    window.history[replace ? 'replaceState' : 'pushState'](state, '', newURL);
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL }));
  };

  return [pathname, navigate];
}

export function useNavigate() {
  const [, navigate] = useLocation();
  return navigate;
}

export function usePathname() {
  const [pathname] = useLocation();
  return pathname;
}

export function useHashSearch() {
  return useSyncExternalStore(subscribeToHash, hashSearch, () => '');
}

export function useSearchParams(): [URLSearchParams, (next: SearchParamsInit, options?: { replace?: boolean }) => void] {
  const [pathname, navigate] = useLocation();
  const search = useHashSearch();
  const params = new URLSearchParams(search);

  const setSearchParams = (next: SearchParamsInit, options?: { replace?: boolean }) => {
    const nextSearch = new URLSearchParams(next).toString();
    navigate(`${pathname}${nextSearch ? `?${nextSearch}` : ''}`, options);
  };

  return [params, setSearchParams];
}
