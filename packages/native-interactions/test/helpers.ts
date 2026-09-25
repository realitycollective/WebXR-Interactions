/**
 * In-memory fakes of the native host's two slices, for this package's own
 * suites and for the shared `InputProvider` contract suite.
 *
 * `FakeInputHost.sample()` deliberately hands back the SAME pooled object
 * and the SAME nested tuple arrays on every call, and `mutatePooled` writes
 * into them afterwards - exactly what a native host that reuses its own
 * sample buffers would do. That is the scenario `NativeInputProvider` has
 * to survive.
 */
import { NO_CAPABILITIES } from "@realitycollective/webxr-input";
import type {
  Handedness,
  HeadPose,
  InputCapabilities,
  InputHitHint,
  InputSourceSnapshot,
  PoseTuple,
  PresenceModality,
  QuatTuple,
  RayTuple,
  Unsubscribe,
  Vec3Tuple,
} from "@realitycollective/webxr-input";
import type { HoldRelease } from "@realitycollective/webxr-interactions";
import type { NativeHit, NativeInputHost, NativeInteractionHost } from "@realitycollective/native-interactions";

export interface FakeInputHostCapable {
  headPose?: boolean;
  hints?: boolean;
  pulse?: boolean;
  presence?: boolean;
}

export class FakeInputHost implements NativeInputHost {
  private live = false;
  private readonly presenceCapable: boolean;
  private readonly capsListeners = new Set<(c: InputCapabilities) => void>();
  private readonly sourceListeners = new Set<() => void>();

  /** One pooled snapshot, reused (and mutated) across calls - see the file header. */
  private readonly pooled: InputSourceSnapshot = {
    id: "pooled-source",
    kind: "hand",
    handedness: "right",
    select: 0,
    squeeze: 0,
    ray: { origin: [0, 0, 0], direction: [0, 0, 1] },
    gripPose: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
  };
  readonly hints: InputHitHint[] = [];
  headPoseValue: HeadPose = { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] };
  readonly pulses: Array<[string, number, number]> = [];
  readonly presenceVisible: Array<[Handedness | "all", boolean]> = [];
  readonly presenceModality: PresenceModality[] = [];
  presenceReport = true;

  getHeadPose?: () => HeadPose;
  sampleHints?: () => readonly InputHitHint[];
  pulse?: (sourceId: string, intensity: number, durationMs: number) => boolean;
  setPresenceVisible?: (target: Handedness | "all", visible: boolean) => boolean;
  setPresenceModality?: (mode: PresenceModality) => boolean;

  constructor(capable: FakeInputHostCapable = {}) {
    this.presenceCapable = !!capable.presence;
    if (capable.headPose) this.getHeadPose = () => this.headPoseValue;
    if (capable.hints) this.sampleHints = () => this.hints;
    if (capable.pulse) {
      this.pulse = (sourceId, intensity, durationMs) => {
        this.pulses.push([sourceId, intensity, durationMs]);
        return true;
      };
    }
    if (capable.presence) {
      this.setPresenceVisible = (target, visible) => {
        this.presenceVisible.push([target, visible]);
        return this.presenceReport;
      };
      this.setPresenceModality = (mode) => {
        this.presenceModality.push(mode);
        return true;
      };
    }
  }

  /** Live capabilities, derived from the session flag and the fixed presence flag. */
  getCapabilities(): InputCapabilities {
    return {
      ...NO_CAPABILITIES,
      presence: this.presenceCapable,
      ...(this.live ? { rays: true, headPose: true, grabs: "poseOnly" as const } : {}),
    };
  }

  onCapabilitiesChanged(listener: (c: InputCapabilities) => void): Unsubscribe {
    this.capsListeners.add(listener);
    return () => this.capsListeners.delete(listener);
  }

  onSourcesChanged(listener: () => void): Unsubscribe {
    this.sourceListeners.add(listener);
    return () => this.sourceListeners.delete(listener);
  }

  sample(): readonly InputSourceSnapshot[] {
    return this.live ? [this.pooled] : [];
  }

  /** Mutate the pooled snapshot's fields and tuples in place, as a reused buffer would be. */
  mutatePooled(select: number, direction: Vec3Tuple): void {
    this.pooled.select = select;
    const ray = this.pooled.ray!;
    ray.direction[0] = direction[0];
    ray.direction[1] = direction[1];
    ray.direction[2] = direction[2];
  }

  /** Driver hook: `inputProviderContractCases()` calls this on cases that need a session. */
  enterSession(): void {
    this.live = true;
    this.notifyCaps();
    this.notifySources();
  }

  /** Driver hook, the other half of a session cycle. */
  exitSession(): void {
    this.live = false;
    this.notifyCaps();
    this.notifySources();
  }

  private notifyCaps(): void {
    const next = this.getCapabilities();
    for (const listener of [...this.capsListeners]) listener(next);
  }

  private notifySources(): void {
    for (const listener of [...this.sourceListeners]) listener();
  }
}

export interface FakeInteractionHostCapable {
  setWorldPose?: boolean;
  setEffect?: boolean;
  /** Wires beginHold/endHold and a fake gravity-driven `step()`, the same shape `TransformPortPhysicsDriver` expects. */
  physics?: boolean;
}

