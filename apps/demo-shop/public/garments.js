/**
 * Flat-lay garment illustrations as inline SVG (no external images in the demo storefront).
 * One silhouette per category, varied by pattern block, filled with the colourway's hex.
 */

const SHAPES = {
  dress: {
    default: 'M122 52 L178 52 L190 76 C198 104 194 132 186 152 L236 338 L64 338 L114 152 C106 132 102 104 110 76 Z',
    'a-line': 'M118 48 L182 48 L198 70 L196 150 L246 338 L54 338 L104 150 L102 70 Z',
    sheath: 'M116 52 L184 52 L210 70 L200 96 L192 92 C196 120 192 150 186 170 L204 338 L96 338 L114 170 C108 150 104 120 108 92 L100 96 L90 70 Z',
    bias: 'M126 70 L174 70 C186 104 186 138 180 160 L224 338 L76 338 L120 160 C114 138 114 104 126 70 Z',
  },
  top: {
    default: 'M104 70 L132 56 Q150 72 168 56 L196 70 L240 112 L216 138 L198 122 L198 304 L102 304 L102 122 L84 138 L60 112 Z',
    shirt: 'M104 66 L134 54 L150 76 L166 54 L196 66 L246 190 L222 200 L198 132 L198 310 L102 310 L102 132 L78 200 L54 190 Z',
    oversized: 'M96 72 L130 58 Q150 74 170 58 L204 72 L256 236 L226 246 L204 150 L206 298 L94 298 L96 150 L74 246 L44 236 Z',
    bias: 'M122 90 L178 90 C190 130 194 170 196 210 L204 296 L96 296 L104 210 C106 170 110 130 122 90 Z',
    wrap: 'M102 70 L134 58 L150 120 L166 58 L198 70 L244 150 L222 166 L198 130 L200 288 L100 288 L102 130 L78 166 L56 150 Z',
  },
  bottom: {
    default: 'M98 50 L202 50 L214 338 L164 338 L150 146 L136 338 L86 338 Z',
    'a-line': 'M112 56 L188 56 L240 330 L60 330 Z',
  },
  outerwear: {
    default: 'M100 62 L134 50 L150 120 L166 50 L200 62 L254 250 L226 258 L204 150 L206 318 L94 318 L96 150 L74 258 L46 250 Z',
  },
};

/** Extra detail lines (seams, pleats, plackets) drawn on top in a translucent stroke. */
const DETAILS = {
  'dress/wrap': 'M110 76 L186 152 M190 76 L150 128',
  'dress/a-line': 'M150 48 L150 338 M140 62 L150 76 L160 62',
  'dress/bias': 'M128 70 L122 44 M172 70 L178 44 M120 160 L180 160',
  'dress/sheath': 'M114 170 L186 170 M150 52 L150 70',
  'top/shirt': 'M150 76 L150 310 M134 54 L150 76 L166 54 M144 120 h0 M144 160 h0',
  'top/oversized': 'M96 284 L206 284 M96 290 L206 290 M226 240 L256 230 M44 230 L74 240',
  'top/bias': 'M128 90 L124 60 M172 90 L176 60',
  'top/wrap': 'M102 130 L170 250 M198 130 L150 196',
  'bottom/straight': 'M98 66 L202 66 M150 66 L150 146 M106 76 C116 96 128 100 138 100',
  'bottom/a-line': 'M112 72 L188 72 M130 72 L110 330 M150 72 L150 330 M170 72 L190 330',
  'outerwear/boxy': 'M134 50 L126 150 L150 196 M166 50 L174 150 L150 196 M150 196 L150 318 M118 240 L138 240',
};

/** Perceived lightness, to choose a visible outline on pale garments. */
function light(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export function garmentSvg(product, hex, { title = '', background = '#EFE8DD' } = {}) {
  const cat = SHAPES[product.category] ? product.category : 'top';
  const block = product.patternBlock || 'default';
  const d = SHAPES[cat][block] || SHAPES[cat].default;
  const detail = DETAILS[`${cat}/${block}`] || '';
  const fill = hex || product.primaryColorHex || '#C9BBA7';
  const pale = light(fill) > 0.8;
  const stroke = pale ? 'rgba(28,26,23,.28)' : 'rgba(0,0,0,.18)';
  const detailStroke = pale ? 'rgba(28,26,23,.22)' : 'rgba(255,255,255,.22)';
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  return `<svg viewBox="0 0 300 375" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(title || product.name)}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${background}"/><stop offset="1" stop-color="${shade(background, -0.05)}"/></linearGradient>
    <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient>
  </defs>
  <rect width="300" height="375" fill="url(#${id}b)"/>
  <ellipse cx="150" cy="352" rx="96" ry="8" fill="#000" opacity=".06"/>
  <path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="${d}" fill="url(#${id}s)"/>
  ${detail ? `<path d="${detail}" fill="none" stroke="${detailStroke}" stroke-width="1.6" stroke-linecap="round"/>` : ''}
</svg>`;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  return `#${[f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
