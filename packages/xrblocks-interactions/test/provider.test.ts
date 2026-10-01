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
    // A controller's index tip is its ray origin, as IWSDK's input rig makes it.
    expect(right?.indexTip).toEqual([0, 1.5, 0]);
    expect(left?.indexTip).toBeUndefined();
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

  it("falls back to the ray pose with an identity orientation when no xr context is supplied", () => {
    const provider = providerWith({
      raySources: [
        {
          controller: { inputSource: { handedness: "right" } },
          sourceType: "controller-ray",
          ray: { origin: { x: 0, y: 1.5, z: -0.2 }, direction: { x: 0, y: 0, z: -1 } },
          selected: false,
        },
      ],
      directTouches: [],
    });
    const [source] = provider.sample();
    expect(source?.gripPose).toEqual({ position: [0, 1.5, -0.2], quaternion: [0, 0, 0, 1] });
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

/** A minimal fake of the three.js `WebXRManager` surface `XBWebXRAccess` needs. */
function fakeXr(options: {
  session?: { visibilityState?: string } | null;
  poses?: Map<object, unknown>;
}): {
  getSession: () => { visibilityState?: string } | null;
  getFrame: () => { getPose: (space: object) => unknown };
  getReferenceSpace: () => object;
} {
  const poses = options.poses ?? new Map();
  return {
    getSession: () => options.session ?? null,
    getFrame: () => ({ getPose: (space: object) => poses.get(space) }),
    getReferenceSpace: () => ({}),
  };
}

function xrPose(position: [number, number, number], orientation: [number, number, number, number] = [0, 0, 0, 1]) {
  return {
    transform: {
      position: { x: position[0], y: position[1], z: position[2] },
      orientation: { x: orientation[0], y: orientation[1], z: orientation[2], w: orientation[3] },
    },
  };
}

describe("XRBlocksInputProvider real grip pose", () => {
  it("reads the grip pose from inputSource.gripSpace via the frame and reference space", () => {
    const gripSpace = {} as never;
    const xr = fakeXr({
      session: { visibilityState: "visible" },
      poses: new Map([[gripSpace, xrPose([0.1, 1.2, -0.3], [0, 1, 0, 0])]]),
    });
    const provider = new XRBlocksInputProvider({
      input: {
        getFrame: () => ({
          raySources: [
            {
              controller: { inputSource: { handedness: "right", gripSpace } },
              sourceType: "controller-ray",
              ray: { origin: { x: 0, y: 1.5, z: -0.2 }, direction: { x: 0, y: 0, z: -1 } },
              selected: false,
            },
          ],
          directTouches: [],
        }),
      },
      camera: {
        getWorldPosition: (t) => Object.assign(t, { x: 0, y: 1.6, z: 0 }),
        getWorldQuaternion: (t) => Object.assign(t, { x: 0, y: 0, z: 0, w: 1 }),
      },
      xr: xr as never,
    });
    const [source] = provider.sample();
    expect(source?.gripPose).toEqual({ position: [0.1, 1.2, -0.3], quaternion: [0, 1, 0, 0] });
  });

  it("falls back to targetRaySpace when the source has no gripSpace", () => {
    const targetRaySpace = {} as never;
    const xr = fakeXr({
      session: { visibilityState: "visible" },
      poses: new Map([[targetRaySpace, xrPose([0.2, 1.4, -0.1])]]),
    });
    const provider = new XRBlocksInputProvider({
      input: {
        getFrame: () => ({
          raySources: [
            {
              controller: { inputSource: { handedness: "left", targetRaySpace } },
              sourceType: "hand-ray",
              ray: { origin: { x: 0, y: 1.5, z: -0.2 }, direction: { x: 0, y: 0, z: -1 } },
              selected: false,
            },
          ],
          directTouches: [],
        }),
      },
      camera: {
        getWorldPosition: (t) => Object.assign(t, { x: 0, y: 1.6, z: 0 }),
        getWorldQuaternion: (t) => Object.assign(t, { x: 0, y: 0, z: 0, w: 1 }),
      },
      xr: xr as never,
    });
    const [source] = provider.sample();
    expect(source?.gripPose?.position).toEqual([0.2, 1.4, -0.1]);
  });
});

describe("XRBlocksInputProvider haptics", () => {
  function provider(actuator: { pulse: (v: number, d: number) => Promise<boolean> }) {
    return new XRBlocksInputProvider({
      input: {
        getFrame: () => ({
          raySources: [
            {
              controller: {
                inputSource: { handedness: "right" },
                gamepad: { hapticActuators: [actuator] },
              },
              sourceType: "controller-ray",
              ray: { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
              selected: false,
            },
          ],
          directTouches: [],
        }),
      },
      camera: {
        getWorldPosition: (t) => Object.assign(t, { x: 0, y: 1.6, z: 0 }),
        getWorldQuaternion: (t) => Object.assign(t, { x: 0, y: 0, z: 0, w: 1 }),
      },
    });
  }

  it("pulses through the controller's WebXR Gamepad hapticActuators, clamping intensity", () => {
    const pulses: Array<[number, number]> = [];
    const p = provider({
      pulse: (v, d) => {
        pulses.push([v, d]);
        return Promise.resolve(true);
      },
    });
    p.sample();
    const [source] = p.sample();
    expect(source?.hapticsAvailable).toBe(true);
    expect(p.getCapabilities().haptics).toBe(true);
    expect(p.pulse(source!.id, 2, 40)).toBe(true);
    expect(p.pulse(source!.id, -1, 10)).toBe(true);
    expect(pulses).toEqual([[1, 40], [0, 10]]);
  });

  it("reports no haptics and refuses to pulse a source it has not sampled", () => {
    const provider = providerWith({
      raySources: [
        {
          controller: { inputSource: { handedness: "right" } },
          sourceType: "controller-ray",
          ray: { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
          selected: false,
        },
      ],
      directTouches: [],
    });
    provider.sample();
    expect(provider.getCapabilities().haptics).toBe(false);
    expect(provider.pulse("xb-right-controller-ray", 1, 10)).toBe(false);
    expect(provider.pulse("nonexistent", 1, 10)).toBe(false);
  });
});

describe("XRBlocksInputProvider session visibility", () => {
  it("returns nothing while the app is not visible, as IWSDK's provider does, when a session is supplied", () => {
    const xr = fakeXr({ session: { visibilityState: "visible" } });
    const provider = new XRBlocksInputProvider({
      input: {
        getFrame: () => ({
          raySources: [
            {
              controller: { inputSource: { handedness: "right" } },
              sourceType: "controller-ray",
              ray: { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
              selected: false,
            },
          ],
          directTouches: [],
        }),
      },
      camera: {
        getWorldPosition: (t) => Object.assign(t, { x: 0, y: 1.6, z: 0 }),
        getWorldQuaternion: (t) => Object.assign(t, { x: 0, y: 0, z: 0, w: 1 }),
      },
      xr: xr as never,
    });
    expect(provider.sample().length).toBe(1);

    (xr.getSession() as { visibilityState?: string }).visibilityState = "hidden";
    expect(provider.sample()).toEqual([]);
  });

  it("samples as usual when no xr context is supplied at all", () => {
    const provider = providerWith({
      raySources: [
        {
          controller: { inputSource: { handedness: "right" } },
          sourceType: "controller-ray",
          ray: { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
          selected: false,
        },
      ],
      directTouches: [],
    });
    expect(provider.sample().length).toBe(1);
  });
});

describe("XRBlocksInputProvider native grabbing", () => {
  it("reports native grabs and switches capabilities.grabs to native with the nativeGrab option", () => {
    const provider = new XRBlocksInputProvider(
      {
        input: {
          getFrame: () => ({
            raySources: [
              {
                controller: { inputSource: { handedness: "right" } },
                sourceType: "controller-ray",
                ray: { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
                selected: false,
              },
            ],
            directTouches: [],
          }),
        },
        camera: {
          getWorldPosition: (t) => Object.assign(t, { x: 0, y: 1.6, z: 0 }),
          getWorldQuaternion: (t) => Object.assign(t, { x: 0, y: 0, z: 0, w: 1 }),
        },
      },
      { nativeGrab: true },
    );
    provider.sample();
    expect(provider.getCapabilities().grabs).toBe("native");

    provider.setNativeGrabbing("right", true);
    const [source] = provider.sample();
    expect(source?.nativeGrabbing).toBe(true);

    provider.setNativeGrabbing("right", false);
    const [again] = provider.sample();
    expect(again?.nativeGrabbing).toBeUndefined();
  });

  it("reports poseOnly grabs without the option, as before", () => {
    const provider = providerWith({
      raySources: [
        {
          controller: { inputSource: { handedness: "right" } },
          sourceType: "controller-ray",
          ray: { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
          selected: false,
        },
      ],
      directTouches: [],
    });
    provider.sample();
    expect(provider.getCapabilities().grabs).toBe("poseOnly");
  });
});
