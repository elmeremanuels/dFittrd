// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { MerchantAssetReview } from './AssetReview';
import type { MerchantData } from './MerchantConsole';
import { mockProducts } from './mock';

afterEach(cleanup);

function renderReview() {
  const products = mockProducts();
  const data = { mode: 'mock', products } as unknown as MerchantData;
  const id = products.items[0]!.externalId;
  const router = createMemoryRouter([{ path: '/merchant', element: <Outlet context={data} />, children: [{ path: 'products/:externalId/3d', element: <MerchantAssetReview /> }] }], { initialEntries: [`/merchant/products/${id}/3d`] });
  render(<RouterProvider router={router} />);
}

describe('the merchant’s review of 3D versions', () => {
  it('a version that passed the automatic check: every check ticked, the tape and its provenance per size, no warning', () => {
    renderReview();
    const card = screen.getByTestId('asset-awaiting_approval');
    expect(within(card).getByTestId('asset-status')).toHaveTextContent('Waiting for your approval');
    expect(within(card).getByTestId('check-summary')).toHaveTextContent('Every check passed');
    expect(within(card).getAllByLabelText('Passed')).toHaveLength(9);
    expect(within(card).queryByText('Read before approving')).toBeNull();
    expect(within(card).getByTestId('tape-row-12')).toHaveTextContent(/12\s*Estimated\s*Estimated\s*between two sizes you measured\s*124\s*3D 124–125.1\s*254\s*3D 254\s*105/);
    expect(within(card).getByTestId('tape-row-16')).toHaveTextContent(/Rough estimate\s*Rough estimate\s*beyond the sizes you measured/);
    expect(within(card).getByTestId('tape-row-8')).toHaveTextContent(/Measured\s*Measured\s*your tape/);
    expect(within(card).getByText(/Hip \(C\): you did not say how far below the band/)).toBeInTheDocument();
    expect(within(card).getAllByText(/^Size 8 is not drawn on a body with 1(09|14) cm hips/)).toHaveLength(2);
    expect(within(card).getByText(/labelled an estimate, never a measurement/)).toBeInTheDocument();
  });

  it('a refused version: the failed checks with their reasons, and no approve button', () => {
    renderReview();
    const card = screen.getByTestId('asset-refused');
    expect(within(card).getByTestId('asset-status')).toHaveTextContent('Refused by the automatic check');
    expect(within(card).getAllByLabelText('Failed')).toHaveLength(2);
    expect(within(card).getByText(/^Size 12: the draped hem is 254 cm around on every body it was draped on, the tape says 280 cm/)).toBeInTheDocument();
    expect(within(card).getByText(/^Size 16 is called measured but its tape numbers are extrapolated/)).toBeInTheDocument();
    expect(within(card).queryByTestId('approve')).toBeNull();
    expect(within(card).getByText('A refused version cannot be approved.')).toBeInTheDocument();
  });

  it('an older import without the check keeps its warning; approving the passed one makes it live', async () => {
    renderReview();
    const old = screen.getByTestId('asset-superseded');
    expect(within(old).getByText(/imported before the automatic check existed/)).toBeInTheDocument();
    expect(within(old).getByText('Read before approving')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('approve'));
    const card = screen.getByTestId('asset-approved');
    expect(within(card).getByText('Live for shoppers')).toBeInTheDocument();
  });
});
