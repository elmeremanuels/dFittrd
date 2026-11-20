/** `/embed` and everything under it is the standalone embed (the only framable route). */
export function isEmbedPath(pathname: string): boolean {
  return pathname === '/embed' || pathname.startsWith('/embed/');
}
