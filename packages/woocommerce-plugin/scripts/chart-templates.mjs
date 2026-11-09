/**
 * assets/chart-templates.json: the size chart templates of @curtain/schema (chartTemplates.ts) for
 * the meta box's "Start from a template" picker. Body templates carry their rows (cm) and the
 * labels preselected in the builder; garment templates carry only the size labels and the points
 * the merchant measures. Generated, never edited: the build and the test fixture export write it,
 * so the Shopify admin and the WooCommerce meta box offer the same numbers.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CHART_TEMPLATES } from '@curtain/schema';

export function chartTemplatesAsset() {
  return {
    source: '@curtain/schema chartTemplates.ts',
    templates: CHART_TEMPLATES.map((t) =>
      t.kind === 'body'
        ? { id: t.id, kind: t.kind, label: t.label, description: t.description, sizes: [...t.defaultSizes], weakSizes: [...t.weakSizes], rows: t.rows.filter((r) => t.defaultSizes.includes(r.size)).map((r) => ({ size: r.size, bust: r.bust, waist: r.waist, hip: r.hip })) }
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
