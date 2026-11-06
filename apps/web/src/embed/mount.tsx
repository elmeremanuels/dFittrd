/**
 * Entry of the standalone embed (`/embed/*`). Its own router and shell: the app store, the app
 * database (`curtain`), the service worker and the phone frame are never loaded here.
 *
 * This module imports no React on purpose. The size peek (`/embed/peek`, an iframe next to the
 * shop's button on every product page) first asks IndexedDB whether a profile is remembered here;
 * when none is, it collapses and stops, so a first-time visitor's product page never downloads
 * React, the fit engine or the api client for it. Everything else mounts the React router.
 */
import { currentFrame, isPeekPath, postCollapse, quickHasProfile } from './peekGate';

async function mountPeek(root: HTMLElement): Promise<void> {
  if ((await quickHasProfile()) === false) {
    postCollapse(currentFrame());
    return;
  }
  (await import('./mountRouter')).mountRouter(root);
}

export function mountEmbed(root: HTMLElement): void {
  document.documentElement.classList.add('curtain-embed');
  if (isPeekPath(location.pathname)) {
    void mountPeek(root);
    return;
  }
  void import('./mountRouter').then((m) => m.mountRouter(root));
}
