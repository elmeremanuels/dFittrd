/**
 * "See it on me" (docs/STANDALONE.md §1.3.6): the existing opt-in hero render, only when the shop
 * has hero renders enabled. The person image is the AVATAR drawn in this page (rasterised SVG of
 * the parametric body + garment overlay) — never a photo or a camera frame (D3, AGENTS.md rule 1).
 * Explicit consent first; the result is labelled an estimate (rule 3).
 *
 * The person image is built from a separate figure in the standard colour (AvatarView `plain`: no
 * face and no outline, the figure this render got before the avatar prompt existed; what a drawn
 * face does to the provider's output is untested), not from the figure on screen
 * (docs/research/photo-avatar-plan.md §3), and `assertNeutralPerson`
 * refuses anything else: an `<image>`, a blob or data reference, or a skin colour the shopper
 * picked. D20 point 1 allows the picked colour to go with this render; it stays out until the
 * privacy policy says so (docs/legal/avatar-consent-copy.md, gap 8).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RENDER_CONSENT_TIER, type HeroRenderRequest, type HeroRenderStatus, type TryResolveResponse } from '@curtain/schema';
import { EstimateBadge, EstimateDisclaimer } from '@/components/EstimateBadge';
import { STANDARD_SKIN_HEX, VIEW_H, VIEW_W } from '@/render/body';
import type { EmbedApi } from './deps';
import { embedStrings } from './strings';

/**
 * The shop's hero-render switch. `ShopBranding` has no such field yet, so this reads an optional
 * `heroRenders: true` defensively; until the API sends it the panel stays hidden.
 */
export function heroRendersEnabled(data: Pick<TryResolveResponse, 'shop'>): boolean {
  return (data.shop as { heroRenders?: unknown }).heroRenders === true && !data.shop.paused;
}

const RENDER_W = 512;
const RENDER_H = Math.max(256, Math.round((RENDER_W * VIEW_H) / VIEW_W));
const POLL_MS = 2000;
const POLL_LIMIT = 45;

/**
 * The hero render's person image may only be the neutral figure. Throws on any embedded picture
 * (`<image>`, `<foreignObject>`), any blob:, data: or http reference, and any skin colour other
 * than the standard one.
 */
export function assertNeutralPerson(svg: SVGSVGElement): void {
  if (svg.querySelector('image, foreignObject, use')) throw new Error('avatar render: only the neutral figure may be sent');
  for (const el of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    for (const attr of Array.from(el.attributes)) {
      // Spoken labels and test ids are text, never a reference: a product called "Big data: tee"
      // must not make the render fail.
      if (/^(aria-|data-testid$)/i.test(attr.name)) continue;
      if (/^(xlink:)?href$/i.test(attr.name) || /\b(blob|data|https?):/i.test(attr.value)) throw new Error('avatar render: only the neutral figure may be sent');
    }
  }
  if ((svg.getAttribute('data-skin') ?? '').toUpperCase() !== STANDARD_SKIN_HEX.toUpperCase()) throw new Error('avatar render: only the standard colour may be sent');
}

/** Rasterise the avatar SVG to a PNG (base64, no data: prefix). Browser only. */
export async function rasterizeAvatar(svg: SVGSVGElement): Promise<{ base64: string; width: number; height: number }> {
  assertNeutralPerson(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // The size rings are a measuring aid on screen, never part of the person image sent for a render.
  clone.querySelectorAll('[data-testid="size-rings"]').forEach((n) => n.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(RENDER_W));
  clone.setAttribute('height', String(RENDER_H));
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('avatar could not be drawn'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = RENDER_W;
    canvas.height = RENDER_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.fillStyle = '#F5EFE7';
    ctx.fillRect(0, 0, RENDER_W, RENDER_H);
    ctx.drawImage(img, 0, 0, RENDER_W, RENDER_H);
    const dataUrl = canvas.toDataURL('image/png');
    return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), width: RENDER_W, height: RENDER_H };
  } finally {
    URL.revokeObjectURL(url);
  }
}

type RenderState = { status: 'idle' } | { status: 'working' } | { status: 'done'; job: HeroRenderStatus } | { status: 'failed'; message: string };

export function HeroRenderPanel({
  getApi,
  data,
  size,
  getAvatarSvg,
}: {
  getApi: () => EmbedApi;
  data: TryResolveResponse;
  size: string;
  getAvatarSvg: () => SVGSVGElement | null;
}): ReactNode {
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<RenderState>({ status: 'idle' });
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const start = async (): Promise<void> => {
    const svg = getAvatarSvg();
    if (!svg) return;
    setState({ status: 'working' });
    try {
      const person = await rasterizeAvatar(svg);
      const req: HeroRenderRequest = {
        productId: data.garment.id,
        shopId: data.shop.id,
        size,
        person: { kind: 'avatarRender', mimeType: 'image/png', imageBase64: person.base64, width: person.width, height: person.height },
        consent: { tier: RENDER_CONSENT_TIER, ack: true, acknowledgedAt: new Date().toISOString() },
      };
      const api = getApi();
      const accepted = await api.requestHeroRender(req);
      for (let i = 0; i < POLL_LIMIT && alive.current; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const job = await api.heroRenderStatus(accepted.jobId);
        if (job.status === 'done') {
          if (alive.current) setState({ status: 'done', job });
          return;
        }
        if (job.status === 'failed' || job.status === 'expired') throw new Error(job.error ?? embedStrings().hero.failed);
      }
      if (alive.current) setState({ status: 'failed', message: embedStrings().hero.slow });
    } catch (e) {
      if (alive.current) setState({ status: 'failed', message: e instanceof Error ? e.message : embedStrings().hero.failed });
    }
  };

  const t = embedStrings().hero;
  return (
    <section className="card space-y-3" aria-labelledby="hero-title">
      <h2 id="hero-title" className="font-display text-xl">
        {t.title}
      </h2>
      {state.status === 'done' && state.job.imageUrl ? (
        <figure className="relative overflow-hidden rounded-2xl">
          <img src={state.job.imageUrl} alt={t.alt(data.garment.name, size)} className="w-full" referrerPolicy="no-referrer" />
          <EstimateBadge className="absolute top-3 left-3" />
          <figcaption>
            <EstimateDisclaimer className="mt-2" />
          </figcaption>
        </figure>
      ) : (
        <>
          <p className="text-sm text-ink-soft">{t.explain}</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t.consent}</span>
          </label>
          <button type="button" className="btn-ghost w-full" disabled={!consent || state.status === 'working'} onClick={() => void start()}>
            {state.status === 'working' ? t.working : t.start(size)}
          </button>
          {state.status === 'failed' ? (
            <p role="alert" className="text-xs text-coral-ink">
              {state.message}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
