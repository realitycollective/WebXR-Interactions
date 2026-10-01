/**
 * ThreePointerVisuals - draws the ray stub and the cursor disc for every
 * source, exactly as the core decided them (`InteractionRuntime.onPointerDrawing`:
 * the pointer arbiter's decision under the app's pointer display settings).
 *
 * This is IWSDK 1.0.0's look restated in plain three.js so the standalone
 * WebXR adapter, and XR Blocks through it, show what a Quest shows on the
 * web (`@iwsdk/xr-input` `ray-pointer.js` and `cursor-visual.js`):
 *
 * - the ray is a thin open cylinder along the source's ray, drawn by the
 *   same shader IWSDK uses (alpha 1 between the far fade and the hand fade,
 *   transparent beyond), so with the defaults it is the 1 mm white stub from
 *   3 cm in front of the hand to `min(0.3 m, the hit)`, blue while selecting;
 * - the cursor is a circle at the hit, facing the surface (the ray's
 *   direction, or the line from the head for a near hit), nudged
 *   `cursorOffset` off it, white with a grey rim, opacity and scale from
 *   the drawing.
 *
 * The renderer decides nothing: it reads each frame's `PointerDrawing` and
 * the source's ray from the runtime. Meshes are created per source on first
 * sight and disposed with the renderer. In an environment without a DOM
 * (tests) the cursor uses a plain material instead of the canvas texture.
 */
import {
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Object3D,
  type Texture,
} from "three";
import type { InteractionRuntime, PointerDrawing, Unsubscribe } from "@realitycollective/webxr-interactions";

export interface ThreePointerVisualsOptions {
  /** Where the ray and cursor meshes are added: the scene, or any root in world space. */
  scene: Object3D;
  /** The runtime whose drawings are applied. */
  runtime: InteractionRuntime;
  /** The head pose source for a near-hit cursor's facing; defaults to the runtime's provider head pose. */
  headPosition?: () => readonly [number, number, number];
  /** A cursor texture to use instead of the canvas one (or when there is no DOM). */
  cursorTexture?: Texture | null;
}

/** IWSDK's ray shader: `v` runs 1 at the hand to 0 at the far tip of a unit mesh. */
const RAY_VERTEX = `
  varying float vPosition;
  void main() {
    vPosition = (position.z + 1.0) / 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const RAY_FRAGMENT = `
  uniform float endValue;
  uniform float fadeLength;
  uniform float handFade;
  uniform float opacity;
  uniform vec3 color;
  varying float vPosition;
  void main() {
    float alpha = vPosition < endValue ? smoothstep(endValue - fadeLength, endValue, vPosition) :
               vPosition < 1.0 - handFade ? 1.0 :
               1.0 - smoothstep(1.0 - handFade, 1.0, vPosition);
    gl_FragColor = vec4(color, alpha * opacity);
  }
