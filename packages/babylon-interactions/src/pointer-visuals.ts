/**
 * BabylonPointerVisuals - draws the ray stub and the cursor disc for every
 * source, exactly as the core decided them (`InteractionRuntime.onPointerDrawing`:
 * the pointer arbiter's decision under the app's pointer display settings).
 *
 * This is IWSDK 1.0.0's look restated for Babylon (`@iwsdk/xr-input`
 * `ray-pointer.js` and `cursor-visual.js`), so a Babylon app shows what a
 * Quest shows on the web:
 *
 * - the ray is a thin cylinder along the source's ray, spanning `rayFrom` to
 *   `rayTo` metres from its origin, so with the defaults it is the 1 mm white
 *   stub from 3 cm in front of the hand to `min(0.3 m, the hit)`, blue while
 *   selecting;
 * - the cursor is a disc at the hit, facing the viewer along the pointing
 *   direction (the ray's, or the line from the head for a near hit), nudged
 *   `cursorOffset` off the surface, white, with opacity and radius from the
 *   drawing.
 *
 * The renderer decides nothing: it reads each frame's `PointerDrawing` and
 * the source's ray from the runtime and writes them onto its meshes. Meshes
 * are created per source on first sight and disposed with the renderer.
 * Positions and directions arrive in world space as the provider gives them,
 * so nothing is flipped for Babylon's left-handed default. Like the rest of
 * this package it never imports `@babylonjs/core`: the app hands over the
 * constructors it uses as a {@link BabylonPointerVisualsKit}.
 */
import type { InteractionRuntime, PointerDrawing, Unsubscribe } from "@realitycollective/webxr-interactions";
import type { BabylonQuaternionLike, BabylonVector3Like } from "./babylon-types.js";

/** Structural slice of Babylon's `Color3`. */
export interface BabylonColor3Like {
  r: number;
  g: number;
  b: number;
}

/** Structural slice of the `StandardMaterial` members the renderer writes. */
export interface BabylonPointerMaterialLike {
  emissiveColor: BabylonColor3Like;
  diffuseColor: BabylonColor3Like;
  /** 0 transparent to 1 opaque. */
  alpha: number;
  /** Unlit so the colour is the colour on screen. */
  disableLighting?: boolean;
  dispose(): void;
}

/** Structural slice of the `Mesh` members the renderer writes. */
export interface BabylonPointerMeshLike {
  position: BabylonVector3Like;
  rotationQuaternion: BabylonQuaternionLike | null;
  scaling: BabylonVector3Like;
  isVisible: boolean;
  material: BabylonPointerMaterialLike | null;
  /** Higher groups draw later; the cursor uses 1 so it draws over the scene. */
  renderingGroupId?: number;
  dispose(): void;
}

/** What the app imports from `@babylonjs/core` and hands to the renderer. */
export interface BabylonPointerVisualsKit {
  MeshBuilder: {
    /** A cylinder along the Y axis, centred on the origin. */
    CreateCylinder(
      name: string,
      options: { height: number; diameter: number; tessellation?: number },
      scene: unknown,
    ): BabylonPointerMeshLike;
    /** A disc in the XY plane whose front face looks down -Z. */
    CreateDisc(name: string, options: { radius: number; tessellation?: number }, scene: unknown): BabylonPointerMeshLike;
  };
  StandardMaterial: new (name: string, scene: unknown) => BabylonPointerMaterialLike;
  Color3: new (r: number, g: number, b: number) => BabylonColor3Like;
  Quaternion: new (x: number, y: number, z: number, w: number) => BabylonQuaternionLike;
}

export interface BabylonPointerVisualsOptions {
  /** The runtime whose drawings are applied. */
  runtime: InteractionRuntime;
  /** The Babylon constructors the renderer builds its meshes from. */
  kit: BabylonPointerVisualsKit;
  /** The scene the meshes are created in (handed to the kit as is). */
  scene: unknown;
}

interface SourceMeshes {
  ray: BabylonPointerMeshLike;
  cursor: BabylonPointerMeshLike;
}

type Vec3 = readonly [number, number, number];

/** The unit vector along (x, y, z); +Z for a zero vector. */
function unit(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z);
  return length < 1e-6 ? [0, 0, 1] : [x / length, y / length, z / length];
}

/**
 * The quaternion turning the axis `from` (+Y or +Z) onto the unit vector `to`.
 * Antiparallel vectors turn half a circle about X, which is square to both axes.
 */
function rotationBetween(from: Vec3, to: Vec3): [number, number, number, number] {
  const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (dot < -0.999999) return [1, 0, 0, 0];
  const x = from[1] * to[2] - from[2] * to[1];
  const y = from[2] * to[0] - from[0] * to[2];
  const z = from[0] * to[1] - from[1] * to[0];
  const w = 1 + dot;
  const length = Math.hypot(x, y, z, w);
  return [x / length, y / length, z / length, w / length];
}

function setColour(target: BabylonColor3Like, rgb: readonly [number, number, number]): void {
  target.r = rgb[0];
  target.g = rgb[1];
  target.b = rgb[2];
}

