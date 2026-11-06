/**
 * The product's own size chart as a classic table (sizes as rows, measurements as columns), in the
 * shopper's units, with the recommended size highlighted. It shows the merchant's numbers as they
 * are: whether they are body or garment measurements is said in the caption, never guessed.
 */
import { useId, type ReactNode } from 'react';
import type { GarmentPayload, SizeRow } from '@curtain/schema';
import { chartLength, lengthUnit, type Units } from './units';

type ChartKey = Exclude<keyof SizeRow, 'size'>;

/** Columns in the order shoppers read them; lengths are converted, the EU shoe size never is. */
const COLUMNS: readonly { key: ChartKey; label: string; length: boolean }[] = [
  { key: 'bust', label: 'Bust', length: true },
  { key: 'waist', label: 'Waist', length: true },
  { key: 'hip', label: 'Hip', length: true },
  { key: 'shoulder', label: 'Shoulders', length: true },
  { key: 'thigh', label: 'Thigh', length: true },
  { key: 'inseam', label: 'Inseam', length: true },
  { key: 'footLengthCm', label: 'Foot length', length: true },
  { key: 'footEu', label: 'EU size', length: false },
];

/** The columns this chart actually has values for. */
export function chartColumns(chart: readonly SizeRow[]): typeof COLUMNS {
  return COLUMNS.filter((c) => chart.some((r) => typeof r[c.key] === 'number'));
}

export function chartCaption(type: GarmentPayload['sizeChartType'], units: Units): string {
  const what = type === 'body' ? 'Body measurements' : 'Garment measurements';
  return `${what}, in ${units === 'imperial' ? 'inches' : 'centimetres'}`;
}

const CHART_NOTE: Record<GarmentPayload['sizeChartType'], string> = {
  body: 'The body each size is made for. Compare with your own measurements.',
  garment: 'Measured on the finished garment, so it includes the room the design allows.',
};

export function SizeChartTable({ garment, recommended, units }: { garment: GarmentPayload; recommended: string | null; units: Units }): ReactNode {
  const id = useId();
  const columns = chartColumns(garment.sizeChart);
  const unit = lengthUnit(units);
  return (
    <section className="space-y-2" aria-labelledby={`${id}-title`} data-testid="size-chart">
      <h3 id={`${id}-title`} className="eyebrow">
        Size chart
      </h3>
      {/* Focusable so keyboard users can scroll a wide chart sideways. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="card overflow-x-auto p-0" role="region" aria-labelledby={`${id}-caption`} tabIndex={0}>
        <table className="w-full border-collapse text-sm tabular-nums">
          <caption id={`${id}-caption`} className="px-3 pt-2.5 pb-1.5 text-left text-xs text-ink-mute">
            {chartCaption(garment.sizeChartType, units)}
          </caption>
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs text-ink-soft">
              <th scope="col" className="px-3 py-1.5 font-semibold">
                Size
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-1.5 text-right font-semibold whitespace-nowrap">
                  {c.label}
                  {c.length ? <span className="font-normal text-ink-mute"> ({unit})</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {garment.sizeChart.map((row) => {
              const isRec = row.size === recommended;
              return (
                <tr key={row.size} className={`border-b border-ink/5 last:border-0 ${isRec ? 'bg-coral/10 font-semibold' : ''}`} data-recommended={isRec || undefined}>
                  <th scope="row" className="px-3 py-1.5 text-left whitespace-nowrap">
                    {row.size}
                    {isRec ? <span className="ml-2 rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">Recommended</span> : null}
                  </th>
                  {columns.map((c) => {
                    const v = row[c.key];
                    return (
                      <td key={c.key} className="px-3 py-1.5 text-right">
                        {typeof v === 'number' ? (c.length ? chartLength(v, units) : String(v)) : <>
                            <span aria-hidden>–</span>
                            <span className="sr-only">not given</span>
                          </>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-mute">{CHART_NOTE[garment.sizeChartType]}</p>
    </section>
  );
}
