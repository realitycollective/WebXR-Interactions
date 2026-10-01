/**
 * The shared `PhysicsFacility` conformance suite: what every platform's
 * physics must do with the core's defaults (`physics.ts`). Runner-free, like
 * the other suites; a binding's test file loops over the cases with a
 * factory that builds a FRESH facility per case:
 *
 * ```ts
 * for (const contractCase of physicsFacilityContractCases()) {
 *   it(contractCase.name, () => contractCase.run({ facility: makeFacility() }));
 * }
 * ```
 *
 * The scene every case builds is a static box floor whose top is at y = 0
 * and a 10 cm sphere dropped from 1 m. Tolerances allow for the different
 * integrators and contact solvers of real engines (Havok, Rapier, Jolt,
 * RealityKit): a rest is within 2 cm of the surface with under 5 cm/s of
 * motion, a bounce is a clear upward velocity, and a hold is exact to 1 mm.
 */
import type { PoseTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import { PHYSICS_DEFAULTS, type PhysicsFacility } from "./physics.js";

/** The facility under test. Build a FRESH one per case. */
export interface PhysicsFacilityContractSubject {
  facility: PhysicsFacility;
}

/** One check a {@link PhysicsFacility} implementation must pass. */
export interface PhysicsFacilityContractCase {
  name: string;
  run(subject: PhysicsFacilityContractSubject): void;
}

export function physicsFacilityContractCases(): readonly PhysicsFacilityContractCase[] {
  return PHYSICS_CASES;
}

const DT = 1 / PHYSICS_DEFAULTS.stepHz;
const BALL_RADIUS = 0.1;
const DROP_HEIGHT = 1;
/** Steps in three seconds: enough for a 1 m drop to land and settle on every engine. */
const SETTLE_STEPS = 180;
const IDENTITY: PoseTuple["quaternion"] = [0, 0, 0, 1];
const REST_EPS = 0.02;
const REST_SPEED = 0.05;
const HOLD_EPS = 1e-3;

function pose(x: number, y: number, z: number): PoseTuple {
  return { position: [x, y, z], quaternion: [...IDENTITY] as PoseTuple["quaternion"] };
}

/** A static box floor, 20 m square and 0.1 m thick, whose top face is y = 0. */
function floor(facility: PhysicsFacility): void {
  facility.addBody("floor", pose(0, -0.05, 0), { state: "static" }, { kind: "box", dimensions: [20, 0.1, 20] });
}

function ball(facility: PhysicsFacility, restitution = 0, gravityFactor = 1): void {
  facility.addBody("ball", pose(0, DROP_HEIGHT, 0), { gravityFactor }, { kind: "sphere", dimensions: [BALL_RADIUS, 0, 0], restitution });
}

function steps(facility: PhysicsFacility, count: number): void {
  for (let i = 0; i < count; i++) facility.step(DT);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function close(a: Readonly<Vec3Tuple>, b: Readonly<Vec3Tuple>, eps: number): boolean {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;
}

function speed(v: Vec3Tuple): number {
  return Math.hypot(v[0], v[1], v[2]);
}

const PHYSICS_CASES: readonly PhysicsFacilityContractCase[] = [
  {
    name: "starts with IWSDK's gravity, and a body added with no spec is dynamic until removed",
    run({ facility }) {
      assert(close(facility.getGravity(), PHYSICS_DEFAULTS.gravity, 1e-6), `gravity must start at ${JSON.stringify(PHYSICS_DEFAULTS.gravity)}, got ${JSON.stringify(facility.getGravity())}`);
      assert(typeof facility.engine === "string" && facility.engine.length > 0, "the facility must name its engine");
      facility.addBody("ball", pose(0, 1, 0), undefined, { kind: "sphere", dimensions: [BALL_RADIUS, 0, 0] });
      assert(facility.hasBody("ball"), "a body just added must be there");
      assert(facility.getBodyState("ball") === "dynamic", `a body with no spec must be dynamic, got ${facility.getBodyState("ball")}`);
      assert(facility.isSuspended("ball") === false, "a body just added is not suspended");
      const at = facility.getBodyPose("ball");
      assert(close(at.position, [0, 1, 0], 1e-6), `a body just added sits where it was added, got ${JSON.stringify(at.position)}`);
      facility.removeBody("ball");
      assert(!facility.hasBody("ball"), "a removed body must be gone");
      let threw = false;
      try {
        facility.getBodyPose("ball");
      } catch (error) {
        threw = /no physics body/.test((error as Error).message);
      }
      assert(threw, 'reading a missing body must throw an error naming it ("no physics body")');
      facility.removeBody("ball");
    },
  },
  {
    name: "a dynamic sphere falls under gravity and comes to rest on a static box",
    run({ facility }) {
      floor(facility);
      ball(facility);
      steps(facility, 30);
      const falling = facility.getBodyPose("ball").position[1];
      // Half a second of free fall drops about 1.2 m from rest; it has hit
      // the floor by now, or is well on its way: at most 0.5 m of the drop left.
      assert(falling < DROP_HEIGHT - 0.5, `after 0.5 s the ball must have fallen at least 0.5 m, it is at y = ${falling}`);
      steps(facility, SETTLE_STEPS - 30);
      const rest = facility.getBodyPose("ball").position;
      assert(Math.abs(rest[1] - BALL_RADIUS) <= REST_EPS, `the ball must rest on the floor at y = ${BALL_RADIUS} (2 cm), it is at y = ${rest[1]}`);
      assert(Math.abs(rest[0]) <= REST_EPS && Math.abs(rest[2]) <= REST_EPS, `the ball must not drift sideways, it is at ${JSON.stringify(rest)}`);
      assert(speed(facility.getVelocity("ball").linear) <= REST_SPEED, `a resting ball must be still, its speed is ${speed(facility.getVelocity("ball").linear)}`);
      const floorPose = facility.getBodyPose("floor");
      assert(close(floorPose.position, [0, -0.05, 0], 1e-3), "a static floor never moves");
    },
  },
  {
    name: "restitution bounces: a lively ball leaves the floor again, a dead one does not",
    run({ facility }) {
      floor(facility);
      ball(facility, 0.8);
      let landed = false;
      let bounced = false;
      for (let i = 0; i < SETTLE_STEPS && !bounced; i++) {
        facility.step(DT);
        const vy = facility.getVelocity("ball").linear[1];
        if (vy < -0.5) landed = true;
        if (landed && vy > 0.5) bounced = true;
      }
      assert(bounced, "a ball with restitution 0.8 dropped from 1 m must bounce back up at over 0.5 m/s");
      facility.removeBody("ball");
      ball(facility, 0);
      landed = false;
      let rose = 0;
      for (let i = 0; i < SETTLE_STEPS; i++) {
        facility.step(DT);
        const vy = facility.getVelocity("ball").linear[1];
        if (vy < -0.5) landed = true;
        if (landed && vy > rose) rose = vy;
      }
      assert(rose <= 0.3, `a ball with restitution 0 must not bounce, it rose at ${rose} m/s`);
    },
  },
  {
    name: "a static body never moves and a kinematic body moves only by pose writes",
    run({ facility }) {
      facility.addBody("wall", pose(0, 1, 0), { state: "static" }, { kind: "box", dimensions: [1, 1, 1] });
      facility.addBody("lift", pose(2, 1, 0), { state: "kinematic" }, { kind: "sphere", dimensions: [BALL_RADIUS, 0, 0] });
      steps(facility, 60);
      assert(close(facility.getBodyPose("wall").position, [0, 1, 0], HOLD_EPS), "a static body must not fall");
      assert(close(facility.getBodyPose("lift").position, [2, 1, 0], HOLD_EPS), "a kinematic body must not fall");
      assert(facility.getBodyState("lift") === "kinematic", "the state reads back as kinematic");
      facility.setBodyPose("lift", pose(2, 2, 0));
      steps(facility, 10);
      assert(close(facility.getBodyPose("lift").position, [2, 2, 0], HOLD_EPS), "a kinematic body follows a pose write and stays");
      facility.setBodyState("lift", "dynamic");
      steps(facility, 30);
      assert(facility.getBodyPose("lift").position[1] < 2 - 0.5, "once dynamic, the same body falls");
    },
  },
  {
    name: "suspend holds the body still and pose writes stick exactly, until resume",
    run({ facility }) {
      ball(facility);
      facility.suspend("ball");
      assert(facility.isSuspended("ball"), "isSuspended reports the hold");
      steps(facility, 30);
      assert(close(facility.getBodyPose("ball").position, [0, DROP_HEIGHT, 0], HOLD_EPS), `a suspended body must not fall, it is at ${JSON.stringify(facility.getBodyPose("ball").position)}`);
      facility.setBodyPose("ball", pose(0.5, 2, 0.25));
      steps(facility, 30);
      assert(close(facility.getBodyPose("ball").position, [0.5, 2, 0.25], HOLD_EPS), "a pose written to a suspended body sticks exactly");
      facility.suspend("ball");
      assert(facility.isSuspended("ball"), "suspending twice is still one hold");
      facility.resume("ball", { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] });
      assert(!facility.isSuspended("ball"), "resume ends the hold");
      assert(facility.getBodyState("ball") === "dynamic", "resume restores the state the body had");
      steps(facility, 30);
      assert(facility.getBodyPose("ball").position[1] < 2 - 0.5, "a resumed body falls again");
    },
  },
  {
    name: "resume with a release velocity throws the body, and with zeros lets it rest",
    run({ facility }) {
      ball(facility, 0, 0);
      facility.suspend("ball");
      facility.resume("ball", { linearVelocity: [2, 0, 0], angularVelocity: [0, 0, 0] });
      facility.step(DT);
      const moved = facility.getBodyPose("ball").position[0];
      assert(moved > 2 * DT * 0.5, `a release at 2 m/s must move the body that way within one step, moved ${moved}`);
      facility.resume("ball", { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] });
      const after = facility.getBodyPose("ball").position[0];
      facility.step(DT);
      assert(Math.abs(facility.getBodyPose("ball").position[0] - after) > 2 * DT * 0.5, "resuming a body that is not suspended changes nothing: it keeps flying");
      facility.suspend("ball");
      facility.resume("ball", { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] });
      const rest = facility.getBodyPose("ball").position;
      steps(facility, 10);
      assert(close(facility.getBodyPose("ball").position, rest, HOLD_EPS), "a zero release rests the body (no gravity here, gravity factor 0)");
    },
  },
  {
    name: "setBodyPose while not suspended teleports the body and clears its velocity",
    run({ facility }) {
      ball(facility);
      facility.setVelocity("ball", { linear: [50, 0, 0], angular: [0, 0, 0] });
      facility.step(DT);
      assert(facility.getBodyPose("ball").position[0] > 0.5, "a body given 50 m/s moves in one step");
      const target = pose(-1, 3, 0.5);
      facility.setBodyPose("ball", target);
      facility.step(DT);
      const at = facility.getBodyPose("ball").position;
      // One step of gravity from rest is about 1.4 mm; a kept velocity would be 0.83 m away.
      assert(close(at, target.position, REST_EPS), `a teleported body must be at the pose one step later, not carrying its old velocity; it is at ${JSON.stringify(at)}`);
      assert(speed(facility.getVelocity("ball").linear) < 1, "a teleport clears the velocity");
    },
  },
  {
    name: "setVelocity and getVelocity round-trip, and every tuple handed back is fresh",
    run({ facility }) {
      ball(facility, 0, 0);
      facility.setVelocity("ball", { linear: [1, 2, 3], angular: [0, 0.5, 0] });
      const read = facility.getVelocity("ball");
      assert(close(read.linear, [1, 2, 3], 1e-3) && close(read.angular, [0, 0.5, 0], 1e-3), `velocity must read back as set, got ${JSON.stringify(read)}`);
      read.linear[0] = 99;
      assert(facility.getVelocity("ball").linear[0] !== 99, "the tuple handed back must be the caller's own copy");
      const at = facility.getBodyPose("ball");
      at.position[0] = 99;
      assert(facility.getBodyPose("ball").position[0] !== 99, "the pose handed back must be the caller's own copy");
      const g = facility.getGravity();
      g[1] = 0;
      assert(facility.getGravity()[1] !== 0, "the gravity handed back must be the caller's own copy");
    },
  },
  {
    name: "gravity factor 0 floats, and setGravity changes the world for every dynamic body",
    run({ facility }) {
      ball(facility, 0, 0);
      steps(facility, 60);
      assert(close(facility.getBodyPose("ball").position, [0, DROP_HEIGHT, 0], HOLD_EPS), "a body with gravity factor 0 floats");
      facility.addBody("stone", pose(1, DROP_HEIGHT, 0), undefined, { kind: "sphere", dimensions: [BALL_RADIUS, 0, 0] });
      facility.setGravity([0, 0, 0]);
      assert(close(facility.getGravity(), [0, 0, 0], 1e-6), "setGravity reads back");
      steps(facility, 60);
      assert(close(facility.getBodyPose("stone").position, [1, DROP_HEIGHT, 0], HOLD_EPS), "with no gravity a dynamic body floats too");
      facility.setGravity([0, -9.81, 0]);
      steps(facility, 60);
      assert(facility.getBodyPose("stone").position[1] < DROP_HEIGHT - 0.5, "with gravity back it falls");
    },
  },
  {
    name: "dispose removes every body",
    run({ facility }) {
      floor(facility);
      ball(facility);
      facility.dispose();
      assert(!facility.hasBody("ball") && !facility.hasBody("floor"), "dispose must remove every body");
    },
  },
];
