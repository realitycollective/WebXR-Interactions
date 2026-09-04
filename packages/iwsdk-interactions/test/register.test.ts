/**
 * One-call setup on a faked world.
 *
 * `registerInteractions` only needs `registerSystem` from the world, so the
 * structural fake covers it. The bridge SYSTEM itself is not exercised
 * here: `createSystem` builds an elics system class whose queries need a
 * real world to attach to, which is more than a fake can stand in for.
 */
import { describe, expect, it } from "vitest";
import type { World } from "@iwsdk/core";
import {
  IWSDKInteractions,
  InteractionBridgeSystem,
  IWSDKInputProvider,
  interactionsFor,
  registerInteractions,
} from "@realitycollective/iwsdk-interactions";
import { FakeSession, makeWorld, type FakeWorld } from "./helpers.js";

function register(world: FakeWorld) {
  return registerInteractions(world as unknown as World);
}

describe("registerInteractions", () => {
  it("builds the host, registers the bridge system and is idempotent", () => {
    const world = makeWorld({ session: new FakeSession() });
    const host = register(world);

    expect(host).toBeInstanceOf(IWSDKInteractions);
    expect(host.provider).toBeInstanceOf(IWSDKInputProvider);
    expect(world.registeredSystems).toEqual([InteractionBridgeSystem]);

    // A second call returns the same host without registering again.
    expect(register(world)).toBe(host);
    expect(world.registeredSystems).toHaveLength(1);
    host.dispose();
  });

  it("finds the host for a world it was registered on", () => {
    const world = makeWorld();
    expect(interactionsFor(world as unknown as World)).toBeUndefined();
    const host = register(world);
    expect(interactionsFor(world as unknown as World)).toBe(host);
    host.dispose();
  });

  it("wires the provider into the runtime", () => {
    const world = makeWorld({ session: new FakeSession() });
    const host = register(world);
    expect(host.runtime.getProvider()).toBe(host.provider);
    expect(host.runtime.getCapabilities().rays).toBe(true);
    host.dispose();
  });
});
