// @vitest-environment jsdom
/**
 * A console session that came from a sign-in link (`cs_…`): "Sign out" ends it at the api, and a
 * session the api no longer accepts is explained as an ended session, not as a wrong key.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type MerchantApi } from '@/api/client';
import { api } from '@/store';
import { MerchantLayout, readMerchantKey, writeMerchantKey } from './MerchantConsole';
import { merchantStrings } from './strings';

const t = merchantStrings().console;
const SESSION = 'cs_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2H1g0F9e';
const SECRET = 'sk_' + 'test_' + 'a'.repeat(32);

function openConsole(key: string, status = 401) {
  writeMerchantKey(key);
  const refuse = () => Promise.reject(new ApiError(status, 'invalid_console_session', 'this console session has ended'));
  const signOut = vi.fn(async () => ({ signedOut: true as const }));
  const stub = new Proxy({ signOut } as unknown as MerchantApi, { get: (o, k) => (k in o ? (o as unknown as Record<string | symbol, unknown>)[k] : refuse) });
  const merchant = vi.spyOn(api, 'merchant').mockReturnValue(stub);
  const router = createMemoryRouter(
    [
      { path: '/merchant', element: <MerchantLayout /> },
      { path: '/merchant/login', element: <p data-testid="login">login</p> },
    ],
    { initialEntries: ['/merchant'] },
  );
  render(<RouterProvider router={router} />);
  return { signOut, merchant };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  writeMerchantKey(null);
});

describe('a console session from a sign-in link', () => {
  it('that the api no longer accepts is explained as an ended session', async () => {
    openConsole(SESSION);
    expect(await screen.findByRole('alert')).toHaveTextContent(t.sessionEnded);
  });

  it('is not confused with a refused secret key', async () => {
    openConsole(SECRET);
    expect(await screen.findByRole('alert')).toHaveTextContent(t.keyRefused);
  });

  it('is ended at the api on "Sign out", with that session as the bearer, and forgotten by the tab', async () => {
    const { signOut, merchant } = openConsole(SESSION);
    await userEvent.click(screen.getByRole('button', { name: t.nav.signOut }));
    await waitFor(() => expect(screen.getByTestId('login')).toBeInTheDocument());
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(merchant).toHaveBeenLastCalledWith(SESSION);
    expect(readMerchantKey()).toBeNull();
  });

  it('"Sign out" with a pasted secret key only forgets the key: there is no session to end', async () => {
    const { signOut } = openConsole(SECRET);
    await userEvent.click(screen.getByRole('button', { name: t.nav.signOut }));
    await waitFor(() => expect(screen.getByTestId('login')).toBeInTheDocument());
    expect(signOut).not.toHaveBeenCalled();
    expect(readMerchantKey()).toBeNull();
  });
});
