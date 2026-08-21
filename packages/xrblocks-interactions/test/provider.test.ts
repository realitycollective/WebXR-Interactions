import { describe, expect, it } from "vitest";
import { XRBlocksInputProvider, type XBFrameLike } from "@realitycollective/xrblocks-interactions";

function providerWith(frame: XBFrameLike): XRBlocksInputProvider {
  return new XRBlocksInputProvider({
    input: { getFrame: () => frame },
    camera: {
      getWorldPosition: (t) => Object.assign(t, { x: 0, y: 1.6, z: 0 }),
      getWorldQuaternion: (t) => Object.assign(t, { x: 0, y: 0, z: 0, w: 1 }),
    },
  });
}

describe("XRBlocksInputProvider (experimental)", () => {
  it("maps ray sources with analog trigger preference and boolean fallback", () => {
    const provider = providerWith({
      raySources: [
        {
          controller: {
            inputSource: { handedness: "right" },
            gamepad: { buttons: [{ value: 0.85 }] },
          },
          sourceType: "controller-ray",
          ray: { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
          selected: false,
        },
        {
          controller: { inputSource: { handedness: "left" }, userData: { squeezing: true } },
          sourceType: "hand-ray",
          ray: { origin: { x: -0.2, y: 1.4, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
          selected: true,
        },
      ],
      directTouches: [],
    });
    const sources = provider.sample();
    const right = sources.find((s) => s.handedness === "right");
    const left = sources.find((s) => s.handedness === "left");
    expect(right?.select).toBeCloseTo(0.85);
    expect(right?.kind).toBe("controller");
    expect(left?.select).toBe(1);
    expect(left?.squeeze).toBe(1);
    expect(left?.kind).toBe("hand");
    const caps = provider.getCapabilities();
    expect(caps.rays).toBe(true);
    expect(caps.grabs).toBe("poseOnly");
    expect(caps.haptics).toBe(false); // xrblocks has no haptics API
  });

  it("merges direct touches into the matching hand and copies pooled data", () => {
    const point = { x: 0.1, y: 1.2, z: -0.3 };
    const frame: XBFrameLike = {
      raySources: [
        {
          controller: { inputSource: { handedness: "left" } },
          sourceType: "hand-ray",
          ray: { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
          selected: false,
        },
      ],
      directTouches: [
        { controller: {}, handIndex: 0, point, selected: false },
      ],
    };
    const provider = providerWith(frame);
    const sources = provider.sample();
    const left = sources.find((s) => s.handedness === "left");
    expect(left?.indexTip).toEqual([0.1, 1.2, -0.3]);
    // Upstream mutates the pooled object; our snapshot must not follow it.
    point.x = 99;
    expect(left?.indexTip?.[0]).toBe(0.1);
    expect(provider.getCapabilities().pokes).toBe(true);
  });

  it("gaze rides its own source and never raw-selects", () => {
    const provider = providerWith({
      raySources: [
        {
          controller: {},
          sourceType: "gaze",
          ray: { origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
          selected: true, // upstream would never set this; even so we ignore it
        },
      ],
      directTouches: [],
    });
    const gaze = provider.sample().find((s) => s.kind === "gaze");
    expect(gaze?.id).toBe("xb-gaze");
    expect(gaze?.select).toBe(0);
  });

  it("mouse maps to pointer2d", () => {
    const provider = providerWith({
      raySources: [
        {
          controller: {},
          sourceType: "mouse",
          ray: { origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0.1, y: 0, z: -1 } },
          selected: true,
        },
      ],
      directTouches: [],
    });
    const mouse = provider.sample().find((s) => s.kind === "pointer2d");
    expect(mouse?.id).toBe("xb-mouse");
    expect(mouse?.select).toBe(1);
    expect(provider.getCapabilities().pointer2d).toBe(true);
  });
});
