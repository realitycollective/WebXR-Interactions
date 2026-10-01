/**
 * The reference fakes as a test host, for a harness run with no native host
 * (Node in CI, or a shell that installs no test host). The same classes this
 * package's own suites prove the kit against: a geometrically correct
 * `ReferenceInteractionHost`, extended so pose writes land (a rest pose per
 * target, local offsets and rotations applied in the rest frame, world-pose
 * writes taken as they are), a `FakeInputHost` with presence and pointer
 * visuals, and the core's `MemoryPhysicsFacility` as the physics slice.
 */
import { MemoryPhysicsFacility, quatMultiply, vAdd, vApplyQuat } from "@realitycollective/webxr-interactions";
import type { PoseTuple, QuatTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import { FakeInputHost, ReferenceInteractionHost } from "../../../packages/native-interactions/test/helpers.js";
import type { InteractionsTestSlices } from "./kits.js";

const IDENTITY: PoseTuple = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };

function clonePose(pose: PoseTuple): PoseTuple {
  return { position: [pose.position[0], pose.position[1], pose.position[2]], quaternion: [pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]] };
}

/** The reference host with a rest pose per target and every transform write applied, as a correct native scene does. */
class GeometricReferenceHost extends ReferenceInteractionHost {
  private readonly rests = new Map<string, PoseTuple>();
  private readonly lives = new Map<string, PoseTuple>();
  private readonly localOffsets = new Map<string, Vec3Tuple>();

  /** A shell driver: register a target at a rest pose, as the native scene would. */
  placeRest(targetId: string, rest: PoseTuple): void {
    this.rests.set(targetId, clonePose(rest));
    this.lives.set(targetId, clonePose(rest));
    this.localOffsets.set(targetId, [0, 0, 0]);
  }

  reset(): void {
    this.clearTargets();
  }

  override getWorldPose(targetId: string): PoseTuple {
    return clonePose(this.lives.get(targetId) ?? this.rests.get(targetId) ?? IDENTITY);
  }

  override getRestWorldPose(targetId: string): PoseTuple {
    return clonePose(this.rests.get(targetId) ?? IDENTITY);
  }

  override getLocalOffset(targetId: string): Vec3Tuple {
    const offset = this.localOffsets.get(targetId) ?? [0, 0, 0];
    return [offset[0], offset[1], offset[2]];
  }

  override setLocalOffset(targetId: string, offset: Vec3Tuple): void {
    super.setLocalOffset(targetId, offset);
    this.localOffsets.set(targetId, [offset[0], offset[1], offset[2]]);
    const rest = this.rests.get(targetId) ?? IDENTITY;
    const live = clonePose(this.lives.get(targetId) ?? rest);
    live.position = vAdd(rest.position, vApplyQuat(offset, rest.quaternion));
    this.lives.set(targetId, live);
  }

  override setLocalRotation(targetId: string, quaternion: QuatTuple): void {
    super.setLocalRotation(targetId, quaternion);
    const rest = this.rests.get(targetId) ?? IDENTITY;
    const live = clonePose(this.lives.get(targetId) ?? rest);
    live.quaternion = quatMultiply(rest.quaternion, quaternion);
    this.lives.set(targetId, live);
  }

  protected override writeLivePose(targetId: string, pose: PoseTuple): void {
    super.writeLivePose(targetId, pose);
    this.lives.set(targetId, clonePose(pose));
  }
}

export function referenceTestSlices(): InteractionsTestSlices {
  const input = new FakeInputHost({ presence: true, headPose: true, pointerVisuals: true });
  input.sources = [
    { id: "left-controller", kind: "controller", handedness: "left", select: 0, squeeze: 0, ray: { origin: [-0.2, 1.2, 0], direction: [0, 0, -1] }, gripPose: { position: [-0.2, 1.2, 0], quaternion: [0, 0, 0, 1] }, indexTip: [-0.2, 1.2, 0] },
    { id: "right-controller", kind: "controller", handedness: "right", select: 0, squeeze: 0, ray: { origin: [0.2, 1.2, 0], direction: [0, 0, -1] }, gripPose: { position: [0.2, 1.2, 0], quaternion: [0, 0, 0, 1] }, indexTip: [0.2, 1.2, 0] },
  ];
  input.enterSession();
  const interactions = new GeometricReferenceHost(input);
  return {
    input,
    interactions,
    physics: new MemoryPhysicsFacility(),
    readbacks: { interactions },
  };
}
