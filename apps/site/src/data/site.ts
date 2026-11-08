/**
 * Everything the founder still has to decide lives here. `null` means "not decided yet":
 * the pages then fall back to honest neutral copy and the build prints a reminder (see docs/SITE.md).
 */
export const site = {
  url: 'https://curtain.fit',
  name: 'Curtain',
  tagline: 'Your private fitting room',
  /** FOUNDER: the mailbox must exist (Hostinger e-mail or a forwarder) before launch. */
  contactEmail: 'hello@curtain.fit',
  /** FOUNDER: separate privacy contact, or null to reuse contactEmail. */
  privacyEmail: null as string | null,
  /** FOUNDER: e.g. "two working days". */
  responseTime: null as string | null,
  /** FOUNDER: company legal name for the footer and imprint. */
  legalName: null as string | null,
  /** FOUNDER: trial length in days (code default 7, listing draft 14). */
  trialDays: null as number | null,
  price: { amount: '8.99', currency: 'USD', per: 'month, per shop' },
  issue: 'Issue 01 — Autumn 2026',
  partner: {
    /** The founder calls Bohohippychic "our partner"; we describe them factually as the pilot shop. */
    name: 'Bohohippychic',
    url: 'https://bohohippychic.com.au',
    /** FOUNDER: update when the pilot goes live on their store. */
    status: 'Being set up — not live on their store yet.',
    /** PILOT: flip to true only with their written approval of images (DECISIONS D13). */
    assetsApproved: false,
  },
} as const;

/** Things the build reports as still open, so they don't get forgotten before launch. */
export function openDecisions(): string[] {
  const open: string[] = [];
  if (!site.privacyEmail) open.push('privacyEmail (falls back to contactEmail)');
  if (!site.responseTime) open.push('responseTime');
  if (!site.legalName) open.push('legalName (footer, imprint)');
  if (site.trialDays === null) open.push('trialDays (pricing, FAQ)');
  if (!site.partner.assetsApproved) open.push('partner.assetsApproved (Bohohippychic imagery placeholders shown)');
  return open;
}

export interface NavItem {
  href: string;
  label: string;
  num: string;
}

/** The contents index: header overlay, footer and sitemap use this order. */
export const contents: NavItem[] = [
  { href: '/how-it-works/', label: 'How it works', num: '01' },
  { href: '/3d/', label: 'The 3D estimate', num: '02' },
  { href: '/why/', label: 'Why we do this', num: '03' },
  { href: '/pilot/', label: 'Our pilot partner', num: '04' },
  { href: '/pricing/', label: 'Pricing', num: '05' },
  { href: '/privacy-promise/', label: 'Privacy & trust', num: '06' },
  { href: '/faq/', label: 'FAQ', num: '07' },
  { href: '/about/', label: 'Who we are', num: '08' },
  { href: '/journal/', label: 'Journal', num: '09' },
  { href: '/waitlist/', label: 'Join the waitlist', num: '10' },
];

export const primaryNav: { href: string; label: string }[] = [
  { href: '/how-it-works/', label: 'How it works' },
  { href: '/3d/', label: '3D estimate' },
  { href: '/pilot/', label: 'Pilot' },
  { href: '/journal/', label: 'Journal' },
  { href: '/about/', label: 'About' },
];
