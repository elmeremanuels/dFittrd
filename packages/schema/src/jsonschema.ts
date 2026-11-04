/**
 * JSON Schema (draft 2020-12) export of the wire types, consumed by the WooCommerce plugin's PHP
 * validator (`includes/class-product-meta.php`) and by the Shopify app's metafield validation.
 * The build script writes `dist/garment.schema.json` and `dist/garment-draft.schema.json`.
 */
import { z } from 'zod';
import { GarmentPayloadDraftSchema, GarmentPayloadSchema } from './garment';
import { FitSignatureWireSchema } from './fitSignature';
import { SwipeEventSchema } from './swipe';

export const JSON_SCHEMA_BASE_ID = 'https://paskamer.app/schema/v1' as const;

export type JsonSchema = Record<string, unknown> & { $schema?: string; $id?: string };

function build(schema: z.ZodType, name: string): JsonSchema {
  const out = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
    reused: 'inline',
  }) as JsonSchema;
  return { ...out, $id: `${JSON_SCHEMA_BASE_ID}/${name}.schema.json` };
}

/** Full GarmentPayload v1 — what the merchant upsert must satisfy to become `active`-eligible. */
export function garmentJsonSchema(): JsonSchema {
  return build(GarmentPayloadSchema, 'garment');
}

/** Draft payload (id, name, brand required; the rest optional) — what the plugins may push. */
export function garmentDraftJsonSchema(): JsonSchema {
  return build(GarmentPayloadDraftSchema, 'garment-draft');
}

export function fitSignatureJsonSchema(): JsonSchema {
  return build(FitSignatureWireSchema, 'fit-signature');
}

export function swipeEventJsonSchema(): JsonSchema {
  return build(SwipeEventSchema, 'swipe-event');
}

/** Everything the build script writes, keyed by file name (without `.schema.json`). */
export function allJsonSchemas(): Record<string, JsonSchema> {
  return {
    garment: garmentJsonSchema(),
    'garment-draft': garmentDraftJsonSchema(),
    'fit-signature': fitSignatureJsonSchema(),
    'swipe-event': swipeEventJsonSchema(),
  };
}
