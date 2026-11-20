/**
 * A lost WebGL context (a phone that put the tab to sleep, a GPU reset) comes back empty. three.js
 * rebuilds its own state when the context is restored, but a settled view is idle by then: nothing
 * draws, and the canvas stays blank under its estimate label. This tells the view to draw again.
 * Kept apart from `mount.ts` (which needs WebGL2) so `pnpm check` can test it.
 * Returns the function that stops listening.
 */
export function redrawOnContextRestored(canvas: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, redraw: () => void): () => void {
  const onRestored = (): void => redraw();
  canvas.addEventListener('webglcontextrestored', onRestored);
  return () => canvas.removeEventListener('webglcontextrestored', onRestored);
}
