/**
 * Entry of the standalone embed (`/embed/*`). Its own router and shell: the app store, the app
 * database (`curtain`), the service worker and the phone frame are never loaded here.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { EmbedNotFound, EmbedRoute } from './EmbedRoute';

export const embedRoutes: RouteObject[] = [
  { path: '/embed/:token', element: <EmbedRoute /> },
  { path: '*', element: <EmbedNotFound /> },
];

export function mountEmbed(root: HTMLElement): void {
  document.documentElement.classList.add('curtain-embed');
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={createBrowserRouter(embedRoutes)} />
    </StrictMode>,
  );
}
