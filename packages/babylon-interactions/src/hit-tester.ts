/**
 * BabylonHitTester - resolves the core's ray and proximity queries against
 * registered Babylon nodes.
 *
 * The default test needs no Babylon raycaster: each registered node carries
 * a radius, and a query is a sphere test against the node's absolute
 * position. That is the same model the IWSDK adapter uses, and it is enough
 * for buttons, levers, dials and grabbables, which are small next to the
 * distance they are pointed at from.
 *
 * An app that wants mesh-accurate picking supplies `pickWithRay`, typically
 * a one-line wrapper over `scene.pickWithRay`. Whatever mesh it returns is
 * mapped back to an interactable id through the registration map, walking up
 * parents so a pick on a child mesh still resolves to the registered root.
 */
import type { RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import {
  rayPointDistance,
  type HitTester,
  type InteractableHit,
} from "@realitycollective/webxr-interactions";
import { nodeShowing, parentOf, toVec3, type BabylonTransformNodeLike } from "./babylon-types.js";

/** What an app's mesh-accurate pick reports back. */
export interface BabylonPickResult {
  /** The node that was hit. Mapped to an interactable through registration. */
  mesh: BabylonTransformNodeLike | null | undefined;
  /** Distance from the ray origin, in metres. */
  distance: number;
  /** World-space hit point. */
  point: Vec3Tuple;
}

/**
 * A mesh-accurate pick supplied by the app - `scene.pickWithRay` with a Ray
 * built from these arguments. Return null for a miss.
 */
export type BabylonPickWithRay = (
  origin: Vec3Tuple,
  direction: Vec3Tuple,
  maxDistance: number,
) => BabylonPickResult | null;

export interface BabylonHitTesterOptions {
  /** Targeting radius for a node registered without one. Default 0.1 m. */
  defaultRadius?: number;
  /** Ray length handed to `pickWithRay`, in metres. Default 100. */
  maxRayDistance?: number;
  /** Optional mesh-accurate pick. Absent, the sphere test is used. */
  pickWithRay?: BabylonPickWithRay;
}

const DEFAULT_RADIUS = 0.1;
const DEFAULT_MAX_RAY_DISTANCE = 100;

export class BabylonHitTester implements HitTester {
  private readonly entries = new Map<string, { node: BabylonTransformNodeLike; radius: number }>();
  private readonly byNode = new Map<BabylonTransformNodeLike, string>();
  private readonly defaultRadius: number;
  private readonly maxRayDistance: number;
  private pickWithRay: BabylonPickWithRay | null;

  constructor(options: BabylonHitTesterOptions = {}) {
    this.defaultRadius = options.defaultRadius ?? DEFAULT_RADIUS;
    this.maxRayDistance = options.maxRayDistance ?? DEFAULT_MAX_RAY_DISTANCE;
    this.pickWithRay = options.pickWithRay ?? null;
  }

  /** Supply or replace the mesh-accurate pick after construction. */
  setPickWithRay(pick: BabylonPickWithRay | null): void {
    this.pickWithRay = pick;
  }

  register(id: string, node: BabylonTransformNodeLike, radius?: number): void {
    this.unregister(id);
    this.entries.set(id, { node, radius: radius ?? this.defaultRadius });
    this.byNode.set(node, id);
  }

  unregister(id: string): void {
    const entry = this.entries.get(id);
    if (entry) this.byNode.delete(entry.node);
    this.entries.delete(id);
  }

  getNode(id: string): BabylonTransformNodeLike | undefined {
    return this.entries.get(id)?.node;
  }

  hitRay(ray: RayTuple): InteractableHit | null {
    // An app-supplied pick REPLACES the sphere test for rays - it does not
    // sit in front of it. A miss, or a hit on scenery, is the answer: the
    // app's own pick already said what the ray reached first, and testing
    // spheres behind it would target something the ray never got to.
    // Proximity queries stay on the sphere test either way.
    if (this.pickWithRay) {
      const picked = this.pickWithRay(ray.origin, ray.direction, this.maxRayDistance);
      if (!picked?.mesh) return null;
      const id = this.ownerOf(picked.mesh);
      return id === null
        ? null
        : { interactableId: id, distance: picked.distance, point: picked.point };
    }

    let best: InteractableHit | null = null;
    for (const [id, { node, radius }] of this.entries) {
      if (!nodeShowing(node)) continue;
      const point = toVec3(node.getAbsolutePosition());
      if (!point) continue;
      const { distance, t } = rayPointDistance(ray, point);
      if (t > 0 && distance <= radius && (best === null || t < best.distance)) {
        best = { interactableId: id, distance: t, point };
      }
    }
    return best;
  }

  hitProximity(point: Vec3Tuple, radius: number): InteractableHit | null {
    let best: InteractableHit | null = null;
    for (const [id, { node, radius: targetRadius }] of this.entries) {
      if (!nodeShowing(node)) continue;
      const at = toVec3(node.getAbsolutePosition());
      if (!at) continue;
      const distance =
        Math.hypot(at[0] - point[0], at[1] - point[1], at[2] - point[2]) - targetRadius;
      if (distance <= radius && (best === null || distance < best.distance)) {
        best = { interactableId: id, distance: Math.max(0, distance), point: at };
      }
    }
    return best;
  }

  /** The registered interactable a picked node belongs to, if any. */
  private ownerOf(node: BabylonTransformNodeLike): string | null {
    let current: BabylonTransformNodeLike | null = node;
    while (current) {
      const id = this.byNode.get(current);
      if (id !== undefined) return id;
      current = parentOf(current);
    }
    return null;
  }
}
