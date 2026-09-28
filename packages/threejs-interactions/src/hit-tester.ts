/**
 * ThreeHitTester - resolves core ray/proximity queries against registered
 * three.js objects. Ray hits use a Raycaster over the registered roots
 * (recursive); proximity uses world-position distance minus an
 * approximate bounding radius, good enough for poke targets.
 *
 * Detailed meshes are the cost to watch. three.js tests every triangle of
 * a mesh once a ray enters its bounding sphere, so a 20k-triangle
 * interactable costs close to a millisecond per ray. When the app has
 * installed three-mesh-bvh's prototype hooks -
 * `BufferGeometry.prototype.computeBoundsTree` and
 * `Mesh.prototype.raycast = acceleratedRaycast`, which IWSDK does for you -
 * the tester builds a bounds tree for every geometry it registers and asks
 * the raycaster for the first hit only, so the same ray costs microseconds.
 * Without the hooks it falls back to the plain raycast, and a detailed
 * interactable should be registered through a low-poly collider proxy
 * instead (see the README).
 *
 * Two rules `ports.ts`'s `HitTester` documents, applied here because
 * three.js does not apply them itself:
 *  - A target registered with no `targetRadius` is a 0.1 m sphere for
 *    `hitProximity`, IWSDK's default. It only matters for a target with no
 *    geometry of its own (a bare `Group`) - one with a mesh keeps using its
 *    own bounding-sphere radius, which is more accurate.
 *  - A target hidden by `visible` on itself or on any ancestor is never a
 *    candidate, for `hitRay` and `hitProximity` alike, even though three.js's
 *    own `Raycaster` ignores `visible` by design (r186, issue 14700) and has
 *    to be told separately.
 */
