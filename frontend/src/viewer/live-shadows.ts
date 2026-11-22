// Fork: real sun shadows for the "Realistic" style (live-light.ts, theme.ts).
//
// Two depth maps of the solid house, rendered before each frame while the style is live:
// - the sun map, seen along the sun's rays: a point the sun cannot see lies in shadow (walls, roof, furniture and
//   closed blinds cast shadows; sunlight reaches a room only through its windows);
// - the cover map, seen from straight above: a point with something over it lies under a roof or a ceiling and gets
//   less light from the sky.
// NeonPlan draws no ceilings (the house is a cut-away), so each shown floor gets ceiling slabs over its rooms that
// only these maps see (CASTER_LAYER, never the view's camera). Only meshes on CASTER_LAYER cast: glass, water, lines,
// labels and effects stay out. The maps live in shader uniforms (theme.ts: uShadow*), read by the style shader.

import {
  BufferGeometry,
  DepthTexture,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OrthographicCamera,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";
import type { Floor } from "../model.ts";
import { triangulate } from "./geo.ts";

/** Layer of everything that casts a shadow (the view's camera keeps to layer 0). */
export const CASTER_LAYER = 7;

/** Resolution of the sun map: sharp shadows of window bars and table legs across a whole house. */
const SUN_SIZE = 4096;
const COVER_SIZE = 2048;

export interface ShadowBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** The uniforms the style shader reads (one set per view, shared by all its themed materials). */
export interface ShadowUniforms {
  uShadowOn: { value: number };
  uShadowMap: { value: DepthTexture | null };
  uShadowMatrix: { value: Matrix4 };
  /** World size of one texel of the sun map (for the normal offset and the soft edge). */
  uShadowTexel: { value: number };
  uCoverMap: { value: DepthTexture | null };
  uCoverMatrix: { value: Matrix4 };
}

export function makeShadowUniforms(): ShadowUniforms {
  return {
    uShadowOn: { value: 0 },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new Matrix4() },
    uShadowTexel: { value: 0.01 },
    uCoverMap: { value: null },
    uCoverMatrix: { value: new Matrix4() },
  };
}

/** Marks an object (and what it holds) as casting shadows: it is drawn into the maps as well as into the view. */
export function castShadow(obj: Object3D): void {
  obj.layers.enable(CASTER_LAYER);
}

/** A floor's ceilings: its rooms' outlines at the floor's height, seen only by the shadow maps. */
export function makeCeilings(floor: Floor): Mesh | null {
  const p: number[] = [];
  for (const r of floor.rooms) {
    if (r.points.length < 3) continue;
    const h = typeof r.ceiling_height === "number" && r.ceiling_height > 0 ? r.ceiling_height : floor.height;
    for (const [i, j, k] of triangulate(r.points)) for (const q of [r.points[i], r.points[j], r.points[k]]) p.push(q[0], h, q[1]);
  }
  if (!p.length) return null;
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(p, 3));
  const m = new Mesh(g, CEILING_MATERIAL);
  // only the shadow maps see it
  m.layers.set(CASTER_LAYER);
  m.frustumCulled = false;
  m.name = "fp3d-ceilings";
  return m;
}

const CEILING_MATERIAL = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });

function depthTarget(size: number): WebGLRenderTarget {
  const t = new WebGLRenderTarget(size, size, { depthBuffer: true });
  const d = new DepthTexture(size, size);
  d.minFilter = NearestFilter;
  d.magFilter = NearestFilter;
  t.depthTexture = d;
  return t;
}

/** Renders the sun map and the cover map and keeps the shader uniforms pointing at them. */
export class LiveShadows {
  private sunTarget: WebGLRenderTarget | null = null;
  private coverTarget: WebGLRenderTarget | null = null;
  private readonly sunCam = new OrthographicCamera();
  private readonly coverCam = new OrthographicCamera();
  /** Drawn instead of every caster's own material: depth only, both sides (thin walls cast from either side). */
  private readonly depthOnly = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
  private readonly bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  private readonly u: ShadowUniforms;

