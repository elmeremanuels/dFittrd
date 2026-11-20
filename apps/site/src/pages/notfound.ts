import { html } from '../lib/html.ts';
import { button, curtainSvg } from '../lib/components.ts';
import { type Page } from './types.ts';

export const notFound: Page = {
  meta: { path: '/404.html', title: 'Wrong size — Curtain', description: 'This page does not fit.', noindex: true },
  hidden: true,
  file: '404.html',
  body: () => html`
<section class="nf">
  ${curtainSvg('nf__svg')}
  <div class="nf__inner wrap">
    <p class="kicker">Error 404</p>
    <h1 class="display-xxl">Wrong <em>size.</em></h1>
    <p class="standfirst">This page doesn't fit. Let's get you back to the rail.</p>
    <div class="btn-row">${button('/', 'Home')}${button('/how-it-works/', 'How it works', 'secondary')}</div>
  </div>
</section>
`,
};
