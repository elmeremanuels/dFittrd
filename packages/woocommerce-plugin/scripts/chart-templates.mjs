/**
 * assets/chart-templates.json: the size chart templates of @curtain/schema (chartTemplates.ts) for
 * the meta box's "Start from a template" picker. Body templates carry their rows (cm), the labels
 * preselected in the builder and, for the men's templates, `audience: 'men'` and their points; garment templates carry only the size labels and the points
 * the merchant measures. Generated, never edited: the build and the test fixture export write it,
 * so the Shopify admin and the WooCommerce meta box offer the same numbers.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CHART_POINTS, CHART_TEMPLATES } from '@curtain/schema';

/** A body row with the points the template carries (bust, waist, hip for the women's charts; waist and inseam for men's jeans W/L). */
function bodyRow(r) {
  const row = { size: r.size };
  for (const p of CHART_POINTS) if (typeof r[p] === 'number') row[p] = r[p];
  return row;
}

export function chartTemplatesAsset() {
  return {
    source: '@curtain/schema chartTemplates.ts',
    templates: CHART_TEMPLATES.map((t) =>
      t.kind === 'body'
        ? { id: t.id, kind: t.kind, label: t.label, description: t.description, sizes: [...t.defaultSizes], weakSizes: [...t.weakSizes], rows: t.rows.filter((r) => t.defaultSizes.includes(r.size)).map(bodyRow), ...(t.audience ? { audience: t.audience } : {}), ...(t.points ? { points: [...t.points] } : {}) }
        : { id: t.id, kind: t.kind, label: t.label, description: t.description, sizes: [...t.defaultSizes], points: [...t.points] },
    ),
  };
}

export function writeChartTemplatesAsset(root) {
  const file = join(root, 'assets/chart-templates.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(chartTemplatesAsset()));
  return file;
}
