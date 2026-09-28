/**
 * The three.js physics facility over the REAL Rapier engine
 * (`@dimforge/rapier3d-compat`, the platform's default): the shared
 * `physicsFacilityContractCases()` suite, the transform port's held-pose
 * rule through it (`transformPortContractCases()` with the facility as the
 * physics driver), and the setup's default and override.
 */
import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Group, Mesh, Object3D, PerspectiveCamera, SphereGeometry } from "three";
import {
  MemoryPhysicsFacility,
  physicsFacilityContractCases,
  transformPortContractCases,
  type PoseTuple,
  type TransformPortContractSubject,
} from "@realitycollective/webxr-interactions";
import { RapierPhysicsFacility, ThreeTransformPort, createThreeInteractions } from "@realitycollective/threejs-interactions";

beforeAll(async () => {
  await RAPIER.init();
});

const REST: PoseTuple = { position: [1, 2, -3], quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };

function xrStub() {
  return { getSession: () => null, getReferenceSpace: () => null, getFrame: () => null } as never;
}

describe("RapierPhysicsFacility", () => {
  for (const contractCase of physicsFacilityContractCases()) {
    it(contractCase.name, () => {
      contractCase.run({ facility: new RapierPhysicsFacility(RAPIER) });
    });
  }

  it("derives an auto shape from the object's bounds, a bare group as a 10 cm sphere, and needs an object for it", () => {
    const objects = new Map<string, Object3D>();
    const facility = new RapierPhysicsFacility(RAPIER, { objectFor: (id) => objects.get(id) });
    const mesh = new Mesh(new SphereGeometry(0.2, 8, 8));
    mesh.position.set(0, 1, 0);
    objects.set("ball", mesh);
    facility.addBody("floor", { position: [0, -0.05, 0], quaternion: [0, 0, 0, 1] }, { state: "static" }, { kind: "box", dimensions: [20, 0.1, 20] });
    facility.addBody("ball", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] });
    for (let i = 0; i < 180; i++) facility.step(1 / 60);
    // A 0.4 m box rests with its centre 0.2 m up, and the object follows the body.
    expect(facility.getBodyPose("ball").position[1]).toBeCloseTo(0.2, 1);
    expect(mesh.position.y).toBeCloseTo(0.2, 1);
    objects.set("bare", new Group());
    facility.addBody("bare", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] });
    expect(facility.hasBody("bare")).toBe(true);
    expect(() => facility.addBody("ghost", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] })).toThrow(/needs its scene object/);
    facility.addBody("pill", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] }, {}, { kind: "capsule", dimensions: [0.1, 0.5, 0] });
    expect(facility.hasBody("pill")).toBe(true);
    facility.dispose();
  });

  it("writes a body's pose into an object under a turned parent", () => {
    const objects = new Map<string, Object3D>();
    const facility = new RapierPhysicsFacility(RAPIER, { objectFor: (id) => objects.get(id) });
    const parent = new Group();
    parent.position.set(0, 0, 5);
    parent.quaternion.set(0, Math.SQRT1_2, 0, Math.SQRT1_2);
    const child = new Object3D();
    parent.add(child);
    objects.set("child", child);
    facility.addBody("child", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] }, { gravityFactor: 0 }, { kind: "sphere", dimensions: [0.1, 0, 0] });
    facility.setBodyPose("child", { position: [1, 1, 5], quaternion: [0, 0, 0, 1] });
    child.getWorldPosition(new Object3D().position);
    parent.updateWorldMatrix(true, true);
    const world = child.getWorldPosition(new Object3D().position);
    expect(world.x).toBeCloseTo(1, 5);
    expect(world.y).toBeCloseTo(1, 5);
    expect(world.z).toBeCloseTo(5, 5);
    facility.step(0);
    facility.dispose();
  });
});

describe("ThreeTransformPort over the facility", () => {
  function subject(): TransformPortContractSubject {
    const object = new Object3D();
    const facility = new RapierPhysicsFacility(RAPIER, { objectFor: () => object });
    object.position.set(...REST.position);
    object.quaternion.set(...REST.quaternion);
    facility.addBody("obj", REST, {}, { kind: "sphere", dimensions: [0.1, 0, 0] });
    const port = new ThreeTransformPort(object, { physics: { facility, bodyId: "obj" } });
    return { port, rest: REST, physics: { step: (dt) => facility.step(dt) } };
  }

  for (const contractCase of transformPortContractCases()) {
    it(contractCase.name, () => contractCase.run(subject()));
  }
});

describe("createThreeInteractions physics", () => {
  const camera = new PerspectiveCamera();

  it("builds the Rapier facility as the default engine, gives a registered object a body and steps it", () => {
    const setup = createThreeInteractions({ xr: xrStub(), camera, physics: { rapier: RAPIER } });
    expect(setup.physics).toBeInstanceOf(RapierPhysicsFacility);
    expect(setup.physics?.engine).toBe("rapier");
    const ball = new Object3D();
    ball.position.set(0, 1, 0);
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
    const setup = createThreeInteractions({ xr: xrStub(), camera, physics: own, stepPhysics: false });
    expect(setup.physics).toBe(own);
    const ball = new Object3D();
    ball.position.set(0, 1, 0);
    setup.register({ id: "ball", behaviours: [] }, ball, { body: { gravityFactor: 1 }, shape: { kind: "sphere", dimensions: [0.1, 0, 0] } });
    for (let i = 0; i < 30; i++) setup.update(1 / 60);
    expect(own.getBodyPose("ball").position[1]).toBe(1);
    setup.dispose();
  });

  it("refuses a body when the setup has no physics, and registers plainly without one", () => {
    const setup = createThreeInteractions({ xr: xrStub(), camera });
    expect(setup.physics).toBeNull();
    const port = setup.register({ id: "plain", behaviours: [] }, new Object3D());
    expect(port.beginHold).toBeUndefined();
    expect(() => setup.register({ id: "ball", behaviours: [] }, new Object3D(), { body: {} })).toThrow(/no physics/);
    setup.update(1 / 60);
    setup.dispose();
  });
});
