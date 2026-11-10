/**
 * R2 spike page (`morph.html`, not shipped): the baked server drapes of AU 8 / 12 / 16 on one shopper body, blended on
 * the device from the morph targets (`morphBlend.ts` weights; three.js does the blend on the GPU). The page also blends
 * on the CPU, the same sum, to measure the hip and hem girth per size (`girthAt`), and counts frames while the camera
 * turns. Everything is labelled an estimate. The hip value typed in stays in this tab (D3).
 *
 * URL: /morph.html?band=W-6&body=t-0.40&glb=meshopt[&morph=0]   (results also on window.__serverdrape for Playwright)
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { axisFromHip, morphWeights } from './morphBlend';
import { girthAt } from '../scripts/serverdrape/girth';

interface Result { t: number; weights: number[]; girths: Record<string, { hip: number; hem: number }>; fps?: number; frames?: number; seconds?: number; glbBytes?: number; loadMs?: number; cpuBlendMs?: number }
declare global { interface Window { __serverdrape?: Result } }

const q = new URLSearchParams(location.search);
const band = q.get('band') ?? 'W-6';
const bodyId = q.get('body') ?? 't-0.40';
const glbKind = q.get('glb') ?? 'meshopt';
/** `morph=0`: the control for the fps measurement, the same meshes with the morph targets removed (base drape only). */
const useMorph = q.get('morph') !== '0';
const status = document.getElementById('status')!;
const view = document.getElementById('view')!;
const HEM_Y = 22;
const SIZES = ['8', '12', '16'];
const GAP = 60;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(view.clientWidth, view.clientHeight);
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f5efe7');
const camera = new THREE.PerspectiveCamera(35, view.clientWidth / view.clientHeight, 10, 5000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f74, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-150, 300, 250);
scene.add(sun);
addEventListener('resize', () => {
  renderer.setSize(view.clientWidth, view.clientHeight);
  camera.aspect = view.clientWidth / view.clientHeight;
  camera.updateProjectionMatrix();
});

interface SizeMesh { size: string; mesh: THREE.Mesh; node: THREE.Object3D }

async function main(): Promise<void> {
  const t0 = performance.now();
  const bodies = (await (await fetch('/serverdrape/bodies/bodies.json')).json()) as { bodies: { id: string; achieved: { hipY: number; hipCm: number } }[] };
  const meta = bodies.bodies.find((b) => b.id === bodyId)!;
  (document.getElementById('hip') as HTMLInputElement).value = String(Math.round(meta.achieved.hipCm * 10) / 10);
  const bodyObj = await new OBJLoader().loadAsync(`/serverdrape/bodies/${bodyId}.obj`);
  const glbUrl = `/serverdrape/web/skirt-${band}-${glbKind === 'meshopt' ? 'meshopt' : 'quant'}.glb`;
  const buf = await (await fetch(glbUrl)).arrayBuffer();
  const glbBytes = buf.byteLength;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(buf, '');
  const loadMs = performance.now() - t0;
  const skin = new THREE.MeshStandardMaterial({ color: '#c9bfb4', roughness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color: '#a44b48', roughness: 0.85, side: THREE.DoubleSide });
  const meshes: SizeMesh[] = [];
  SIZES.forEach((size, i) => {
    const node = gltf.scene.getObjectByName(`AU${size}`)!;
    const mesh = (node as THREE.Mesh).isMesh ? (node as THREE.Mesh) : (node.getObjectByProperty('isMesh', true) as THREE.Mesh);
    mesh.material = cloth;
    const holder = new THREE.Group();
    holder.position.x = (i - 1) * GAP;
    const body = bodyObj.clone();
    body.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).material = skin; (o as THREE.Mesh).geometry.computeVertexNormals(); } });
    holder.add(body);
    holder.add(node);
    scene.add(holder);
    meshes.push({ size, mesh, node });
  });

  const table = document.getElementById('girths')!;
  const update = (): Result => {
    const hip = Number((document.getElementById('hip') as HTMLInputElement).value);
    const t = axisFromHip(hip);
    const w = morphWeights(t);
    document.getElementById('t')!.textContent = t.toFixed(2);
    const girths: Result['girths'] = {};
    for (const { size, mesh, node } of meshes) {
      mesh.morphTargetInfluences!.splice(0, w.length, ...w);
      // The same blend on the CPU, in the bundle's units (node scale/translation = quantisation grid), for the girths.
      const g = mesh.geometry;
      const base = g.attributes.position!;
      const targets = g.morphAttributes.position!;
      const pos = new Float32Array(base.count * 3);
      const v = new THREE.Vector3();
      node.updateMatrix();
      for (let i = 0; i < base.count; i++) {
        v.fromBufferAttribute(base, i);
        targets.forEach((tg, k) => { v.x += w[k]! * tg.getX(i); v.y += w[k]! * tg.getY(i); v.z += w[k]! * tg.getZ(i); });
        v.applyMatrix4(node.matrix);
        pos[3 * i] = v.x; pos[3 * i + 1] = v.y; pos[3 * i + 2] = v.z;
      }
      const idx = g.index!.array;
      girths[size] = { hip: girthAt(pos, idx, meta.achieved.hipY), hem: girthAt(pos, idx, HEM_Y) };
    }
    table.innerHTML = `<tr><th>AU</th>${SIZES.map((s) => `<th>${s}</th>`).join('')}<th>16−8</th></tr>` +
      (['hip', 'hem'] as const).map((k) => `<tr><td>${k}</td>${SIZES.map((s) => `<td>${girths[s]![k].toFixed(1)}</td>`).join('')}<td>${(girths['16']![k] - girths['8']![k]).toFixed(1)}</td></tr>`).join('');
    return { t, weights: w, girths, glbBytes, loadMs };
  };
  const tb = performance.now();
  window.__serverdrape = { ...update(), cpuBlendMs: performance.now() - tb };
  if (!useMorph) for (const { mesh } of meshes) { mesh.geometry.morphAttributes = {}; mesh.morphTargetInfluences = undefined; mesh.morphTargetDictionary = undefined; mesh.updateMorphTargets(); }
  document.getElementById('hip')!.addEventListener('change', () => { window.__serverdrape = { ...window.__serverdrape, ...update() }; });
  status.textContent = `${glbUrl.split('/').pop()} · body ${bodyId} · band ${band} (see band-model.json: assumed until measured) · estimate`;
  document.documentElement.dataset.state = 'ready';

  let frames = 0;
  let start = performance.now();
  let last = start;
  const R = camera.aspect < 1 ? 760 : 420;
  const loop = (now: number): void => {
    const a = (now / 1000) * 0.6;
    camera.position.set(Math.sin(a) * R, 110, Math.cos(a) * R);
    camera.lookAt(0, 85, 0);
    renderer.render(scene, camera);
    frames++;
    if (now - last > 1000) {
      const fps = (frames * 1000) / (now - start);
      document.getElementById('fps')!.textContent = `${fps.toFixed(1)} fps`;
      window.__serverdrape = { ...window.__serverdrape!, fps, frames, seconds: (now - start) / 1000 };
      last = now;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame((now) => { start = now; last = now; loop(now); });
}

main().catch((e: unknown) => {
  status.textContent = `error: ${String(e)}`;
  document.documentElement.dataset.state = 'error';
});
