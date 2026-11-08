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
    /**
     * LAUNCH GATE: true once Bohohippychic has agreed in writing to be named as our pilot shop.
     * The preview build names them (the founder's request); the release build refuses until this is true.
     */
    nameApproved: false,
    /** FOUNDER: set to false to describe them neutrally ("an Australian boho label") instead of by name. */
    showName: true,
  },
  /**
   * LAUNCH GATE: the identity behind the waitlist (GDPR Art. 13). The release build refuses while any is empty.
   * The waitlist notice on /legal/#waitlist and the imprint use these.
   */
  company: {
    address: null as string | null,
    registration: null as string | null,
    vat: null as string | null,
  },
  /** LAUNCH GATE: true once hello@curtain.fit (or contactEmail) exists and receives mail. */
  mailboxReady: false,
  /** LAUNCH GATE: true once a lawyer has reviewed the waitlist notice on /legal/#waitlist. */
  waitlistNoticeReviewed: false,
} as const;

/** How the pilot shop is named in running text. */
export const partnerName: string = site.partner.showName ? site.partner.name : 'an Australian boho label';
/** Capitalised form for headings and the start of a sentence. */
export const PartnerName: string = site.partner.showName ? site.partner.name : 'An Australian boho label';

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

/** Must all be cleared before the site goes public: `pnpm --filter @curtain/site build:release` fails otherwise. */
export function launchGates(): string[] {
  const gates: string[] = [];
  if (site.partner.showName && !site.partner.nameApproved) gates.push('partner.nameApproved: Bohohippychic has not yet agreed in writing to be named (or set partner.showName=false)');
  if (!site.legalName || !site.company.address || !site.company.registration) gates.push('legalName + company.address + company.registration: needed for the imprint and the waitlist notice (GDPR Art. 13)');
  if (!site.mailboxReady) gates.push(`mailboxReady: create ${site.contactEmail} before the waitlist goes live`);
  if (!site.waitlistNoticeReviewed) gates.push('waitlistNoticeReviewed: legal review of /legal/#waitlist');
  return gates;
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
