import { describe, expect, it } from "vitest";
import { InputComponent, VisibilityState, type World } from "@iwsdk/core";
import { IWSDKInputProvider, type IWSDKProviderOptions } from "@realitycollective/iwsdk-interactions";
import {
  FakeGamepad,
  FakeSession,
  fakeActuator,
  fakeVisualAdapters,
  makeWorld,
  type FakeWorld,
} from "./helpers.js";

function providerFor(world: FakeWorld, options: IWSDKProviderOptions = {}): IWSDKInputProvider {
  return new IWSDKInputProvider(world as unknown as World, options);
}

/** A world already in a session, with both controllers reporting. */
function immersiveWorld(session = new FakeSession()) {
  const left = new FakeGamepad({ buttons: { [InputComponent.Trigger]: 0.4 } });
  const right = new FakeGamepad({
    buttons: { [InputComponent.Trigger]: 0.9, [InputComponent.Squeeze]: 0.2 },
    actuators: [fakeActuator()],
  });
  const world = makeWorld({ session, gamepads: { left, right } });
  return { world, left, right, session };
}

describe("capabilities", () => {
  it("offers only gaze and head pose before a session", () => {
    const provider = providerFor(makeWorld());
    const capabilities = provider.getCapabilities();
    expect(capabilities.rays).toBe(false);
    expect(capabilities.pokes).toBe(false);
    expect(capabilities.grabs).toBe("none");
    expect(capabilities.haptics).toBe(false);
    expect(capabilities.gaze).toBe(true);
    expect(capabilities.headPose).toBe(true);
  });

  it("derives rays, pokes, grabs and haptics from the live session", () => {
    const { world } = immersiveWorld();
    const provider = providerFor(world);
    const capabilities = provider.getCapabilities();
    expect(capabilities.rays).toBe(true);
    expect(capabilities.pokes).toBe(true);
    expect(capabilities.grabs).toBe("poseOnly");
    expect(capabilities.buttonsAxes).toBe(true);
    expect(capabilities.haptics).toBe(true);
  });

  it("reports native grab fulfilment when the app enabled IWSDK grabbing", () => {
    const { world } = immersiveWorld();
    expect(providerFor(world, { nativeGrab: true }).getCapabilities().grabs).toBe("native");
  });

  it("reads hand tracking from the session's enabled features", () => {
    const { world } = immersiveWorld(new FakeSession({ enabledFeatures: ["hand-tracking"] }));
    const capabilities = providerFor(world).getCapabilities();
    expect(capabilities.handJoints).toBe(true);
    expect(capabilities.pinch).toBe(true);
  });

  it("reads hand tracking from a connected hand input source", () => {
    const session = new FakeSession({ inputSources: [{ hand: {} }] });
    const { world } = immersiveWorld(session);
    expect(providerFor(world).getCapabilities().handJoints).toBe(true);
  });

  it("re-publishes when the session appears", () => {
    const world = makeWorld();
    const provider = providerFor(world);
    const published: boolean[] = [];
    provider.onCapabilitiesChanged((c) => published.push(c.rays));

    world.session = new FakeSession();
    world.visibilityState.set(VisibilityState.Visible);

    expect(published).toEqual([true]);
    expect(provider.getCapabilities().rays).toBe(true);
  });

  it("notifies source listeners on inputsourceschange, and stops after unsubscribe", () => {
    const { world, session } = immersiveWorld();
    const provider = providerFor(world);
    let calls = 0;
    const unsubscribe = provider.onSourcesChanged(() => calls++);

    session.dispatch("inputsourceschange");
    expect(calls).toBe(1);
    unsubscribe();
    session.dispatch("inputsourceschange");
    expect(calls).toBe(1);
  });

  it("stops publishing capability changes after unsubscribe", () => {
    const world = makeWorld();
    const provider = providerFor(world);
    let calls = 0;
    const unsubscribe = provider.onCapabilitiesChanged(() => calls++);
    unsubscribe();
    world.session = new FakeSession();
    world.visibilityState.set(VisibilityState.Visible);
    expect(calls).toBe(0);
  });
});

