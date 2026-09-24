/**
 * The shipped `HitTester` and `TransformPort` conformance suites, tested
 * against fakes.
 *
 * The five adapters run these cases for real, which proves they pass. This
 * file proves the other half: that each case FAILS when a host breaks the
 * one promise it checks. A contract case that cannot fail is a case that
 * catches nothing, so every assertion inside `src/contract-cases.ts` gets a
 * fake built to break it here - the same approach WebXR-UIExtensions' own
 * `contract-cases.test.ts` takes for `windowHostContractCases()`.
 */
import { describe, expect, it } from "vitest";
import {
  hitTesterContractCases,
  transformPortContractCases,
  type HitTester,
  type HitTesterContractSubject,
  type InteractableHit,
  type PoseTuple,
  type QuatTuple,
  type TransformPort,
  type TransformPortContractSubject,
  quatMultiply,
  vAdd,
  vApplyQuat,
} from "../src/index.js";
import type { RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";

// ---------------------------------------------------------------------------
// HitTester
// ---------------------------------------------------------------------------

const EMPTY = "an empty scene answers a ray with null";
const RAY_HIT = "a ray through a placed target returns its id, a positive distance and a point near the ray";
const RAY_AWAY = "a ray pointing away from the target returns null";
const PROXIMITY = "hitProximity finds a target inside its radius and misses outside it";
const NEARER = "with two targets on one ray, the nearer one wins";
const FRESH_HIT = "each hit and its point are fresh values the caller owns";

/** One deliberate defect at a time, so each broken-fake test names the case it breaks. */
interface HitTesterFakeConfig {
  /** Answers a hit even with nothing placed. */
  emptySceneHit?: boolean;
  /** Reports a different id than the target it actually found. */
  wrongId?: boolean;
  /** Reports a non-positive distance for a hit in front of the ray. */
  negativeDistance?: boolean;
  /** Reports a point far from the ray, rather than at or near it. */
  wrongPoint?: boolean;
  /** Answers a ray hit regardless of which way the ray points. */
  ignoresDirection?: boolean;
  /** hitProximity never finds anything, even dead on the target. */
  blindProximity?: boolean;
  /** hitProximity finds a target however far the query point is. */
  greedyProximity?: boolean;
  /** hitRay keeps the first target it finds along a ray, not the nearest. */
  pickFarther?: boolean;
  /** Hands back the target's own stored position as the hit point. */
  sharedPoint?: boolean;
}

class FakeHitTesterHost implements HitTester {
  private readonly targets = new Map<string, { position: Vec3Tuple; radius: number }>();

  constructor(private readonly config: HitTesterFakeConfig = {}) {}

  place(id: string, position: Vec3Tuple, radius: number): void {
    this.targets.set(id, { position, radius });
  }

  hitRay(ray: RayTuple): InteractableHit | null {
    if (this.config.emptySceneHit && this.targets.size === 0) {
      return { interactableId: "ghost", distance: 1, point: [0, 0, 0] };
    }
    let best: [string, number] | null = null;
    for (const [id, target] of this.targets) {
      const t = along(ray, target.position);
      if (!this.config.ignoresDirection && t <= 0) continue;
      const wins = best === null || (this.config.pickFarther ? t > best[1] : t < best[1]);
      if (wins) best = [id, t];
    }
    if (!best) return null;
    const [id, t] = best;
    const target = this.targets.get(id)!;
    return {
      interactableId: this.config.wrongId ? "wrong" : id,
      distance: this.config.negativeDistance ? -Math.abs(t) : t,
      point: this.config.wrongPoint
        ? [target.position[0] + 50, target.position[1], target.position[2]]
        : this.pointOf(target.position),
    };
  }

  private pointOf(position: Vec3Tuple): Vec3Tuple {
    return this.config.sharedPoint ? position : [position[0], position[1], position[2]];
  }

  hitProximity(point: Vec3Tuple, radius: number): InteractableHit | null {
    if (this.config.blindProximity) return null;
    for (const [id, target] of this.targets) {
      const distance = dist(point, target.position);
      if (this.config.greedyProximity || distance <= target.radius + radius) {
        return { interactableId: id, distance, point: this.pointOf(target.position) };
      }
    }
    return null;
  }
}

function along(ray: RayTuple, point: Vec3Tuple): number {
  return (
    (point[0] - ray.origin[0]) * ray.direction[0] +
    (point[1] - ray.origin[1]) * ray.direction[1] +
    (point[2] - ray.origin[2]) * ray.direction[2]
  );
}

function dist(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function makeSubject(config: HitTesterFakeConfig = {}): HitTesterContractSubject {
  const host = new FakeHitTesterHost(config);
  return { hitTester: host, driver: host };
}

function runHitTesterCase(name: string, config: HitTesterFakeConfig): void {
  const contractCase = hitTesterContractCases().find((entry) => entry.name === name);
  if (!contractCase) throw new Error(`no contract case named "${name}"`);
  contractCase.run(makeSubject(config));
}

describe("hitTesterContractCases", () => {
  it("ships named cases, each with a run function", () => {
    const cases = hitTesterContractCases();
    expect(cases.length).toBeGreaterThan(0);
    for (const contractCase of cases) {
      expect(typeof contractCase.name).toBe("string");
      expect(typeof contractCase.run).toBe("function");
    }
    // Two calls hand back the same data; nothing is rebuilt per caller.
    expect(hitTesterContractCases()).toBe(cases);
  });

  it("passes a conforming host", () => {
    for (const contractCase of hitTesterContractCases()) {
      expect(() => contractCase.run(makeSubject())).not.toThrow();
    }
  });
});

describe("hitTesterContractCases catches a broken host", () => {
  it("rejects a host that answers a hit on an empty scene", () => {
    expect(() => runHitTesterCase(EMPTY, { emptySceneHit: true })).toThrow(
      /hitRay over an empty scene must return null/,
    );
  });

  it("rejects a hit that names the wrong interactable", () => {
    expect(() => runHitTesterCase(RAY_HIT, { wrongId: true })).toThrow(
      /expected interactableId "target"/,
    );
  });

  it("rejects a hit with a non-positive distance", () => {
    expect(() => runHitTesterCase(RAY_HIT, { negativeDistance: true })).toThrow(
      /distance must be positive/,
    );
  });

  it("rejects a hit whose point is nowhere near the ray", () => {
    expect(() => runHitTesterCase(RAY_HIT, { wrongPoint: true })).toThrow(
      /point\[0\] must be close to/,
    );
  });

  it("rejects a host that answers a ray pointing away from every target", () => {
    expect(() => runHitTesterCase(RAY_AWAY, { ignoresDirection: true })).toThrow(
      /must return null/,
    );
  });

  it("rejects a hitProximity that misses a target dead on its own position", () => {
    expect(() => runHitTesterCase(PROXIMITY, { blindProximity: true })).toThrow(
      /must find it/,
    );
  });

  it("rejects a hitProximity that finds a target far outside the query radius", () => {
    expect(() => runHitTesterCase(PROXIMITY, { greedyProximity: true })).toThrow(
      /must return null/,
    );
  });

  it("rejects a host that keeps the farther of two targets", () => {
    expect(() => runHitTesterCase(NEARER, { pickFarther: true })).toThrow(
      /the nearer target must win, got "far"/,
    );
  });

  it("rejects a host that hands back its own stored point", () => {
    expect(() => runHitTesterCase(FRESH_HIT, { sharedPoint: true })).toThrow(
      /hitRay must return a new hit and point each call/,
    );
  });

  it("fails loudly when asked for a case that does not exist", () => {
    expect(() => runHitTesterCase("no such case", {})).toThrow(/no contract case named/);
  });
});

// ---------------------------------------------------------------------------
// TransformPort
// ---------------------------------------------------------------------------

const OFFSET = "setLocalOffset then getLocalOffset returns the same offset";
const POSE = "getWorldPose returns finite numbers and a unit quaternion";
const ROTATION = "setLocalRotation with a unit quaternion does not throw";
const REST = "getRestWorldPose returns the pose captured at registration";
const LIVE_AT_REST = "before any write, the live pose is the rest pose";
const LIVE_OFFSET = "getWorldPose follows setLocalOffset while getRestWorldPose stays put";
const LIVE_ROTATION = "getWorldPose follows setLocalRotation while getRestWorldPose stays put";
const LIVE_WORLD = "setWorldPose, when present, is what getWorldPose reads back";
const FRESH = "every returned tuple is a fresh value the caller owns";
const NOT_KEPT = "a tuple passed in is not kept";
const EFFECT = "setEffect, when present, accepts scale and emissive without throwing";

/** A rest pose away from the origin and turned a quarter about Y. */
const REST_POSE: PoseTuple = { position: [1, 0.5, -2], quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };

/** One deliberate defect at a time, so each broken-port test names the case it breaks. */
interface TransformPortFakeConfig {
  /** getLocalOffset does not report back what setLocalOffset was given. */
  offsetMismatch?: boolean;
  /** getWorldPose reports a NaN. */
  nonFinitePose?: boolean;
  /** getWorldPose reports a quaternion that is not unit length. */
  nonUnitQuaternion?: boolean;
  /** setLocalRotation throws even on a unit quaternion. */
  rotationThrows?: boolean;
  /** getRestWorldPose reports the origin rather than the captured rest. */
  restAtOrigin?: boolean;
  /** getRestWorldPose reports the live pose, so it moves with every write. */
  restFollowsWrites?: boolean;
  /** getWorldPose reports the rest pose, however the object has moved. */
  liveIsRest?: boolean;
  /** setLocalOffset adds the offset in world axes, ignoring the rest rotation. */
  offsetIgnoresRestFrame?: boolean;
  /** setLocalRotation replaces the rest orientation rather than composing with it. */
  rotationReplacesRest?: boolean;
  /** Whether this port carries the optional setWorldPose member at all. */
  hasSetWorldPose?: boolean;
  /** setWorldPose accepts the pose but getWorldPose never shows it. */
  worldPoseIgnored?: boolean;
  /** getWorldPose, getRestWorldPose and getLocalOffset hand back stored tuples. */
  sharesTuples?: boolean;
  /** setLocalOffset keeps the caller's tuple. */
  keepsOffsetInput?: boolean;
  /** setWorldPose keeps the caller's pose. */
  keepsPoseInput?: boolean;
  /** Whether this port carries the optional setEffect member at all. */
  hasSetEffect?: boolean;
  /** setEffect throws when called. */
  effectThrows?: boolean;
}

function copyPose(pose: PoseTuple): PoseTuple {
  return { position: [...pose.position], quaternion: [...pose.quaternion] };
}

/** A port over one object that sits at {@link REST_POSE} with no parent. */
class FakeTransformPortHost implements TransformPort {
  private readonly rest = copyPose(REST_POSE);
  private live = copyPose(REST_POSE);
  private offset: Vec3Tuple = [0, 0, 0];
  readonly setWorldPose?: (pose: PoseTuple) => void;
  readonly setEffect?: (effect: { scale?: number; emissive?: number }) => void;

  constructor(private readonly config: TransformPortFakeConfig = {}) {
    if (config.hasSetWorldPose) {
      this.setWorldPose = (pose) => {
        if (this.config.worldPoseIgnored) return;
        this.live = this.config.keepsPoseInput ? pose : copyPose(pose);
      };
    }
    if (config.hasSetEffect) {
      this.setEffect = () => {
        if (this.config.effectThrows) throw new Error("effect rejected");
      };
    }
  }

  getWorldPose(): PoseTuple {
    if (this.config.nonFinitePose) return { position: [0, Number.NaN, 0], quaternion: [0, 0, 0, 1] };
    if (this.config.nonUnitQuaternion) return { position: [0, 0, 0], quaternion: [1, 1, 0, 0] };
    const pose = this.config.liveIsRest ? this.rest : this.live;
    return this.config.sharesTuples ? pose : copyPose(pose);
  }

  getRestWorldPose(): PoseTuple {
    if (this.config.restAtOrigin) return { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
    const pose = this.config.restFollowsWrites ? this.live : this.rest;
    return this.config.sharesTuples ? pose : copyPose(pose);
  }

  getLocalOffset(): Vec3Tuple {
    if (this.config.offsetMismatch) return [this.offset[0] + 1, this.offset[1], this.offset[2]];
    return this.config.sharesTuples ? this.offset : [...this.offset];
  }

  setLocalOffset(offset: Vec3Tuple): void {
    this.offset = this.config.keepsOffsetInput ? offset : [...offset];
    const moved = this.config.offsetIgnoresRestFrame ? offset : vApplyQuat(offset, this.rest.quaternion);
    this.live.position = vAdd(this.rest.position, moved);
  }

  setLocalRotation(quaternion: QuatTuple): void {
    if (this.config.rotationThrows) throw new Error("rotation rejected");
    this.live.quaternion = this.config.rotationReplacesRest
      ? [...quaternion]
      : quatMultiply(this.rest.quaternion, quaternion);
  }
}

function makePortSubject(config: TransformPortFakeConfig = {}): TransformPortContractSubject {
  return { port: new FakeTransformPortHost(config), rest: copyPose(REST_POSE) };
}

function runTransformPortCase(name: string, config: TransformPortFakeConfig): void {
  const contractCase = transformPortContractCases().find((entry) => entry.name === name);
  if (!contractCase) throw new Error(`no contract case named "${name}"`);
  contractCase.run(makePortSubject(config));
}

describe("transformPortContractCases", () => {
  it("ships named cases, each with a run function", () => {
    const cases = transformPortContractCases();
    expect(cases.length).toBeGreaterThan(0);
    for (const contractCase of cases) {
      expect(typeof contractCase.name).toBe("string");
      expect(typeof contractCase.run).toBe("function");
    }
    expect(transformPortContractCases()).toBe(cases);
  });

  it("passes a conforming port with no optional members", () => {
    for (const contractCase of transformPortContractCases()) {
      expect(() => contractCase.run(makePortSubject())).not.toThrow();
    }
  });

  it("passes a conforming port that also implements setWorldPose and setEffect", () => {
    for (const contractCase of transformPortContractCases()) {
      expect(() => contractCase.run(makePortSubject({ hasSetWorldPose: true, hasSetEffect: true }))).not.toThrow();
    }
  });
});

describe("transformPortContractCases catches a broken port", () => {
  it("rejects a port whose getLocalOffset does not match what was set", () => {
    expect(() => runTransformPortCase(OFFSET, { offsetMismatch: true })).toThrow(
      /getLocalOffset\(\)\[0\] must be close to 0.3/,
    );
  });

  it("rejects a getWorldPose with a non-finite number", () => {
    expect(() => runTransformPortCase(POSE, { nonFinitePose: true })).toThrow(/must return finite numbers/);
  });

  it("rejects a getWorldPose with a non-unit quaternion", () => {
    expect(() => runTransformPortCase(POSE, { nonUnitQuaternion: true })).toThrow(/must be a unit quaternion/);
  });

  it("rejects a setLocalRotation that throws on a unit quaternion", () => {
    expect(() => runTransformPortCase(ROTATION, { rotationThrows: true })).toThrow(
      /setLocalRotation\(unit quaternion\) must not throw/,
    );
  });

  it("rejects a getRestWorldPose that is not the captured rest", () => {
    expect(() => runTransformPortCase(REST, { restAtOrigin: true })).toThrow(
      /getRestWorldPose\(\)\.position\[0\] must be close to 1/,
    );
  });

  it("rejects a live pose that does not start at rest", () => {
    expect(() => runTransformPortCase(LIVE_AT_REST, { nonFinitePose: true })).toThrow(/getWorldPose\(\)\.position/);
  });

  it("rejects a getWorldPose that reports the rest pose after the object moved", () => {
    expect(() => runTransformPortCase(LIVE_OFFSET, { liveIsRest: true })).toThrow(
      /getWorldPose\(\)\.position after setLocalOffset/,
    );
    expect(() => runTransformPortCase(LIVE_ROTATION, { liveIsRest: true })).toThrow(
      /getWorldPose\(\)\.quaternion after setLocalRotation/,
    );
    expect(() => runTransformPortCase(LIVE_WORLD, { hasSetWorldPose: true, liveIsRest: true })).toThrow(
      /getWorldPose\(\) after setWorldPose/,
    );
  });

  it("rejects a getRestWorldPose that moves with every write", () => {
    expect(() => runTransformPortCase(LIVE_OFFSET, { restFollowsWrites: true })).toThrow(
      /getRestWorldPose\(\) after setLocalOffset/,
    );
    expect(() => runTransformPortCase(LIVE_ROTATION, { restFollowsWrites: true })).toThrow(
      /getRestWorldPose\(\) after setLocalRotation/,
    );
    expect(() => runTransformPortCase(LIVE_WORLD, { hasSetWorldPose: true, restFollowsWrites: true })).toThrow(
      /getRestWorldPose\(\) after setWorldPose/,
    );
  });

  it("rejects offsets and rotations that ignore the rest frame", () => {
    expect(() => runTransformPortCase(LIVE_OFFSET, { offsetIgnoresRestFrame: true })).toThrow(
      /getWorldPose\(\)\.position after setLocalOffset/,
    );
    expect(() => runTransformPortCase(LIVE_ROTATION, { rotationReplacesRest: true })).toThrow(
      /getWorldPose\(\)\.quaternion after setLocalRotation/,
    );
  });

  it("rejects a setWorldPose that getWorldPose never shows", () => {
    expect(() => runTransformPortCase(LIVE_WORLD, { hasSetWorldPose: true, worldPoseIgnored: true })).toThrow(
      /getWorldPose\(\) after setWorldPose/,
    );
  });

  it("rejects a port that hands back its stored tuples", () => {
    expect(() => runTransformPortCase(FRESH, { sharesTuples: true })).toThrow(/must not change the port/);
  });

  it("rejects a port that keeps the caller's tuples", () => {
    expect(() => runTransformPortCase(NOT_KEPT, { keepsOffsetInput: true })).toThrow(
      /getLocalOffset\(\) after the caller reused its tuple/,
    );
    expect(() => runTransformPortCase(NOT_KEPT, { hasSetWorldPose: true, keepsPoseInput: true })).toThrow(
      /getWorldPose\(\) after the caller reused its tuple/,
    );
  });

  it("rejects a setEffect that throws", () => {
    expect(() => runTransformPortCase(EFFECT, { hasSetEffect: true, effectThrows: true })).toThrow(
      /setEffect\(\{ scale, emissive \}\) must not throw/,
    );
  });

  it("fails loudly when asked for a case that does not exist", () => {
    expect(() => runTransformPortCase("no such case", {})).toThrow(/no contract case named/);
  });
});
