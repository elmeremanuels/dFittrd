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
- **Honesty rules (enforced in the copy and components):** pilot stage is stated openly; every 3D picture
  carries an `ESTIMATE` tag and the caption "Estimated drape on a standard mannequin. Not a photo, not a
  guarantee of fit." (AGENTS.md rule 3); no testimonials, metrics, customer logos or press; privacy claims
  follow `docs/legal/privacy.md`; Bohohippychic is named as our pilot shop, and dashed placeholder frames
  mark where their approved assets will go. No logo, product photo or texture of theirs is used (D13).

## Commands

```bash
pnpm --filter @curtain/site build      # renders dist/, then checks links, anchors, images and <h1> count
pnpm --filter @curtain/site dev        # build + preview on http://localhost:4321
pnpm --filter @curtain/site typecheck
pnpm --filter @curtain/site lint
```

The build fails on a broken internal link or anchor, a missing image variant, a page without exactly one
`<h1>`, or a reference to a third-party script, stylesheet or font. It prints the decisions that are
still open (see below). The site is part of `pnpm check` through the normal `build:apps`, `typecheck` and
`lint` steps.

## Pages

| Path | What |
|---|---|
| `/` | Home: hero, three-line strip, intro, marquee, chapters 01–07, lookbook, pricing, FAQ, journal, waitlist CTA |
| `/how-it-works/` | Shopper walkthrough (5 steps, demo-shop screens) and the merchant side (install, charts, approve 3D, totals) |
| `/3d/` | The garment engine and the 3D estimate, with synthetic renders only |
| `/why/` | Sizes are a guess; returns; less shipping; privacy |
| `/pilot/` | Bohohippychic, the pilot shop, with placeholders for their approved assets |
| `/pricing/` | One plan, USD 8.99 / month per shop |
| `/privacy-promise/` | The privacy ledger: device / our server / what the shop sees |
| `/faq/` | Twelve questions |
| `/about/` | Who we are |
| `/journal/` | Three story teasers, each marked "Coming soon" |
| `/waitlist/` | Waitlist and contact form (opens the visitor's e-mail app; no backend) |
| `/credits/` | Every photo with photographer, source and licence; our own screens and renders |
| `/legal/` | Privacy policy, terms, imprint, cookies — "Coming soon" where legal review is pending |
| `/404.html` | "Wrong size." |

Also generated: `sitemap.xml`, `robots.txt`, `og-card.html` (the source of `public/og.jpg`, not indexed).

Content lives in `apps/site/src/pages/*.ts` and `src/data/content.ts` (FAQ, journal). The open founder
decisions are all in `src/data/site.ts`.

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
7. **Bohohippychic:** confirm in writing that they agree to be named as our pilot shop. When they approve
   images, a logo or a quote, put the files in `public/img/partner/`, replace the placeholder frames in
   `src/pages/pilot.ts` and `src/pages/home.ts`, set `partner.assetsApproved: true`, and add the images
   to `/credits/`. A quote must be their real words, signed off.
8. **Legal:** the product privacy policy and terms are drafts; `/legal/` says "Coming soon" until a lawyer
   has reviewed them. The waitlist needs a short website privacy notice (a first version is on `/legal/#waitlist`).
9. **Optional:** a founder name, bio and portrait for `/about/`; one sourced statistic on fit returns for
   `/why/` (with the link); a Dutch version (only the short strings first).

The photos are CC0 from the WordPress Photo Directory (Unsplash and Pexels could not be verified from the
build sandbox). CC0 covers copyright, not model releases, so the picks show people from behind or cropped.
Swapping in licensed campaign photography later is a matter of replacing files in `public/img/photos/`
(keep the `-800` and `-1600` widths in AVIF and WebP) and updating `src/data/photo-credits.json` and the
alt text in `src/data/images.ts`.

## Deploying to curtain.fit

The site is static: anything that serves a folder over HTTPS works. Two options.

### Option A — the existing VPS behind Caddy (recommended)

The VPS already runs Caddy for `app.<domain>` and `api.<domain>` (docs/DEPLOY.md). The site becomes a third
site block on the same Caddy.

**1. DNS at Hostinger** (hPanel → Domains → curtain.fit → DNS / Nameservers → DNS records). Remove the
parking `A`/`CNAME` records for `@` and `www` that Hostinger adds by default, then add:

| Type | Name | Points to | TTL |
|---|---|---|---|
| A | `@` | the VPS IPv4 | 3600 |
| AAAA | `@` | the VPS IPv6 (only if the VPS has one) | 3600 |
| CNAME | `www` | `curtain.fit` | 3600 |
| A | `app`, `api` | the VPS IPv4 (already needed for the product, see DEPLOY.md) | 3600 |

Check with `dig +short curtain.fit A` and `dig +short www.curtain.fit` before reloading Caddy, so the
Let's Encrypt challenge finds the server.

**2. Caddy site block.** Add to `infra/Caddyfile` (the `security_headers` snippet already exists there) and
mount the site folder read-only in `infra/docker-compose.yml` (`- site:/srv/site:ro` on the caddy service
and a `site:` volume):

```caddy
{$DOMAIN} {
	import security_headers
	root * /srv/site
	encode zstd gzip

	# No cookies, no third parties: everything is same-origin. style-src-attr allows only the image crop (object-position) attributes.
	header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' mailto:"
	header X-Frame-Options "DENY"

	@immutable path /assets/* /fonts/* /img/*
	header @immutable Cache-Control "public, max-age=31536000, immutable"
	@html path / *.html */
	header @html Cache-Control "no-cache"

	try_files {path} {path}/index.html
	file_server
	handle_errors {
		@404 expression {err.status_code} == 404
		rewrite @404 /404.html
		file_server
	}
}

www.{$DOMAIN} {
	redir https://{$DOMAIN}{uri} permanent
}
```

`/img/*` is marked immutable: if you replace a photo, give the file a new name. Run
`infra/scripts/caddy-validate.sh` after editing the Caddyfile.

**3. Publish.**

```bash
pnpm install --frozen-lockfile
pnpm --filter @curtain/site build
rsync -av --delete apps/site/dist/ <user>@<vps>:/opt/curtain/site-release/
# on the VPS: copy into the caddy volume, then reload
docker run --rm -v curtain_site:/srv/site -v /opt/curtain/site-release:/src:ro caddy:2.9-alpine \
  sh -c 'cp -a /src/assets /src/fonts /src/img /srv/site/ 2>/dev/null; cp -a /src/. /srv/site/'
docker compose -f /opt/curtain/infra/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Copying `assets/`, `fonts/` and `img/` first means a visitor never gets new HTML that points at a CSS or JS
file that isn't there yet. Old hashed files can be cleaned up now and then. Wiring this into
`infra/scripts/deploy.sh` and CI is a follow-up; it has not been done in this change.

### Option B — Hostinger static hosting

If you'd rather keep the website off the VPS: in hPanel, add curtain.fit as a website on a Hostinger
hosting plan, then upload the **contents** of `apps/site/dist/` to `public_html/` (File Manager or SFTP).
Hostinger provides the TLS certificate. Add this `.htaccess` in `public_html/` for clean URLs, caching and
the 404 page:

```apache
ErrorDocument 404 /404.html
DirectorySlash On
<IfModule mod_headers.c>
  <FilesMatch "\.(css|js|woff2|avif|webp|png|jpg|svg)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>
```

In this case leave the `@`/`www` DNS records on Hostinger's hosting, and point only `app` and `api` at the VPS.

## After launch

- Submit `https://curtain.fit/sitemap.xml` in Google Search Console (DNS TXT verification at Hostinger;
  no tracking script needed).
- Re-shoot the product screenshots when the plugin UI changes (the capture scripts used `pnpm demo` with
  the synthetic `aalter-studio-2` garment; never the azure bundle, whose texture is shop-derived).
- Regenerate `public/og.jpg` after changing the hero: screenshot `/og-card.html` at 1200×630.
