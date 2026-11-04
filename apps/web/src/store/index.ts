/** App-wide singletons: the shared Dexie database, the API client and the store. */
import { ApiClient, apiBaseUrl } from '@/api/client';
import { getAppDb } from '@/db/db';
import { createAppStore, type AppState } from './store';

export const useApp = createAppStore({ db: getAppDb() });

export const api = new ApiClient({
  baseUrl: apiBaseUrl(),
  appVersion: '0.1.0',
  getDevice: () => useApp.getState().deviceCredentials(),
  setDevice: (d) => useApp.getState().setDeviceCredentials(d),
  onLedger: (entry) => useApp.getState().appendLedger(entry),
});

useApp.attachClient(api);

export type { AppState };
export { MOCK_SHOP, MOCK_SHOP_ID } from './store';
