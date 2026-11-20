#!/usr/bin/env node
/**
 * Download the MediaPipe Tasks Vision assets the capture worker needs into `apps/web/public/models`
 * so onboarding makes ZERO third-party requests (DECISIONS.md D3; AGENTS.md: ML models are
 * self-hosted). Run from anywhere:
 *
 *   node apps/web/src/features/capture/scripts/fetch-models.mjs [--out <dir>] [--force]
 *
 * - WASM runtime: copied from the installed @mediapipe/tasks-vision package (version-locked to the
 *   JS bundle; mixing versions breaks the runtime).
 * - .task / .tflite models: downloaded from Google's official model storage (pinned `/1/` paths).
 * - Writes `models.manifest.json` with sha256 + bytes per file; existing files with a matching
 *   hash are skipped unless --force.
 * Network: uses global fetch; if that fails (corporate proxy) it falls back to `curl -L`, which
 * honours HTTPS_PROXY.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../../..'); // apps/web
const args = process.argv.slice(2);
const force = args.includes('--force');
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 && args[outIdx + 1] ? path.resolve(args[outIdx + 1]) : path.join(webRoot, 'public', 'models');

const STORAGE = 'https://storage.googleapis.com/mediapipe-models';
const MODELS = [
  { file: 'pose_landmarker_full.task', url: `${STORAGE}/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task` },
  { file: 'pose_landmarker_lite.task', url: `${STORAGE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` },
  { file: 'selfie_multiclass_256x256.tflite', url: `${STORAGE}/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite` },
  { file: 'face_landmarker.task', url: `${STORAGE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task` },
];
const WASM_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm'];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    const r = spawnSync('curl', ['-fsSL', url], { maxBuffer: 256 * 1024 * 1024 });
    if (r.status === 0 && r.stdout?.length) return r.stdout;
    throw new Error(`download failed for ${url}: ${e instanceof Error ? e.message : e}; curl: ${r.stderr?.toString() ?? 'unavailable'}`);
  }
}

async function main() {
  await mkdir(path.join(outDir, 'wasm'), { recursive: true });
  const manifest = { generatedAt: new Date().toISOString(), tasksVision: null, files: {} };

  // 1. WASM runtime from node_modules (resolved from apps/web so the workspace version is used).
  const require = createRequire(path.join(webRoot, 'package.json'));
  // The package's "exports" map hides package.json, so resolve the entry file and walk up.
  const entry = require.resolve('@mediapipe/tasks-vision');
  const pkgDir = path.dirname(entry);
  const pkgJson = path.join(pkgDir, 'package.json');
  const wasmSrc = path.join(pkgDir, 'wasm');
  manifest.tasksVision = JSON.parse(await readFile(pkgJson, 'utf8')).version;
  for (const f of WASM_FILES) {
    const src = path.join(wasmSrc, f);
    const dst = path.join(outDir, 'wasm', f);
    await copyFile(src, dst);
    const buf = await readFile(dst);
    manifest.files[`wasm/${f}`] = { bytes: buf.length, sha256: sha256(buf), source: `@mediapipe/tasks-vision@${manifest.tasksVision}` };
    console.log(`copied  wasm/${f} (${buf.length} B)`);
  }

  // 2. Models from the official storage.
  for (const m of MODELS) {
    const dst = path.join(outDir, m.file);
    if (!force && (await exists(dst))) {
      const buf = await readFile(dst);
      manifest.files[m.file] = { bytes: buf.length, sha256: sha256(buf), source: m.url };
      console.log(`kept    ${m.file} (${buf.length} B)`);
      continue;
    }
    process.stdout.write(`fetch   ${m.file} … `);
    const buf = await download(m.url);
    await writeFile(dst, buf);
    manifest.files[m.file] = { bytes: buf.length, sha256: sha256(buf), source: m.url };
    console.log(`${buf.length} B`);
  }
  await writeFile(path.join(outDir, 'models.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nwrote ${path.join(outDir, 'models.manifest.json')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
