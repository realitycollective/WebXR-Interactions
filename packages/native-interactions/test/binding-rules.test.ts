/**
 * Binding cases (the second kind in the Masters' "Validation" section): the
 * rules `NativeInputProvider` and `NativeInteractions` now apply themselves,
 * as `IWSDKInputProvider` and `registerInteractions` do, proved against fakes
 * that only report facts and record what they were told.
 */
import { describe, expect, it, vi } from "vitest";
import type { InputSourceSnapshot } from "@realitycollective/webxr-input";
import { NativeInputProvider, createNativeInteractions } from "@realitycollective/native-interactions";
import { FakeInputHost, FakeInteractionHost } from "./helpers.js";

const CONTROLLER = (side: "left" | "right", haptics = false): InputSourceSnapshot => ({
  id: `${side}-controller`,
  kind: "controller",
  handedness: side,
  select: 0,
  squeeze: 0,
  ...(haptics ? { hapticsAvailable: true } : {}),
});
const HAND = (side: "left" | "right"): InputSourceSnapshot => ({
  id: `${side}-hand`,
  kind: "hand",
  handedness: side,
  select: 0,
  squeeze: 0,
});

describe("change 26: capabilities are derived from host facts", () => {
  it("reports nothing before a session, whatever the host could do", () => {
    const host = new FakeInputHost({ pulse: true });
    const caps = new NativeInputProvider({ input: host }).getCapabilities();
    expect(caps).toMatchObject({ rays: false, pokes: false, grabs: "none", handJoints: false, buttonsAxes: false, haptics: false });
  });

  it("derives rays, pokes and pose-only grabs from immersion, as IWSDK does", () => {
    const host = new FakeInputHost();
    host.sources = [CONTROLLER("right")];
    const provider = new NativeInputProvider({ input: host });
    host.enterSession();
    expect(provider.getCapabilities()).toMatchObject({ rays: true, pokes: true, grabs: "poseOnly", buttonsAxes: true });
  });

  it("pokes with controllers alone: pokes follow immersion, not hand tracking", () => {
    const host = new FakeInputHost();
    host.sources = [CONTROLLER("left"), CONTROLLER("right")];
    const provider = new NativeInputProvider({ input: host });
    host.enterSession();
    expect(provider.getCapabilities()).toMatchObject({ pokes: true, handJoints: false, pinch: false });
  });

  it("flips handJoints and pinch when a hand appears, and says so", () => {
    const host = new FakeInputHost();
    host.sources = [CONTROLLER("right")];
    const provider = new NativeInputProvider({ input: host });
    host.enterSession();
    const changed = vi.fn();
    provider.onCapabilitiesChanged(changed);
    host.setSources([HAND("right")]);
    expect(provider.getCapabilities()).toMatchObject({ handJoints: true, pinch: true, buttonsAxes: false });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("counts the session's hand-tracking fact without a hand source", () => {
    const host = new FakeInputHost();
    host.sources = [];
    host.handTracking = true;
    const provider = new NativeInputProvider({ input: host });
    host.enterSession();
    expect(provider.getCapabilities().handJoints).toBe(true);
  });

  it("reports haptics only for a source with an actuator on a host that can pulse", () => {
    const host = new FakeInputHost({ pulse: true });
    host.sources = [CONTROLLER("right", true)];
    const provider = new NativeInputProvider({ input: host });
    host.enterSession();
    expect(provider.getCapabilities().haptics).toBe(true);
    const mute = new FakeInputHost();
    mute.sources = [CONTROLLER("right", true)];
    const muteProvider = new NativeInputProvider({ input: mute });
    mute.enterSession();
    expect(muteProvider.getCapabilities().haptics).toBe(false);
  });

  it("derives gaze and headPose from a head pose, and presence from the host's presence member", () => {
    expect(new NativeInputProvider({ input: new FakeInputHost({ headPose: true, presence: true }) }).getCapabilities()).toMatchObject({
      gaze: true,
      headPose: true,
      presence: true,
    });
    expect(new NativeInputProvider({ input: new FakeInputHost() }).getCapabilities()).toMatchObject({
      gaze: false,
      headPose: false,
      presence: false,
    });
  });

  it("reports native grabs with nativeGrab, as IWSDK's option does", () => {
    const host = new FakeInputHost();
    const provider = new NativeInputProvider({ input: host, nativeGrab: true });
    host.enterSession();
    expect(provider.getCapabilities().grabs).toBe("native");
  });

  it("re-derives on a facts change and publishes once per change", () => {
    const host = new FakeInputHost();
    const provider = new NativeInputProvider({ input: host });
    const changed = vi.fn();
    provider.onCapabilitiesChanged(changed);
    host.enterSession();
    host.notifyFacts(); // nothing changed
    expect(changed).toHaveBeenCalledTimes(1);
    host.exitSession();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(provider.getCapabilities().rays).toBe(false);
  });

  it("samples no sources while the session is not focused, as IWSDK samples none unless visible", () => {
    const host = new FakeInputHost();
    const provider = new NativeInputProvider({ input: host });
    expect(provider.sample()).toEqual([]);
    host.enterSession();
    expect(provider.sample()).toHaveLength(1);
  });

  it("forwards source changes to its own listeners after re-deriving", () => {
    const host = new FakeInputHost();
    const provider = new NativeInputProvider({ input: host });
    host.enterSession();
    const order: string[] = [];
    provider.onCapabilitiesChanged(() => order.push("caps"));
    provider.onSourcesChanged(() => order.push("sources"));
    host.setSources([CONTROLLER("left")]);
    expect(order).toEqual(["caps", "sources"]);
  });

  it("dispose stops following the host", () => {
    const host = new FakeInputHost();
    const provider = new NativeInputProvider({ input: host });
    const changed = vi.fn();
    provider.onCapabilitiesChanged(changed);
    provider.dispose();
    host.enterSession();
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("change 9 and 10: presence is decided in the binding, per side", () => {
  function live(sources: InputSourceSnapshot[]) {
    const host = new FakeInputHost({ presence: true });
    host.sources = sources;
    const provider = new NativeInputProvider({ input: host });
    host.enterSession();
    return { host, provider };
  }

  it('"auto" shows controllers while no hand is tracked, on both sides', () => {
    const { host } = live([CONTROLLER("left"), CONTROLLER("right")]);
    expect(host.shown).toEqual({ left: { hand: false, controller: true }, right: { hand: false, controller: true } });
  });

  it('"auto" follows the live modality when a hand appears', () => {
    const { host } = live([CONTROLLER("right")]);
    host.setSources([HAND("right")]);
    expect(host.shown.right).toEqual({ hand: true, controller: false });
  });

  it("hides the models of one side only, and the other keeps its family", () => {
    const { host, provider } = live([CONTROLLER("left"), CONTROLLER("right")]);
    expect(provider.setPresenceVisible?.("left", false)).toBe(true);
    expect(host.shown.left).toEqual({ hand: false, controller: false });
    expect(host.shown.right).toEqual({ hand: false, controller: true });
    provider.setPresenceVisible?.("all", true);
    expect(host.shown.left).toEqual({ hand: false, controller: true });
  });

  it('"hands" and "controllers" force one family and hide the other', () => {
    const { host, provider } = live([CONTROLLER("right")]);
    provider.setPresenceModality?.("hands");
    expect(host.shown.right).toEqual({ hand: true, controller: false });
    provider.setPresenceModality?.("controllers");
    expect(host.shown.right).toEqual({ hand: false, controller: true });
  });

  it("sends nothing for a request that changes nothing", () => {
    const { host, provider } = live([CONTROLLER("right")]);
    const calls = host.presenceCalls.length;
    provider.setPresenceVisible?.("right", true);
    provider.setPresenceModality?.("auto");
    provider.setPresenceVisible?.("none", false);
    expect(host.presenceCalls.length).toBe(calls);
  });

  it("reports false outside a session but keeps the request for the session", () => {
    const host = new FakeInputHost({ presence: true });
    host.sources = [CONTROLLER("left")];
    const provider = new NativeInputProvider({ input: host });
    expect(provider.setPresenceVisible?.("left", false)).toBe(false);
    host.enterSession();
    expect(host.shown.left).toEqual({ hand: false, controller: false });
  });
});

describe("change 27: a target's radius reaches the host", () => {
  it("defaults to 0.1 m, as IWSDK registers a bare target", () => {
    const interactions = new FakeInteractionHost();
    const setup = createNativeInteractions({ input: new FakeInputHost(), interactions });
    setup.register({ id: "bare", behaviours: [] });
    setup.register({ id: "big", behaviours: [] }, { targetRadius: 0.25 });
    expect(interactions.radiusCalls).toEqual([
      ["bare", 0.1],
      ["big", 0.25],
    ]);
    setup.dispose();
  });
});

describe("change 25 is not applied: haptics are routed by the client, as on IWSDK", () => {
  it("createNativeInteractions routes no feedback by itself, exactly as registerInteractions does not", () => {
    const input = new FakeInputHost({ pulse: true });
    const setup = createNativeInteractions({ input, interactions: new FakeInteractionHost() });
    expect(setup.runtime.onFeedback).toBeTypeOf("function");
    expect(input.pulses).toEqual([]);
    setup.dispose();
  });
});
