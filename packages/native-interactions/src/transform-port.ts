/**
 * NativeTransformPort - the read/write surface of ONE interactable, over the
 * native host's `interactions` slice. The host serves every registered
 * object through one set of methods, so this port is a thin binding of one
 * `targetId` onto them - the same idea as `BabylonTransformPort` binding to
 * one node, but the object itself lives on the native side.
 *
 * `setWorldPose` and `setEffect` are optional on `TransformPort`, and are
 * only ever assigned here when the host itself carries the matching member,
 * so an app whose native host cannot follow a world pose, or has no effect
 * hook, sees a port without one rather than a method that silently no-ops.
 *
 * `beginHold` and `endHold` are always present. A pose-only grab calls them
 * on every grab and release, and a host that silently lacked them used to
 * drop every throw on the floor (the release velocity never reached it). A
 * host without them now fails here, at construction, naming both. A target
 * with no physics body simply rests where it is released; the host decides
 * that from its own scene, as IWSDK does.
 */
import type { PoseTuple, QuatTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import type { HoldRelease, TransformPort } from "@realitycollective/webxr-interactions";
import {
  copyPose,
  copyQuat,
  copyVec3,
  resolveHostSlice,
  type NativeInteractionHost,
} from "./native-types.js";

export interface NativeTransformPortOptions {
  /** The `interactions` slice. Omit to read `globalThis.__rcHost.interactions`. */
  interactions?: NativeInteractionHost;
}

export class NativeTransformPort implements TransformPort {
  private readonly host: NativeInteractionHost;
  private readonly targetId: string;

  readonly setWorldPose?: (pose: PoseTuple) => void;
  readonly setEffect?: (effect: { scale?: number; emissive?: number }) => void;
  readonly beginHold: () => void;
  readonly endHold: (release: HoldRelease) => void;

  constructor(targetId: string, options: NativeTransformPortOptions = {}) {
    this.targetId = targetId;
    this.host = resolveHostSlice("interactions", options.interactions);

    if (this.host.setWorldPose) {
      const host = this.host;
      this.setWorldPose = (pose) => host.setWorldPose!(targetId, copyPose(pose));
    }
    if (this.host.setEffect) {
      const host = this.host;
      this.setEffect = (effect) => host.setEffect!(targetId, effect);
    }
    if (typeof this.host.beginHold !== "function" || typeof this.host.endHold !== "function") {
      throw new Error(
        "@realitycollective/native-interactions: the interactions slice must implement beginHold(targetId) and endHold(targetId, release). A pose-only grab calls both, and a host without them drops every release velocity. A host with no physics implements them and lets the object rest.",
      );
    }
    const host = this.host;
    this.beginHold = () => host.beginHold(targetId);
    this.endHold = (release) =>
      host.endHold(targetId, {
        linearVelocity: copyVec3(release.linearVelocity),
        angularVelocity: copyVec3(release.angularVelocity),
      });
  }

  getWorldPose(): PoseTuple {
    return copyPose(this.host.getWorldPose(this.targetId));
  }

  getRestWorldPose(): PoseTuple {
    return copyPose(this.host.getRestWorldPose(this.targetId));
  }

  getLocalOffset(): Vec3Tuple {
    return copyVec3(this.host.getLocalOffset(this.targetId));
  }

  setLocalOffset(offset: Vec3Tuple): void {
    this.host.setLocalOffset(this.targetId, copyVec3(offset));
  }

  setLocalRotation(quaternion: QuatTuple): void {
    this.host.setLocalRotation(this.targetId, copyQuat(quaternion));
  }
}
