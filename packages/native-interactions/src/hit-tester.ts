/**
 * NativeHitTester - resolves the core's ray, proximity and cone queries
 * against the native host's `interactions` slice. The native app owns the
 * scene and physics, so targeting is entirely the host's answer; this class
 * only copies the result across and renames its `targetId` to the core's
 * `interactableId`. `hitCone` is present only when the host slice carries
 * one, so the runtime falls back to `hitRay` for eye gaze on a host without.
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
  readonly hitCone?: (ray: RayTuple, halfAngle: number, maxLength: number) => InteractableHit | null;

  constructor(options: NativeHitTesterOptions = {}) {
    this.host = resolveHostSlice("interactions", options.interactions);
    const host = this.host;
    if (host.hitCone) {
      this.hitCone = (ray, halfAngle, maxLength) => {
        const hit = host.hitCone!(copyRay(ray), halfAngle, maxLength);
        return hit ? toInteractableHit(hit) : null;
      };
    }
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
