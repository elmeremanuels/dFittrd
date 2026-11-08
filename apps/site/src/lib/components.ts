import { attrs, em, html, raw, type Child, type SafeHtml } from './html.ts';
import { img, type ImageInfo } from '../data/images.ts';

/* ---------- figure numbering (reset per page by the builder) ---------- */
let figNo = 0;
export function resetFigures(): void {
  figNo = 0;
}
function nextFig(): string {
  figNo += 1;
  return String(figNo).padStart(2, '0');
}

/* ---------- images ---------- */
export interface PictureOpts {
  sizes?: string;
  eager?: boolean;
  cls?: string;
  /** CSS object-position, e.g. "50% 20%". */
  pos?: string;
  /** Override alt (e.g. empty for an image a caption already describes fully). */
  alt?: string;
}

function srcset(i: ImageInfo, ext: 'avif' | 'webp'): string {
  return i.widths.map((w) => `/img/${i.id}-${w}.${ext} ${w}w`).join(', ');
}

export function picture(id: string, o: PictureOpts = {}): SafeHtml {
  const i = img(id);
  const sizes = o.sizes ?? '(min-width: 1024px) 50vw, 100vw';
  const fallbackW = i.widths[i.widths.length - 1] ?? i.w;
  const fallbackH = Math.round((i.h * fallbackW) / i.w);
  return html`<picture${attrs({ class: o.cls })}><source type="image/avif" srcset="${srcset(i, 'avif')}" sizes="${sizes}"><source type="image/webp" srcset="${srcset(i, 'webp')}" sizes="${sizes}"><img src="/img/${i.id}-${fallbackW}.webp"${attrs({
    alt: o.alt ?? i.alt,
    width: fallbackW,
    height: fallbackH,
    loading: o.eager ? 'eager' : 'lazy',
    fetchpriority: o.eager ? 'high' : undefined,
    decoding: o.eager ? 'sync' : 'async',
    style: o.pos ? `object-position:${o.pos}` : undefined,
  })}></picture>`;
}

export function estimateTag(label = 'Estimate'): SafeHtml {
  return html`<span class="tag tag--estimate">${label}</span>`;
}

function creditLine(i: ImageInfo): SafeHtml {
  if (i.kind === 'photo') {
    return html`<span class="fig__credit">Photo: <a href="/credits/#${i.id.replace('/', '-')}">${i.credit}</a>, CC0</span>`;
  }
  return html`<span class="fig__credit">${i.credit}</span>`;
}

export interface FigureOpts extends PictureOpts {
  caption?: Child;
  /** aspect ratio class: 45 (4:5), 34 (3:4), 23 (2:3), 916, 169, 11, auto */
  ratio?: '45' | '34' | '23' | '916' | '169' | '11' | '32' | 'auto';
  reveal?: boolean;
  figCls?: string;
}

/** An editorial photo figure with "Fig. nn" caption and credit; 3D renders get the ESTIMATE tag automatically. */
export function figure(id: string, o: FigureOpts = {}): SafeHtml {
  const i = img(id);
  const n = nextFig();
  const ratio = o.ratio ?? '45';
  return html`<figure class="fig ${o.figCls ?? ''}"${attrs({ 'data-reveal': o.reveal === false ? undefined : 'img' })}>
  <div class="fig__frame ratio-${ratio}">${picture(id, o)}${i.estimate ? estimateTag() : ''}</div>
  <figcaption class="fig__cap"><span class="fig__no">Fig. ${n}</span> ${o.caption ?? ''} ${creditLine(i)}</figcaption>
</figure>`;
}

/* ---------- product as object: CSS device frames on a paper mat ---------- */
export interface DeviceOpts {
  caption: Child;
  device: 'phone' | 'browser' | 'bare';
  url?: string;
  sizes?: string;
  cls?: string;
  eager?: boolean;
  /** crop the screenshot to a window (CSS object-position), phone screens are 9:19.5 */
  pos?: string;
}

export function device(id: string, o: DeviceOpts): SafeHtml {
  const i = img(id);
  const n = nextFig();
  const inner =
    o.device === 'phone'
      ? html`<div class="phone"><div class="phone__screen">${picture(id, { sizes: o.sizes ?? '(min-width: 1024px) 320px, 70vw', eager: o.eager, pos: o.pos })}</div></div>`
      : o.device === 'browser'
        ? html`<div class="browser"><div class="browser__bar" aria-hidden="true"><span></span><span></span><span></span><em>${o.url ?? 'demo.curtain.fit'}</em></div><div class="browser__screen">${picture(id, { sizes: o.sizes ?? '(min-width: 1024px) 60vw, 100vw', eager: o.eager, pos: o.pos })}</div></div>`
        : html`<div class="bare">${picture(id, { sizes: o.sizes ?? '(min-width: 1024px) 40vw, 100vw', eager: o.eager, pos: o.pos })}</div>`;
  return html`<figure class="object ${o.cls ?? ''}" data-reveal="fade">
  <div class="object__mat">${inner}${i.estimate ? estimateTag() : ''}</div>
  <figcaption class="fig__cap"><span class="fig__no">Fig. ${n}</span> ${o.caption} <span class="fig__credit">${i.credit}</span></figcaption>
</figure>`;
}

/** The mandatory caption next to every 3D visual. */
export const ESTIMATE_CAPTION = 'Estimated drape on a standard mannequin. Not a photo, not a guarantee of fit.';

/* ---------- typography blocks ---------- */
export interface ChapterOpts {
  num?: string;
  kicker: string;
  title: string;
  standfirst?: string;
  level?: 1 | 2;
  id?: string;
  cls?: string;
  /** Numeral above the text instead of beside it (narrow columns). */
  stack?: boolean;
}

