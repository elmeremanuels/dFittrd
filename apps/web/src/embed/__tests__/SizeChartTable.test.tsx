// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MOCK_GARMENTS_BY_ID, type GarmentPayload } from '@curtain/schema';
import { chartCaption, chartColumns, SizeChartTable } from '../SizeChartTable';

const dress = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;

/** A pilot-shop style chart: AU women's sizes 8–16, body measurements. */
const auDress: GarmentPayload = {
  ...dress,
  sizeChartType: 'body',
  sizeChart: [
    { size: '8', bust: 82, waist: 64, hip: 90 },
    { size: '10', bust: 87, waist: 69, hip: 95 },
    { size: '12', bust: 92, waist: 74, hip: 100 },
    { size: '14', bust: 97, waist: 79, hip: 105 },
    { size: '16', bust: 102, waist: 84, hip: 110 },
  ],
};

afterEach(() => cleanup());

const rowTexts = (table: HTMLElement): string[][] =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent ?? ''));

describe('SizeChartTable', () => {
  it('is a real table: caption, column headers with units, one row header per size', () => {
    render(<SizeChartTable garment={auDress} recommended="12" units="metric" />);
    const table = screen.getByRole('table', { name: 'Body measurements, in centimetres' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Size', 'Bust (cm)', 'Waist (cm)', 'Hip (cm)']);
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent?.replace('Recommended', ''))).toEqual(['8', '10', '12', '14', '16']);
    expect(rowTexts(table)[0]).toEqual(['8', '82', '64', '90']);
    // AU size labels are shown exactly as the shop prints them
    expect(screen.getByRole('rowheader', { name: /^12/ })).toBeInTheDocument();
  });

  it('highlights the recommended size, in text as well as colour', () => {
    render(<SizeChartTable garment={auDress} recommended="12" units="metric" />);
    const rec = screen.getByRole('rowheader', { name: /Recommended/ });
    expect(rec).toHaveTextContent('12Recommended');
    expect(rec.closest('tr')).toHaveAttribute('data-recommended', 'true');
    expect(screen.getAllByText('Recommended')).toHaveLength(1);
  });

  it('no highlight without a recommendation', () => {
    render(<SizeChartTable garment={auDress} recommended={null} units="metric" />);
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
  });

  it('shows inches with one decimal when the shopper uses imperial', () => {
    render(<SizeChartTable garment={auDress} recommended="12" units="imperial" />);
    const table = screen.getByRole('table', { name: 'Body measurements, in inches' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Size', 'Bust (in)', 'Waist (in)', 'Hip (in)']);
    expect(rowTexts(table)[2]).toEqual(['12Recommended', '36.2', '29.1', '39.4']);
  });

  it('labels a garment chart as garment measurements and only lists the columns it has', () => {
    const garment: GarmentPayload = { ...dress, sizeChartType: 'garment', sizeChart: [{ size: 'S', bust: 90, shoulder: 37 }, { size: 'M', bust: 95 }] };
    render(<SizeChartTable garment={garment} recommended="M" units="metric" />);
    expect(screen.getByRole('table', { name: 'Garment measurements, in centimetres' })).toBeInTheDocument();
    expect(screen.getByText(/finished garment/)).toBeInTheDocument();
    expect(chartColumns(garment.sizeChart).map((c) => c.key)).toEqual(['bust', 'shoulder']);
    // a missing value reads as "not given", never as zero
    expect(rowTexts(screen.getByRole('table'))[1]).toEqual(['MRecommended', '95', '–not given']);
  });

  it('never converts the EU shoe size', () => {
    const shoe: GarmentPayload = { ...dress, category: 'shoes', sizeChart: [{ size: '38', footEu: 38, footLengthCm: 24.5 }] };
    render(<SizeChartTable garment={shoe} recommended="38" units="imperial" />);
    expect(rowTexts(screen.getByRole('table'))[0]).toEqual(['38Recommended', '9.6', '38']);
    expect(chartCaption('body', 'imperial')).toBe('Body measurements, in inches');
  });
});
