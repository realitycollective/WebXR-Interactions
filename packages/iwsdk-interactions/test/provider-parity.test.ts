/**
 * Every adapter implements the same provider contract.
 *
 * Four providers built against four different engines is exactly the
 * shape of defect that hides: one of them quietly drops a method, and
 * nothing notices until an app swaps adapters. This suite instantiates
 * all four and checks the contract on the instances, not the types.
 */
import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import type { World } from "@iwsdk/core";
import type { InputProvider } from "@realitycollective/webxr-input";
import { IWSDKInputProvider } from "@realitycollective/iwsdk-interactions";
import { WebXRInputProvider } from "@realitycollective/threejs-interactions";
import { XRBlocksInputProvider } from "@realitycollective/xrblocks-interactions";
import { BabylonInputProvider } from "@realitycollective/babylon-interactions";
import { FakeGamepad, FakeSession, fakeActuator, makeWorld } from "./helpers.js";

/** The members `InputProvider` requires of every implementation. */
const REQUIRED = ["getCapabilities", "onCapabilitiesChanged", "onSourcesChanged", "sample"] as const;

function iwsdkProvider(): InputProvider {
  const world = makeWorld({
    session: new FakeSession(),
    gamepads: { right: new FakeGamepad({ actuators: [fakeActuator()] }) },
  });
  return new IWSDKInputProvider(world as unknown as World);
}

function threeProvider(): InputProvider {
  return new WebXRInputProvider({
    xr: { getSession: () => null, getReferenceSpace: () => null, getFrame: () => null },
    camera: new PerspectiveCamera(70, 4 / 3, 0.05, 100),
  } as never);
}

function xrBlocksProvider(): InputProvider {
  return new XRBlocksInputProvider({
    input: { getFrame: () => ({ raySources: [], directTouches: [] }) },
    camera: {
      getWorldPosition: (t: object) => Object.assign(t, { x: 0, y: 1.6, z: 0 }),
      getWorldQuaternion: (t: object) => Object.assign(t, { x: 0, y: 0, z: 0, w: 1 }),
    },
  } as never);
}

function babylonProvider(): InputProvider {
  // No @babylonjs/core in the workspace - the adapter matches the shape of
  // the Babylon API, so a bare scene-shaped object is a valid host.
  return new BabylonInputProvider({
    scene: {
      onPointerObservable: { add: () => null, remove: () => true },
      activeCamera: { globalPosition: { x: 0, y: 1.6, z: 0 } },
    },
  } as never);
}

const providers: Array<[string, () => InputProvider]> = [
  ["iwsdk", iwsdkProvider],
  ["threejs", threeProvider],
  ["xrblocks", xrBlocksProvider],
  ["babylon", babylonProvider],
];

describe.each(providers)("%s provider", (_name, build) => {
  it("implements every required InputProvider member", () => {
    const provider = build() as unknown as Record<string, unknown>;
    for (const member of REQUIRED) {
      expect(typeof provider[member]).toBe("function");
    }
  });

  it("returns a full capability record and a source list", () => {
    const provider = build();
    const capabilities = provider.getCapabilities();
    for (const key of ["rays", "pokes", "grabs", "handJoints", "haptics"] as const) {
      expect(capabilities[key]).toBeDefined();
    }
    expect(Array.isArray(provider.sample())).toBe(true);
  });

  it("offers pulse whenever it claims haptics", () => {
    const provider = build();
    if (!provider.getCapabilities().haptics) return;
    expect(typeof provider.pulse).toBe("function");
  });

  it("hands back an unsubscribe from every subscription", () => {
    const provider = build();
    const offCapabilities = provider.onCapabilitiesChanged(() => undefined);
    const offSources = provider.onSourcesChanged(() => undefined);
    expect(typeof offCapabilities).toBe("function");
    expect(typeof offSources).toBe("function");
    expect(() => {
      offCapabilities();
      offSources();
    }).not.toThrow();
  });

  it("declares whether it can show and hide input visuals", () => {
    const provider = build() as unknown as { supportsPresence?: unknown };
    expect(typeof provider.supportsPresence).toBe("boolean");
  });
});