const Y_AXIS: Vec3 = [0, 1, 0];
const Z_AXIS: Vec3 = [0, 0, 1];

export class BabylonPointerVisuals {
  private readonly runtime: InteractionRuntime;
  private readonly kit: BabylonPointerVisualsKit;
  private readonly scene: unknown;
  private readonly meshes = new Map<string, SourceMeshes>();
  private readonly unsubscribe: Unsubscribe;
  private disposed = false;

  constructor(options: BabylonPointerVisualsOptions) {
    this.runtime = options.runtime;
    this.kit = options.kit;
    this.scene = options.scene;
    this.unsubscribe = this.runtime.onPointerDrawing((drawings) => this.apply(drawings));
  }

  /** The meshes drawn for one source, for a test or an app that restyles them. */
  meshesFor(sourceId: string): SourceMeshes | undefined {
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
        meshes.ray.isVisible = false;
        meshes.cursor.isVisible = false;
      }
    }
  }

  private create(sourceId: string): SourceMeshes {
    const ray = this.kit.MeshBuilder.CreateCylinder(
      `pointer-ray-${sourceId}`,
      { height: 1, diameter: 1, tessellation: 6 },
      this.scene,
    );
    ray.material = this.material(`pointer-ray-${sourceId}-material`);
    ray.isVisible = false;
    const cursor = this.kit.MeshBuilder.CreateDisc(`pointer-cursor-${sourceId}`, { radius: 1, tessellation: 32 }, this.scene);
    cursor.material = this.material(`pointer-cursor-${sourceId}-material`);
    cursor.renderingGroupId = 1;
    cursor.isVisible = false;
    const meshes = { ray, cursor };
    this.meshes.set(sourceId, meshes);
    return meshes;
  }

  private material(name: string): BabylonPointerMaterialLike {
    const material = new this.kit.StandardMaterial(name, this.scene);
    material.emissiveColor = new this.kit.Color3(1, 1, 1);
    material.diffuseColor = new this.kit.Color3(1, 1, 1);
    material.disableLighting = true;
    material.alpha = 1;
    return material;
  }

  private applyRay(mesh: BabylonPointerMeshLike, drawing: PointerDrawing): void {
    const ray = this.runtime.getSource(drawing.sourceId)?.ray;
    const length = drawing.rayTo - drawing.rayFrom;
    if (!drawing.ray || !ray || length <= 0) {
      mesh.isVisible = false;
      return;
    }
    const dir = unit(ray.direction[0], ray.direction[1], ray.direction[2]);
    const centre = (drawing.rayFrom + drawing.rayTo) / 2;
    mesh.position.x = ray.origin[0] + dir[0] * centre;
    mesh.position.y = ray.origin[1] + dir[1] * centre;
    mesh.position.z = ray.origin[2] + dir[2] * centre;
    mesh.scaling.x = drawing.rayRadius * 2;
    mesh.scaling.y = length;
    mesh.scaling.z = drawing.rayRadius * 2;
    const q = rotationBetween(Y_AXIS, dir);
    mesh.rotationQuaternion = new this.kit.Quaternion(q[0], q[1], q[2], q[3]);
    const material = mesh.material!;
    setColour(material.emissiveColor, drawing.rayColor);
    setColour(material.diffuseColor, drawing.rayColor);
    material.alpha = 1;
    mesh.isVisible = true;
  }

  private applyCursor(mesh: BabylonPointerMeshLike, drawing: PointerDrawing): void {
    if (!drawing.cursor || !drawing.cursorPoint) {
      mesh.isVisible = false;
      return;
    }
    const point = drawing.cursorPoint;
    const source = this.runtime.getSource(drawing.sourceId);
    // Pointing direction: along the ray for a ray hit; from the head for a near hit.
    let dir: Vec3;
    if (source?.ray && drawing.ray) {
      dir = unit(source.ray.direction[0], source.ray.direction[1], source.ray.direction[2]);
    } else {
      const head = this.runtime.getProvider().getHeadPose?.()?.position;
      dir = head ? unit(point[0] - head[0], point[1] - head[1], point[2] - head[2]) : Z_AXIS;
    }
    // The disc's front face looks down -Z, so turning +Z onto the pointing
    // direction makes it face back at the viewer. It sits `cursorOffset` toward the viewer.
    const q = rotationBetween(Z_AXIS, dir);
    mesh.rotationQuaternion = new this.kit.Quaternion(q[0], q[1], q[2], q[3]);
    mesh.position.x = point[0] - dir[0] * drawing.cursorOffset;
    mesh.position.y = point[1] - dir[1] * drawing.cursorOffset;
    mesh.position.z = point[2] - dir[2] * drawing.cursorOffset;
    mesh.scaling.x = drawing.cursorRadius;
    mesh.scaling.y = drawing.cursorRadius;
    mesh.scaling.z = drawing.cursorRadius;
    mesh.material!.alpha = drawing.cursorOpacity;
    mesh.isVisible = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const { ray, cursor } of this.meshes.values()) {
      for (const mesh of [ray, cursor]) {
        mesh.material!.dispose();
        mesh.dispose();
      }
    }
    this.meshes.clear();
  }
}
