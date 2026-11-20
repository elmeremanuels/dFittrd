// @vitest-environment jsdom
/**
 * The console's Settings page and the product list's notices (slice 1 steps 5 and 6; D25 points
 * 1, 2 and 7).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MERCHANT_SETUP_TEXT, type MerchantSettingsResponse, type MerchantSettingsUpdateRequest } from '@curtain/schema';
import { MerchantProducts, type MerchantData } from './MerchantConsole';
import { mockProducts, mockSettings, mockSetup } from './mock';
import { MerchantSettings } from './Settings';
import { merchantStrings } from './strings';

afterEach(cleanup);

const t = merchantStrings().console;

function renderAt(path: string, over: Partial<MerchantData> = {}) {
  const products = mockProducts();
  const saveSettings = vi.fn(async (_patch: MerchantSettingsUpdateRequest) => {});
  const data = { mode: 'live', products, setup: mockSetup(products), settings: mockSettings(), saveSettings, ...over } as unknown as MerchantData;
  const router = createMemoryRouter(
    [{ path: '/merchant', element: <Outlet context={data} />, children: [{ path: 'settings', element: <MerchantSettings /> }, { path: 'products', element: <MerchantProducts /> }] }],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return { saveSettings: (over.saveSettings as typeof saveSettings | undefined) ?? saveSettings, products, router };
}

describe('Settings: incomplete fabric details', () => {
  it('offers two plain choices, "show size advice anyway" chosen by default', () => {
    renderAt('/merchant/settings');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(screen.getByRole('radio', { name: /Show size advice anyway/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Hold the product back until it is complete/ })).not.toBeChecked();
    // No number, no jargon: the two labels and their explanations.
    expect(screen.getByText(t.settings.incomplete.choices['let-through'].text)).toBeInTheDocument();
    expect(screen.getByText(t.settings.incomplete.choices['hold-back'].text)).toBeInTheDocument();
  });

  it('saves the choice when it is picked, and says so', async () => {
    const { saveSettings } = renderAt('/merchant/settings');
    await userEvent.click(screen.getByTestId('policy-hold-back'));
    expect(saveSettings).toHaveBeenCalledWith({ incompleteProductData: 'hold-back' });
    await waitFor(() => expect(screen.getByTestId('settings-status')).toHaveTextContent(t.settings.saved));
  });

  it('says when a save failed', async () => {
    const saveSettings = vi.fn(async () => {
      throw new Error('offline');
    });
    renderAt('/merchant/settings', { saveSettings });
    await userEvent.click(screen.getByTestId('policy-hold-back'));
    await waitFor(() => expect(screen.getByTestId('settings-status')).toHaveTextContent(t.settings.failed));
  });

  it('tells how many products are held back right now', () => {
    renderAt('/merchant/settings');
    expect(screen.getByTestId('held-now')).toHaveTextContent('1 product is held back right now.');
  });

  it('is not a step of the "Get set up" checklist (D25 point 2)', () => {
    const steps = mockSetup(mockProducts()).steps;
    expect(steps).toHaveLength(5);
    expect(JSON.stringify(steps) + JSON.stringify(MERCHANT_SETUP_TEXT)).not.toMatch(/incomplete fabric|hold the product back|held back/i);
  });
});

describe('Settings: "Fit by Curtain", colour, logo and name', () => {
  it('the wordmark switch is on by default, and its text says the estimate labels always stay', async () => {
    const { saveSettings } = renderAt('/merchant/settings');
    const sw = screen.getByRole('switch', { name: /Show “Fit by Curtain”/ });
    expect(sw).toBeChecked();
    expect(sw).toHaveAccessibleDescription(/“Estimate” labels .* always stay/);
    await userEvent.click(sw);
    expect(saveSettings).toHaveBeenCalledWith({ showFitByCurtain: false });
  });

  it('an older api without the key still shows the switch as on', () => {
    renderAt('/merchant/settings', { settings: { incompleteProductData: 'let-through' } as MerchantSettingsResponse });
    expect(screen.getByRole('switch', { name: /Show “Fit by Curtain”/ })).toBeChecked();
  });

  it('shows the shop name read-only, with where to change it', () => {
    renderAt('/merchant/settings');
    expect(screen.getByTestId('shop-name')).toHaveTextContent('Aalter Studio');
    expect(screen.queryByRole('textbox', { name: /shop name/i })).toBeNull();
    expect(screen.getByText(t.settings.shop.nameFrom.woocommerce)).toBeInTheDocument();
  });

  it('saves colour and logo together; an empty field removes the value', async () => {
    const { saveSettings } = renderAt('/merchant/settings');
    const colour = screen.getByTestId('brand-colour');
    expect(colour).toHaveValue('#2F4F3A');
    await userEvent.clear(colour);
    await userEvent.type(screen.getByTestId('logo-url'), 'https://aalter.example/logo.png');
    await userEvent.click(screen.getByTestId('save-shop'));
    expect(saveSettings).toHaveBeenCalledWith({ brandColor: null, logoUrl: 'https://aalter.example/logo.png' });
  });

  it('does not send a colour that is not a hex code or a logo that is not https', async () => {
    const { saveSettings } = renderAt('/merchant/settings');
    await userEvent.clear(screen.getByTestId('brand-colour'));
    await userEvent.type(screen.getByTestId('brand-colour'), 'green');
    await userEvent.type(screen.getByTestId('logo-url'), 'http://aalter.example/logo.png');
    await userEvent.click(screen.getByTestId('save-shop'));
    expect(saveSettings).not.toHaveBeenCalled();
    expect(screen.getByText(t.settings.shop.colourBad)).toBeInTheDocument();
    expect(screen.getByText(t.settings.shop.logoBad)).toBeInTheDocument();
  });

  it('says so when this api version has no settings', () => {
    renderAt('/merchant/settings', { settings: null });
    expect(screen.getByText(t.settings.unavailable)).toBeInTheDocument();
  });
});

describe('Products: notices and the held-back state', () => {
  it('a value that was left out: which part, and why, in plain words', () => {
    const { products } = renderAt('/merchant/products');
    const p = products.items.find((i) => i.notices?.leftOut.length)!;
    const row = screen.getByTestId(`product-${p.externalId}`);
    const line = within(row).getByTestId(`left-out-${p.externalId}`);
    expect(line).toHaveTextContent('Not saved: the fabric stretch. The value you entered was left out (it must be a number from 0 to 100). The rest of the fabric was kept.');
    // The validator's own wording is not shown when the console has a plain rule for the field.
    expect(line).not.toHaveTextContent('Too big');
    expect(within(row).getByTestId(`stretch-assumed-${p.externalId}`)).toHaveTextContent(t.products.stretchAssumed);
  });

  it('a field the console has no rule for falls back to the api’s reason', () => {
    const products = mockProducts();
    const p = products.items[1]!;
    p.notices = { defaulted: [], leftOut: [{ field: 'fabric.somethingNew', reason: 'Not a known value' }] };
    renderAt('/merchant/products', { products });
    expect(screen.getByTestId(`left-out-${p.externalId}`)).toHaveTextContent('Not saved: a fabric detail. The value you entered was left out (Not a known value).');
  });

  it('a held-back product: the chip, the reason, what to add, and a link to the setting', () => {
    const { products } = renderAt('/merchant/products');
    const p = products.items.find((i) => i.heldBack)!;
    const row = screen.getByTestId(`product-${p.externalId}`);
    expect(within(row).getByText(t.products.heldBack)).toBeInTheDocument();
    const line = within(row).getByTestId(`held-back-${p.externalId}`);
    expect(line).toHaveTextContent('Held back by your setting: shoppers get no size advice for this product until you add the fabric stretch.');
    expect(within(line).getByRole('link', { name: t.products.heldBackSetting })).toHaveAttribute('href', '/merchant/settings');
    // No "assumed" line: a held-back product gives no size advice.
    expect(within(row).queryByTestId(`stretch-assumed-${p.externalId}`)).toBeNull();
  });

  it('a complete product shows no notice', () => {
    const { products } = renderAt('/merchant/products');
    const p = products.items[0]!;
    expect(screen.queryByTestId(`notices-${p.externalId}`)).toBeNull();
  });
});