import { Raycaster, type BufferGeometry, type Intersection, type Mesh, type Object3D } from "three";
import type { RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import {
  coneHitForSpheres,
  type HitTester,
  type InteractableHit,
  type SphereTarget,
} from "@realitycollective/webxr-interactions";

/** What three-mesh-bvh adds to a geometry once its prototype hooks are installed. */
interface BvhGeometryLike {
  boundsTree?: unknown;
  computeBoundsTree?: () => void;
}

/** IWSDK's default target radius, used for a target with no geometry of its own. */
const DEFAULT_TARGET_RADIUS = 0.1;

/** A `Matrix4` always holds sixteen numbers; the type says so for indexed reads. */
type Matrix4Elements = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export class ThreeHitTester implements HitTester {
  private readonly roots = new Map<string, Object3D>();
  private readonly byObject = new WeakMap<Object3D, string>();
  /** Explicit `targetRadius` from `register()`, keyed by id - `hitProximity`'s fallback for a target with no geometry of its own. */
  private readonly targetRadii = new Map<string, number>();
  /** `roots` as the array the raycaster takes, rebuilt only when the set changes. */
  private rootList: Object3D[] | null = null;
  private readonly raycaster = new Raycaster();
  /** Reused between calls; three.js appends into it and sorts it. */
  private readonly intersections: Intersection[] = [];

  constructor() {
    // Read by three-mesh-bvh's accelerated raycast, ignored by the stock one.
    (this.raycaster as { firstHitOnly?: boolean }).firstHitOnly = true;
  }

  /**
   * `targetRadius` is the sphere `hitProximity` uses when `object` (and
   * every child `register` inspects) carries no geometry of its own - a
   * bare `Group` standing in for an interactable, as a `poke`-only or
   * gaze-only target often is. Default 0.1 m, matching IWSDK's
   * `EntityHitTester`. A target with a mesh ignores this and keeps using
   * its own bounding-sphere radius, which is more accurate.
   */
  register(id: string, object: Object3D, targetRadius: number = DEFAULT_TARGET_RADIUS): void {
    this.unregister(id);
    object.traverse((child) => {
      const geometry = (child as Mesh).geometry as (BufferGeometry & BvhGeometryLike) | undefined;
      // `disposeBoundsTree` leaves null behind, a never-built geometry has
      // undefined: both mean there is no tree to use.
      if (
        geometry &&
        typeof geometry.computeBoundsTree === "function" &&
        (geometry.boundsTree === undefined || geometry.boundsTree === null)
      ) {
        geometry.computeBoundsTree();
      }
    });
    this.roots.set(id, object);
    this.byObject.set(object, id);
    this.targetRadii.set(id, targetRadius);
    this.rootList = null;
  }

  unregister(id: string): void {
    const object = this.roots.get(id);
    if (!object) return;
    this.byObject.delete(object);
    this.roots.delete(id);
    this.targetRadii.delete(id);
    this.rootList = null;
  }

  getObject(id: string): Object3D | undefined {
    return this.roots.get(id);
  }

  hitRay(ray: RayTuple): InteractableHit | null {
    if (this.roots.size === 0) return null;
    this.raycaster.ray.origin.set(ray.origin[0], ray.origin[1], ray.origin[2]);
    this.raycaster.ray.direction.set(ray.direction[0], ray.direction[1], ray.direction[2]);
    const intersections = this.intersections;
    intersections.length = 0;
    this.raycaster.intersectObjects(this.objects(), true, intersections);
    for (const intersection of intersections) {
      const id = this.ownerOf(intersection.object);
      // three.js's Raycaster ignores `visible` by design (r186, issue
      // 14700), so the rule is re-applied here: a hit on an object hidden by
      // itself or by an ancestor is not a candidate at all.
      if (id !== null && isVisibleChain(intersection.object)) {
        return {
          interactableId: id,
          distance: intersection.distance,
          point: [intersection.point.x, intersection.point.y, intersection.point.z],
        };
      }
    }
    return null;
  }

  hitProximity(point: Vec3Tuple, radius: number): InteractableHit | null {
    let best: InteractableHit | null = null;
    for (const [id, object] of this.roots) {
      if (!isVisibleChain(object)) continue;
      // One matrix update per object, then position and scale straight off
      // the world matrix: the last column is the translation and the length
      // of each of the first three columns is that axis's scale.
      object.updateWorldMatrix(true, false);
      const e = object.matrixWorld.elements as Matrix4Elements;
      const scale = Math.max(
        Math.hypot(e[0], e[1], e[2]),
        Math.hypot(e[4], e[5], e[6]),
        Math.hypot(e[8], e[9], e[10]),
      );
      const radius0 = radiusOf(object, this.targetRadii.get(id) ?? DEFAULT_TARGET_RADIUS);
      const surfaceDistance = Math.max(
        0,
        Math.hypot(e[12] - point[0], e[13] - point[1], e[14] - point[2]) - radius0 * scale,
      );
      if (surfaceDistance <= radius && (best === null || surfaceDistance < best.distance)) {
        best = { interactableId: id, distance: surfaceDistance, point: [e[12], e[13], e[14]] };
      }
    }
    return best;
  }

  /**
   * The eye-gaze cone (`ports.ts`, `hitCone`): a mesh the raycast reaches
   * within `maxLength` wins outright, as IWSDK's conecaster lets the raw
   * gaze ray win; otherwise the cone runs over each root's bounding sphere
   * (world position, geometry radius scaled by the world scale, or the
   * registered radius for a bare group), the same sphere `hitProximity`
   * uses. A root hidden by `visible` on itself or an ancestor is skipped.
   */
  hitCone(ray: RayTuple, halfAngle: number, maxLength: number): InteractableHit | null {
    const direct = this.hitRay(ray);
    if (direct && direct.distance <= maxLength) return direct;
    const spheres: SphereTarget[] = [];
    for (const [id, object] of this.roots) {
      if (!isVisibleChain(object)) continue;
      object.updateWorldMatrix(true, false);
      const e = object.matrixWorld.elements as Matrix4Elements;
      const scale = Math.max(
        Math.hypot(e[0], e[1], e[2]),
        Math.hypot(e[4], e[5], e[6]),
        Math.hypot(e[8], e[9], e[10]),
      );
      const radius = radiusOf(object, this.targetRadii.get(id) ?? DEFAULT_TARGET_RADIUS) * scale;
      spheres.push({ id, center: [e[12], e[13], e[14]], radius });
    }
    const hit = coneHitForSpheres(ray, spheres, halfAngle, maxLength);
    return hit ? { interactableId: hit.interactableId, distance: hit.distance, point: hit.point } : null;
  }

  private objects(): Object3D[] {
    if (this.rootList === null) this.rootList = [...this.roots.values()];
    return this.rootList;
  }

  private ownerOf(object: Object3D): string | null {
    let current: Object3D | null = object;
    while (current) {
      const id = this.byObject.get(current);
      if (id !== undefined) return id;
      current = current.parent;
    }
    return null;
  }
}

/**
 * Bounding-sphere radius of the object's own geometry in local units, or
 * `fallbackRadius` (the registered `targetRadius`) for a plain group with
 * none - see `register()`'s own comment.
 */
function radiusOf(object: Object3D, fallbackRadius: number): number {
  const geometry = (object as Mesh).geometry as BufferGeometry | undefined;
  if (!geometry) return fallbackRadius;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  return geometry.boundingSphere?.radius ?? fallbackRadius;
}

/** False when `object` or any ancestor has `visible === false` - see the file comment. */
function isVisibleChain(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (current.visible === false) return false;
    current = current.parent;
  }
  return true;
}
