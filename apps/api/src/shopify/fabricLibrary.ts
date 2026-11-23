/**
 * Fabric library (CUR-40, WO-026): the merchant's named fabrics, persisted per shop so they
 * survive a reload and a new session. One shop can never read another shop's fabrics (the
 * `shopId` column scopes every query).
 *
 * Routes (all merchant-authenticated, Shopify-only):
 *   - GET    /shopify/fabric-library       list the shop's library entries
 *   - POST   /shopify/fabric-library       add an entry (validated against FabricSchema)
 *   - PUT    /shopify/fabric-library/:id   update an entry
 *   - DELETE /shopify/fabric-library/:id   remove an entry
 *
 * D3: nothing here touches shopper data.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { FabricSchema, type Fabric } from '@curtain/schema';
import { requireMerchant } from '../auth/merchant.js';
import { fabricLibrary } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { ShopRow } from '../services/shops.js';

const FabricLibraryEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  fabric: FabricSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type FabricLibraryEntry = z.infer<typeof FabricLibraryEntrySchema>;

const FabricLibraryListResponseSchema = z.object({
  entries: z.array(FabricLibraryEntrySchema),
});

const FabricLibraryWriteBodySchema = z.object({
  name: z.string().min(1).max(64),
  fabric: FabricSchema,
});

const FabricLibraryIdParams = z.object({ id: z.string().uuid() });

const FabricLibraryWriteResponseSchema = z.object({
  entry: FabricLibraryEntrySchema,
});

async function requireShop(shop: ShopRow | undefined): Promise<ShopRow> {
  if (!shop) throw badRequest('no_shop', 'no authenticated shop');
  return shop;
}

export const shopifyFabricLibraryRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app.ctx;

  app.get(
    '/shopify/fabric-library',
    { schema: { response: { 200: FabricLibraryListResponseSchema } }, preHandler: requireMerchant },
    async (req): Promise<{ entries: FabricLibraryEntry[] }> => {
      const shop = await requireShop(req.shop);
      const rows = await db
        .select()
        .from(fabricLibrary)
        .where(eq(fabricLibrary.shopId, shop.id))
        .orderBy(fabricLibrary.name);
      return { entries: rows.map(toEntry) };
    },
  );

  app.post(
    '/shopify/fabric-library',
    {
      schema: { body: FabricLibraryWriteBodySchema, response: { 201: FabricLibraryWriteResponseSchema } },
      preHandler: requireMerchant,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply): Promise<{ entry: FabricLibraryEntry }> => {
      const shop = await requireShop(req.shop);
      const { name, fabric } = req.body;
      const rows = await db
        .insert(fabricLibrary)
        .values({ shopId: shop.id, name, fabric })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('insert returned no rows');
      reply.code(201);
      return { entry: toEntry(row) };
    },
  );

  app.put(
    '/shopify/fabric-library/:id',
    {
      schema: { params: FabricLibraryIdParams, body: FabricLibraryWriteBodySchema, response: { 200: FabricLibraryWriteResponseSchema } },
      preHandler: requireMerchant,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req): Promise<{ entry: FabricLibraryEntry }> => {
      const shop = await requireShop(req.shop);
      const { name, fabric } = req.body;
      const rows = await db
        .update(fabricLibrary)
        .set({ name, fabric, updatedAt: new Date() })
        .where(and(eq(fabricLibrary.id, req.params.id), eq(fabricLibrary.shopId, shop.id)))
        .returning();
      const row = rows[0];
      if (!row) throw notFound('fabric library entry');
      return { entry: toEntry(row) };
    },
  );

  app.delete(
    '/shopify/fabric-library/:id',
    {
      schema: { params: FabricLibraryIdParams, response: { 200: z.object({ deleted: z.boolean() }) } },
      preHandler: requireMerchant,
    },
    async (req): Promise<{ deleted: boolean }> => {
      const shop = await requireShop(req.shop);
      const rows = await db
        .delete(fabricLibrary)
        .where(and(eq(fabricLibrary.id, req.params.id), eq(fabricLibrary.shopId, shop.id)))
        .returning({ id: fabricLibrary.id });
      return { deleted: rows.length > 0 };
    },
  );
};

interface FabricLibraryRow {
  id: string;
  shopId: string;
  name: string;
  fabric: Fabric;
  createdAt: Date;
  updatedAt: Date;
}

function toEntry(row: FabricLibraryRow): FabricLibraryEntry {
  return { id: row.id, name: row.name, fabric: row.fabric, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
