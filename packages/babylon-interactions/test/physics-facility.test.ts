/**
 * The Babylon physics facility over a fake Havok-era Physics V2 kit (see
 * `createFakeHavok` in `helpers.ts`, backed by the core's own
 * `MemoryPhysicsFacility`): the shared `physicsFacilityContractCases()`
 * suite, the transform port's held-pose rule through it
 * (`transformPortContractCases()` with the facility as the physics driver),
 * and `createBabylonInteractions`'s default engine, app override, register
 * wiring and error.
 */
import { describe, expect, it } from "vitest";
import {
  BabylonPhysicsFacility,
  BabylonTransformPort,
  MemoryPhysicsFacility,
  createBabylonInteractions,
  physicsFacilityContractCases,
  transformPortContractCases,
  type BabylonSceneLike,
  type PoseTuple,
  type TransformPortContractSubject,
} from "@realitycollective/babylon-interactions";
import { FakeNode, FakeScene, createFakeHavok } from "./helpers.js";

/** Every body id any `physicsFacilityContractCases()` case touches. */
const CONTRACT_BODY_IDS = ["floor", "ball", "wall", "lift", "stone"];

function contractFacility(): { facility: BabylonPhysicsFacility; env: ReturnType<typeof createFakeHavok> } {
  const env = createFakeHavok();
  for (const id of CONTRACT_BODY_IDS) {
    env.place(id, new FakeNode({ position: [0, 0, 0], rotationQuaternion: [0, 0, 0, 1] }));
  }
  const facility = new BabylonPhysicsFacility(env.scene, env.kit, { nodeFor: env.nodeFor });
  return { facility, env };
}

describe("BabylonPhysicsFacility", () => {
  for (const contractCase of physicsFacilityContractCases()) {
    it(contractCase.name, () => {
      const { facility } = contractFacility();
      contractCase.run({ facility });
    });
  }

  it("names its engine havok", () => {
    const { facility } = contractFacility();
    expect(facility.engine).toBe("havok");
  });

  it("throws a clear error for a body id with no registered node", () => {
    const env = createFakeHavok();
    const facility = new BabylonPhysicsFacility(env.scene, env.kit, { nodeFor: env.nodeFor });
    expect(() =>
      facility.addBody("ghost", { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }),
    ).toThrow(/no node for physics body "ghost"/);
  });

  it("derives an auto shape from the node's own geometry, and a 10 cm sphere for a node with none", () => {
    const env = createFakeHavok();
    const mesh = new FakeNode({ position: [0, 1, 0], rotationQuaternion: [0, 0, 0, 1] }) as unknown as {
      getTotalVertices(): number;
    } & FakeNode;
    mesh.getTotalVertices = () => 24;
    env.place("mesh-node", mesh);
    const facility = new BabylonPhysicsFacility(env.scene, env.kit, { nodeFor: env.nodeFor });

    facility.addBody("mesh-node", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] });
    const meshShape = env.lastBody()?.shape as unknown as { kind: string; dimensions: number[] } | undefined;
    expect(meshShape?.kind).toBe("mesh");

    // A bare node - `getTotalVertices` absent entirely - falls back to a small sphere.
    const bareNode = { position: { x: 0, y: 1, z: 0 }, getAbsolutePosition: () => ({ x: 0, y: 1, z: 0 }) };
    env.place("bare-node", bareNode as unknown as FakeNode);
    facility.addBody("bare-node", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] });
    const bareShape = env.lastBody()?.shape as unknown as { kind: string; dimensions: number[] } | undefined;
    expect(bareShape?.kind).toBe("sphere");
    expect(bareShape?.dimensions[0]).toBeCloseTo(0.1);
    // No computeWorldMatrix, no rotationQuaternion on this node: getBodyPose
    // must still work, creating a rotationQuaternion and reading position.
    expect(facility.getBodyPose("bare-node").position).toEqual([0, 1, 0]);
    facility.dispose();
  });

  it("derives a capsule's two hemisphere points from its radius and height", () => {
    const env = createFakeHavok();
    env.place("pill", new FakeNode({ position: [0, 1, 0], rotationQuaternion: [0, 0, 0, 1] }));
    const facility = new BabylonPhysicsFacility(env.scene, env.kit, { nodeFor: env.nodeFor });
    facility.addBody("pill", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] }, {}, { kind: "capsule", dimensions: [0.2, 1, 0] });
    const shape = env.lastBody()?.shape as unknown as { kind: string; dimensions: number[] } | undefined;
    expect(shape?.kind).toBe("capsule");
    // Reconstructed from the two points: radius 0.2, total height 1.
    expect(shape?.dimensions[0]).toBeCloseTo(0.2);
    expect(shape?.dimensions[1]).toBeCloseTo(1);
    facility.dispose();
  });

  it("places a node through its parent's frame, as BabylonTransformPort.setWorldPose does", () => {
    const env = createFakeHavok();
    const parent = new FakeNode({ absolutePosition: [0, 0, 5], absoluteRotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] });
    const child = new FakeNode({ position: [0, 0, 0], rotationQuaternion: [0, 0, 0, 1], parent });
    env.place("child", child);
    const facility = new BabylonPhysicsFacility(env.scene, env.kit, { nodeFor: env.nodeFor });
    facility.addBody("child", { position: [1, 1, 5], quaternion: [0, 0, 0, 1] }, { gravityFactor: 0 }, { kind: "sphere", dimensions: [0.1, 0, 0] });
    // A 90 degree turned parent 5 m down +Z: world (1,1,5) resolves to local (0,1,1).
    expect(child.position.x).toBeCloseTo(0, 5);
    expect(child.position.y).toBeCloseTo(1, 5);
    expect(child.position.z).toBeCloseTo(1, 5);
    facility.dispose();
  });

  it("falls back to the core's default gravity, held locally, and steps do nothing without a physics engine", () => {
    const env = createFakeHavok();
    env.place("ball", new FakeNode({ position: [0, 1, 0], rotationQuaternion: [0, 0, 0, 1] }));
    const facility = new BabylonPhysicsFacility(env.scene, env.kit, { nodeFor: env.nodeFor });
    facility.addBody("ball", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] }, {}, { kind: "sphere", dimensions: [0.1, 0, 0] });
    env.removeEngine();

    expect(facility.getGravity()).toEqual([0, -9.81, 0]);
    facility.setGravity([0, -1, 0]);
    expect(facility.getGravity()).toEqual([0, -1, 0]);

    expect(() => facility.step(1 / 60)).not.toThrow();
    expect(facility.getBodyPose("ball").position).toEqual([0, 1, 0]);
    facility.dispose();
  });

  it("does nothing on a scene whose getPhysicsEngine method is absent entirely", () => {
    const bareScene = new FakeScene() as unknown as { getPhysicsEngine?: () => null };
    delete bareScene.getPhysicsEngine;
    const env = createFakeHavok();
    env.place("ball", new FakeNode({ position: [0, 1, 0], rotationQuaternion: [0, 0, 0, 1] }));
    const facility = new BabylonPhysicsFacility(bareScene as unknown as BabylonSceneLike, env.kit, { nodeFor: env.nodeFor });
    expect(facility.getGravity()).toEqual([0, -9.81, 0]);
    expect(() => facility.step(1 / 60)).not.toThrow();
  });

  it("step(0) and a negative step never reach the physics engine", () => {
    const { facility, env } = contractFacility();
    facility.addBody("ball", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] }, {}, { kind: "sphere", dimensions: [0.1, 0, 0] });
    facility.step(0);
    facility.step(-1);
    expect(env.engine.stepCalls).toBe(0);
    expect(facility.getBodyPose("ball").position).toEqual([0, 1, 0]);
    facility.step(1 / 60);
    expect(env.engine.stepCalls).toBe(1);
    facility.dispose();
  });
});

