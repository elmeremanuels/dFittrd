import type { AppContext } from './context.js';
import type { DeviceAuth } from './auth/device.js';
import type { MerchantAuthKind } from './auth/merchant.js';
import type { ShopRow } from './services/shops.js';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    rawBody?: Buffer;
    device?: DeviceAuth;
    shop?: ShopRow;
    merchantAuth?: MerchantAuthKind;
  }
}
