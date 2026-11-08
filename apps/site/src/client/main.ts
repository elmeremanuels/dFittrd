/**
 * Progressive enhancement only: every page is complete and readable without this script.
 * No cookies, no storage, no network requests.
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- header: hide on scroll down, show on scroll up ---------- */
function initHeader(): void {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (!header) return;
  let lastY = window.scrollY;
  let ticking = false;
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const menuOpen = document.documentElement.classList.contains('menu-open');
        header.classList.toggle('is-scrolled', y > 8);
        header.classList.toggle('is-hidden', !menuOpen && y > 240 && y > lastY && !header.contains(document.activeElement));
        lastY = y;
        ticking = false;
      });
    },
    { passive: true },
  );
  header.addEventListener('focusin', () => header.classList.remove('is-hidden'));
}

/* ---------- full-screen contents menu ---------- */
function initMenu(): void {
  const toggle = document.querySelector<HTMLAnchorElement>('[data-menu-toggle]');
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  if (!toggle || !menu) return;
  toggle.setAttribute('role', 'button');
  const label = toggle.querySelector('.menu-toggle__label');
  const setOpen = (open: boolean): void => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (label) label.textContent = open ? 'Close' : 'Menu';
    document.documentElement.classList.toggle('menu-open', open);
    if (open) menu.querySelector<HTMLAnchorElement>('a')?.focus();
  };
  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    setOpen(menu.hidden);
  });
  toggle.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      setOpen(menu.hidden);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });
  menu.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) setOpen(false);
  });
}

/* ---------- reveals: content is visible by default; animation is opt-in via .js-reveal ---------- */
function initReveals(): void {
  if (reduceMotion.matches || !('IntersectionObserver' in window)) return;
  const els = document.querySelectorAll<HTMLElement>('[data-reveal]');
  const vh = window.innerHeight;
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  els.forEach((el) => {
    // Already on screen at load: don't hide it, just leave it.
    if (el.getBoundingClientRect().top < vh * 0.9) return;
    el.classList.add('will-reveal');
    io.observe(el);
  });
}

/* ---------- lookbook carousel: buttons, counter, native scroll ---------- */
function initLookbooks(): void {
  document.querySelectorAll<HTMLElement>('[data-lookbook]').forEach((root) => {
    const track = root.querySelector<HTMLElement>('.lookbook__track');
    const cur = root.querySelector<HTMLElement>('[data-current]');
    const prev = root.querySelector<HTMLButtonElement>('[data-prev]');
    const next = root.querySelector<HTMLButtonElement>('[data-next]');
    if (!track || !cur || !prev || !next) return;
    const cards = Array.from(track.children) as HTMLElement[];
    const index = (): number => {
      const left = track.scrollLeft;
      let best = 0;
      cards.forEach((c, i) => {
        if (Math.abs(c.offsetLeft - track.offsetLeft - left) < Math.abs((cards[best]?.offsetLeft ?? 0) - track.offsetLeft - left)) best = i;
      });
      return best;
    };
    const update = (): void => {
      const i = index();
      cur.textContent = String(i + 1);
      prev.disabled = track.scrollLeft < 4;
      next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    };
    const go = (d: number): void => {
      const target = cards[Math.max(0, Math.min(cards.length - 1, index() + d))];
      if (target) track.scrollTo({ left: target.offsetLeft - track.offsetLeft, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    };
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      }
    });
    track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
    update();
  });
}

/* ---------- waitlist form: inline validation, then a prefilled e-mail (no backend yet) ---------- */
function initWaitlist(): void {
  const form = document.querySelector<HTMLFormElement>('[data-waitlist]');
  if (!form) return;
  const status = form.querySelector<HTMLElement>('[data-status]');
  const to = form.dataset.email ?? '';

  const messages: Record<string, string> = {
    name: 'Please tell us your name.',
    email: 'Please enter a work e-mail address, like name@brand.com.',
    brand: 'Please tell us your brand name.',
    shop: 'Please enter your shop address, starting with https://.',
    platform: 'Please choose a platform.',
    consent: 'Please agree so we can e-mail you about the waitlist.',
  };

  const setError = (name: string, msg: string): void => {
    const input = form.elements.namedItem(name);
    const first = input instanceof RadioNodeList ? (input[0] as HTMLInputElement | undefined) : (input as HTMLInputElement | null);
    if (!first) return;
    const errId = first.getAttribute('aria-describedby')?.split(' ').find((id) => id.endsWith('-error'));
    const err = errId ? document.getElementById(errId) : null;
    if (err) {
      err.textContent = msg;
      err.hidden = msg === '';
    }
    const all = input instanceof RadioNodeList ? (Array.from(input) as HTMLInputElement[]) : [first];
    all.forEach((el) => (msg ? el.setAttribute('aria-invalid', 'true') : el.removeAttribute('aria-invalid')));
  };

  const validate = (): string[] => {
    const bad: string[] = [];
    for (const name of Object.keys(messages)) {
      const el = form.elements.namedItem(name);
      let ok = true;
      if (el instanceof RadioNodeList) ok = el.value !== '';
      else if (el instanceof HTMLInputElement) ok = el.type === 'checkbox' ? el.checked : el.checkValidity() && el.value.trim() !== '';
      setError(name, ok ? '' : (messages[name] ?? ''));
      if (!ok) bad.push(name);
    }
    return bad;
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const bad = validate();
    if (bad.length) {
      const first = form.elements.namedItem(bad[0] ?? '');
      const el = first instanceof RadioNodeList ? (first[0] as HTMLElement | undefined) : (first as HTMLElement | null);
      el?.focus();
      if (status) status.textContent = `Please check ${bad.length === 1 ? 'one field' : `${bad.length} fields`}.`;
      return;
    }
    const d = new FormData(form);
    const get = (k: string): string => String(d.get(k) ?? '').trim();
    const body = [
      `Name: ${get('name')}`,
      `E-mail: ${get('email')}`,
      `Brand: ${get('brand')}`,
      `Shop URL: ${get('shop')}`,
      `Platform: ${get('platform')}`,
      `Sells: ${get('sells') || '-'}`,
      '',
      get('message'),
      '',
      'I agree that Curtain may e-mail me about the waitlist.',
    ].join('\n');
    const href = `mailto:${to}?subject=${encodeURIComponent(`Waitlist: ${get('brand')}`)}&body=${encodeURIComponent(body)}`;
    if (status) status.textContent = 'Your e-mail app should open with your details. Press send and we will reply.';
    window.location.href = href;
  });

  form.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name && t.name in messages && t.getAttribute('aria-invalid')) validate();
  });
}

document.documentElement.classList.add('js');
initHeader();
initMenu();
initReveals();
initLookbooks();
initWaitlist();