describe("sample", () => {
  it("returns nothing without a session", () => {
    expect(providerFor(makeWorld()).sample()).toEqual([]);
  });

  it("returns nothing while the app is not visible", () => {
    const { world } = immersiveWorld();
    world.visibilityState.set(VisibilityState.Hidden);
    expect(providerFor(world).sample()).toEqual([]);
  });

  it("builds one snapshot per side from the player rig", () => {
    const { world } = immersiveWorld();
    world.playerSpaceEntities.raySpaces.right.object3D?.position.set(0.2, 1.5, 0);
    world.playerSpaceEntities.gripSpaces.right.object3D?.position.set(0.25, 1.4, -0.1);
    world.playerSpaceEntities.indexTipSpaces.right.object3D?.position.set(0.26, 1.42, -0.2);

    const sources = providerFor(world).sample();
    expect(sources.map((s) => s.id)).toEqual(["left-input", "right-input"]);

    const right = sources.find((s) => s.id === "right-input");
    expect(right?.kind).toBe("controller");
    expect(right?.handedness).toBe("right");
    expect(right?.ray?.origin).toEqual([0.2, 1.5, 0]);
    expect(right?.ray?.direction[2]).toBeCloseTo(-1);
    expect(right?.gripPose?.position).toEqual([0.25, 1.4, -0.1]);
    expect(right?.indexTip).toEqual([0.26, 1.42, -0.2]);
    expect(right?.select).toBeCloseTo(0.9);
    expect(right?.squeeze).toBeCloseTo(0.2);
    expect(right?.hapticsAvailable).toBe(true);
    expect(sources.find((s) => s.id === "left-input")?.hapticsAvailable).toBeUndefined();
  });

  it("reports hand sources while hand tracking is live", () => {
    const { world } = immersiveWorld(new FakeSession({ enabledFeatures: ["hand-tracking"] }));
    expect(providerFor(world).sample()[0]?.kind).toBe("hand");
  });

  it("falls back to getSelecting when there is no analog trigger", () => {
    const { world, left } = immersiveWorld();
    left.buttons = {};
    left.selecting = true;
    const sources = providerFor(world).sample();
    expect(sources.find((s) => s.id === "left-input")?.select).toBe(1);
  });

  it("reports no signals for a side with no gamepad", () => {
    const { world } = immersiveWorld();
    world.input.xr.gamepads = {};
    const left = providerFor(world).sample()[0];
    expect(left?.select).toBe(0);
    expect(left?.squeeze).toBe(0);
  });

  it("skips a side whose ray space has no object", () => {
    const { world } = immersiveWorld();
    world.playerSpaceEntities.raySpaces.left.object3D = null;
    expect(providerFor(world).sample().map((s) => s.id)).toEqual(["right-input"]);
  });

  it("omits grip and index tip when those spaces have no object", () => {
    const { world } = immersiveWorld();
    world.playerSpaceEntities.gripSpaces.right.object3D = null;
    world.playerSpaceEntities.indexTipSpaces.right.object3D = null;
    const right = providerFor(world).sample().find((s) => s.id === "right-input");
    expect(right?.gripPose).toBeUndefined();
    expect(right?.indexTip).toBeUndefined();
  });

  it("flags native grabbing for the side the bridge reported", () => {
    const { world } = immersiveWorld();
    const provider = providerFor(world);
    provider.setNativeGrabbing("left", true);
    const sources = provider.sample();
    expect(sources.find((s) => s.id === "left-input")?.nativeGrabbing).toBe(true);
    expect(sources.find((s) => s.id === "right-input")?.nativeGrabbing).toBeUndefined();
  });

  it("passes the bridge's hints straight through", () => {
    const provider = providerFor(makeWorld());
    expect(provider.sampleHints()).toEqual([]);
    provider.setHints([{ sourceId: "left-input", targetId: "lever", state: "grab" }]);
    expect(provider.sampleHints()).toEqual([
      { sourceId: "left-input", targetId: "lever", state: "grab" },
    ]);
  });
});

describe("head pose", () => {
  it("reads the head space object", () => {
    const { world } = immersiveWorld();
    world.playerSpaceEntities.head.object3D?.position.set(0, 1.7, 0.1);
    expect(providerFor(world).getHeadPose().position).toEqual([0, 1.7, 0.1]);
  });

  it("falls back to the origin when there is no head object", () => {
    const { world } = immersiveWorld();
    world.playerSpaceEntities.head.object3D = null;
    expect(providerFor(world).getHeadPose()).toEqual({
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
    });
  });
});

