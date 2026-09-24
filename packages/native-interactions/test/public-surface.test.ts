/**
 * A platform adapter only implements the core's contracts. Its public
 * surface matches the other adapters: the core, the provider, hit tester,
 * transform port and setup entry point. Slice reading and tuple copying stay
 * internal.
 */
import { describe, expect, it } from "vitest";
import * as core from "@realitycollective/webxr-interactions";
import * as adapter from "@realitycollective/native-interactions";

describe("native-interactions public surface", () => {
  it("adds only the classes and setup entry point every adapter has", () => {
    const added = Object.keys(adapter).filter((name) => !(name in core)).sort();
    expect(added).toEqual([
      "NativeHitTester",
      "NativeInputProvider",
      "NativeInteractions",
      "NativeTransformPort",
      "createNativeInteractions",
    ]);
  });
});
