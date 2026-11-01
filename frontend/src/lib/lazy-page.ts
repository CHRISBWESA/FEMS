import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'fems.chunkReload';

/**
 * React.lazy for a page, plus recovery from a new deployment: a tab opened before the deploy asks for page files
 * that no longer exist. Instead of a broken screen, the page reloads once to fetch the current version.
 */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await load();
      try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* storage unavailable */ }
      return mod;
    } catch (error) {
      let reloaded = false;
      try { reloaded = sessionStorage.getItem(RELOAD_KEY) === '1'; sessionStorage.setItem(RELOAD_KEY, '1'); } catch { reloaded = true; }
      if (!reloaded) {
        window.location.reload();
        return new Promise<{ default: T }>(() => undefined); // keep showing the loading state until the reload
      }
      throw error;
    }
  });
}
