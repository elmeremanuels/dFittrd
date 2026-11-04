import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { AppShell, IndexRoute, RequireOnboarded } from '@/routes/AppShell';
import { DeckRoute } from '@/routes/DeckRoute';
import { OnboardingRoute } from '@/routes/OnboardingRoute';
import { PairRoute } from '@/routes/PairRoute';
import { ProfileRoute } from '@/routes/ProfileRoute';
import { TryRoute } from '@/routes/TryRoute';
import { WardrobeRoute } from '@/routes/WardrobeRoute';
import { MerchantAnalytics, MerchantLayout, MerchantLedgerRoute, MerchantLogin, MerchantOverview, MerchantProducts, MerchantUsage } from '@/merchant/MerchantConsole';

/**
 * Two route trees (react-router 7 data router): the phone-framed consumer app and the merchant
 * console (`/merchant/*`, behind a session-stored shop key, not inside the phone frame).
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <IndexRoute /> },
      { path: 'onboarding', element: <OnboardingRoute /> },
      {
        path: 'deck',
        element: (
          <RequireOnboarded>
            <DeckRoute />
          </RequireOnboarded>
        ),
      },
      { path: 'try/:token', element: <TryRoute /> },
      {
        path: 'wardrobe',
        element: (
          <RequireOnboarded>
            <WardrobeRoute />
          </RequireOnboarded>
        ),
      },
      {
        path: 'profile',
        element: (
          <RequireOnboarded>
            <ProfileRoute />
          </RequireOnboarded>
        ),
      },
      { path: 'pair', element: <PairRoute /> },
    ],
  },
  { path: '/merchant/login', element: <MerchantLogin /> },
  {
    path: '/merchant',
    element: <MerchantLayout />,
    children: [
      { index: true, element: <MerchantOverview /> },
      { path: 'products', element: <MerchantProducts /> },
      { path: 'usage', element: <MerchantUsage /> },
      { path: 'analytics', element: <MerchantAnalytics /> },
      { path: 'ledger', element: <MerchantLedgerRoute /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router = createBrowserRouter(routes);
