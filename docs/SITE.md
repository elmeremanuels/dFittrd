# curtain.fit — the marketing site

`apps/site` is the public website for fashion brands at `https://curtain.fit`. It is separate from the
consumer PWA (`app.<domain>`) and the API (`api.<domain>`), and has nothing to do with the product's data.

- **Stack:** a small TypeScript static-site generator (`apps/site/scripts/build.ts`), esbuild for one CSS
  and one JS file, no framework and no runtime dependencies. The output is plain HTML in `apps/site/dist/`.
- **Privacy:** no cookies, no analytics, no third-party scripts, fonts or images. Fonts (Fraunces, Inter)
  come from the Fontsource packages and images from `apps/site/public/img`, all served from our own origin.
  ESLint blocks known tracker and font-CDN hosts in the source.
- **Design:** "Fitting Room Editorial": cream paper, Fraunces display type, Inter labels, hairline rules,
  numbered chapters, coral used sparingly (brand tokens from HANDOFF §7). No dark mode by design.
- **Honesty rules (enforced in the copy and components):** pilot stage is stated openly; the 3D estimate is
  labelled "in development · demo only" (it stays off at real shops until the approval screen exists, PLUGIN.md §2);
  every 3D picture carries an `ESTIMATE` tag and a caption (AGENTS.md rule 3): engine renders say "Estimated drape
  on a standard mannequin. Not a photo, not a guarantee of fit.", viewer screenshots say "Estimated drape on a
  figure built from the entered measurements. Not a photo, not a guarantee of fit."; no testimonials, metrics, customer logos or press; privacy claims
  follow `docs/legal/privacy.md`; Bohohippychic is named as our pilot shop and its logo, product photos and
  our 3D estimates of its garments are shown with its permission (below). No quote of theirs: a quote
  appears only when they write one.

## Commands

```bash
pnpm --filter @curtain/site build      # preview build: renders dist/, checks, lists open decisions and launch gates
pnpm --filter @curtain/site build:release  # the same, but fails while any launch gate is open (use this to publish)
pnpm --filter @curtain/site dev        # build + preview on http://localhost:4321
pnpm --filter @curtain/site typecheck
pnpm --filter @curtain/site lint
```

The build fails on a broken internal link or anchor (including same-page `#` links), a missing image variant,
an absolute (`http(s)://` or `//`) image URL, any image file over 250 KB, a page without exactly one `<h1>`, or a
reference to a third-party script, stylesheet or font. It prints the decisions that are
still open (see below). The site is part of `pnpm check` through the normal `build:apps`, `typecheck` and
`lint` steps.

## Pages

