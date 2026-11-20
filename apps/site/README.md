# @curtain/site

The marketing website for fashion brands at **curtain.fit**: static HTML, one CSS file, one small JS file,
self-hosted fonts and images, no cookies and no trackers.

```bash
pnpm build      # dist/ + link, anchor, image and heading checks
pnpm dev        # build + preview on :4321
```

- Pages: `src/pages/*.ts` (one file per page; `index.ts` lists them).
- Shared blocks and components: `src/lib/`.
- Founder decisions still open: `src/data/site.ts` (the build lists them).
- Images: `public/img` (AVIF + WebP at two widths), alt text in `src/data/images.ts`, photo credits in
  `src/data/photo-credits.json`, shown on `/credits/`.

Deploy notes, the founder checklist and the Caddy / Hostinger setup are in [`docs/SITE.md`](../../docs/SITE.md).
