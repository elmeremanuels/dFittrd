/**
 * The embed's React router (`/embed/:token`, the fitting room in the overlay, and `/embed/peek`, the
 * size peek). Both routes load lazily, so neither downloads the other's screens.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';

const Blank = (): null => null;

export const embedRoutes: RouteObject[] = [
  { path: '/embed/peek', HydrateFallback: Blank, lazy: async () => ({ Component: (await import('./PeekRoute')).PeekRoute }) },
  { path: '/embed/:token', HydrateFallback: Blank, lazy: async () => ({ Component: (await import('./EmbedRoute')).EmbedRoute }) },
  { path: '*', HydrateFallback: Blank, lazy: async () => ({ Component: (await import('./EmbedRoute')).EmbedNotFound }) },
];

export function mountRouter(root: HTMLElement): void {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={createBrowserRouter(embedRoutes)} />
    </StrictMode>,
  );
}
