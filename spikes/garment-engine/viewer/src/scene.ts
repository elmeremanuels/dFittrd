/**
 * three.js side of the spike viewer: one stage (renderer, camera, orbit controls, light) and one
 * figure per shown size (avatar + garment). Units are cm, +Y up, +Z front, like the mannequin.
 * WebGL2 only in the spike; WebGPU and the drawn-overlay fallback belong to packages/garment-viewer.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Mesh } from '@curtain/mannequin';
import type { ViewerMaterial } from './engine';

export interface StageOptions {
  /** Drag to rotate and wheel or pinch to zoom. */
  controls?: boolean;
  /** Turn the camera slowly around the figures (blind test). */
  autoRotate?: boolean;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 5, 5000);
  readonly controls: OrbitControls;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, options: StageOptions = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color('#F5EFE7');
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8076, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(150, 260, 320);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 1.1);
    rim.position.set(-220, 180, -260);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshStandardMaterial({ color: '#E9E1D6', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = options.controls !== false;
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 80;
    this.controls.maxDistance = 1400;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.autoRotate = options.autoRotate === true;
    this.controls.autoRotateSpeed = 1.2;
    this.frame(60);
  }

  /** Point the camera at figures spread over `widthCm` (front view). */
  frame(widthCm: number): void {
    const target = new THREE.Vector3(0, 98, 0);
    const vfov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.max(0.3, this.camera.aspect);
    const fitH = 205 / 2 / Math.tan(vfov / 2);
    const fitW = (widthCm + 20) / 2 / Math.tan(vfov / 2) / aspect;
    this.camera.position.set(0, 112, Math.max(fitH, fitW));
    this.controls.target.copy(target);
    this.controls.update();
  }

  resize(): boolean {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return false;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x === w && size.y === h) return false;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    return true;
  }

  render(): void {
    this.resize();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen position (CSS px within the canvas) of a world point, for labels. */
  toScreen(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - v.y) / 2) * this.canvas.clientHeight };
  }
}

export function meshGeometry(mesh: Pick<Mesh, 'positions' | 'indices'>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(mesh.positions), 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeVertexNormals();
  return g;
}

const BODY_MATERIAL = new THREE.MeshStandardMaterial({ color: '#8C8C8C', roughness: 0.75, metalness: 0 });

export class Figure {
  readonly group = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly garment: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private heatOn = false;

  constructor(bodyGeometry: THREE.BufferGeometry, garmentIndices: Uint32Array, vertexCount: number) {
    this.body = new THREE.Mesh(bodyGeometry, BODY_MATERIAL);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertexCount * 3).fill(1), 3));
    g.setIndex(new THREE.BufferAttribute(garmentIndices, 1));
    this.garment = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide }));
    this.garment.frustumCulled = false;
    this.group.add(this.body, this.garment);
  }

  setBody(geometry: THREE.BufferGeometry): void {
    this.body.geometry = geometry;
  }

  setPositions(pos: Float32Array): void {
    const attr = this.garment.geometry.getAttribute('position') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(pos);
    attr.needsUpdate = true;
    this.garment.geometry.computeVertexNormals();
  }

  /** Vertex colours of the heat map, or `null` for the fabric colour. */
  setHeat(colors: Float32Array | null): void {
    const on = colors !== null;
    if (colors) {
      const attr = this.garment.geometry.getAttribute('color') as THREE.BufferAttribute;
      (attr.array as Float32Array).set(colors);
      attr.needsUpdate = true;
    }
    if (on !== this.heatOn) {
      this.heatOn = on;
      this.applyColour();
    }
  }

  private fabricColour = new THREE.Color('#cccccc');

  /**
   * PBR look from material.json or a preset: sheen and roughness from `sheen`, translucency from
   * `opacity` (kept ≥ 0.85 so the avatar does not show through as a spike artefact).
   */
  setMaterial(vm: ViewerMaterial): void {
    const m = this.garment.material;
    this.fabricColour = new THREE.Color(vm.baseColorHex);
    m.roughness = Math.min(1, Math.max(0.25, 0.95 - 0.8 * vm.sheen));
    m.sheen = Math.min(1, vm.sheen * 1.4);
    m.sheenRoughness = 0.25 + 0.5 * (1 - vm.sheen);
    m.sheenColor = new THREE.Color(0xffffff);
    m.opacity = Math.max(0.85, Math.min(1, vm.opacity));
    m.transparent = m.opacity < 1;
    this.applyColour();
  }

  private applyColour(): void {
    const m = this.garment.material;
    m.vertexColors = this.heatOn;
    m.color = this.heatOn ? new THREE.Color(0xffffff) : this.fabricColour.clone();
    m.needsUpdate = true;
  }

  dispose(): void {
    this.garment.geometry.dispose();
    this.garment.material.dispose();
  }
}
