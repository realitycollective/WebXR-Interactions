/**
 * Desktop mouse fallback.
 *
 * These are regression tests for a real defect: the provider only ever set
 * `grabs` inside its `if (session)` branch, so off-headset it stayed at the
 * NO_CAPABILITIES default of "none". Capability negotiation then disabled every
 * behaviour declaring `requires: ["grabs"]` - grab, hinge, dial and slide -
 * leaving press as the only usable behaviour on desktop.
 *
 * The suite runs under `environment: "node"`, so the handful of DOM globals the
 * provider touches are stubbed rather than pulling in jsdom.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import { WebXRInputProvider } from "@realitycollective/threejs-interactions";

type Handler = (event: unknown) => void;

/** The slice of HTMLElement the provider actually uses. */
function fakeElement() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    handlers,
    addEventListener(type: string, handler: Handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
    },
    removeEventListener(type: string, handler: Handler) {
      handlers.get(type)?.delete(handler);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    /** Fire a listener registered on the element OR on the stubbed window. */
    fire(type: string, event: unknown) {
      for (const handler of handlers.get(type) ?? []) handler(event);
      for (const handler of windowHandlers.get(type) ?? []) handler(event);
    },
  };
}

let windowHandlers = new Map<string, Set<Handler>>();
let priorWindow: unknown;
let priorDocument: unknown;

beforeEach(() => {
  windowHandlers = new Map();
  priorWindow = (globalThis as Record<string, unknown>).window;
  priorDocument = (globalThis as Record<string, unknown>).document;
  (globalThis as Record<string, unknown>).window = {
    addEventListener(type: string, handler: Handler) {
      if (!windowHandlers.has(type)) windowHandlers.set(type, new Set());
      windowHandlers.get(type)!.add(handler);
    },
    removeEventListener(type: string, handler: Handler) {
      windowHandlers.get(type)?.delete(handler);
    },
  };
  (globalThis as Record<string, unknown>).document = { pointerLockElement: null };
});

afterEach(() => {
  (globalThis as Record<string, unknown>).window = priorWindow;
  (globalThis as Record<string, unknown>).document = priorDocument;
});

/** A provider with no XR session - i.e. the desktop path. */
function desktopProvider(overrides: Record<string, unknown> = {}) {
  const element = fakeElement();
  const camera = new PerspectiveCamera(70, 4 / 3, 0.05, 100);
  camera.updateMatrixWorld(true);
  const provider = new WebXRInputProvider({
    xr: { getSession: () => null, getReferenceSpace: () => null, getFrame: () => null },
    camera,
    domElement: element as unknown as HTMLElement,
    ...overrides,
  } as never);
  return { provider, element, camera };
}

const press = (button: number) => ({ button, clientX: 400, clientY: 300 });

describe("desktop capability negotiation", () => {
  it("reports grabs so hand-driven behaviours are not negotiated away", () => {
    const { provider } = desktopProvider();
    const capabilities = provider.getCapabilities();
    expect(capabilities.grabs).toBe("poseOnly");
    expect(capabilities.pointer2d).toBe(true);
  });

  it("leaves rays false, which sample() uses as its session-ended sentinel", () => {
    // Setting rays true on desktop would re-derive capabilities every frame for
    // the life of the page. See the note in refreshCapabilities.
    const { provider } = desktopProvider();
    expect(provider.getCapabilities().rays).toBeFalsy();
  });
});

describe("desktop grip pose", () => {
  it("projects a grip onto the mouse ray at the configured distance", () => {
    const { provider } = desktopProvider({ desktopGripDistance: 2 });
    const [source] = provider.sample();
    expect(source).toBeDefined();
    // Default camera sits at the origin looking down -Z, and the untouched
    // pointer is dead centre, so the grip lands at exactly -Z * distance.
    expect(source!.gripPose).toBeDefined();
    const [x, y, z] = source!.gripPose!.position;
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(-2, 5);
  });

  it("defaults the grip distance to 1 metre", () => {
    const { provider } = desktopProvider();
    const [source] = provider.sample();
    expect(source!.gripPose!.position[2]).toBeCloseTo(-1, 5);
  });

  it("supplies a grip at all, which holderPoint prefers over the ray origin", () => {
    // holderPoint() falls back to ray.origin, which on desktop is the camera
    // and barely moves - levers would not track the pointer without this.
    const { provider } = desktopProvider();
    const [source] = provider.sample();
    expect(source!.gripPose).toBeDefined();
    expect(source!.gripPose!.position).not.toEqual(source!.ray!.origin);
  });
});

describe("desktop squeeze button", () => {
  it("defaults to the left button, because right-drag is reserved for looking", () => {
    const { provider, element } = desktopProvider();
    expect(provider.sample()[0]!.squeeze).toBe(0);

    element.fire("pointerdown", press(0));
    const held = provider.sample()[0]!;
    expect(held.select).toBe(1);
    expect(held.squeeze).toBe(1);

    element.fire("pointerup", press(0));
    expect(provider.sample()[0]!.squeeze).toBe(0);
  });

  it("moves squeeze to the right button on request, leaving select on the left", () => {
    const { provider, element } = desktopProvider({ desktopSqueezeButton: "right" });

    element.fire("pointerdown", press(0));
    const left = provider.sample()[0]!;
    expect(left.select).toBe(1);
    expect(left.squeeze).toBe(0);

    element.fire("pointerdown", press(2));
    expect(provider.sample()[0]!.squeeze).toBe(1);

    element.fire("pointerup", press(2));
    expect(provider.sample()[0]!.squeeze).toBe(0);
  });

  it("claims the context menu only when squeeze is on the right button", () => {
    const { element } = desktopProvider({ desktopSqueezeButton: "right" });
    expect(element.handlers.get("contextmenu")?.size).toBe(1);

    const { element: leftDefault } = desktopProvider();
    // The shared camera controls own the menu when we are not using the right
    // button, so the provider must not also claim it.
    expect(leftDefault.handlers.get("contextmenu")?.size ?? 0).toBe(0);
  });

  it("never squeezes when disabled", () => {
    const { provider, element } = desktopProvider({ desktopSqueezeButton: "none" });
    element.fire("pointerdown", press(0));
    element.fire("pointerdown", press(2));
    expect(provider.sample()[0]!.squeeze).toBe(0);
    expect(provider.sample()[0]!.select).toBe(1);
  });
});
