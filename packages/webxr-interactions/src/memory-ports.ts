/**
 * Engine-free ports over sphere targets: the reference `HitTester` and
 * `TransformPort` a trace replay, a synthetic recording, a harness run
 * without a host, or a test can drive with no engine at all. They apply the
 * contract exactly as every binding must (`hitTesterContractCases()` and
 * `transformPortContractCases()` pass over them), so a difference between a
 * binding and these is a difference in the binding.
 */
import type { PoseTuple, QuatTuple, RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import { coneHitForSpheres, type SphereTarget } from "./gaze.js";
import { quatMultiply, rayPointDistance, surfacePointOnSphere, vAdd, vApplyQuat } from "./math.js";
import type { HitTester, HoldRelease, InteractableHit, TransformPort } from "./ports.js";

/** IWSDK's radius for a target that declares none. */
export const MEMORY_DEFAULT_RADIUS = 0.1;

interface MemoryTarget {
  id: string;
  /** The port the target's live pose is read from, when one was placed with a port. */
  port?: MemoryTransformPort;
  centre: Vec3Tuple;
  radius: number;
  visible: boolean;
}

/** A sphere-target hit tester: IWSDK's `EntityHitTester` rules over plain spheres. */
export class MemoryHitTester implements HitTester {
  private readonly targets = new Map<string, MemoryTarget>();

  /** Place a shown sphere target; a port makes its centre follow the port's live pose. */
  place(id: string, centre: Vec3Tuple, radius: number = MEMORY_DEFAULT_RADIUS, port?: MemoryTransformPort): void {
    this.targets.set(id, { id, centre: [centre[0], centre[1], centre[2]], radius, visible: true, ...(port ? { port } : {}) });
  }

  remove(id: string): void {
    this.targets.delete(id);
  }

  setVisible(id: string, visible: boolean): void {
    const target = this.targets.get(id);
    if (target) target.visible = visible;
  }

  clear(): void {
    this.targets.clear();
  }

  private centreOf(target: MemoryTarget): Vec3Tuple {
    return target.port ? target.port.getWorldPose().position : target.centre;
  }

  hitRay(ray: RayTuple): InteractableHit | null {
    let best: InteractableHit | null = null;
    for (const target of this.targets.values()) {
      if (!target.visible) continue;
      const centre = this.centreOf(target);
      const { distance, t } = rayPointDistance(ray, centre);
      if (t <= 0 || distance > target.radius) continue;
      if (best === null || t < best.distance) {
        // Where the ray enters the sphere.
        const inside = Math.sqrt(Math.max(0, target.radius * target.radius - distance * distance));
        const enter = t - inside;
        best = {
          interactableId: target.id,
          distance: enter,
          point: [ray.origin[0] + ray.direction[0] * enter, ray.origin[1] + ray.direction[1] * enter, ray.origin[2] + ray.direction[2] * enter],
        };
      }
    }
    return best;
  }

  hitProximity(point: Vec3Tuple, radius: number): InteractableHit | null {
    let best: InteractableHit | null = null;
    for (const target of this.targets.values()) {
      if (!target.visible) continue;
      const centre = this.centreOf(target);
      const surface = Math.max(0, Math.hypot(centre[0] - point[0], centre[1] - point[1], centre[2] - point[2]) - target.radius);
      if (surface <= radius && (best === null || surface < best.distance)) {
        best = { interactableId: target.id, distance: surface, point: surfacePointOnSphere(centre, target.radius, point) };
      }
    }
    return best;
  }

  hitCone(ray: RayTuple, halfAngle: number, maxLength: number): InteractableHit | null {
    const spheres: SphereTarget[] = [];
    for (const target of this.targets.values()) {
      if (target.visible) spheres.push({ id: target.id, center: this.centreOf(target), radius: target.radius });
    }
    const hit = coneHitForSpheres(ray, spheres, halfAngle, maxLength);
    return hit ? { interactableId: hit.interactableId, distance: hit.distance, point: hit.point } : null;
  }
}

/** A transform port over a pose it keeps itself, with the held-pose members recorded. */
export class MemoryTransformPort implements TransformPort {
  private rest: PoseTuple;
  private live: PoseTuple;
  private offset: Vec3Tuple = [0, 0, 0];
  private rotation: QuatTuple = [0, 0, 0, 1];
  private held = false;
  /** Every release `endHold` received, in order. */
  readonly releases: HoldRelease[] = [];
  /** The last effect written. */
  effect: { scale?: number; emissive?: number } = {};

  constructor(rest: PoseTuple) {
    this.rest = copyPose(rest);
    this.live = copyPose(rest);
  }

  getWorldPose(): PoseTuple {
    return copyPose(this.live);
  }

  getRestWorldPose(): PoseTuple {
    return copyPose(this.rest);
  }

  getLocalOffset(): Vec3Tuple {
    return [this.offset[0], this.offset[1], this.offset[2]];
  }

  setLocalOffset(offset: Vec3Tuple): void {
    this.offset = [offset[0], offset[1], offset[2]];
    this.live = { position: vAdd(this.rest.position, vApplyQuat(this.offset, this.rest.quaternion)), quaternion: quatMultiply(this.rest.quaternion, this.rotation) };
  }

  setLocalRotation(quaternion: QuatTuple): void {
    this.rotation = [quaternion[0], quaternion[1], quaternion[2], quaternion[3]];
    this.live = { position: vAdd(this.rest.position, vApplyQuat(this.offset, this.rest.quaternion)), quaternion: quatMultiply(this.rest.quaternion, this.rotation) };
  }

  setWorldPose(pose: PoseTuple): void {
    this.live = copyPose(pose);
  }

  setEffect(effect: { scale?: number; emissive?: number }): void {
    this.effect = { ...this.effect, ...effect };
  }

  recaptureRest(): void {
    this.rest = copyPose(this.live);
    this.offset = [0, 0, 0];
    this.rotation = [0, 0, 0, 1];
  }

  beginHold(): void {
    this.held = true;
  }

  endHold(release: HoldRelease): void {
    this.held = false;
    this.releases.push({ linearVelocity: [...release.linearVelocity] as Vec3Tuple, angularVelocity: [...release.angularVelocity] as Vec3Tuple });
  }

  get isHeld(): boolean {
    return this.held;
  }
}

function copyPose(pose: PoseTuple): PoseTuple {
  return { position: [pose.position[0], pose.position[1], pose.position[2]], quaternion: [pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]] };
}
