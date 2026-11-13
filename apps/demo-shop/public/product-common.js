/** Pieces both product page styles share: gallery, size guide, details, the size-selected note. */
import { escapeHtml, garmentSvg } from './garments.js';

const GALLERY_BG = ['#EFE8DD', '#E6E0D6', '#E3E7DE'];

export function gallery(p, hex, cls) {
  return `<div class="${cls} gallery">
    <div class="gallery-main" data-gallery-main>${garmentSvg(p, hex, { title: `${p.name}, flat lay` })}</div>
    <div class="gallery-thumbs" aria-hidden="true">
      ${GALLERY_BG.map((bg) => `<div class="thumb">${garmentSvg(p, hex, { background: bg })}</div>`).join('')}
    </div>
  </div>`;
}

export function updateGallery(root, p, hex) {
  root.querySelector('[data-gallery-main]').innerHTML = garmentSvg(p, hex, { title: `${p.name}, flat lay` });
  root.querySelectorAll('.gallery-thumbs .thumb').forEach((t, i) => (t.innerHTML = garmentSvg(p, hex, { background: GALLERY_BG[i] })));
}

const COLS = [
  ['bust', 'Bust'],
  ['waist', 'Waist'],
  ['hip', 'Hip'],
  ['shoulder', 'Shoulder'],
  ['inseam', 'Inseam'],
  ['thigh', 'Thigh'],
];

export function sizeGuide(p) {
  const chart = p.sizeChart ?? [];
  if (!chart.length) return '<p>Size chart coming soon.</p>';
  const cols = COLS.filter(([k]) => chart.some((r) => typeof r[k] === 'number'));
  return `<p class="muted">${p.sizeChartType === 'garment' ? 'Garment measurements, measured flat and doubled' : 'Body measurements each size is cut for'}, in cm.</p>
  <div class="table-wrap"><table class="size-table">
    <thead><tr><th scope="col">Size</th>${cols.map(([, l]) => `<th scope="col">${l}</th>`).join('')}</tr></thead>
    <tbody>${chart.map((r) => `<tr><th scope="row">${escapeHtml(r.size)}</th>${cols.map(([k]) => `<td>${r[k] ?? '–'}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

export function fabricLine(p) {
  if (!p.fabric?.length) return '';
  return p.fabric.map(([fibre, pct]) => `${pct}% ${fibre}`).join(', ');
}

export function description(p) {
  const fabric = fabricLine(p);
  const words = { dress: 'dress', top: 'top', bottom: 'piece', outerwear: 'jacket' }[p.category] ?? 'piece';
  return `A ${p.patternBlock ? `${escapeHtml(p.patternBlock.replace('-', ' '))} ` : ''}${words} by ${escapeHtml(p.brand)}${fabric ? ` in ${escapeHtml(fabric)}` : ''}. ${p.sizingNotes ? `Fit note: ${escapeHtml(p.sizingNotes)}.` : ''}`;
}

/**
 * A theme-level listener for the SDK's bubbling `curtain:size-selected` DOM event: shows which size
 * Curtain picked, next to the button. Real themes can do the same.
 */
export function listenForCurtain(note) {
  document.addEventListener('curtain:size-selected', (e) => {
    const { size, via } = e.detail ?? {};
    if (!size) return;
    note.hidden = false;
    note.innerHTML = via === 'toast' ? `Your size: <strong>${escapeHtml(size)}</strong>` : `Curtain selected size <strong>${escapeHtml(size)}</strong> for you. Add it to your bag when you are ready.`;
  });
}
