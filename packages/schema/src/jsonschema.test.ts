import { describe, expect, it } from 'vitest';
import { allJsonSchemas, fitSignatureJsonSchema, garmentDraftJsonSchema, garmentJsonSchema } from './jsonschema';

type Obj = Record<string, unknown>;

describe('garmentJsonSchema', () => {
  const schema = garmentJsonSchema() as Obj & { properties: Record<string, Obj>; required: string[] };

  it('is draft 2020-12 with a flat object root and an $id', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe('https://paskamer.app/schema/v1/garment.schema.json');
    expect(schema.type).toBe('object');
    expect(schema.title).toBe('Paskamer GarmentPayload v1');
  });

  it('requires the heavy fields and schemaVersion = 1', () => {
    expect(schema.required).toEqual(expect.arrayContaining(['schemaVersion', 'id', 'brand', 'name', 'category', 'priceEur', 'primaryColorHex', 'fabric', 'patternBlock', 'sizeChartType', 'sizeChart']));
    expect(schema.required).not.toContain('flatLayPhoto');
    expect(schema.properties.schemaVersion).toMatchObject({ const: 1 });
    expect(schema.properties.sizeChartType).toMatchObject({ enum: ['garment', 'body'] });
    expect(schema.properties.category).toMatchObject({ enum: ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'] });
  });

  it('keeps the open vocabularies as strings with examples, and nested objects typed', () => {
    expect(schema.properties.patternBlock).toMatchObject({ type: 'string', examples: expect.arrayContaining(['wrap', 'bias', 'straight']) });
    const fabric = schema.properties.fabric as Obj & { properties: Record<string, Obj>; required: string[] };
    expect(fabric.required).toEqual(expect.arrayContaining(['primary', 'stretchPct', 'drape']));
    expect(fabric.properties.primary).toMatchObject({ type: 'string', examples: expect.arrayContaining(['linen', 'denim']) });
    expect(fabric.properties.drape).toMatchObject({ type: 'number', minimum: 0, maximum: 1 });
    const chart = schema.properties.sizeChart as Obj & { items: Obj & { properties: Record<string, Obj>; required: string[] } };
    expect(chart.minItems).toBe(1);
    expect(chart.items.required).toEqual(['size']);
    expect(Object.keys(chart.items.properties)).toEqual(expect.arrayContaining(['bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'footEu', 'footLengthCm']));
    expect(schema.properties.flatLayPhoto).toMatchObject({ type: 'string', format: 'uri' });
  });

  it('is plain JSON (serialisable, no functions or undefined)', () => {
    const text = JSON.stringify(schema);
    expect(JSON.parse(text)).toEqual(schema);
    expect(text).not.toMatch(/"undefined"|function/);
  });
});

describe('other schemas', () => {
  it('draft schema requires only id, name, brand', () => {
    const draft = garmentDraftJsonSchema() as Obj & { required: string[] };
    expect([...draft.required].sort()).toEqual(['brand', 'id', 'name']);
    expect(draft.$id).toMatch(/garment-draft\.schema\.json$/);
  });

  it('fit signature schema pins the vector to 80 numbers', () => {
    const fs = fitSignatureJsonSchema() as Obj & { properties: Record<string, Obj> };
    expect(fs.properties.vector).toMatchObject({ type: 'array', minItems: 80, maxItems: 80 });
    expect(fs.properties.version).toMatchObject({ const: 1 });
  });

  it('allJsonSchemas names the files the build script writes', () => {
    expect(Object.keys(allJsonSchemas()).sort()).toEqual(['fit-signature', 'garment', 'garment-draft', 'swipe-event']);
  });
});
