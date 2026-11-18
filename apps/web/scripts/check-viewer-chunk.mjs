#!/usr/bin/env node
/**
 * Run after `vite build` (D16, docs/ENGINE-HANDOFF.md §Device budget): the 3D viewer is one lazy
 * chunk of at most 400 KB gzip, three.js appears in no other chunk (the embed entry, the peek and
 * the PWA shell stay as small as before), and the service worker never precaches it. The drape bake reader with the
 * meshopt decoder (`drapeBakeRead`) is its own lazy chunk, loaded only for a bake bundle: not in the viewer chunk and not
 * precached either.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const BUDGET = 400 * 1024;
const assets = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'));
const viewer = assets.filter((f) => /^garment-viewer-[\w-]+\.js$/.test(f));
const fail = (msg) => {
  console.error(`check-viewer-chunk: ${msg}`);
  process.exit(1);
};
if (viewer.length !== 1) fail(`expected one garment-viewer chunk, found ${viewer.length}: ${viewer.join(', ')}`);
const gz = gzipSync(readFileSync(join(dist, 'assets', viewer[0]))).length;
if (gz > BUDGET) fail(`${viewer[0]} is ${gz} B gzip, budget ${BUDGET} B`);
const leaks = assets.filter((f) => f !== viewer[0] && !/^drape\.worker-/.test(f) && readFileSync(join(dist, 'assets', f), 'utf8').includes('WebGLRenderer'));
if (leaks.length) fail(`three.js (WebGLRenderer) outside the viewer chunk: ${leaks.join(', ')}`);
const bake = assets.filter((f) => /^drapeBakeRead-[\w-]+\.js$/.test(f));
if (bake.length !== 1) fail(`expected one drapeBakeRead chunk, found ${bake.length}: ${bake.join(', ')}`);
if (readFileSync(join(dist, 'assets', viewer[0]), 'utf8').includes('decodeGltfBuffer')) fail('the meshopt decoder is in the viewer chunk (it belongs to the drapeBakeRead chunk)');
const bakeGz = gzipSync(readFileSync(join(dist, 'assets', bake[0]))).length;
const sw = readdirSync(dist).find((f) => f === 'sw.js');
if (sw && /garment-viewer-|drape\.worker-|drapeBakeRead-/.test(readFileSync(join(dist, sw), 'utf8'))) fail('the service worker precaches the 3D viewer');
console.log(`check-viewer-chunk: ${viewer[0]} ${(gz / 1024).toFixed(1)} KB gzip of ${BUDGET / 1024} KB (+ ${bake[0]} ${(bakeGz / 1024).toFixed(1)} KB, bakes only); three.js in no other chunk; not precached`);
