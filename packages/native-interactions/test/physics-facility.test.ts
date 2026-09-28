/**
 * The native physics facility over a `physics` slice: the shared
 * `physicsFacilityContractCases()` suite through the binding over the core's
 * reference facility (a correct host), the copies it makes in both
 * directions, and how it resolves the slice.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryPhysicsFacility,
  physicsFacilityContractCases,
  type PhysicsFacility,
  type PoseTuple,
  type Vec3Tuple,
} from "@realitycollective/webxr-interactions";
import { NativePhysicsFacility, NativeTransformPort, createNativeInteractions } from "@realitycollective/native-interactions";
import { FakeInputHost, FakeInteractionHost } from "./helpers.js";

afterEach(() => {
  delete (globalThis as { __rcHost?: unknown }).__rcHost;
});

describe("NativePhysicsFacility over a correct physics slice", () => {
  for (const contractCase of physicsFacilityContractCases()) {
    it(contractCase.name, () => {
      contractCase.run({ facility: new NativePhysicsFacility({ physics: new MemoryPhysicsFacility() }) });
    });
  }

  it("copies every tuple it hands the host and every tuple it reads back", () => {
    const slice = new MemoryPhysicsFacility();
    const received: unknown[] = [];
    const recording: PhysicsFacility = {
      ...slice,
      engine: "recorder",
      addBody: (id, pose, body, shape) => {
        received.push(pose, shape?.dimensions);
        slice.addBody(id, pose, body, shape);
      },
      setGravity: (g) => {
        received.push(g);
        slice.setGravity(g);
      },
      setBodyPose: (id, pose) => {
        received.push(pose);
        slice.setBodyPose(id, pose);
      },
      setVelocity: (id, v) => {
        received.push(v.linear, v.angular);
        slice.setVelocity(id, v);
      },
      resume: (id, release) => {
        received.push(release.linearVelocity, release.angularVelocity);
        slice.resume(id, release);
      },
      getGravity: () => slice.getGravity(),
      getBodyPose: (id) => slice.getBodyPose(id),
      getVelocity: (id) => slice.getVelocity(id),
      getBodyState: (id) => slice.getBodyState(id),
      setBodyState: (id, s) => slice.setBodyState(id, s),
      hasBody: (id) => slice.hasBody(id),
      removeBody: (id) => slice.removeBody(id),
      suspend: (id) => slice.suspend(id),
      isSuspended: (id) => slice.isSuspended(id),
      step: (dt) => slice.step(dt),
      dispose: () => slice.dispose(),
    };
    const facility = new NativePhysicsFacility({ physics: recording });
    expect(facility.engine).toBe("recorder");
    const pose: PoseTuple = { position: [0, 1, 0], quaternion: [0, 0, 0, 1] };
    const dimensions: Vec3Tuple = [0.1, 0, 0];
    const gravity: Vec3Tuple = [0, -1, 0];
    const linear: Vec3Tuple = [1, 0, 0];
    facility.addBody("ball", pose, { gravityFactor: 0 }, { kind: "sphere", dimensions });
    facility.addBody("plain", pose);
    facility.addBody("auto", pose, undefined, { kind: "auto" });
    facility.setGravity(gravity);
    facility.setBodyPose("ball", pose);
    facility.setVelocity("ball", { linear, angular: [0, 0, 0] });
    facility.suspend("ball");
    facility.resume("ball", { linearVelocity: linear, angularVelocity: [0, 0, 0] });
    for (const tuple of received) {
      expect(tuple).not.toBe(pose);
      expect(tuple).not.toBe(pose.position);
      expect(tuple).not.toBe(dimensions);
      expect(tuple).not.toBe(gravity);
      expect(tuple).not.toBe(linear);
    }
    facility.removeBody("plain");
    expect(facility.hasBody("plain")).toBe(false);
    facility.setBodyState("ball", "kinematic");
    expect(facility.getBodyState("ball")).toBe("kinematic");
    facility.step(1 / 60);
    facility.dispose();
  });

  it("reads globalThis.__rcHost.physics when no slice is passed, and names the missing slice otherwise", () => {
    expect(() => new NativePhysicsFacility()).toThrow(/"physics" slice/);
    (globalThis as { __rcHost?: unknown }).__rcHost = { physics: new MemoryPhysicsFacility() };
    expect(new NativePhysicsFacility().engine).toBe("memory");
  });
});

describe("NativeTransformPort over the physics facility", () => {
  it("suspends and resumes the body for a hold, and teleports it with a world-pose write", () => {
    const physics = new NativePhysicsFacility({ physics: new MemoryPhysicsFacility() });
    physics.addBody("ball", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] }, {}, { kind: "sphere", dimensions: [0.1, 0, 0] });
    const host = new FakeInteractionHost({ setWorldPose: true });
    const port = new NativeTransformPort("ball", { interactions: host, physics: { facility: physics, bodyId: "ball" } });
    port.beginHold();
    expect(physics.isSuspended("ball")).toBe(true);
    expect(host.beginHoldCalls).toEqual([]);
    port.setWorldPose!({ position: [1, 2, 3], quaternion: [0, 0, 0, 1] });
    expect(physics.getBodyPose("ball").position).toEqual([1, 2, 3]);
    expect(host.setWorldPoseCalls).toHaveLength(1);
    port.endHold({ linearVelocity: [2, 0, 0], angularVelocity: [0, 0, 0] });
    expect(physics.isSuspended("ball")).toBe(false);
    expect(physics.getVelocity("ball").linear).toEqual([2, 0, 0]);
    expect(host.endHoldCalls).toEqual([]);
    // A host with no world-pose write of its own still gets the body written.
    const bare = new NativeTransformPort("ball", { interactions: new FakeInteractionHost(), physics: { facility: physics, bodyId: "ball" } });
    bare.setWorldPose!({ position: [4, 5, 6], quaternion: [0, 0, 0, 1] });
    expect(physics.getBodyPose("ball").position).toEqual([4, 5, 6]);
  });
});

describe("createNativeInteractions physics", () => {
  function setup(physics?: MemoryPhysicsFacility) {
    const input = new FakeInputHost();
    const interactions = new FakeInteractionHost();
    interactions.setPose("ball", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] });
    return { input, interactions, native: createNativeInteractions({ input, interactions, ...(physics ? { physics } : {}) }) };
  }

  it("adds a body at the host's pose on register, holds through it, steps it, and removes it on unregister", () => {
    const slice = new MemoryPhysicsFacility();
    const { native } = setup(slice);
    expect(native.physics?.engine).toBe("memory");
    const port = native.register({ id: "ball", behaviours: [{ kind: "grab" }] }, { shape: { kind: "sphere", dimensions: [0.1, 0, 0] } });
    expect(slice.getBodyPose("ball").position).toEqual([0, 1, 0]);
    port.beginHold();
    expect(slice.isSuspended("ball")).toBe(true);
    port.endHold({ linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] });
    native.update(1 / 60);
    expect(slice.getBodyPose("ball").position[1]).toBeLessThan(1);
    native.unregister("ball");
    expect(slice.hasBody("ball")).toBe(false);
    native.dispose();
  });

  it("binds a target whose body the host already holds, and leaves that body alone on unregister", () => {
    const slice = new MemoryPhysicsFacility();
    slice.addBody("ball", { position: [0, 1, 0], quaternion: [0, 0, 0, 1] }, {}, { kind: "sphere", dimensions: [0.1, 0, 0] });
    const { native, interactions } = setup(slice);
    const port = native.register({ id: "ball", behaviours: [{ kind: "grab" }] });
    port.beginHold();
    expect(slice.isSuspended("ball")).toBe(true);
    expect(interactions.beginHoldCalls).toEqual([]);
    native.unregister("ball");
    expect(slice.hasBody("ball")).toBe(true);
    native.dispose();
  });

  it("leaves stepping to the host when asked, and without a slice reports null and refuses a body", () => {
    const slice = new MemoryPhysicsFacility();
    const input = new FakeInputHost();
    const interactions = new FakeInteractionHost();
    const stepped = createNativeInteractions({ input, interactions, physics: slice, stepPhysics: false });
    stepped.register({ id: "ball", behaviours: [] }, { body: {}, shape: { kind: "sphere", dimensions: [0.1, 0, 0] } });
    stepped.update(1 / 60);
    expect(slice.getBodyPose("ball").position).toEqual([0, 0, 0]);
    stepped.dispose();

    const { native, interactions: plain } = setup();
    expect(native.physics).toBeNull();
    expect(() => native.register({ id: "ball", behaviours: [] }, { body: {} })).toThrow(/no physics slice/);
    const port = native.register({ id: "lever", behaviours: [{ kind: "grab" }] });
    port.beginHold();
    expect(plain.beginHoldCalls).toEqual(["lever"]);
    native.update(1 / 60);
    native.dispose();
  });
});
