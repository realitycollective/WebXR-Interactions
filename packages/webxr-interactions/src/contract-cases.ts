/**
 * Shared `HitTester` and `TransformPort` conformance suites, shipped as data
 * rather than as tests - the same idea as `windowHostContractCases()` in
 * WebXR-UIExtensions and `inputProviderContractCases()` in
 * `@realitycollective/webxr-input`. Five adapters implement these two ports
 * against five different scene graphs; running the same checks against every
 * one is what stops an adapter quietly dropping a documented rule.
 *
 * The suites are runner-free on purpose. Every adapter repository already has
 * its own test runner, and an adapter written outside this repository cannot
 * reach into this one's `test/` folder, so the checks ship as plain objects
 * that throw an `Error` on failure and the adapter iterates them.
 *
 * Both suites assert only what `ports.ts` documents, including two rules
 * every platform now shares:
 *  - `getWorldPose()` is the LIVE pose and `getRestWorldPose()` the rest pose
 *    offsets are measured from.
 *  - Every tuple a port returns is fresh and owned by the caller, and a tuple
 *    passed in is not kept.
 */
import type { PoseTuple, QuatTuple, RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import { quatMultiply, vAdd, vApplyQuat } from "./math.js";
import type { HitTester, HoldRelease, TransformPort } from "./ports.js";

// ---------------------------------------------------------------------------
// HitTester
// ---------------------------------------------------------------------------

/**
 * Places (or replaces) one target for a case to query against. Build a FRESH
 * subject per case: cases place targets of their own and do not clean up.
 */
export interface HitTesterContractDriver {
  /**
   * Register a target at `position` with an interaction radius of `radius`,
   * however the platform registers a target - a mesh, a node, an entity.
   */
  place(id: string, position: Vec3Tuple, radius: number): void;
}

/** The tester under test, plus the means of putting targets into its scene. */
export interface HitTesterContractSubject {
  hitTester: HitTester;
  driver: HitTesterContractDriver;
}

/** One check a {@link HitTester} implementation must pass. */
export interface HitTesterContractCase {
  name: string;
  run(subject: HitTesterContractSubject): void;
}

/**
 * The shared `HitTester` conformance suite. An adapter's test file is a loop:
 *
 * ```ts
 * for (const contractCase of hitTesterContractCases()) {
 *   it(contractCase.name, () => contractCase.run(makeSubject()));
 * }
 * ```
 */
export function hitTesterContractCases(): readonly HitTesterContractCase[] {
  return HIT_TESTER_CASES;
}

const DOWN_RAY: RayTuple = { origin: [0, 0, 0], direction: [0, 0, -1] };
const AWAY_RAY: RayTuple = { origin: [0, 0, 0], direction: [0, 0, 1] };

/**
 * A ray-based query only has to land WITHIN the target's own radius:
 * `ports.ts` documents `point` as "world-space hit or closest point", so a
 * mesh-accurate ray tester (three.js) reporting the surface it actually hit
 * is as conforming as a sphere tester (Babylon, IWSDK) reporting the target's
 * centre. Placing the target exactly on the ray's line makes both answers
 * the same point when a tester has no radius-shaped slack, and this is the
 * tolerance for testers that do.
 */
function slack(radius: number): number {
  return radius + 0.05;
}

const HIT_TESTER_CASES: readonly HitTesterContractCase[] = [
  {
    name: "an empty scene answers a ray with null",
    run({ hitTester }) {
      assert(hitTester.hitRay(DOWN_RAY) === null, "hitRay over an empty scene must return null");
    },
  },
  {
    name: "a ray through a placed target returns its id, a positive distance and a point near the ray",
    run({ hitTester, driver }) {
      const radius = 0.15;
      driver.place("target", [0, 0, -2], radius);
      const hit = hitTester.hitRay(DOWN_RAY);
      assert(hit !== null, "a ray through a placed target must not miss");
      assert(hit.interactableId === "target", `expected interactableId "target", got "${hit.interactableId}"`);
      assert(hit.distance > 0, `distance must be positive, got ${hit.distance}`);
      const eps = slack(radius);
      assert(closeTo(hit.distance, 2, eps), `distance must be close to 2, got ${hit.distance}`);
      assertVec3Close(hit.point, [0, 0, -2], eps, "point");
    },
  },
  {
    name: "a ray pointing away from the target returns null",
    run({ hitTester, driver }) {
      driver.place("target", [0, 0, -2], 0.15);
      assert(hitTester.hitRay(AWAY_RAY) === null, "a ray pointing away from every target must return null");
    },
  },
  {
    name: "hitProximity finds a target inside its radius and misses outside it",
    run({ hitTester, driver }) {
      driver.place("target", [0, 0, -2], 0.1);
      const inside = hitTester.hitProximity([0, 0, -2], 0.5);
      assert(inside !== null, "hitProximity at the target's own position must find it");
      assert(
        inside.interactableId === "target",
        `expected interactableId "target", got "${inside.interactableId}"`,
      );
      const outside = hitTester.hitProximity([5, 5, 5], 0.05);
      assert(outside === null, "hitProximity far from every target must return null");
    },
  },
  {
    name: "with two targets on one ray, the nearer one wins",
    run({ hitTester, driver }) {
      const radius = 0.1;
      driver.place("far", [0, 0, -3], radius);
      driver.place("near", [0, 0, -1], radius);
      const hit = hitTester.hitRay(DOWN_RAY);
      assert(hit !== null, "a ray through two targets must not miss");
      assert(hit.interactableId === "near", `the nearer target must win, got "${hit.interactableId}"`);
      assert(closeTo(hit.distance, 1, slack(radius)), `distance must be close to 1, got ${hit.distance}`);
    },
  },
  {
    name: "each hit and its point are fresh values the caller owns",
    run({ hitTester, driver }) {
      driver.place("target", [0, 0, -2], 0.15);
      for (const [label, query] of [
        ["hitRay", () => hitTester.hitRay(DOWN_RAY)],
        ["hitProximity", () => hitTester.hitProximity([0, 0, -2], 0.5)],
      ] as const) {
        const first = query();
        const second = query();
        assert(first !== null && second !== null, `${label} must find the placed target`);
        assert(second !== first && second.point !== first.point, `${label} must return a new hit and point each call`);
        const expected = first.point[2];
        first.point[2] = 1e6;
        const third = query();
        assert(
          third !== null && closeTo(third.point[2], expected, POSE_EPS),
          `writing to a returned point must not change the next ${label} answer`,
        );
      }
    },
  },
];

// ---------------------------------------------------------------------------
// TransformPort
// ---------------------------------------------------------------------------

/**
 * Advances a subject's physics simulation - a real engine step where a
 * platform's physics can run in a test, otherwise a fake that faithfully
 * reproduces the one behaviour these cases check: gravity moves the object
 * unless held, and a release velocity carries it.
 */
export interface TransformPortPhysicsDriver {
  step(dtSeconds: number): void;
}

/** The port under test, over one object. Build a FRESH one per case. */
export interface TransformPortContractSubject {
  port: TransformPort;
  /**
   * The world pose the object sat at when the port captured its rest. Place
   * it away from the origin and turned, under no parent or an unscaled one,
   * so a port that ignores its rest frame cannot pass by accident.
   */
  rest: PoseTuple;
  /**
   * Present only when the object has a physics body - the same condition
   * that gives the port `beginHold`/`endHold`. The held/released/reset
   * cases below skip without one, since there is nothing for them to check.
   */
  physics?: TransformPortPhysicsDriver;
}

/** One check a {@link TransformPort} implementation must pass. */
export interface TransformPortContractCase {
  name: string;
  run(subject: TransformPortContractSubject): void;
}

/**
 * The shared `TransformPort` conformance suite. An adapter's test file is a
 * loop, the same shape as {@link hitTesterContractCases}.
 */
export function transformPortContractCases(): readonly TransformPortContractCase[] {
  return TRANSFORM_PORT_CASES;
}

const POSE_EPS = 1e-3;
// A quarter turn about Y - a non-identity unit quaternion, so the case
// cannot pass by accident on a port that ignores its argument.
const QUARTER_TURN_Y: QuatTuple = [0, Math.SQRT1_2, 0, Math.SQRT1_2];

// ---------------------------------------------------------------------------
// Held / released / reset - the "held pose" rule, checked only when the
// subject carries a physics driver. One fixed step size and a looser
// position tolerance than POSE_EPS: real engines differ slightly in their
// integrator, and a held/reset case allows for up to one step of gravity
// (see PHYSICS_POSE_EPS's own comment), where the plain pose cases above
// never touch physics at all.
// ---------------------------------------------------------------------------

const PHYSICS_DT = 1 / 60;
const HELD_STEPS = 5;
/** metres/second - small enough that one step's drift is easy to read, large enough not to vanish into PHYSICS_POSE_EPS. */
const RELEASE_SPEED = 2;
/** metres/second - about 25x RELEASE_SPEED, so "kept the old velocity" and "one step of gravity" cannot be confused. */
const LARGE_PRIOR_SPEED = 50;
/**
 * 2 cm. One step of gravity at PHYSICS_DT droops roughly
 * `0.5 * 9.8 * PHYSICS_DT^2` ≈ 1.4 mm, well inside this; a full step of
 * LARGE_PRIOR_SPEED (≈ 0.83 m) or RELEASE_SPEED (≈ 33 mm) is well outside it.
 */
const PHYSICS_POSE_EPS = 0.02;

function assertPhysicsPoseClose(value: PoseTuple, expected: PoseTuple, label: string): void {
  assertVec3Close(value.position, expected.position, PHYSICS_POSE_EPS, `${label}.position`);
  assertQuatClose(value.quaternion, expected.quaternion, `${label}.quaternion`);
}

const TRANSFORM_PORT_CASES: readonly TransformPortContractCase[] = [
  {
    name: "setLocalOffset then getLocalOffset returns the same offset",
    run({ port }) {
      const offset: Vec3Tuple = [0.3, -0.1, 0.05];
      port.setLocalOffset(offset);
      assertVec3Close(port.getLocalOffset(), offset, POSE_EPS, "getLocalOffset()");
    },
  },
  {
    name: "getWorldPose returns finite numbers and a unit quaternion",
    run({ port }) {
      const pose = port.getWorldPose();
      for (const value of [...pose.position, ...pose.quaternion]) {
        assert(Number.isFinite(value), `getWorldPose() must return finite numbers, got ${value}`);
      }
      const length = quatLength(pose.quaternion);
      assert(
        closeTo(length, 1, POSE_EPS),
        `getWorldPose().quaternion must be a unit quaternion, length was ${length}`,
      );
    },
  },
  {
    name: "setLocalRotation with a unit quaternion does not throw",
    run({ port }) {
      try {
        port.setLocalRotation(QUARTER_TURN_Y);
      } catch (error) {
        throw new Error(`setLocalRotation(unit quaternion) must not throw, it threw: ${String(error)}`);
      }
    },
  },
  {
    name: "getRestWorldPose returns the pose captured at registration",
    run({ port, rest }) {
      assertPoseClose(port.getRestWorldPose(), rest, "getRestWorldPose()");
    },
  },
  {
    name: "before any write, the live pose is the rest pose",
    run({ port, rest }) {
      assertPoseClose(port.getWorldPose(), rest, "getWorldPose()");
    },
  },
  {
    name: "getWorldPose follows setLocalOffset while getRestWorldPose stays put",
    run({ port, rest }) {
      const offset: Vec3Tuple = [0.3, -0.1, 0.05];
      port.setLocalOffset(offset);
      assertVec3Close(
        port.getWorldPose().position,
        vAdd(rest.position, vApplyQuat(offset, rest.quaternion)),
        POSE_EPS,
        "getWorldPose().position after setLocalOffset",
      );
      assertPoseClose(port.getRestWorldPose(), rest, "getRestWorldPose() after setLocalOffset");
    },
  },
  {
    name: "getWorldPose follows setLocalRotation while getRestWorldPose stays put",
    run({ port, rest }) {
      port.setLocalRotation(QUARTER_TURN_Y);
      assertQuatClose(
        port.getWorldPose().quaternion,
        quatMultiply(rest.quaternion, QUARTER_TURN_Y),
        "getWorldPose().quaternion after setLocalRotation",
      );
      assertPoseClose(port.getRestWorldPose(), rest, "getRestWorldPose() after setLocalRotation");
    },
  },
  {
    name: "setWorldPose, when present, is what getWorldPose reads back",
    run({ port, rest }) {
      if (!port.setWorldPose) return;
      const target: PoseTuple = { position: [0.5, 1.2, -0.4], quaternion: QUARTER_TURN_Y };
      port.setWorldPose(target);
      assertPoseClose(port.getWorldPose(), target, "getWorldPose() after setWorldPose");
      assertPoseClose(port.getRestWorldPose(), rest, "getRestWorldPose() after setWorldPose");
    },
  },
  {
    name: "every returned tuple is a fresh value the caller owns",
    run({ port }) {
      const pose = port.getWorldPose();
      const restPose = port.getRestWorldPose();
      const offset = port.getLocalOffset();
      pose.position[0] = 1e6;
      pose.quaternion[3] = 1e6;
      restPose.position[0] = 1e6;
      offset[0] = 1e6;
      assert(port.getWorldPose().position[0] !== 1e6, "writing to a returned getWorldPose() tuple must not change the port");
      assert(port.getWorldPose().quaternion[3] !== 1e6, "writing to a returned getWorldPose() quaternion must not change the port");
      assert(port.getRestWorldPose().position[0] !== 1e6, "writing to a returned getRestWorldPose() tuple must not change the port");
      assert(port.getLocalOffset()[0] !== 1e6, "writing to a returned getLocalOffset() tuple must not change the port");
    },
  },
  {
    name: "a tuple passed in is not kept",
    run({ port }) {
      const offset: Vec3Tuple = [0.3, -0.1, 0.05];
      port.setLocalOffset(offset);
      offset[0] = 9;
      assertVec3Close(port.getLocalOffset(), [0.3, -0.1, 0.05], POSE_EPS, "getLocalOffset() after the caller reused its tuple");
      if (!port.setWorldPose) return;
      const target: PoseTuple = { position: [0.5, 1.2, -0.4], quaternion: [0, 0, 0, 1] };
      port.setWorldPose(target);
      target.position[0] = 9;
      assertVec3Close(port.getWorldPose().position, [0.5, 1.2, -0.4], POSE_EPS, "getWorldPose() after the caller reused its tuple");
    },
  },
  {
    name: "setEffect, when present, accepts scale and emissive without throwing",
    run({ port }) {
      if (!port.setEffect) return;
      try {
        port.setEffect({ scale: 1.2, emissive: 0.3 });
      } catch (error) {
        throw new Error(`setEffect({ scale, emissive }) must not throw, it threw: ${String(error)}`);
      }
    },
  },
  {
    name: "Held: beginHold holds a fixed setWorldPose without falling, when the subject has physics",
    run({ port, rest, physics }) {
      if (!physics || !port.setWorldPose || !port.beginHold) return;
      const held: PoseTuple = {
        position: [rest.position[0], rest.position[1] + 1, rest.position[2]],
        quaternion: rest.quaternion,
      };
      port.beginHold();
      for (let i = 0; i < HELD_STEPS; i++) {
        port.setWorldPose(held);
        physics.step(PHYSICS_DT);
      }
      // A tight tolerance, not PHYSICS_POSE_EPS: a genuinely held body sees
      // no simulation at all, so it matches the written pose exactly bar
      // floating point noise - the same POSE_EPS the non-physics cases
      // above use. One step of unwanted gravity (~2.7 mm at PHYSICS_DT) is
      // what this case exists to catch, and it must not hide inside the
      // tolerance the way it deliberately may in the Reset case below.
      assertPoseClose(port.getWorldPose(), held, `getWorldPose() after ${HELD_STEPS} held steps`);
    },
  },
  {
    name: "Released: endHold sends the body away with the release velocity, when the subject has physics",
    run({ port, rest, physics }) {
      if (!physics || !port.beginHold || !port.endHold) return;
      port.beginHold();
      const release: HoldRelease = { linearVelocity: [RELEASE_SPEED, 0, 0], angularVelocity: [0, 0, 0] };
      port.endHold(release);
      physics.step(PHYSICS_DT);
      const moved = port.getWorldPose().position[0] - rest.position[0];
      assert(
        moved > RELEASE_SPEED * PHYSICS_DT * 0.5,
        `endHold({ linearVelocity: [${RELEASE_SPEED}, 0, 0] }) must move the body that way within one step, moved ${moved}`,
      );
    },
  },
  {
    name: "Reset: setWorldPose while not held teleports to the pose and clears velocity, when the subject has physics",
    run({ port, rest, physics }) {
      if (!physics || !port.setWorldPose || !port.beginHold || !port.endHold) return;
      // Give the body a large prior velocity and let it run for a step, so
      // carrying that velocity through the reset below is unmistakable -
      // one step of it (~0.83 m) dwarfs PHYSICS_POSE_EPS (2 cm).
      port.beginHold();
      const priorRelease: HoldRelease = { linearVelocity: [LARGE_PRIOR_SPEED, 0, 0], angularVelocity: [0, 0, 0] };
      port.endHold(priorRelease);
      physics.step(PHYSICS_DT);
      const target: PoseTuple = {
        position: [rest.position[0] - 1, rest.position[1] + 2, rest.position[2] + 0.5],
        quaternion: rest.quaternion,
      };
      port.setWorldPose(target);
      // One further step: it must be at `target`, not carrying the prior
      // velocity forward - allowing for this one step's worth of gravity.
      physics.step(PHYSICS_DT);
      assertPhysicsPoseClose(port.getWorldPose(), target, "getWorldPose() one step after a reset setWorldPose");
    },
  },
];

// ---------------------------------------------------------------------------
// Shared assertion helpers
// ---------------------------------------------------------------------------

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function closeTo(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

// Indexed one component at a time, rather than in a loop, so each index is a
// literal: `noUncheckedIndexedAccess` cannot narrow a tuple read through a
// variable index back to `number`.
function assertVec3Close(value: Vec3Tuple, expected: Vec3Tuple, eps: number, label: string): void {
  assert(closeTo(value[0], expected[0], eps), `${label}[0] must be close to ${expected[0]}, got ${value[0]}`);
  assert(closeTo(value[1], expected[1], eps), `${label}[1] must be close to ${expected[1]}, got ${value[1]}`);
  assert(closeTo(value[2], expected[2], eps), `${label}[2] must be close to ${expected[2]}, got ${value[2]}`);
}

// q and -q are the same rotation, so compare by the size of the dot product.
function assertQuatClose(value: QuatTuple, expected: QuatTuple, label: string): void {
  const dot = value[0] * expected[0] + value[1] * expected[1] + value[2] * expected[2] + value[3] * expected[3];
  assert(
    closeTo(Math.abs(dot), 1, POSE_EPS),
    `${label} must be close to [${expected.join(", ")}], got [${value.join(", ")}]`,
  );
}

function assertPoseClose(value: PoseTuple, expected: PoseTuple, label: string): void {
  assertVec3Close(value.position, expected.position, POSE_EPS, `${label}.position`);
  assertQuatClose(value.quaternion, expected.quaternion, `${label}.quaternion`);
}

function quatLength(q: QuatTuple): number {
  return Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
}
