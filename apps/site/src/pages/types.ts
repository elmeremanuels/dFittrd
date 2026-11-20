import { type SafeHtml } from '../lib/html.ts';
import { type PageMeta } from '../lib/layout.ts';

export interface Page {
  meta: PageMeta;
  body: () => SafeHtml;
  /** Excluded from sitemap.xml (404, OG card). */
  hidden?: boolean;
  /** Output file relative to dist; defaults to <path>/index.html. */
  file?: string;
}