export class FakeInteractionHost implements NativeInteractionHost {
  rayHit: NativeHit | null = null;
  proximityHit: NativeHit | null = null;
  lastRay: RayTuple | null = null;
  lastProximity: { point: Vec3Tuple; radius: number } | null = null;

  private readonly poses = new Map<string, PoseTuple>();
  private readonly restPoses = new Map<string, PoseTuple>();
  private readonly offsets = new Map<string, Vec3Tuple>();
  private readonly physicsCapable: boolean;
  private readonly heldTargets = new Set<string>();
  private readonly velocities = new Map<string, Vec3Tuple>();

  readonly setLocalOffsetCalls: Array<[string, Vec3Tuple]> = [];
  readonly setLocalRotationCalls: Array<[string, QuatTuple]> = [];
  readonly setWorldPoseCalls: Array<[string, PoseTuple]> = [];
  readonly setEffectCalls: Array<[string, { scale?: number; emissive?: number }]> = [];
  readonly beginHoldCalls: string[] = [];
  readonly endHoldCalls: Array<[string, HoldRelease]> = [];

  setWorldPose?: (targetId: string, pose: PoseTuple) => void;
  setEffect?: (targetId: string, effect: { scale?: number; emissive?: number }) => void;
  beginHold?: (targetId: string) => void;
  endHold?: (targetId: string, release: HoldRelease) => void;

  constructor(capable: FakeInteractionHostCapable = {}) {
    this.physicsCapable = !!capable.physics;
    if (capable.setWorldPose) {
      this.setWorldPose = (targetId, pose) => {
        this.setWorldPoseCalls.push([targetId, pose]);
        this.writeLivePose(targetId, pose);
        this.clearVelocityIfNotHeld(targetId);
      };
    }
    if (capable.setEffect) {
      this.setEffect = (targetId, effect) => {
        this.setEffectCalls.push([targetId, effect]);
      };
    }
    if (capable.physics) {
      this.beginHold = (targetId) => {
        this.beginHoldCalls.push(targetId);
        this.heldTargets.add(targetId);
      };
      this.endHold = (targetId, release) => {
        this.endHoldCalls.push([targetId, release]);
        this.heldTargets.delete(targetId);
        this.velocities.set(targetId, [...release.linearVelocity]);
      };
    }
  }

  /**
   * Advance the fake physics for one target: gravity moves it unless it is
   * currently held, mirroring the rule `beginHold`/`endHold` document. The
   * `TransformPortPhysicsDriver` a contract-case subject wires to this.
   */
  step(targetId: string, dtSeconds: number): void {
    if (this.heldTargets.has(targetId)) return;
    const velocity = this.velocities.get(targetId) ?? [0, 0, 0];
    const next: Vec3Tuple = [velocity[0], velocity[1] - 9.8 * dtSeconds, velocity[2]];
    this.velocities.set(targetId, next);
    const pose = this.getWorldPose(targetId);
    this.writeLivePose(targetId, {
      position: [
        pose.position[0] + next[0] * dtSeconds,
        pose.position[1] + next[1] * dtSeconds,
        pose.position[2] + next[2] * dtSeconds,
      ],
      quaternion: pose.quaternion,
    });
  }

  /**
   * Where a live-pose write lands. Overridable so a subclass tracking poses
   * its own way (`GeometricInteractionHost` in `iwsdk-interactions`'s
   * `port-parity.test.ts`) still gets a working `step()`/`setWorldPose`.
   */
  protected writeLivePose(targetId: string, pose: PoseTuple): void {
    this.poses.set(targetId, pose);
  }

  /** setWorldPose's reset half: a teleport while not held clears velocity. */
  protected clearVelocityIfNotHeld(targetId: string): void {
    if (this.physicsCapable && !this.heldTargets.has(targetId)) {
      this.velocities.set(targetId, [0, 0, 0]);
    }
  }

  hitRay(ray: RayTuple): NativeHit | null {
    this.lastRay = ray;
    return this.rayHit;
  }

  hitProximity(point: Vec3Tuple, radius: number): NativeHit | null {
    this.lastProximity = { point, radius };
    return this.proximityHit;
  }

  setPose(targetId: string, pose: PoseTuple): void {
    this.poses.set(targetId, pose);
  }

  setRestPose(targetId: string, pose: PoseTuple): void {
    this.restPoses.set(targetId, pose);
  }

  setOffset(targetId: string, offset: Vec3Tuple): void {
    this.offsets.set(targetId, offset);
  }

  getWorldPose(targetId: string): PoseTuple {
    return this.poses.get(targetId) ?? { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  }

  getRestWorldPose(targetId: string): PoseTuple {
    return this.restPoses.get(targetId) ?? { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  }

  getLocalOffset(targetId: string): Vec3Tuple {
    return this.offsets.get(targetId) ?? [0, 0, 0];
  }

  setLocalOffset(targetId: string, offset: Vec3Tuple): void {
    this.setLocalOffsetCalls.push([targetId, offset]);
  }

  setLocalRotation(targetId: string, quaternion: QuatTuple): void {
    this.setLocalRotationCalls.push([targetId, quaternion]);
  }
}