| Path | What |
|---|---|
| `/` | Home: hero, three-line strip, intro, marquee, chapters 01–07, lookbook, pricing, FAQ, journal, waitlist CTA |
| `/how-it-works/` | Shopper walkthrough (5 steps, demo-shop screens) and the merchant side (install, charts, approve 3D, totals) |
| `/3d/` | The garment engine and the 3D estimate, with synthetic renders only |
| `/why/` | Sizes are a guess; returns; less shipping; privacy |
| `/pilot/` | Bohohippychic, the pilot shop: their logo and product photos, their photo next to our 3D estimate (demo only), what the pilot covers |
| `/pricing/` | One plan, USD 8.99 / month per shop |
| `/privacy-promise/` | The privacy ledger: device / our server / what the shop sees |
| `/faq/` | Twelve questions |
| `/about/` | Who we are |
| `/journal/` | Three story teasers, each marked "Coming soon" |
| `/waitlist/` | Waitlist and contact form (opens the visitor's e-mail app; no backend) |
| `/credits/` | Bohohippychic images ("courtesy of Bohohippychic, used with permission"), every CC0 photo with photographer, source and licence, our own screens and renders |
| `/legal/` | Privacy policy, terms, imprint, cookies — "Coming soon" where legal review is pending |
| `/404.html` | "Wrong size." |

Also generated: `sitemap.xml`, `robots.txt`, `og-card.html` (the source of `public/og.jpg`, not indexed).

Content lives in `apps/site/src/pages/*.ts` and `src/data/content.ts` (FAQ, journal). The open founder
decisions are all in `src/data/site.ts`.

## Launch gates (the release build refuses until all are cleared)

`build:release` fails while any of these is open in `apps/site/src/data/site.ts`:

1. **`partner.nameApproved`** — **cleared** (8 Nov 2026). Bohohippychic has granted permission to use its
   name, logo, product photos and the 3D bundles derived from them, on the website and in demos
   (`partner.permissionSource`: "founder statement 8 Nov 2026, written confirmation held by founder";
   DECISIONS.md, REFINEMENT.md B1). `partner.assetsApproved` is true for the same reason. Should the
   permission ever be withdrawn: set `partner.showName: false` (every page then says "an Australian boho
   label", with no name, link or logo) and `partner.assetsApproved: false`; the build then fails on every
   page that still shows one of their images or one of our 3D estimates built from their photos (every image
   `images.ts` marks `partnerDerived`), and on `/og.jpg` (made from their photo, `ogFromPartner`), which lists
   what to replace.
2. **`partner.estimatesReviewed`** (REFINEMENT B2) — the founder has looked at our 3D estimates of their garments
   (`renders/azure-estimate*`, run 17b; `renders/skirt-estimate*`, run 17d) next to their photos on `/`, `/3d/` and
   `/pilot/` and signs them off for a public page under Bohohippychic's name. Known gaps: the azure estimate has a
   square neck and short puffed sleeves where the dress has a V-neck and 3/4 sleeves; the skirt estimate is a
   narrow tube without the slit or tiers. Either set it to true, or take the estimates off those pages (the gate
   only applies while a page shows one).
3. **`legalName`, `company.address`, `company.registration`** (and `company.vat` if registered) — the identity
   behind the waitlist. GDPR Art. 13 requires it as soon as the site collects e-mail addresses; it fills the
   imprint and the "Who is responsible" line of the waitlist notice on `/legal/#waitlist`.
4. **`mailboxReady`** — `hello@curtain.fit` (or whatever `contactEmail` is) exists and receives mail.
5. **`waitlistNoticeReviewed`** — a lawyer has read the waitlist notice on `/legal/#waitlist` (controller,
   purpose, consent as legal basis, retention "12 months after public launch or on request", rights, the right
   to complain to the Autoriteit Persoonsgegevens or another supervisory authority).

## What the founder must fill in before launch

Edit `apps/site/src/data/site.ts` (the build lists whatever is still `null`):

1. **`contactEmail`** — set to `hello@curtain.fit`. Create that mailbox (Hostinger e-mail, or a forwarder)
   before launch, or change it. The waitlist form sends to it.
2. **`privacyEmail`** — optional; falls back to `contactEmail`.
3. **`responseTime`** — e.g. "two working days"; shown on the waitlist page when set.
4. **`legalName`** — company legal name for the footer and imprint. The imprint also needs the address,
   registration number and VAT number (edit `src/pages/legal.ts`).
5. **`trialDays`** — trial length (7 days in code, 14 in the listing draft). Until set, the site says the
   trial length is confirmed at launch.
6. **`partner.status`** — update when the pilot is live on Bohohippychic's store.
7. **Bohohippychic:** their images are in `public/img/partner/` (photos and logo) and `public/img/renders/`
   (`azure-estimate*`, `skirt-estimate*`: our estimates of the Azure Palm Baby Doll Dress, run 17b, and the
   Crimson Wildflower Maxi Skirt, run 17d, both accepted pending founder review, REFINEMENT B2). The
   official logo file came from their site's header (`bhc-logo.png`); replace it if they send a vector
   version. A quote is only added when they write one and sign it off; there is no quote slot until then.
8. **Legal:** the product privacy policy and terms are drafts; `/legal/` says "Coming soon" until a lawyer
   has reviewed them. The waitlist needs a short website privacy notice (a first version is on `/legal/#waitlist`).
9. **Optional:** a founder name, bio and portrait for `/about/`; one sourced statistic on fit returns for
   `/why/` (with the link); a Dutch version (only the short strings first).

### Images

The strongest pictures lead: Bohohippychic's product photos (home hero, the intro, the pilot teaser, the
lookbook, `/pilot/`, `/why/`, `/waitlist/`), our 3D estimates of their garments (home 02 and 05, `/3d/`,
`/pilot/`) and the demo-shop screens. Their photos are shown as published on their shop (800×1200),
resized to 600 and 800 px wide, without a colour grade; the estimates are clean renders of the viewer
(`spikes/garment-engine/viewer`, size 12 on the M mannequin, labels hidden), cropped to 2:3. Every 3D picture
carries the `ESTIMATE` tag and caption, and its credit says it was made from Bohohippychic's photos.

Five CC0 photos remain (knitwear rail, minimal rail, pattern scissors, fabric rolls, draped fabric), from the
WordPress Photo Directory through Openverse, with the house grade (about −20% saturation, slightly warmer,
lifted blacks, a 6% cream veil). The weak and repeating ones (the black-and-beige editorial set, blazer,
colour rail, beach, corridor, barrel, straw hat) were dropped in Nov 2026. CC0 covers copyright, not model
releases, so those picks show people from behind or cropped.

Everything is AVIF + WebP under a 230 KB budget per file; the build fails above 250 KB. Each image appears on at
most two pages and never twice on one page. To swap an image: replace the files (keep the widths listed in
`src/data/image-sizes.json`, AVIF and WebP), then update `src/data/photo-credits.json` (CC0) or
`partnerProducts` (Bohohippychic) and the alt text in `src/data/images.ts`. The build refuses Bohohippychic
images and our estimates built from them while `partner.assetsApproved` is false, and their logo while
`partner.showName` is false.

Rights: the founder's statement covers Bohohippychic's product photos as published. They show identifiable
models; that rests on Bohohippychic owning the photos (or being allowed to sublicense them, model releases
included), which the founder confirms with them in the written permission.

## Deploying to curtain.fit

The site runs on the founder's VPS next to `app.` and `api.`, behind the same Caddy; Hostinger is only
the registrar and DNS. The deploy workflow builds and publishes it (docs/DEPLOY.md):

- **DNS at Hostinger** (hPanel → Domains → curtain.fit → DNS / Nameservers → DNS records): `A` records for
  `@`, `www`, `app` and `api` → the VPS IPv4 (and `AAAA` → its IPv6, if it has one). Remove Hostinger's
  default parking records for `@` and `www` first. Check with
  `dig +short curtain.fit www.curtain.fit app.curtain.fit api.curtain.fit`.
- **Caddy** (`infra/Caddyfile`): `{$DOMAIN}` serves the `site` volume (`/srv/site`, read-only) with the
  shared security headers, a same-origin CSP (`style-src-attr 'unsafe-inline'` only for the image crops,
  `form-action 'self' mailto:` for the waitlist form), `X-Frame-Options: DENY`, one-year immutable caching
  for `/assets/*` and `/fonts/*`, one day for `/img/*` (so a replaced photo is gone within a day), an hour
  for `og.jpg`, the icons, `robots.txt` and `sitemap.xml`, `no-cache` for HTML, one URL per page (`/pilot`
  redirects with 308 to `/pilot/`) and `/404.html` with status 404. HSTS from the apex does not extend to
  subdomains (the mailbox hosts are Hostinger's). `www.{$DOMAIN}` redirects permanently to the apex. Pinned by
  `apps/api/src/caddy-site.test.ts`; the deploy validates the Caddyfile in CI and on the server
  (`infra/scripts/caddy-validate.sh`, docs/DEPLOY.md).
- **Build:** the workflow's **site** job runs `pnpm --filter @curtain/site build:release`. While a launch gate
  is open the build refuses; the job then warns ("curtain.fit not published"), lists the open gates in the
  run summary, and the deploy ships app and api without the site. The site never blocks the plugin.
- **Publish:** `scripts/deploy.sh` uploads `SITE_DIST` to `/opt/curtain/site/releases/<tag>/` and
  `infra/scripts/deploy.sh --site-release` copies it into the `site` volume: every file except the pages
  first (hashed CSS/JS, fonts, images), then each HTML page through a rename, then it prunes files that
  belong to neither this release nor the previous one. The site release is recorded with the image and web
  release, so `rollback` puts the previous site back too. A failed site publish, or `https://curtain.fit/`
  not answering, only logs a warning; the previous site stays up.
- **By hand** (from a laptop with ssh access): build with `build:release`, then
  `SITE_DIST=apps/site/dist scripts/deploy.sh deploy` with the usual variables (docs/DEPLOY.md, "From a laptop").

Until the first site release is published, `https://curtain.fit` answers 404 (the volume is empty).

## After launch

- Submit `https://curtain.fit/sitemap.xml` in Google Search Console (DNS TXT verification at Hostinger;
  no tracking script needed).
- Re-shoot the product screenshots when the plugin UI changes (the capture scripts used `pnpm demo` with
  the synthetic `aalter-studio-2` garment; never the azure bundle, whose texture is shop-derived).
- Regenerate `public/og.jpg` after changing the hero: screenshot `/og-card.html` at 1200×630.