  constructor(u: ShadowUniforms) {
    this.u = u;
    this.sunCam.layers.set(CASTER_LAYER);
    this.coverCam.layers.set(CASTER_LAYER);
  }

  /** Off: the shader lights everything as if nothing were in the way. */
  off(): void {
    this.u.uShadowOn.value = 0;
  }

  /**
   * Draws both maps for the sun towards `toSun` (a unit vector, world space) over the house in `box` (world space,
   * with a margin). Call right before the frame is drawn.
   */
  render(renderer: WebGLRenderer, scene: Scene, toSun: Vector3, box: ShadowBox): void {
    this.sunTarget ??= depthTarget(SUN_SIZE);
    this.coverTarget ??= depthTarget(COVER_SIZE);
    const corners: Vector3[] = [];
    for (const x of [box.x0, box.x1]) for (const y of [box.y0, box.y1]) for (const z of [box.z0, box.z1]) corners.push(new Vector3(x, y, z));
    const centre = new Vector3((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2);
    const reach = centre.distanceTo(corners[0]) + 1;
    fit(this.sunCam, centre, toSun, reach, corners);
    fit(this.coverCam, centre, new Vector3(0, 1, 0), reach, corners);
    const before = { target: renderer.getRenderTarget(), override: scene.overrideMaterial, autoClear: renderer.autoClear, background: scene.background, fog: scene.fog };
    scene.overrideMaterial = this.depthOnly;
    scene.background = null;
    scene.fog = null;
    renderer.autoClear = true;
    for (const [cam, target] of [
      [this.sunCam, this.sunTarget],
      [this.coverCam, this.coverTarget],
    ] as const) {
      renderer.setRenderTarget(target);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
    }
    renderer.setRenderTarget(before.target);
    scene.overrideMaterial = before.override;
    scene.background = before.background;
    scene.fog = before.fog;
    renderer.autoClear = before.autoClear;
    this.u.uShadowMatrix.value.multiplyMatrices(this.bias, this.sunCam.projectionMatrix).multiply(this.sunCam.matrixWorldInverse);
    this.u.uCoverMatrix.value.multiplyMatrices(this.bias, this.coverCam.projectionMatrix).multiply(this.coverCam.matrixWorldInverse);
    this.u.uShadowMap.value = this.sunTarget.depthTexture;
    this.u.uCoverMap.value = this.coverTarget.depthTexture;
    this.u.uShadowTexel.value = (this.sunCam.right - this.sunCam.left) / SUN_SIZE;
    this.u.uShadowOn.value = 1;
  }

  dispose(): void {
    this.sunTarget?.dispose();
    this.coverTarget?.dispose();
    this.depthOnly.dispose();
    this.sunTarget = this.coverTarget = null;
  }
}

/** An orthographic camera looking along -dir at `centre`, its box just around the corners. */
function fit(cam: OrthographicCamera, centre: Vector3, dir: Vector3, reach: number, corners: Vector3[]): void {
  cam.position.copy(centre).addScaledVector(dir, reach);
  // an up that is not along the view (the sun or the cover camera looking straight down)
  cam.up.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.99) cam.up.set(0, 0, 1);
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const v = new Vector3();
  for (const c of corners) {
    v.copy(c).applyMatrix4(inv);
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    y0 = Math.min(y0, v.y);
    y1 = Math.max(y1, v.y);
    z0 = Math.min(z0, v.z);
    z1 = Math.max(z1, v.z);
  }
  cam.left = x0;
  cam.right = x1;
  cam.bottom = y0;
  cam.top = y1;
  // the camera looks down -z: near and far are the corners' distances in front of it
  cam.near = Math.max(0.01, -z1 - 0.5);
  cam.far = -z0 + 0.5;
  cam.updateProjectionMatrix();
}
