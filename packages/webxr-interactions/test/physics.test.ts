/**
 * The physics contract (`src/physics.ts`), the in-memory reference facility,
 * and the shipped `physicsFacilityContractCases()` suite: every case passes
 * on the reference, and each FAILS a facility with the defect it exists for.
 */
import { describe, expect, it } from "vitest";
import type { PoseTuple } from "@realitycollective/webxr-input";
import {
  MemoryPhysicsFacility,
  PHYSICS_DEFAULTS,
  missingBody,
  physicsFacilityContractCases,
  resolvePhysicsBody,
  resolvePhysicsShape,
  type PhysicsBodySpec,
  type PhysicsBodyState,
  type PhysicsFacility,
  type PhysicsShapeSpec,
  type PhysicsVelocity,
} from "../src/index.js";

describe("physics defaults", () => {
  it("are IWSDK 1.0.0's", () => {
    expect(PHYSICS_DEFAULTS.gravity).toEqual([0, -9.81, 0]);
    expect(PHYSICS_DEFAULTS.stepHz).toBe(60);
    expect(PHYSICS_DEFAULTS.interpolation).toBe(true);
    expect(resolvePhysicsBody()).toEqual({ state: "dynamic", linearDamping: 0, angularDamping: 0, gravityFactor: 1 });
    expect(resolvePhysicsShape()).toEqual({ kind: "auto", dimensions: [0, 0, 0], density: 1, restitution: 0, friction: 0.5 });
    expect(resolvePhysicsBody({ state: "static", gravityFactor: 0 }).state).toBe("static");
    expect(resolvePhysicsShape({ kind: "sphere", dimensions: [0.1, 0, 0], restitution: 0.5 }).restitution).toBe(0.5);
  });

  it("rejects nonsense", () => {
    expect(() => resolvePhysicsBody({ linearDamping: -1 })).toThrow(/damping/);
    expect(() => resolvePhysicsShape({ density: 0 })).toThrow(/density/);
    expect(() => resolvePhysicsShape({ restitution: 2 })).toThrow(/restitution/);
    expect(() => resolvePhysicsShape({ friction: -1 })).toThrow(/friction/);
    expect(missingBody("x").message).toContain('no physics body "x"');
  });
});

describe("MemoryPhysicsFacility", () => {
  for (const contractCase of physicsFacilityContractCases()) {
    it(contractCase.name, () => {
      expect(() => contractCase.run({ facility: new MemoryPhysicsFacility() })).not.toThrow();
    });
  }

  it("damps velocity, turns a spinning body, and leaves a state change on a resting body", () => {
    const facility = new MemoryPhysicsFacility();
    facility.addBody("puck", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] }, { gravityFactor: 0, linearDamping: 10, angularDamping: 10 }, { kind: "sphere", dimensions: [0.1, 0, 0] });
    facility.setVelocity("puck", { linear: [1, 0, 0], angular: [0, 1, 0] });
    facility.step(1 / 60);
    expect(facility.getVelocity("puck").linear[0]).toBeLessThan(1);
    expect(facility.getBodyPose("puck").quaternion[1]).not.toBe(0);
    facility.step(0);
    facility.setBodyState("puck", "static");
    expect(facility.getVelocity("puck").linear).toEqual([0, 0, 0]);
    // A sphere beside a box, not touching it, is left alone.
    facility.addBody("box", { position: [5, 1, 0], quaternion: [0, 0, 0, 1] }, { state: "static" }, { kind: "box", dimensions: [1, 1, 1] });
    facility.setBodyState("puck", "dynamic");
    facility.step(1 / 60);
    expect(facility.getBodyPose("puck").position[0]).toBeLessThan(2);
    // A sphere next to a dynamic box passes through: sphere-to-box is against static or kinematic boxes only.
    facility.addBody("crate", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] }, {}, { kind: "box", dimensions: [1, 1, 1] });
    facility.step(1 / 60);
    expect(facility.hasBody("crate")).toBe(true);
    expect(facility.engine).toBe("memory");
  });
});

// ---------------------------------------------------------------------------
// Each case fails a facility with the defect it exists for.
// ---------------------------------------------------------------------------

interface Defects {
  noGravity?: boolean;
  wrongGravity?: boolean;
  deadRestitution?: boolean;
  alwaysBouncy?: boolean;
  suspendIgnored?: boolean;
  resumeKeepsHold?: boolean;
  teleportKeepsVelocity?: boolean;
  sharedTuples?: boolean;
  removeIgnored?: boolean;
  missingBodySilent?: boolean;
  defaultKinematic?: boolean;
  setGravityIgnored?: boolean;
  disposeKeepsBodies?: boolean;
  staticFalls?: boolean;
  noEngineName?: boolean;
  gravityFactorIgnored?: boolean;
}

