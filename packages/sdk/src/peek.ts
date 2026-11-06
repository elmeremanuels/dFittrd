/**
 * The size peek: a small cross-origin iframe (`{data-app}/embed/peek?shop=…&product=…`) right after
 * each button. For a shopper who already found their size on this shop it shows "Your size: M" and
 * a drawing of their figure; for everyone else it stays at height 0. The iframe is inserted only
 * when the button comes within 300 px of the viewport, and it takes no space until it reports a
 * height.
 *
 * Privacy (D3): the page sees the iframe and its height, never what is inside it. The only messages
 * the SDK accepts are `curtain:peek-size { height }` and `curtain:peek-open {}`, from the peek's own
 * window on the app origin. Neither carries a size. The height is `PEEK_HEIGHT` or 0 and nothing
 * else: one bit (a remembered profile on this shop, for a try-able product), never the fit outcome
 * or the length of what the peek says. The size reaches the page only when the shopper presses
 * "Choose size" in the overlay (`curtain:size-selected`).
 */

/** The one height a shown peek has, in px (apps/web `PEEK_HEIGHT`; keep the two equal). */
export const PEEK_HEIGHT = 112;

let frames: [HTMLIFrameElement, HTMLElement][] = [];
let observers: IntersectionObserver[] = [];
let app = '';

function onMessage(e: MessageEvent): void {
  const d = e.data;
  if (e.origin !== app || !d || d.source !== 'curtain' || d.v !== 1) return;
  for (const [f, b] of frames)
    if (f.contentWindow === e.source) {
      if (d.type === 'curtain:peek-size') {
        // Only the one fixed height opens it; anything else (0, another number, NaN, a string) collapses.
        const h = d.height === PEEK_HEIGHT ? PEEK_HEIGHT : 0;
        f.style.height = h + 'px';
        f.style.visibility = h ? '' : 'hidden';
      } else if (d.type === 'curtain:peek-open') b.click();
    }
}

/**
 * Watch a button; its peek iframe is inserted next to it once it is near the viewport. `appUrl` is
 * the fitting room's origin (`data-app`), compared exactly with `event.origin`.
 */
export function watchPeek(b: HTMLElement, appUrl: string, shop: string, product: string, title: string): void {
  if (typeof IntersectionObserver === 'undefined') return;
  if (!observers.length) addEventListener('message', onMessage);
  app = appUrl;
  const o = new IntersectionObserver(
    (entries) => {
      if (!entries[0]!.isIntersecting) return;
      o.disconnect();
      const f = document.createElement('iframe');
      f.title = title;
      f.src = `${appUrl}/embed/peek?shop=${encodeURIComponent(shop)}&product=${encodeURIComponent(product)}`;
      // The page origin only, also on a `no-referrer` page: the peek needs it to pick its target.
      f.referrerPolicy = 'origin';
      // Height 0 and hidden (so out of the tab order) until the peek reports something to show.
      f.style.cssText = 'display:block;width:100%;height:0;border:0;visibility:hidden';
      b.after(f);
      frames.push([f, b]);
    },
    { rootMargin: '300px' },
  );
  o.observe(b);
  observers.push(o);
}

/** Remove every peek iframe, the observers and the message listener. */
export function destroyPeeks(): void {
  for (const o of observers) o.disconnect();
  for (const [f] of frames) f.remove();
  removeEventListener('message', onMessage);
  frames = [];
  observers = [];
}