export function chapter(o: ChapterOpts): SafeHtml {
  const tag = o.level === 1 ? 'h1' : 'h2';
  return html`<header class="chapter${o.stack ? ' chapter--stack' : ''} ${o.cls ?? ''}">
  ${o.num ? html`<span class="chapter__num" aria-hidden="true">${o.num}</span>` : ''}
  <div class="chapter__text">
    <p class="kicker">${o.kicker}</p>
    ${raw(`<${tag} class="chapter__title" data-reveal="lines"${o.id ? ` id="${o.id}"` : ''}>`)}${em(o.title)}${raw(`</${tag}>`)}
    ${o.standfirst ? html`<p class="standfirst">${em(o.standfirst)}</p>` : ''}
  </div>
</header>`;
}

export function button(href: string, label: string, variant: 'primary' | 'secondary' | 'ghost' = 'primary', extra: Record<string, string> = {}): SafeHtml {
  return html`<a class="btn btn--${variant}" href="${href}"${attrs(extra)}><span>${label}</span></a>`;
}

export function textLink(href: string, label: string): SafeHtml {
  return html`<a class="link-arrow" href="${href}">${label}<span aria-hidden="true"> →</span></a>`;
}

export function marquee(items: string[]): SafeHtml {
  const line = items.map((t) => html`<span>${t}</span><span class="marquee__star" aria-hidden="true">✶</span>`);
  return html`<section class="marquee" aria-label="In short">
  <p class="visually-hidden">${items.join('. ')}.</p>
  <div class="marquee__track" aria-hidden="true"><div class="marquee__row">${line}</div><div class="marquee__row">${line}</div></div>
</section>`;
}

export interface LookCard {
  id: string;
  title: string;
  text?: string;
  device?: 'phone' | 'photo';
  pos?: string;
}

export function lookbook(label: string, cards: LookCard[], opts: { title?: string; kicker?: string } = {}): SafeHtml {
  const total = cards.length;
  const slug = label.toLowerCase().replace(/[^a-z]+/g, '-');
  return html`<section class="lookbook" aria-roledescription="carousel" aria-label="${label}" data-lookbook>
  <div class="lookbook__head wrap">
    <div>${opts.kicker ? html`<p class="kicker">${opts.kicker}</p>` : ''}${opts.title ? html`<h2 class="h2" data-reveal="lines">${em(opts.title)}</h2>` : ''}</div>
    <div class="lookbook__ctrl">
      <p class="lookbook__count" aria-live="polite"><span data-current>1</span> / ${total}</p>
      <button type="button" class="iconbtn" data-prev aria-controls="${slug}" aria-label="Previous">←</button>
      <button type="button" class="iconbtn" data-next aria-controls="${slug}" aria-label="Next">→</button>
    </div>
  </div>
  <ol class="lookbook__track" id="${slug}" tabindex="0" aria-label="${label}, scroll horizontally">
    ${cards.map((c, idx) => {
      const i = img(c.id);
      const n = nextFig();
      return html`<li class="look" aria-label="${idx + 1} of ${total}">
      <figure class="fig">
        <div class="fig__frame ${c.device === 'phone' ? 'look__phone' : 'ratio-23'}">${
          c.device === 'phone'
            ? html`<div class="phone phone--sm"><div class="phone__screen">${picture(c.id, { sizes: '260px', pos: c.pos })}</div></div>`
            : picture(c.id, { sizes: '(min-width: 1024px) 26vw, 70vw', pos: c.pos })
        }${i.estimate ? estimateTag() : ''}</div>
        <figcaption class="look__cap"><span class="fig__no">Fig. ${n}</span><span class="look__title">${c.title}</span>${c.text ? html`<span class="look__text">${c.text}</span>` : ''}${
          i.kind === 'photo' ? html`<span class="fig__credit">Photo: ${i.credit}, CC0</span>` : ''
        }</figcaption>
      </figure>
    </li>`;
    })}
  </ol>
</section>`;
}

export interface Qa {
  q: string;
  a: Child;
}

export function faqList(items: Qa[], startOpen = false): SafeHtml {
  return html`<div class="faq">${items.map(
    (it, i) => html`<details class="faq__item"${attrs({ open: startOpen && i === 0 })}><summary><span class="faq__n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><span class="faq__q">${it.q}</span><span class="faq__icon" aria-hidden="true"></span></summary><div class="faq__a">${it.a}</div></details>`,
  )}</div>`;
}

export function placeholderFrame(label: string, note: string, ratio: '45' | '34' | '23' | '169' = '45'): SafeHtml {
  return html`<figure class="placeholder ratio-${ratio}" data-placeholder>
  <div class="placeholder__inner">
    <span class="tag tag--outline">Placeholder</span>
    <p class="placeholder__label">${label}</p>
    <p class="placeholder__note">${note}</p>
  </div>
</figure>`;
}

export function marginNote(content: Child): SafeHtml {
  return html`<aside class="margin-note">${content}</aside>`;
}

/** Original SVG motif: a curtain of soft vertical folds. Decorative. */
export function curtainSvg(cls = ''): SafeHtml {
  const folds: string[] = [];
  for (let i = 0; i < 14; i += 1) {
    const x = 20 + i * 40;
    folds.push(`<path d="M${x} 0 C ${x - 14} 120, ${x + 16} 240, ${x - 4} 360 S ${x + 12} 560, ${x} 640" />`);
  }
  return raw(
    `<svg class="curtain-svg ${cls}" viewBox="0 0 580 640" preserveAspectRatio="none" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.1" vector-effect="non-scaling-stroke">${folds.join('')}</g></svg>`,
  );
}

/** A thin coral tape-measure line with ticks, used as a divider. Decorative. */
export function tapeDivider(): SafeHtml {
  return raw('<div class="tape" aria-hidden="true"></div>');
}
