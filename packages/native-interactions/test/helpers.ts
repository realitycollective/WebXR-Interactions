/**
 * In-memory fakes of the native host's two slices, for this package's own
 * suites and for the shared `InputProvider` contract suite.
 *
 * `FakeInputHost.sample()` deliberately hands back the SAME pooled object
 * and the SAME nested tuple arrays on every call, and `mutatePooled` writes
 * into them afterwards - exactly what a native host that reuses its own
 * sample buffers would do. That is the scenario `NativeInputProvider` has
 * to survive.
 *
 * The input fake reports FACTS, sources and signals, as a native app now
 * does; it never reports capabilities, which `NativeInputProvider` derives.
 * `ReferenceInteractionHost` is a geometrically correct host that also
 * implements the test readbacks, the smoke target for the conformance kit.
 */
import type {
  HeadPose,
  InputHitHint,
  InputSourceSnapshot,
  PoseTuple,
  QuatTuple,
  RayTuple,
  Unsubscribe,
  Vec3Tuple,
} from "@realitycollective/webxr-input";
import type { HoldRelease } from "@realitycollective/webxr-interactions";
import type {
  NativeHit,
  NativeInputFacts,
  NativeInputHost,
  NativeInteractionHost,
  NativeInteractionsTestHost,
  NativePresenceShown,
} from "@realitycollective/native-interactions";

export interface FakeInputHostCapable {
  headPose?: boolean;
  hints?: boolean;
  pulse?: boolean;
  presence?: boolean;
}

export class FakeInputHost implements NativeInputHost {
  private live = false;
  private readonly factsListeners = new Set<() => void>();
  private readonly sourceListeners = new Set<() => void>();
  /** The session's hand-tracking fact. */
  handTracking = false;
  /** Sources reported in place of the pooled one while set. */
  sources: InputSourceSnapshot[] | null = null;

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
  /** Every `applyPresence` call, in order. */
  readonly presenceCalls: Array<["left" | "right", NativePresenceShown]> = [];
  /** What each side draws now. */
  readonly shown: Partial<Record<"left" | "right", NativePresenceShown>> = {};
  /** Cursor discs drawn, which a correct host keeps whatever presence says. */
  cursorPoints: Vec3Tuple[] = [];

  getHeadPose?: () => HeadPose;
  sampleHints?: () => readonly InputHitHint[];
  pulse?: (sourceId: string, intensity: number, durationMs: number) => boolean;
  applyPresence?: (side: "left" | "right", shown: NativePresenceShown) => void;

  constructor(capable: FakeInputHostCapable = {}) {
    if (capable.headPose) this.getHeadPose = () => this.headPoseValue;
    if (capable.hints) this.sampleHints = () => this.hints;
    if (capable.pulse) {
      this.pulse = (sourceId, intensity, durationMs) => {
        this.pulses.push([sourceId, intensity, durationMs]);
        return true;
      };
    }
    if (capable.presence) {
      this.applyPresence = (side, shown) => {
        this.presenceCalls.push([side, shown]);
        this.shown[side] = { ...shown };
      };
    }
  }

  getFacts(): NativeInputFacts {
    return { immersive: this.live, focused: this.live, handTracking: this.handTracking };
  }

  onFactsChanged(listener: () => void): Unsubscribe {
    this.factsListeners.add(listener);
    return () => this.factsListeners.delete(listener);
  }

  onSourcesChanged(listener: () => void): Unsubscribe {
    this.sourceListeners.add(listener);
    return () => this.sourceListeners.delete(listener);
  }

  sample(): readonly InputSourceSnapshot[] {
    if (!this.live) return [];
    return this.sources ?? [this.pooled];
  }

  /** Mutate the pooled snapshot's fields and tuples in place, as a reused buffer would be. */
  mutatePooled(select: number, direction: Vec3Tuple): void {
    this.pooled.select = select;
    const ray = this.pooled.ray!;
    ray.direction[0] = direction[0];
    ray.direction[1] = direction[1];
    ray.direction[2] = direction[2];
  }

  /** Replace the reported sources and signal a source change. */
  setSources(sources: InputSourceSnapshot[] | null): void {
    this.sources = sources;
    this.notifySources();
  }

  /** Driver hook: `inputProviderContractCases()` calls this on cases that need a session. */
  enterSession(): void {
    this.live = true;
    this.notifyFacts();
    this.notifySources();
  }

  /** Driver hook, the other half of a session cycle. */
  exitSession(): void {
    this.live = false;
    this.notifyFacts();
    this.notifySources();
  }

