/**
 * IWSDKPointerVisuals applies the app's pointer display settings to IWSDK's
 * own ray and cursor, on a fake world carrying `multiPointers`.
 */
import { describe, expect, it } from "vitest";
import type { Entity, World } from "@iwsdk/core";
import { Object3D } from "three";
import {
  IWSDKInteractions,
  IWSDKPointerVisuals,
  type InteractionRuntime,
  type IWSDKRegisterOptions,
  type PointerVisualsWorld,
} from "@realitycollective/iwsdk-interactions";
import { FakeSession, fakeMultiPointer, makeWorld } from "./helpers.js";

const DT = 1 / 72;

function fakeEntity(object: Object3D): Entity {
  return { object3D: object, hasComponent: () => false, addComponent: () => undefined } as unknown as Entity;
}

/** Both rays point straight ahead and hit a beacon; each hand has its own fake multi pointer. */
function setup(options: IWSDKRegisterOptions = {}, position: [number, number, number] = [0, 0, -1]) {
  const right = fakeMultiPointer();
  const left = fakeMultiPointer();
  const world = makeWorld({ session: new FakeSession(), multiPointers: { left, right } });
  const host = new IWSDKInteractions(world as unknown as World, options);
  const object = new Object3D();
  object.position.set(...position);
  const scene = new Object3D();
  scene.add(object);
  host.register({ id: "beacon", behaviours: [{ kind: "press" }] }, fakeEntity(object), { addInteractables: false });
  return { world, host, left, right };
}

describe("IWSDKPointerVisuals", () => {
  it("writes IWSDK's own defaults with default settings", () => {
    const { host, right, left } = setup();
    host.tick(DT, [], []);
    for (const pointer of [left, right]) {
      expect(pointer.ray.visual.rayDisplayMode).toBe(2);
      expect(pointer.ray.visual.ray.scale.z).toBe(1);
      expect(pointer.modeWrites.length).toBeGreaterThan(0);
    }
    expect(host.pointerVisuals).toBeInstanceOf(IWSDKPointerVisuals);
    host.dispose();
  });

  it("maps the ray setting to IWSDK's display mode", () => {
    const never = setup({ pointerDisplay: { ray: "never" } });
    never.host.tick(DT, [], []);
    expect(never.right.ray.visual.rayDisplayMode).toBe(3);
    never.host.dispose();

    const always = setup({ pointerDisplay: { ray: "always" } });
    always.host.tick(DT, [], []);
    expect(always.right.ray.visual.rayDisplayMode).toBe(1);
    always.host.dispose();

    const hitting = setup({ pointerDisplay: { ray: "whileHitting" } });
    hitting.host.tick(DT, [], []);
    expect(hitting.right.ray.visual.rayDisplayMode).toBe(2);
    hitting.host.dispose();
  });

  it("sets the ray mesh length from rayLength", () => {
    const { host, right } = setup({ pointerDisplay: { rayLength: 2 } });
    host.tick(DT, [], []);
    expect(right.ray.visual.ray.scale.z).toBe(2);
    host.dispose();
  });

  it("hides the cursor when the core draws none, and leaves the ray IWSDK showed", () => {
    const { host, right } = setup({ pointerDisplay: { cursorOnObjects: false } });
    host.tick(DT, [], []);
    expect(right.cursorCalls).toContain(false);
    expect(right.cursorCalls).not.toContain(true);
    expect(right.ray.visual.ray.visible).toBe(true);
    host.dispose();
  });

  it("never makes the cursor visible", () => {
    const { host, right } = setup();
    host.tick(DT, [], []);
    expect(right.cursorCalls).not.toContain(true);
    host.dispose();
  });

  it("forces the ray hidden while a touch pointer owns the hand", () => {
    // Both rays hit the beacon; the left index tip is also within reach of it: a touch.
    const { world, host, left, right } = setup();
    world.playerSpaceEntities.indexTipSpaces.left.object3D?.position.set(0, 0, -0.95);
    host.tick(DT, [], []);
    expect(left.ray.visual.ray.visible).toBe(false);
    expect(right.ray.visual.ray.visible).toBe(true);
    host.dispose();
  });

  it("writes nothing with pointerVisuals: false", () => {
    const { host, left, right } = setup({ pointerVisuals: false, pointerDisplay: { ray: "never", cursorOnObjects: false } });
    host.tick(DT, [], []);
    expect(host.pointerVisuals).toBeNull();
    for (const pointer of [left, right]) {
      expect(pointer.modeWrites).toEqual([]);
      expect(pointer.cursorCalls).toEqual([]);
      expect(pointer.ray.visual.ray.scale.z).toBe(1);
    }
    host.dispose();
  });

  it("restores IWSDK's defaults on dispose and stops writing", () => {
    const { host, right } = setup({ pointerDisplay: { ray: "never", rayLength: 2 } });
    host.tick(DT, [], []);
    expect(right.ray.visual.rayDisplayMode).toBe(3);
    const visuals = host.pointerVisuals!;
    visuals.dispose();
    expect(right.ray.visual.rayDisplayMode).toBe(2);
    expect(right.ray.visual.ray.scale.z).toBe(1);
    host.tick(DT, [], []);
    expect(right.ray.visual.rayDisplayMode).toBe(2);
    expect(right.ray.visual.ray.scale.z).toBe(1);
    visuals.dispose();
    host.dispose();
  });

  it("skips a side with no multi pointer, and a world with none at all", () => {
    const right = fakeMultiPointer();
    const world = makeWorld({ session: new FakeSession(), multiPointers: { right } });
    const host = new IWSDKInteractions(world as unknown as World, { pointerDisplay: { ray: "never" } });
    host.tick(DT, [], []);
    expect(right.ray.visual.rayDisplayMode).toBe(3);
    host.dispose();

    const bare = makeWorld({ session: new FakeSession() });
    const bareHost = new IWSDKInteractions(bare as unknown as World, { pointerDisplay: { ray: "never" } });
    expect(() => bareHost.tick(DT, [], [])).not.toThrow();
    bareHost.dispose();
  });

  it("skips a drawing whose source is unknown or has no hand side", () => {
    const pointer = fakeMultiPointer();
    let deliver: (drawings: unknown[]) => void = () => undefined;
    const runtime = {
      onPointerDrawing: (listener: (drawings: unknown[]) => void) => {
        deliver = listener;
        return () => undefined;
      },
      getPointerDisplay: () => ({ get: () => ({ ray: "never", rayLength: 2 }) }),
      getSource: (id: string) => (id === "head-gaze" ? { handedness: "none" } : undefined),
    } as unknown as InteractionRuntime;
    const world = makeWorld({ multiPointers: { left: pointer, right: pointer } });
    const visuals = new IWSDKPointerVisuals({ world: world as unknown as PointerVisualsWorld, runtime });
    deliver([
      { sourceId: "head-gaze", ray: false, cursor: false },
      { sourceId: "gone", ray: false, cursor: false },
    ]);
    expect(pointer.modeWrites).toEqual([]);
    expect(pointer.cursorCalls).toEqual([]);
    expect(pointer.ray.visual.ray.visible).toBe(true);
    visuals.dispose();
  });
});
