import { describe, expect, it } from "vitest";
import { BabylonTransformPort } from "@realitycollective/babylon-interactions";
import { BARE_PARENT, FakeNode, HALF_TURN_Y, quat } from "./helpers.js";

describe("BabylonTransformPort offsets", () => {
  it("reports nothing at rest and round-trips an offset", () => {
    const node = new FakeNode({ position: [1, 2, 3] });
    const port = new BabylonTransformPort(node);
    expect(port.getLocalOffset()).toEqual([0, 0, 0]);

    port.setLocalOffset([0, 0.5, 0]);
    expect(node.position).toEqual({ x: 1, y: 2.5, z: 3 });
    expect(port.getLocalOffset()[1]).toBeCloseTo(0.5);
  });

  it("applies an offset in the rest orientation, not the world one", () => {
    const node = new FakeNode({ position: [0, 0, 0], rotationQuaternion: HALF_TURN_Y });
    const port = new BabylonTransformPort(node);
    port.setLocalOffset([0, 0, 1]);
    expect(node.position.z).toBeCloseTo(-1);
    expect(port.getLocalOffset()[2]).toBeCloseTo(1);
  });

  it("writes into the node's own vector rather than replacing it", () => {
    const node = new FakeNode({ position: [0, 0, 0] });
    const vector = node.position;
    new BabylonTransformPort(node).setLocalOffset([1, 0, 0]);
    expect(node.position).toBe(vector);
  });

  it("re-reads the rest transform on request", () => {
    const node = new FakeNode({ position: [0, 0, 0] });
    const port = new BabylonTransformPort(node);
    node.position.y = 5;
    expect(port.getLocalOffset()[1]).toBeCloseTo(5);
    port.recaptureRest();
    expect(port.getLocalOffset()).toEqual([0, 0, 0]);
  });
});

describe("BabylonTransformPort rotation", () => {
  it("composes a local rotation onto the rest orientation, in place", () => {
    const node = new FakeNode({ position: [0, 0, 0], rotationQuaternion: HALF_TURN_Y });
    const rotation = node.rotationQuaternion;
    const port = new BabylonTransformPort(node);
    port.setLocalRotation([0, 0, 0, 1]);
    expect(node.rotationQuaternion).toBe(rotation);
    expect(node.rotationQuaternion).toEqual(quat(HALF_TURN_Y));

    port.setLocalRotation([0, 1, 0, 0]);
    // Half turn about Y, twice, is a full turn: w back to -1 (or 1).
    expect(Math.abs(node.rotationQuaternion?.w ?? 0)).toBeCloseTo(1);
    expect(node.rotationQuaternion?.y).toBeCloseTo(0);
  });

  it("builds a quaternion for a node still driven by Euler rotation", () => {
    const node = new FakeNode({ position: [0, 0, 0], rotationQuaternion: null });
    let built = 0;
    const port = new BabylonTransformPort(node, {
      createQuaternion: () => {
        built += 1;
        return { x: 0, y: 0, z: 0, w: 1 };
      },
    });
    port.setLocalRotation([0, 1, 0, 0]);
    port.setLocalRotation([0, 0, 0, 1]);
    expect(built).toBe(1);
    expect(node.rotationQuaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("falls back to a plain object when no factory is supplied", () => {
    const node = new FakeNode({ rotationQuaternion: null });
    new BabylonTransformPort(node).setLocalRotation([0, 1, 0, 0]);
    expect(node.rotationQuaternion).toEqual({ x: 0, y: 1, z: 0, w: 0 });
  });
});

describe("BabylonTransformPort world pose", () => {
  it("reports the live absolute pose, recomputing the world matrix first", () => {
    const node = new FakeNode({
      position: [0, 0, 0],
      absolutePosition: [1, 2, 3],
      absoluteRotation: HALF_TURN_Y,
    });
    const port = new BabylonTransformPort(node);
    expect(port.getWorldPose()).toEqual({ position: [1, 2, 3], quaternion: [0, 1, 0, 0] });
    expect(node.computeWorldMatrixCalls).toBe(1);
  });

  it("writes an unparented node's world pose straight through", () => {
    const node = new FakeNode({ position: [0, 0, 0], rotationQuaternion: [0, 0, 0, 1] });
    const port = new BabylonTransformPort(node);
    port.setWorldPose({ position: [1, 2, 3], quaternion: [0, 1, 0, 0] });
    expect(node.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(node.rotationQuaternion).toEqual({ x: 0, y: 1, z: 0, w: 0 });
  });

  it("resolves a world pose into a rotated parent's frame", () => {
    const parent = new FakeNode({ absolutePosition: [0, 1, 0], absoluteRotation: HALF_TURN_Y });
    const node = new FakeNode({ parent, rotationQuaternion: [0, 0, 0, 1] });
    const port = new BabylonTransformPort(node);
    port.setWorldPose({ position: [0, 1, 1], quaternion: [0, 0, 0, 1] });
    expect(node.position.x).toBeCloseTo(0);
    expect(node.position.y).toBeCloseTo(0);
    expect(node.position.z).toBeCloseTo(-1);
  });

  it("treats a parent with no transform as no parent", () => {
    const node = new FakeNode({ parent: BARE_PARENT, rotationQuaternion: [0, 0, 0, 1] });
    new BabylonTransformPort(node).setWorldPose({ position: [4, 5, 6], quaternion: [0, 0, 0, 1] });
    expect(node.position).toEqual({ x: 4, y: 5, z: 6 });
  });
});

describe("BabylonTransformPort effects", () => {
  it("scales uniformly about the rest scale", () => {
    const node = new FakeNode({ scaling: [2, 2, 2] });
    const port = new BabylonTransformPort(node);
    port.setEffect({ scale: 1.5 });
    expect(node.scaling).toEqual({ x: 3, y: 3, z: 3 });
    port.setEffect({ scale: 1 });
    expect(node.scaling).toEqual({ x: 2, y: 2, z: 2 });
  });

  it("ignores an emissive-only intent and a node with no scaling", () => {
    const node = new FakeNode({ scaling: [1, 1, 1] });
    const port = new BabylonTransformPort(node);
    port.setEffect({ emissive: 0.5 });
    expect(node.scaling).toEqual({ x: 1, y: 1, z: 1 });

    const bare = { position: { x: 0, y: 0, z: 0 }, getAbsolutePosition: () => ({ x: 0, y: 0, z: 0 }) };
    expect(() => new BabylonTransformPort(bare).setEffect({ scale: 2 })).not.toThrow();
  });
});