describe("BabylonTransformPort over the facility", () => {
  const REST: PoseTuple = { position: [1, 2, -3], quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };

  function subject(): TransformPortContractSubject {
    const env = createFakeHavok();
    const node = new FakeNode({ position: REST.position, rotationQuaternion: REST.quaternion });
    env.place("obj", node);
    const facility = new BabylonPhysicsFacility(env.scene, env.kit, { nodeFor: env.nodeFor });
    facility.addBody("obj", REST, {}, { kind: "sphere", dimensions: [0.1, 0, 0] });
    const port = new BabylonTransformPort(node, { physics: { facility, bodyId: "obj" } });
    return { port, rest: REST, physics: { step: (dt) => facility.step(dt) } };
  }

  for (const contractCase of transformPortContractCases()) {
    it(contractCase.name, () => contractCase.run(subject()));
  }
});

describe("createBabylonInteractions physics", () => {
  it("builds the Havok facility as the default engine, gives a registered node a body and steps it", () => {
    const env = createFakeHavok();
    const setup = createBabylonInteractions({ scene: env.scene, physics: { kit: env.kit } });
    expect(setup.physics).toBeInstanceOf(BabylonPhysicsFacility);
    expect(setup.physics?.engine).toBe("havok");
    const ball = new FakeNode({ position: [0, 1, 0], rotationQuaternion: [0, 0, 0, 1] });
    const port = setup.register({ id: "ball", behaviours: [{ kind: "grab" }] }, ball, { shape: { kind: "sphere", dimensions: [0.1, 0, 0] } });
    expect(port.beginHold).toBeTypeOf("function");
    expect(setup.physics?.getBodyState("ball")).toBe("dynamic");
    for (let i = 0; i < 30; i++) setup.update(1 / 60);
    expect(ball.position.y).toBeLessThan(0.9);
    setup.unregister("ball");
    expect(setup.physics?.hasBody("ball")).toBe(false);
    setup.dispose();
  });

  it("takes an app's own facility in place of the default, and leaves stepping to the app when asked", () => {
    const own = new MemoryPhysicsFacility();
    const scene = new FakeScene();
    const setup = createBabylonInteractions({ scene, physics: own, stepPhysics: false });
    expect(setup.physics).toBe(own);
    const ball = new FakeNode({ position: [0, 1, 0], rotationQuaternion: [0, 0, 0, 1] });
    setup.register({ id: "ball", behaviours: [] }, ball, { body: { gravityFactor: 1 }, shape: { kind: "sphere", dimensions: [0.1, 0, 0] } });
    for (let i = 0; i < 30; i++) setup.update(1 / 60);
    expect(own.getBodyPose("ball").position[1]).toBe(1);
    setup.dispose();
  });

  it("refuses a body when the setup has no physics, and registers plainly without one", () => {
    const scene = new FakeScene();
    const setup = createBabylonInteractions({ scene });
    expect(setup.physics).toBeNull();
    const port = setup.register({ id: "plain", behaviours: [] }, new FakeNode());
    expect(port.beginHold).toBeUndefined();
    expect(() => setup.register({ id: "ball", behaviours: [] }, new FakeNode(), { body: {} })).toThrow(/no physics/);
    setup.update(1 / 60);
    setup.dispose();
  });
});
