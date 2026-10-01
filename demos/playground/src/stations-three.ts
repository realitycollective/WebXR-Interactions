/**
 * Builds the playground stations as three.js meshes from the portable layout
 * in `scene.ts`. Used as it is by the three.js, IWSDK (which is three.js
 * underneath) and XR Blocks (a three.js Script) platforms.
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { BALL_HOME, DWELL_RING_PART, STAGE, STATION_PARTS, type PartSpec, type Vec3 } from "./scene.js";

export interface BuiltStations {
  /** interactable id -> the object to register as the interactable root. */
  objects: Map<string, Object3D>;
  /** Everything to add to the scene (stations and decorative parts). */
  root: Group;
  /** Every part by name, including the decorative ones. */
  parts: Map<string, Object3D>;
  /** The gaze ring mesh (drive from dwellProgress). */
  dwellRing: Object3D;
  /** The toss tee position (ball respawn point). */
  ballHome: Vec3;
}

function material(part: PartSpec): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(part.color),
    emissive: new Color(part.emissive ?? 0x000000),
    emissiveIntensity: part.emissiveIntensity ?? 1,
    roughness: 0.5,
    metalness: 0.2,
  });
}

function geometry(part: PartSpec): BufferGeometry {
  const shape = part.shape;
  let built: BufferGeometry;
  switch (shape.kind) {
    case "box":
      built = new BoxGeometry(...shape.size);
      break;
    case "cylinder":
      built = new CylinderGeometry(shape.radiusTop, shape.radiusBottom, shape.height, shape.segments);
      break;
    case "sphere":
      built = new SphereGeometry(shape.radius, shape.segments, shape.segments);
      break;
    case "torus":
      built = new TorusGeometry(shape.radius, shape.tube, shape.radialSegments, shape.tubularSegments);
      break;
    default:
      throw new Error(`[playground] "${part.name}" has no geometry`);
  }
  if (part.geometryPitch) built.rotateX(part.geometryPitch);
  if (part.geometryOffset) built.translate(...part.geometryOffset);
  return built;
}

/** Lights and floor: the stage every three.js based platform shares. */
export function buildStage(): Group {
  const stage = new Group();
  stage.add(new HemisphereLight(STAGE.hemisphere.sky, STAGE.hemisphere.ground, STAGE.hemisphere.intensity));
  const key = new DirectionalLight(0xffffff, STAGE.key.intensity);
  key.position.set(...STAGE.key.position);
  stage.add(key);
  const floor = new Mesh(
    new PlaneGeometry(STAGE.floorSize, STAGE.floorSize),
    new MeshStandardMaterial({ color: new Color(STAGE.floorColor), roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  stage.add(floor);
  return stage;
}

/** Build all station meshes; returns the registerable roots. */
export function buildStations(): BuiltStations {
  const root = new Group();
  const parts = new Map<string, Object3D>();
  const objects = new Map<string, Object3D>();

  for (const part of STATION_PARTS) {
    const object: Object3D = part.shape.kind === "group" ? new Group() : new Mesh(geometry(part), material(part));
    object.name = part.name;
    object.position.set(...part.position);
    if (part.yaw !== undefined) object.rotation.y = part.yaw;
    if (part.pitch !== undefined) object.rotation.x = part.pitch;
    if (part.scale !== undefined) object.scale.setScalar(part.scale);
    (part.parent ? (parts.get(part.parent) ?? root) : root).add(object);
    parts.set(part.name, object);
    if (part.name.startsWith("pg-")) objects.set(part.name, object);
  }

  return { objects, root, parts, dwellRing: parts.get(DWELL_RING_PART)!, ballHome: BALL_HOME };
}
