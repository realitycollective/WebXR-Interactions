/**
 * XR Blocks physics: the platform's default engine is the Rapier it bundles,
 * driven through the same `RapierPhysicsFacility` the three.js binding
 * builds. Proved here against the REAL engine (`@dimforge/rapier3d-compat`):
 * the shared `physicsFacilityContractCases()` suite, the XR Blocks port's
 * held-pose rule through the facility, and the setup's default and override.
 */
import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, PerspectiveCamera } from "three";
import {
  MemoryPhysicsFacility,
  physicsFacilityContractCases,
  transformPortContractCases,
  type PoseTuple,
  type TransformPortContractSubject,
} from "@realitycollective/webxr-interactions";
import { RapierPhysicsFacility, XRBlocksTransformPort, connectXRBlocksInteractions } from "@realitycollective/xrblocks-interactions";

beforeAll(async () => {
  await RAPIER.init();
});

const REST: PoseTuple = { position: [1, 2, -3], quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };

function context() {
  return { input: { getFrame: () => ({ raySources: [], directTouches: [] }) }, camera: new PerspectiveCamera() };
}

describe("RapierPhysicsFacility on XR Blocks", () => {
  for (const contractCase of physicsFacilityContractCases()) {
    it(contractCase.name, () => {
      contractCase.run({ facility: new RapierPhysicsFacility(RAPIER) });
    });
  }
});

describe("XRBlocksTransformPort over the facility", () => {
  function subject(): TransformPortContractSubject {
    const object = new Object3D();
    object.position.set(...REST.position);
    object.quaternion.set(...REST.quaternion);
    const facility = new RapierPhysicsFacility(RAPIER, { objectFor: () => object });
    facility.addBody("obj", REST, {}, { kind: "sphere", dimensions: [0.1, 0, 0] });
    const port = new XRBlocksTransformPort(object, { physics: { facility, bodyId: "obj" } });
    return { port, rest: REST, physics: { step: (dt) => facility.step(dt) } };
  }

  for (const contractCase of transformPortContractCases()) {
    it(contractCase.name, () => contractCase.run(subject()));
  }
});

describe("connectXRBlocksInteractions physics", () => {
  it("builds the Rapier facility as the default engine, gives a registered object a body and steps it", () => {
    const setup = connectXRBlocksInteractions({ ...context(), physics: { rapier: RAPIER } });
    expect(setup.physics).toBeInstanceOf(RapierPhysicsFacility);
    expect(setup.physics?.engine).toBe("rapier");
    const ball = new Object3D();
    ball.position.set(0, 1, 0);
    const port = setup.register({ id: "ball", behaviours: [{ kind: "grab" }] }, ball, { shape: { kind: "sphere", dimensions: [0.1, 0, 0] } });
    expect(port.beginHold).toBeTypeOf("function");
    for (let i = 0; i < 30; i++) setup.update(1 / 60);
    expect(ball.position.y).toBeLessThan(0.9);
    setup.unregister("ball");
    expect(setup.physics?.hasBody("ball")).toBe(false);
    setup.dispose();
  });

  it("takes an app's own facility in place of the default, and leaves stepping to the app when asked", () => {
    const own = new MemoryPhysicsFacility();
    const setup = connectXRBlocksInteractions({ ...context(), physics: own, stepPhysics: false });
    expect(setup.physics).toBe(own);
    const ball = new Object3D();
    ball.position.set(0, 1, 0);
    setup.register({ id: "ball", behaviours: [] }, ball, { body: {}, shape: { kind: "sphere", dimensions: [0.1, 0, 0] } });
    for (let i = 0; i < 30; i++) setup.update(1 / 60);
    expect(own.getBodyPose("ball").position[1]).toBe(1);
    setup.dispose();
  });

  it("refuses a body when the setup has no physics", () => {
    const setup = connectXRBlocksInteractions(context());
    expect(setup.physics).toBeNull();
    expect(() => setup.register({ id: "ball", behaviours: [] }, new Object3D(), { body: {} })).toThrow(/no physics/);
    setup.dispose();
  });
});