  notifyFacts(): void {
    for (const listener of [...this.factsListeners]) listener();
  }

  private notifySources(): void {
    for (const listener of [...this.sourceListeners]) listener();
  }
}

export interface FakeInteractionHostCapable {
  setWorldPose?: boolean;
  setEffect?: boolean;
  /** Wires a fake gravity-driven `step()` that the hold methods suspend, the shape `TransformPortPhysicsDriver` expects. */
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
  /** Every `setTargetRadius` call, in order. */
  readonly radiusCalls: Array<[string, number]> = [];

  setWorldPose?: (targetId: string, pose: PoseTuple) => void;
  setEffect?: (targetId: string, effect: { scale?: number; emissive?: number }) => void;

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
  }

  /**
   * Suspend the body. Always recorded; the object is held only when this
   * fake has physics. A host without physics implements both hold methods
   * and lets the object rest, as the contract states.
   */
  beginHold(targetId: string): void {
    this.beginHoldCalls.push(targetId);
    if (this.physicsCapable) this.heldTargets.add(targetId);
  }

  endHold(targetId: string, release: HoldRelease): void {
    this.endHoldCalls.push([targetId, release]);
    if (!this.physicsCapable) return;
    this.heldTargets.delete(targetId);
    this.velocities.set(targetId, [...release.linearVelocity]);
  }

  setTargetRadius(targetId: string, radius: number): void {
    this.radiusCalls.push([targetId, radius]);
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

/**
 * A correct host, geometrically: targets are spheres, `hitRay` is IWSDK's
 * point-to-line test and `hitProximity` its surface distance, radii follow
 * `setTargetRadius`, and every test readback is implemented. The smoke
 * target for the host conformance kit.
 */
export class ReferenceInteractionHost extends FakeInteractionHost implements NativeInteractionsTestHost {
  private readonly targets = new Map<string, { position: Vec3Tuple; radius: number }>();
  private readonly releases = new Map<string, HoldRelease>();
  private readonly input: FakeInputHost | undefined;

  constructor(input?: FakeInputHost) {
    super();
    this.input = input;
  }

  placeTarget(targetId: string, position: Vec3Tuple, radius: number): void {
    this.targets.set(targetId, { position: [...position], radius });
  }

  clearTargets(): void {
    this.targets.clear();
  }

  override setTargetRadius(targetId: string, radius: number): void {
    super.setTargetRadius(targetId, radius);
    const target = this.targets.get(targetId);
    if (target) target.radius = radius;
  }

  override endHold(targetId: string, release: HoldRelease): void {
    super.endHold(targetId, release);
    this.releases.set(targetId, {
      linearVelocity: [...release.linearVelocity],
      angularVelocity: [...release.angularVelocity],
    });
  }

  lastRelease(targetId: string): HoldRelease | undefined {
    return this.releases.get(targetId);
  }

  presenceShown(side: "left" | "right"): NativePresenceShown | undefined {
    return this.input?.shown[side];
  }

  cursors(): Vec3Tuple[] {
    return (this.input?.cursorPoints ?? []).map((point) => [...point] as Vec3Tuple);
  }

  override hitRay(ray: RayTuple): NativeHit | null {
    let best: NativeHit | null = null;
    for (const [id, target] of this.targets) {
      const t =
        (target.position[0] - ray.origin[0]) * ray.direction[0] +
        (target.position[1] - ray.origin[1]) * ray.direction[1] +
        (target.position[2] - ray.origin[2]) * ray.direction[2];
      if (t <= 0) continue;
      const miss = Math.hypot(
        ray.origin[0] + ray.direction[0] * t - target.position[0],
        ray.origin[1] + ray.direction[1] * t - target.position[1],
        ray.origin[2] + ray.direction[2] * t - target.position[2],
      );
      if (miss <= target.radius && (best === null || t < best.distance)) {
        best = { targetId: id, distance: t, point: [...target.position] };
      }
    }
    return best;
  }

  override hitProximity(point: Vec3Tuple, radius: number): NativeHit | null {
    let best: NativeHit | null = null;
    for (const [id, target] of this.targets) {
      const surface =
        Math.hypot(target.position[0] - point[0], target.position[1] - point[1], target.position[2] - point[2]) -
        target.radius;
      if (surface <= radius && (best === null || surface < best.distance)) {
        best = { targetId: id, distance: Math.max(0, surface), point: [...target.position] };
      }
    }
    return best;
  }
}
