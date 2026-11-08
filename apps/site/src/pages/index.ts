import { about } from './about.ts';
import { credits } from './credits.ts';
import { faqPage } from './faq.ts';
import { home } from './home.ts';
import { how } from './how.ts';
import { journal } from './journal.ts';
import { legal } from './legal.ts';
import { notFound } from './notfound.ts';
import { ogCard } from './og.ts';
import { pilot } from './pilot.ts';
import { pricing } from './pricing.ts';
import { privacy } from './privacy.ts';
import { threed } from './threed.ts';
import { type Page } from './types.ts';
import { waitlist } from './waitlist.ts';
import { why } from './why.ts';

export const pages: Page[] = [home, how, threed, why, pilot, pricing, privacy, faqPage, about, journal, waitlist, credits, legal, notFound, ogCard];
