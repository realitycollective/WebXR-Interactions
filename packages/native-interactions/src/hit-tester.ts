/**
 * NativeHitTester - resolves the core's ray and proximity queries against
 * the native host's `interactions` slice. The native app owns the scene and
 * physics, so targeting is entirely the host's answer; this class only
 * copies the result across and renames its `targetId` to the core's
 * `interactableId`.
 */
import type { RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import type { HitTester, InteractableHit } from "@realitycollective/webxr-interactions";
import {
  copyRay,
  copyVec3,
  resolveHostSlice,
  type NativeHit,
  type NativeInteractionHost,
} from "./native-types.js";

export interface NativeHitTesterOptions {
  /** The `interactions` slice. Omit to read `globalThis.__rcHost.interactions`. */
  interactions?: NativeInteractionHost;
}

export class NativeHitTester implements HitTester {
  private readonly host: NativeInteractionHost;

  constructor(options: NativeHitTesterOptions = {}) {
    this.host = resolveHostSlice("interactions", options.interactions);
  }

  hitRay(ray: RayTuple): InteractableHit | null {
    const hit = this.host.hitRay(copyRay(ray));
    return hit ? toInteractableHit(hit) : null;
  }

  hitProximity(point: Vec3Tuple, radius: number): InteractableHit | null {
    const hit = this.host.hitProximity(copyVec3(point), radius);
    return hit ? toInteractableHit(hit) : null;
  }
}

function toInteractableHit(hit: NativeHit): InteractableHit {
  return { interactableId: hit.targetId, distance: hit.distance, point: copyVec3(hit.point) };
}
