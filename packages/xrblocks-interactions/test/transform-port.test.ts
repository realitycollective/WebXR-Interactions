import { describe, expect, it } from "vitest";
import { Object3D } from "three";
import { XRBlocksTransformPort } from "@realitycollective/xrblocks-interactions";
import { FakeRapierRigidBody, RAPIER_BODY_TYPES } from "./helpers.js";

const REST = {
  position: [1, 0.5, -2] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
};

function objectAtRest(): Object3D {
  const object = new Object3D();
  object.position.set(...REST.position);
  object.quaternion.set(...REST.quaternion);
  return object;
}

describe("XRBlocksTransformPort with no rigid body", () => {
  it("behaves exactly like ThreeTransformPort - offsets, rotation and effects all apply", () => {
    const object = objectAtRest();
    const port = new XRBlocksTransformPort(object);
    expect(port.beginHold).toBeUndefined();
    expect(port.endHold).toBeUndefined();

    port.setLocalOffset([0, 0.1, 0]);
    expect(object.position.y).toBeCloseTo(0.6, 5);
    expect(port.getWorldPose().position[1]).toBeCloseTo(0.6, 5);
    expect(port.getRestWorldPose().position).toEqual(REST.position);
  });

  it("omits beginHold/endHold when a rigidBodyTypes option is missing, even with a body", () => {
    const object = objectAtRest();
    const body = new FakeRapierRigidBody(object);
    const port = new XRBlocksTransformPort(object, { rigidBody: body });
    expect(port.beginHold).toBeUndefined();
    expect(port.endHold).toBeUndefined();
  });
});

describe("XRBlocksTransformPort held pose", () => {
  function subject() {
    const object = objectAtRest();
    const body = new FakeRapierRigidBody(object);
    const port = new XRBlocksTransformPort(object, { rigidBody: body, rigidBodyTypes: RAPIER_BODY_TYPES });
    return { object, body, port };
  }

  it("beginHold switches the body to kinematicPositionBased", () => {
    const { body, port } = subject();
    port.beginHold?.();
    expect(body.bodyType).toBe(RAPIER_BODY_TYPES.kinematicPositionBased);
  });

  it("endHold switches the body back to dynamic and applies the release velocity", () => {
    const { object, body, port } = subject();
    port.beginHold?.();
    port.endHold?.({ linearVelocity: [1, 2, 3], angularVelocity: [0, 0.5, 0] });
    expect(body.bodyType).toBe(RAPIER_BODY_TYPES.dynamic);
    body.step(1 / 60);
    // Gravity aside, the body must be carrying the release's x velocity.
    expect(object.position.x).toBeGreaterThan(REST.position[0]);
  });

  it("setWorldPose while held keeps the kinematic body from drifting under gravity", () => {
    const { object, body, port } = subject();
    port.beginHold?.();
    const held = {
      position: [REST.position[0], REST.position[1] + 1, REST.position[2]] as [number, number, number],
      quaternion: REST.quaternion,
    };
    for (let i = 0; i < 5; i++) {
      port.setWorldPose(held);
      body.step(1 / 60); // Kinematic: gravity must not move it.
    }
    expect(port.getWorldPose().position[1]).toBeCloseTo(held.position[1], 5);
    expect(object.position.y).toBeCloseTo(held.position[1], 5);
  });

  it("setWorldPose while not held (reset) teleports the object and clears the body's velocity", () => {
    const { object, port, body } = subject();
    port.beginHold?.();
    port.endHold?.({ linearVelocity: [50, 0, 0], angularVelocity: [0, 0, 0] });
    body.step(1 / 60); // Large prior velocity now carried by the dynamic body.
    port.setWorldPose({ position: [2, 2, 2], quaternion: [0, 0, 0, 1] });
    body.step(1 / 60);
    // One further step of gravity only - the prior 50 m/s must not carry through.
    expect(object.position.x).toBeCloseTo(2, 5);
    expect(object.position.y).toBeGreaterThan(1.9);
  });

  it("behaves as ThreeTransformPort's setEffect for a target with a body", () => {
    const { port } = subject();
    expect(() => port.setEffect({ scale: 1.2 })).not.toThrow();
  });
});