`;

const CURSOR_RESOLUTION = 512;
let sharedCursorTexture: Texture | null | undefined;

/** IWSDK's cursor: a white disc with a thin grey rim, drawn once and shared. Null without a DOM. */
function cursorTexture(): Texture | null {
  if (sharedCursorTexture !== undefined) return sharedCursorTexture;
  const doc = (globalThis as { document?: { createElement(tag: string): unknown } }).document;
  if (!doc) {
    sharedCursorTexture = null;
    return null;
  }
  const canvas = doc.createElement("canvas") as {
    width: number;
    height: number;
    getContext(kind: "2d"): CanvasRenderingContext2D | null;
  };
  canvas.width = CURSOR_RESOLUTION;
  canvas.height = CURSOR_RESOLUTION;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    sharedCursorTexture = null;
    return null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(CURSOR_RESOLUTION / 2, CURSOR_RESOLUTION / 2, (CURSOR_RESOLUTION / 16) * 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "gray";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(CURSOR_RESOLUTION / 2, CURSOR_RESOLUTION / 2, (CURSOR_RESOLUTION / 16) * 7, 0, Math.PI * 2);
  ctx.stroke();
  sharedCursorTexture = new CanvasTexture(canvas as unknown as HTMLCanvasElement);
  return sharedCursorTexture;
}

interface SourceMeshes {
  ray: Mesh<CylinderGeometry, ShaderMaterial>;
  cursor: Mesh<CircleGeometry, MeshBasicMaterial>;
}

const Z_AXIS = new Vector3(0, 0, 1);
const TEMP_V = new Vector3();
const TEMP_Q = new Quaternion();
const TEMP_DIR = new Vector3();

export class ThreePointerVisuals {
  private readonly scene: Object3D;
  private readonly runtime: InteractionRuntime;
  private readonly meshes = new Map<string, SourceMeshes>();
  private readonly unsubscribe: Unsubscribe;
  private readonly headPosition: (() => readonly [number, number, number]) | undefined;
  private readonly texture: Texture | null;
  private disposed = false;

  constructor(options: ThreePointerVisualsOptions) {
    this.scene = options.scene;
    this.runtime = options.runtime;
    this.headPosition = options.headPosition;
    this.texture = options.cursorTexture === undefined ? cursorTexture() : options.cursorTexture;
    this.unsubscribe = this.runtime.onPointerDrawing((drawings) => this.apply(drawings));
  }

  /** The meshes drawn for one source, for a test or an app that restyles them. */
  meshesFor(sourceId: string): { ray: Mesh; cursor: Mesh } | undefined {
    return this.meshes.get(sourceId);
  }

  /** Apply one frame's drawings: create meshes for new sources, hide those of sources gone. */
  apply(drawings: readonly PointerDrawing[]): void {
    if (this.disposed) return;
    const seen = new Set<string>();
    for (const drawing of drawings) {
      seen.add(drawing.sourceId);
      const meshes = this.meshes.get(drawing.sourceId) ?? this.create(drawing.sourceId);
      this.applyRay(meshes.ray, drawing);
      this.applyCursor(meshes.cursor, drawing);
    }
    for (const [id, meshes] of this.meshes) {
      if (!seen.has(id)) {
        meshes.ray.visible = false;
        meshes.cursor.visible = false;
      }
    }
  }

  private create(sourceId: string): SourceMeshes {
    const ray = new Mesh(
      new CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(-Math.PI / 2),
      new ShaderMaterial({
        vertexShader: RAY_VERTEX,
        fragmentShader: RAY_FRAGMENT,
        transparent: true,
        depthWrite: false,
        uniforms: {
          endValue: { value: 0.75 },
          fadeLength: { value: 0.05 },
          handFade: { value: 0.03 },
          color: { value: new Color(1, 1, 1) },
          opacity: { value: 1 },
        },
      }),
    );
    ray.visible = false;
    ray.renderOrder = 0;
    const cursor = new Mesh(
      new CircleGeometry(1),
      new MeshBasicMaterial({ transparent: true, ...(this.texture ? { map: this.texture } : { color: 0xffffff }) }),
    );
    cursor.visible = false;
    cursor.renderOrder = Number.POSITIVE_INFINITY;
    this.scene.add(ray, cursor);
    const meshes = { ray, cursor };
    this.meshes.set(sourceId, meshes);
    return meshes;
  }

  private applyRay(mesh: Mesh<CylinderGeometry, ShaderMaterial>, drawing: PointerDrawing): void {
    const source = this.runtime.getSource(drawing.sourceId);
    const ray = source?.ray;
    if (!drawing.ray || !ray || drawing.rayTo <= 0) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    // The mesh is a unit cylinder along -Z: scale it to the drawn length
    // and the radius, and express the fades as fractions of that length.
    const length = drawing.rayTo;
    mesh.scale.set(drawing.rayRadius, drawing.rayRadius, length);
    mesh.position.set(ray.origin[0], ray.origin[1], ray.origin[2]);
    TEMP_DIR.set(ray.direction[0], ray.direction[1], ray.direction[2]).normalize();
    mesh.quaternion.setFromUnitVectors(TEMP_V.set(0, 0, -1), TEMP_DIR);
    const uniforms = mesh.material.uniforms;
    // v = 1 - z/length; solid from the hand fade to the far fade.
    uniforms.endValue!.value = 1 - drawing.raySolidTo / length;
    uniforms.fadeLength!.value = Math.max(0, (drawing.rayTo - drawing.raySolidTo) / length);
    uniforms.handFade!.value = Math.min(1, drawing.rayFrom / length);
    (uniforms.color!.value as Color).setRGB(drawing.rayColor[0], drawing.rayColor[1], drawing.rayColor[2]);
    mesh.updateMatrix();
  }

  private applyCursor(mesh: Mesh<CircleGeometry, MeshBasicMaterial>, drawing: PointerDrawing): void {
    if (!drawing.cursor || !drawing.cursorPoint) {
      mesh.visible = false;
      return;
    }
    const point = drawing.cursorPoint;
    const source = this.runtime.getSource(drawing.sourceId);
    // Facing: along the ray for a ray hit; from the head (or the grip) for a near hit.
    if (source?.ray && drawing.ray) {
      TEMP_DIR.set(source.ray.direction[0], source.ray.direction[1], source.ray.direction[2]);
    } else {
      const from = this.headPosition?.() ?? this.runtime.getProvider().getHeadPose?.()?.position ?? source?.gripPose?.position ?? [point[0], point[1] + 1, point[2]];
      TEMP_DIR.set(point[0] - from[0], point[1] - from[1], point[2] - from[2]);
    }
    if (TEMP_DIR.lengthSq() < 1e-12) TEMP_DIR.set(0, 0, -1);
    TEMP_DIR.normalize();
    // The disc faces back along the pointing direction; sit it `cursorOffset` toward the viewer.
    mesh.quaternion.copy(TEMP_Q.setFromUnitVectors(Z_AXIS, TEMP_DIR.clone().negate()));
    mesh.position.set(
      point[0] - TEMP_DIR.x * drawing.cursorOffset,
      point[1] - TEMP_DIR.y * drawing.cursorOffset,
      point[2] - TEMP_DIR.z * drawing.cursorOffset,
    );
    mesh.scale.setScalar(drawing.cursorRadius);
    mesh.material.opacity = drawing.cursorOpacity;
    mesh.visible = true;
    mesh.updateMatrix();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const { ray, cursor } of this.meshes.values()) {
      ray.removeFromParent();
      cursor.removeFromParent();
      ray.geometry.dispose();
      ray.material.dispose();
      cursor.geometry.dispose();
      cursor.material.dispose();
    }
    this.meshes.clear();
  }
}