describe("pulse", () => {
  it("resolves the side from the handedness recorded while sampling", () => {
    const { world, right } = immersiveWorld();
    const provider = providerFor(world);
    provider.sample();

    expect(provider.pulse("right-input", 0.5, 40)).toBe(true);
    expect(right.gamepad.hapticActuators[0]?.pulses).toEqual([{ intensity: 0.5, durationMs: 40 }]);
  });

  it("falls back to the id prefix for a source it did not produce", () => {
    const { world, right } = immersiveWorld();
    const provider = providerFor(world);
    // No sample() yet, so nothing is recorded - the prefix is all there is.
    expect(provider.pulse("right-hand-0", 2, 40)).toBe(true);
    expect(right.gamepad.hapticActuators[0]?.pulses).toEqual([{ intensity: 1, durationMs: 40 }]);
  });

  it("refuses an id that names no side", () => {
    const { world } = immersiveWorld();
    expect(providerFor(world).pulse("mouse", 1, 10)).toBe(false);
  });

  it("refuses a side with no actuator", () => {
    const { world } = immersiveWorld();
    const provider = providerFor(world);
    provider.sample();
    expect(provider.pulse("left-input", 1, 10)).toBe(false);
  });
});

describe("presence", () => {
  it("declares support through the capability", () => {
    expect(providerFor(makeWorld()).getCapabilities().presence).toBe(true);
  });

  it("reports failure when IWSDK has published no visual adapters", () => {
    const provider = providerFor(makeWorld());
    expect(provider.setPresenceVisible("all", false)).toBe(false);
    expect(provider.setPresenceModality("hands")).toBe(false);
  });

  it("hides the descendants of a side's visuals, leaving the root alone", () => {
    const { adapters, parts } = fakeVisualAdapters();
    const { world } = immersiveWorld();
    world.input.xr.visualAdapters = adapters;
    const provider = providerFor(world);

    expect(provider.setPresenceVisible("right", false)).toBe(true);
    expect(parts.controller.right.child.visible).toBe(false);
    expect(parts.controller.right.grandchild.visible).toBe(false);
    expect(adapters.controller.right.visual.model.visible).toBe(true);
    expect(parts.controller.left.child.visible).toBe(true);
  });

  it("targets both sides with all, and no side with none", () => {
    const { adapters, parts } = fakeVisualAdapters();
    const { world } = immersiveWorld();
    world.input.xr.visualAdapters = adapters;
    const provider = providerFor(world);

    expect(provider.setPresenceVisible("all", false)).toBe(true);
    expect(parts.controller.left.child.visible).toBe(false);
    expect(parts.controller.right.child.visible).toBe(false);

    expect(provider.setPresenceVisible("none", true)).toBe(true);
    expect(parts.controller.left.child.visible).toBe(false);
    expect(parts.controller.right.child.visible).toBe(false);
  });

  it("auto shows controllers without hand tracking and hands with it", () => {
    const { adapters, parts } = fakeVisualAdapters();
    const { world } = immersiveWorld();
    world.input.xr.visualAdapters = adapters;
    const provider = providerFor(world);

    provider.setPresenceModality("auto");
    expect(parts.controller.right.child.visible).toBe(true);
    expect(parts.hand.right.child.visible).toBe(false);

    world.session = new FakeSession({ enabledFeatures: ["hand-tracking"] });
    world.visibilityState.set(VisibilityState.Visible);
    provider.setPresenceModality("auto");
    expect(parts.controller.right.child.visible).toBe(false);
    expect(parts.hand.right.child.visible).toBe(true);
  });

  it("forces one family with hands or controllers", () => {
    const { adapters, parts } = fakeVisualAdapters();
    const { world } = immersiveWorld();
    world.input.xr.visualAdapters = adapters;
    const provider = providerFor(world);

    expect(provider.setPresenceModality("hands")).toBe(true);
    expect(parts.hand.left.child.visible).toBe(true);
    expect(parts.controller.left.child.visible).toBe(false);

    expect(provider.setPresenceModality("controllers")).toBe(true);
    expect(parts.hand.left.child.visible).toBe(false);
    expect(parts.controller.left.child.visible).toBe(true);
  });

  it("hiding a side beats the modality", () => {
    const { adapters, parts } = fakeVisualAdapters();
    const { world } = immersiveWorld();
    world.input.xr.visualAdapters = adapters;
    const provider = providerFor(world);

    provider.setPresenceModality("controllers");
    provider.setPresenceVisible("left", false);
    expect(parts.controller.left.child.visible).toBe(false);
    expect(parts.controller.right.child.visible).toBe(true);
  });

  it("re-applies the request to adapters that appear later", () => {
    const { adapters, parts } = fakeVisualAdapters();
    const { world } = immersiveWorld();
    const provider = providerFor(world);

    // Asked for before IWSDK built any visuals.
    expect(provider.setPresenceVisible("all", false)).toBe(false);
    world.input.xr.visualAdapters = adapters;
    provider.sample();
    expect(parts.controller.left.child.visible).toBe(false);
    expect(parts.controller.right.child.visible).toBe(false);
  });

  it("leaves visuals alone until a client asks for presence", () => {
    const { adapters, parts } = fakeVisualAdapters();
    const { world } = immersiveWorld();
    world.input.xr.visualAdapters = adapters;
    parts.hand.left.child.visible = true;

    providerFor(world).sample();
    expect(parts.hand.left.child.visible).toBe(true);
    expect(parts.controller.left.child.visible).toBe(true);
  });

  it("writes nothing when a repeat call asks for what is already applied", () => {
    const { adapters, parts } = fakeVisualAdapters();
    const { world } = immersiveWorld();
    world.input.xr.visualAdapters = adapters;
    const provider = providerFor(world);

    expect(provider.setPresenceVisible("all", false)).toBe(true);
    expect(parts.controller.left.child.visible).toBe(false);

    // Stand in for the walk having happened: if the repeat re-applies, this
    // goes back to false. An app pushing presence from a state subscription
    // makes this call on every unrelated state change.
    parts.controller.left.child.visible = true;
    parts.controller.right.child.visible = true;
    expect(provider.setPresenceVisible("all", false)).toBe(true);
    expect(parts.controller.left.child.visible).toBe(true);
    expect(parts.controller.right.child.visible).toBe(true);

    // The same for a repeated modality.
    provider.setPresenceModality("controllers");
    parts.controller.left.child.visible = true;
    provider.setPresenceModality("controllers");
    expect(parts.controller.left.child.visible).toBe(true);
  });

  it("still writes when only one side of a repeat actually changed", () => {
    const { adapters, parts } = fakeVisualAdapters();
    const { world } = immersiveWorld();
    world.input.xr.visualAdapters = adapters;
    const provider = providerFor(world);

    provider.setPresenceVisible("all", false);
    parts.controller.left.child.visible = true;
    parts.controller.right.child.visible = true;

    provider.setPresenceVisible("right", true);
    expect(parts.controller.right.child.visible).toBe(true);
    // Left was already hidden and is left alone by the diff.
    expect(parts.controller.left.child.visible).toBe(true);
  });

  it("re-applies unconditionally on every sample, so a capability refresh lands", () => {
    const { adapters, parts } = fakeVisualAdapters();
    const { world } = immersiveWorld();
    world.input.xr.visualAdapters = adapters;
    const provider = providerFor(world);

    provider.setPresenceVisible("all", true);
    provider.setPresenceModality("auto");
    expect(parts.controller.left.child.visible).toBe(true);
    expect(parts.hand.left.child.visible).toBe(false);

    // IWSDK re-asserts its own visuals every frame; the desired state has to
    // be pushed again even though nothing the caller asked for changed.
    parts.controller.left.child.visible = false;
    provider.sample();
    expect(parts.controller.left.child.visible).toBe(true);

    // A capability refresh swaps the modality underneath the adapter.
    world.session = new FakeSession({ enabledFeatures: ["hand-tracking"] });
    world.visibilityState.set(VisibilityState.Visible);
    provider.sample();
    expect(parts.hand.left.child.visible).toBe(true);
    expect(parts.controller.left.child.visible).toBe(false);
  });

  it("tolerates an adapter with no visual yet", () => {
    const { world } = immersiveWorld();
    world.input.xr.visualAdapters = { controller: {}, hand: {} } as never;
    expect(providerFor(world).setPresenceVisible("all", false)).toBe(true);
  });
});

describe("dispose", () => {
  it("drops the visibility subscription and the session listener", () => {
    const { world, session } = immersiveWorld();
    const provider = providerFor(world);
    expect(session.countListeners("inputsourceschange")).toBe(1);

    provider.dispose();
    expect(session.countListeners("inputsourceschange")).toBe(0);

    // A later visibility change must not reach the disposed provider.
    let calls = 0;
    provider.onCapabilitiesChanged(() => calls++);
    world.session = null;
    world.visibilityState.set(VisibilityState.Hidden);
    expect(calls).toBe(0);
  });
});