class Defective extends MemoryPhysicsFacility {
  override readonly engine: string;
  constructor(private readonly defects: Defects) {
    super();
    this.engine = defects.noEngineName ? "" : "defective";
    if (defects.wrongGravity) super.setGravity([0, -1, 0]);
    if (defects.noGravity) super.setGravity([0, 0, 0]);
  }

  override setGravity(gravity: [number, number, number]): void {
    if (this.defects.setGravityIgnored) return;
    super.setGravity(gravity);
  }

  override addBody(id: string, pose: PoseTuple, body: PhysicsBodySpec = {}, shape: PhysicsShapeSpec = {}): void {
    const bodySpec = { ...body };
    const shapeSpec = { ...shape };
    if (this.defects.defaultKinematic && !bodySpec.state) bodySpec.state = "kinematic";
    if (this.defects.staticFalls && bodySpec.state === "static") bodySpec.state = "dynamic";
    if (this.defects.deadRestitution) shapeSpec.restitution = 0;
    if (this.defects.alwaysBouncy) shapeSpec.restitution = 1;
    if (this.defects.gravityFactorIgnored) delete bodySpec.gravityFactor;
    super.addBody(id, pose, bodySpec, shapeSpec);
  }

  override removeBody(id: string): void {
    if (this.defects.removeIgnored) return;
    super.removeBody(id);
  }

  override getBodyPose(id: string): PoseTuple {
    if (this.defects.missingBodySilent && !this.hasBody(id)) return { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
    return super.getBodyPose(id);
  }

  override suspend(id: string): void {
    if (this.defects.suspendIgnored) return;
    super.suspend(id);
  }

  override resume(id: string, release: { linearVelocity: [number, number, number]; angularVelocity: [number, number, number] }): void {
    if (this.defects.resumeKeepsHold) return;
    super.resume(id, release);
  }

  override setBodyPose(id: string, pose: PoseTuple): void {
    if (this.defects.teleportKeepsVelocity) {
      const velocity = this.getVelocity(id);
      super.setBodyPose(id, pose);
      super.setVelocity(id, velocity);
      return;
    }
    super.setBodyPose(id, pose);
  }

  private sharedVelocity: PhysicsVelocity | null = null;

  override getVelocity(id: string): PhysicsVelocity {
    if (!this.defects.sharedTuples) return super.getVelocity(id);
    this.sharedVelocity ??= super.getVelocity(id);
    return this.sharedVelocity;
  }

  override getBodyState(id: string): PhysicsBodyState {
    return super.getBodyState(id);
  }

  override dispose(): void {
    if (this.defects.disposeKeepsBodies) return;
    super.dispose();
  }
}

describe("physicsFacilityContractCases fail a defective facility", () => {
  const defects: Array<[string, Defects, string]> = [
    ["no gravity", { noGravity: true }, "gravity must start at"],
    ["the wrong gravity", { wrongGravity: true }, "gravity must start at"],
    ["a static body that falls", { staticFalls: true }, "static body"],
    ["restitution ignored (dead)", { deadRestitution: true }, "must bounce"],
    ["restitution ignored (always bouncy)", { alwaysBouncy: true }, "must not bounce"],
    ["suspend ignored", { suspendIgnored: true }, "isSuspended reports the hold"],
    ["resume ignored", { resumeKeepsHold: true }, "resume ends the hold"],
    ["a teleport that keeps velocity", { teleportKeepsVelocity: true }, "not carrying its old velocity"],
    ["shared tuples", { sharedTuples: true }, "own copy"],
    ["removeBody ignored", { removeIgnored: true }, "removed body must be gone"],
    ["a silent missing body", { missingBodySilent: true }, "no physics body"],
    ["a kinematic default state", { defaultKinematic: true }, "must be dynamic"],
    ["setGravity ignored", { setGravityIgnored: true }, "setGravity reads back"],
    ["dispose keeping bodies", { disposeKeepsBodies: true }, "dispose must remove"],
    ["no engine name", { noEngineName: true }, "name its engine"],
    ["gravity factor ignored", { gravityFactorIgnored: true }, "gravity factor 0 floats"],
  ];
  for (const [label, config, expectedMessage] of defects) {
    it(`fails a facility with ${label}`, () => {
      const failures = physicsFacilityContractCases()
        .map((contractCase) => {
          try {
            contractCase.run({ facility: new Defective(config) as PhysicsFacility });
            return null;
          } catch (error) {
            return (error as Error).message;
          }
        })
        .filter((message): message is string => message !== null);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.join("\n")).toContain(expectedMessage);
    });
  }
});
