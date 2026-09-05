/**
 * Every adapter implements the same provider contract.
 *
 * Four providers built against four different engines is exactly the
 * shape of defect that hides: one of them quietly drops a method, and
 * nothing notices until an app swaps adapters. The checks themselves are
 * the shared suite shipped by `@realitycollective/webxr-input`, so this
 * repository cannot drift from the contract it implements; this file only
 * builds the four instances and adds what the shared suite does not cover.
 */
import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import type { World } from "@iwsdk/core";
import {
  inputProviderContractCases,
  type InputProvider,
  type InputProviderContractDriver,
} from "@realitycollective/webxr-input";
import { IWSDKInputProvider } from "@realitycollective/iwsdk-interactions";
import { WebXRInputProvider } from "@realitycollective/threejs-interactions";
import { XRBlocksInputProvider } from "@realitycollective/xrblocks-interactions";
import { BabylonInputProvider } from "@realitycollective/babylon-interactions";
import { FakeGamepad, FakeSession, fakeActuator, makeWorld } from "./helpers.js";

/** The members `InputProvider` requires of every implementation. */
const REQUIRED = ["getCapabilities", "onCapabilitiesChanged", "onSourcesChanged", "sample"] as const;

/** A provider plus whatever session control its fakes can offer. */
interface Built {
  provider: InputProvider;
  driver?: InputProviderContractDriver;
}

function iwsdkProvider(): Built {
  const world = makeWorld({
    session: new FakeSession(),
    gamepads: { right: new FakeGamepad({ actuators: [fakeActuator()] }) },
  });
  const provider = new IWSDKInputProvider(world as unknown as World);
  // The fake world drives a session cycle, so the contract case that needs
  // one runs here rather than being skipped for want of a driver.
  return {
    provider,
    driver: {
      enterSession() {
        world.session = new FakeSession();
        world.visibilityState.set("visible");
      },
      exitSession() {
        world.session = null;
        world.visibilityState.set("visible");
      },
    },
  };
}

function threeProvider(): Built {
  const provider = new WebXRInputProvider({
    xr: { getSession: () => null, getReferenceSpace: () => null, getFrame: () => null },
    camera: new PerspectiveCamera(70, 4 / 3, 0.05, 100),
  } as never);
  return { provider };
}

function xrBlocksProvider(): Built {
  const provider = new XRBlocksInputProvider({
    input: { getFrame: () => ({ raySources: [], directTouches: [] }) },
    camera: {
      getWorldPosition: (t: object) => Object.assign(t, { x: 0, y: 1.6, z: 0 }),
      getWorldQuaternion: (t: object) => Object.assign(t, { x: 0, y: 0, z: 0, w: 1 }),
    },
  } as never);
  return { provider };
}

function babylonProvider(): Built {
  // No @babylonjs/core in the workspace - the adapter matches the shape of
  // the Babylon API, so a bare scene-shaped object is a valid host.
  const provider = new BabylonInputProvider({
    scene: {
      onPointerObservable: { add: () => null, remove: () => true },
      activeCamera: { globalPosition: { x: 0, y: 1.6, z: 0 } },
    },
  } as never);
  return { provider };
}

const providers: Array<[string, () => Built]> = [
  ["iwsdk", iwsdkProvider],
  ["threejs", threeProvider],
  ["xrblocks", xrBlocksProvider],
  ["babylon", babylonProvider],
];

describe.each(providers)("%s provider", (_name, build) => {
  for (const contractCase of inputProviderContractCases()) {
    it(contractCase.name, () => {
      const { provider, driver } = build();
      contractCase.run(provider, driver);
    });
  }

  // Adapter-specific, on top of the shared suite: the contract cases call
  // these members, but never assert that all four are present as functions.
  it("implements every required InputProvider member", () => {
    const provider = build().provider as unknown as Record<string, unknown>;
    for (const member of REQUIRED) {
      expect(typeof provider[member]).toBe("function");
    }
  });

  // The shared suite checks the capability KEYS and the methods a true
  // presence flag implies. It cannot check the value's type, and presence
  // is the one capability whose value differs across these four.
  it("answers capabilities.presence with a boolean", () => {
    expect(typeof build().provider.getCapabilities().presence).toBe("boolean");
  });
});
