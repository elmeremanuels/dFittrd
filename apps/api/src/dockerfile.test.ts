/**
 * The api image's build list against the workspace manifests (OI-49).
 *
 * `apps/api/Dockerfile` copies and builds the workspace packages by hand, in order. On 20 Nov 2026 the image
 * did not build: the bake check (`@curtain/garment-viewer` `bakeGate`) had started to import
 * `@curtain/fit-engine`, which the Dockerfile copied but never built. Nothing outside `docker build` saw it,
 * because every other build runs with all `dist/` folders present. This test reads the manifests and fails when
 * a package the api needs at run time is not copied, not built, or built before a package it imports.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dockerfile = readFileSync(join(root, 'apps/api/Dockerfile'), 'utf8');

interface Manifest {
  name: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
}
const manifest = (dir: string): Manifest => JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) as Manifest;
const dirOf = (name: string): string => `packages/${name.replace('@curtain/', '')}`;
const workspaceDeps = (m: Manifest): string[] => Object.keys(m.dependencies ?? {}).filter((d) => d.startsWith('@curtain/'));

/** Every workspace package the api imports at run time, directly or through another package. */
function closure(): Manifest[] {
  const seen = new Map<string, Manifest>();
  const walk = (m: Manifest) => {
    for (const dep of workspaceDeps(m)) {
      if (seen.has(dep)) continue;
      const next = manifest(dirOf(dep));
      seen.set(dep, next);
      walk(next);
    }
  };
  walk(manifest('apps/api'));
  return [...seen.values()];
}

/** Position of `pnpm --filter <name> build` in the build stage's RUN line; -1 when it is not there. */
const buildAt = (name: string): number => dockerfile.search(new RegExp(`pnpm --filter ${name.replace('/', '\\/')} build(\\s|$)`, 'm'));

describe('apps/api/Dockerfile builds what the api imports', () => {
  const packages = closure();

  it('the api needs the bake check and, through it, the fit engine', () => {
    expect(packages.map((p) => p.name)).toEqual(expect.arrayContaining(['@curtain/garment-viewer', '@curtain/fit-engine', '@curtain/mannequin', '@curtain/anchors', '@curtain/schema']));
  });

  it('copies every workspace package of the api’s dependency closure', () => {
    for (const p of packages) expect(dockerfile, p.name).toContain(`COPY ${dirOf(p.name)} ${dirOf(p.name)}`);
    expect(dockerfile).toContain('COPY apps/api apps/api');
  });

  it('builds every one of them that has a build step, after the packages it imports and before the api', () => {
    const api = buildAt('@curtain/api');
    expect(api).toBeGreaterThan(-1);
    for (const p of packages) {
      if (!p.scripts?.build) continue;
      const at = buildAt(p.name);
      expect(at, `${p.name} is not built in the Dockerfile`).toBeGreaterThan(-1);
      expect(at, `${p.name} is built after the api`).toBeLessThan(api);
      for (const dep of workspaceDeps(p)) {
        if (!manifest(dirOf(dep)).scripts?.build) continue;
        expect(buildAt(dep), `${dep} must be built before ${p.name}, which imports it`).toBeGreaterThan(-1);
        expect(buildAt(dep), `${dep} must be built before ${p.name}, which imports it`).toBeLessThan(at);
      }
    }
  });

  it('every path a COPY names exists in the repository', () => {
    const sources = [...dockerfile.matchAll(/^COPY (?!--from)(?:--parents )?(.+)$/gm)].flatMap((m) => m[1]!.trim().split(/\s+/).slice(0, -1));
    expect(sources.length).toBeGreaterThan(10);
    for (const src of sources) {
      if (src.includes('*')) continue; // manifests of every workspace project, matched by the build
      expect(existsSync(join(root, src)), src).toBe(true);
    }
  });

  it('checks in the build that the image ships the server, the migrations and the bake check', () => {
    expect(dockerfile).toMatch(/test -f \/out\/dist\/server\.js && test -f \/out\/dist\/migrate\.js && test -d \/out\/drizzle/);
    expect(dockerfile).toMatch(/test -f \/out\/node_modules\/@curtain\/garment-viewer\/dist\/bakeGate\.js/);
  });
});
