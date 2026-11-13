/**
 * assets/fabric-library.json: the part of the @curtain/schema fabric library that the PHP twin of
 * `resolveFabricText` (includes/class-fabric-text.php) needs: every term in lookup order, the fibre
 * and construction ids, base fibres, and the v1 `fabric.primary` names. Generated, never edited:
 * the build and the test fixture export both write it, so PHP and TypeScript read the same table.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ASSUMED_ELASTANE_PCT,
  FABRIC_BY_ID,
  FABRIC_CONSTRUCTION_IDS,
  FABRIC_FIBRE_IDS,
  FABRIC_LIBRARY_VERSION,
  FABRIC_PRIMARY_LIBRARY_IDS,
  fabricTerms,
} from '@curtain/schema';

export function fabricLibraryAsset() {
  const baseFibre = {};
  for (const id of FABRIC_CONSTRUCTION_IDS) if (FABRIC_BY_ID[id].baseFibre) baseFibre[id] = FABRIC_BY_ID[id].baseFibre;
  return {
    source: '@curtain/schema fabrics.ts',
    version: FABRIC_LIBRARY_VERSION,
    terms: [...fabricTerms().entries()],
    fibres: [...FABRIC_FIBRE_IDS],
    constructions: [...FABRIC_CONSTRUCTION_IDS],
    baseFibre,
    v1Primaries: FABRIC_PRIMARY_LIBRARY_IDS,
    assumedElastanePct: ASSUMED_ELASTANE_PCT,
  };
}

export function writeFabricLibraryAsset(root) {
  const file = join(root, 'assets/fabric-library.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(fabricLibraryAsset()));
  return file;
}
