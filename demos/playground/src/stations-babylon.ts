/**
 * Builds the same stations as `stations-three.ts` with `@babylonjs/core`:
 * the layout, sizes and emissive colours come from `scene.ts`.
 *
 * The scene must be right-handed (`scene.useRightHandedSystem = true`) so the
 * layout's -Z-ahead positions mean the same thing as on the three.js based
 * platforms.
 */
import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Matrix,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Mesh,
  type Scene,
} from "@babylonjs/core";
import { BALL_HOME, DWELL_RING_PART, STAGE, STATION_PARTS, type PartSpec, type Vec3 } from "./scene.js";

export interface BuiltBabylonStations {
  /** interactable id -> the node to register as the interactable root. */
  objects: Map<string, TransformNode>;
  /** The gaze ring mesh (drive from dwellProgress). */
  dwellRing: Mesh;
  /** The toss tee position (ball respawn point). */
  ballHome: Vec3;
}

function color3(hex: number, intensity = 1): Color3 {
  return new Color3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255).scale(intensity);
}

function material(part: PartSpec, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(`${part.name}-material`, scene);
  mat.diffuseColor = color3(part.color);
  mat.emissiveColor = color3(part.emissive ?? 0x000000, part.emissiveIntensity ?? 1);
  mat.specularColor = color3(0x222222);
  return mat;
}

function mesh(part: PartSpec, scene: Scene): Mesh {
  const shape = part.shape;
  let built: Mesh;
  switch (shape.kind) {
    case "box":
      built = MeshBuilder.CreateBox(part.name, { width: shape.size[0], height: shape.size[1], depth: shape.size[2] }, scene);
      break;
    case "cylinder":
      built = MeshBuilder.CreateCylinder(
        part.name,
        { diameterTop: shape.radiusTop * 2, diameterBottom: shape.radiusBottom * 2, height: shape.height, tessellation: shape.segments },
        scene,
      );
      break;
    case "sphere":
      built = MeshBuilder.CreateSphere(part.name, { diameter: shape.radius * 2, segments: shape.segments }, scene);
      break;
    case "torus":
      built = MeshBuilder.CreateTorus(
        part.name,
        { diameter: shape.radius * 2, thickness: shape.tube * 2, tessellation: shape.tubularSegments },
        scene,
      );
      // Babylon's torus lies flat (hole along Y); the layout's lies in XY (hole along Z).
      built.bakeTransformIntoVertices(Matrix.RotationX(Math.PI / 2));
      break;
    default:
      throw new Error(`[playground] "${part.name}" has no geometry`);
  }
  if (part.geometryPitch || part.geometryOffset) {
    // Turn first, then offset, as the three.js builder does: a lever pivoted at its base.
    const [x, y, z] = part.geometryOffset ?? [0, 0, 0];
    built.bakeTransformIntoVertices(Matrix.RotationX(part.geometryPitch ?? 0).multiply(Matrix.Translation(x, y, z)));
  }
  built.material = material(part, scene);
  return built;
}

/** Lights, floor and background: the stage, from the same numbers as the three.js one. */
export function buildBabylonStage(scene: Scene): void {
  scene.clearColor = new Color4(...color3(STAGE.background).asArray(), 1);
  const hemi = new HemisphericLight("hemisphere", new Vector3(0, 1, 0), scene);
  hemi.diffuse = color3(STAGE.hemisphere.sky);
  hemi.groundColor = color3(STAGE.hemisphere.ground);
  hemi.intensity = STAGE.hemisphere.intensity;
  const key = new DirectionalLight("key", new Vector3(...STAGE.key.position).negate(), scene);
  key.intensity = STAGE.key.intensity;
  const floor = MeshBuilder.CreateGround("floor", { width: STAGE.floorSize, height: STAGE.floorSize }, scene);
  const mat = new StandardMaterial("floor-material", scene);
  mat.diffuseColor = color3(STAGE.floorColor);
  mat.specularColor = color3(0x000000);
  floor.material = mat;
}

/** Build all station nodes; returns the registerable roots. */
export function buildBabylonStations(scene: Scene): BuiltBabylonStations {
  const parts = new Map<string, TransformNode>();
  const objects = new Map<string, TransformNode>();

  for (const part of STATION_PARTS) {
    const node: TransformNode = part.shape.kind === "group" ? new TransformNode(part.name, scene) : mesh(part, scene);
    node.position.set(...part.position);
    if (part.yaw !== undefined) node.rotation.y = part.yaw;
    if (part.pitch !== undefined) node.rotation.x = part.pitch;
    if (part.scale !== undefined) node.scaling.setAll(part.scale);
    if (part.parent) node.parent = parts.get(part.parent) ?? null;
    parts.set(part.name, node);
    if (part.name.startsWith("pg-")) objects.set(part.name, node);
  }

  return { objects, dwellRing: parts.get(DWELL_RING_PART) as Mesh, ballHome: BALL_HOME };
}
