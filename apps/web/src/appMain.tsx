/** Entry of the consumer app and the merchant console (everything except `/embed/*`). */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import { router } from './router';
import { useApp } from './store';

export function mountApp(root: HTMLElement): void {
  void useApp.getState().hydrate();
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  registerSW({ immediate: true });
}
