import { html } from '../lib/html.ts';
import { type Qa } from '../lib/components.ts';
import { site } from './site.ts';

const trial = site.trialDays ? `with a free trial of ${site.trialDays} days` : 'with a free trial (its length is announced at launch)';

export const faq: Qa[] = [
  {
    q: 'Is Curtain live?',
    a: html`<p>Not yet for everyone. It's built and tested in our demo store, and we're setting it up with our first pilot shop. <a href="/waitlist/">Join the waitlist</a> and we'll tell you when you can install it.</p>`,
  },
  {
    q: 'Which platforms do you support?',
    a: html`<p>Shopify (a theme block you add in the theme editor) and WooCommerce (a WordPress plugin). Using another platform? Tell us on the waitlist form.</p>`,
  },
  {
    q: 'Do my shoppers need an app or an account?',
    a: html`<p>No. Everything happens in an overlay on your product page. No download, no sign-up.</p>`,
  },
  {
    q: 'Where does the size come from?',
    a: html`<p>From your own size chart and what the shopper tells us, worked out by our fit engine on their device. You choose a chart from our templates or enter your own.</p>`,
  },
  {
    q: 'Is the recommendation guaranteed?',
    a: html`<p>No, and we won't pretend. It's advice: only as good as the size chart behind it and the details the shopper gives. Curtain shows how confident it is, and the shopper always chooses.</p>`,
  },
  {
    q: 'Do you see my customers’ measurements? Do I?',
    a: html`<p>Neither of us does. Measurements stay on the shopper's device. We receive the recommended size and a random device number; you see totals. <a href="/privacy-promise/">Exactly what we store</a>.</p>`,
  },
  {
    q: 'What sizes and categories do the templates cover?',
    a: html`<p>Women's body charts for AU, UK, EU and US sizes, plus garment templates. For men's, kids' and other categories, add your own chart for now.</p>`,
  },
  {
    q: 'Do I need a developer?',
    a: html`<p>No code changes. On Shopify you add the block in the theme editor; on WooCommerce you upload the plugin and press Connect.</p>`,
  },
  {
    q: 'What does it cost?',
    a: html`<p>USD ${site.price.amount} a month per shop, flat, ${trial}. No fee per try-on. The 3D estimate is in pilot and will be priced separately later.</p>`,
  },
  {
    q: 'What is the 3D estimate?',
    a: html`<p>A 3D version of your garment, built from your own front and back product photos and draped on a figure shaped by the shopper's measurements, on their phone. It's always labelled an estimate and only appears for pieces you've approved. <a href="/3d/">How it's made</a>.</p>`,
  },
  {
    q: 'What happens if I cancel or uninstall?',
    a: html`<p>Your page never breaks. On Shopify, we delete your shop's data 48 hours after you uninstall. Your size charts are stored in your own shop, so they're there if you come back.</p>`,
  },
  {
    q: 'Will it slow my product page down?',
    a: html`<p>The button is a small script, and the fit tool and the 3D view only load when a shopper taps.</p>`,
  },
];

export interface Story {
  id: string;
  kicker: string;
  title: string;
  dek: string;
  image: string;
  pos?: string;
}

export const stories: Story[] = [
  {
    id: 'privacy',
    kicker: 'Privacy',
    title: 'Why your measurements never leave your phone',
    dek: 'How Curtain works out a size in the browser, and the short list of what we do receive.',
    image: 'photos/editorial-black-beige-2',
    pos: '60% 50%',
  },
  {
    id: 'charts',
    kicker: 'Size charts',
    title: 'Body chart or garment chart? The question that decides a size',
    dek: 'A size chart can describe the body a size fits, or the garment itself. Mixing them up is where good sizes go wrong.',
    image: 'photos/pattern-scissors',
    pos: '45% 50%',
  },
  {
    id: 'engine',
    kicker: 'The 3D engine',
    title: 'From two product photos to a 3D estimate (and why we call it an estimate)',
    dek: 'Inside our garment engine: a known mannequin, a known camera, and a merchant who signs off before anyone sees it.',
    image: 'renders/engine-dress-sizes-fitmap',
    pos: '50% 40%',
  },
];
