/**
 * The near-pointer rule against IWSDK 1.0.0's own pointer stack: the core's
 * `NEAR_POINTER_DEFAULTS` are the constants IWSDK's touch and grab pointers
 * are built with, read from the engine rather than copied by hand, and the
 * touch press decision agrees with `@pmndrs/pointer-events`' rule
 * (`distance <= downRadius`) on every frame but the one the core deliberately
 * differs on: a fingertip first seen inside the press band, which IWSDK
 * presses at once and the core presses only after it has been outside.
 */
import { describe, expect, it } from "vitest";
import { Object3D, PerspectiveCamera } from "three";
import { TOUCH_DEFAULTS } from "@iwsdk/xr-input/dist/pointer/touch-pointer.js";
import { GrabPointer } from "@iwsdk/xr-input/dist/pointer/grab-pointer.js";
import { NEAR_POINTER_DEFAULTS, POINTER_PRIORITY, TouchPointerState } from "@realitycollective/webxr-interactions";

/** IWSDK's `computeIsPointerDown` (`@pmndrs/pointer-events` `pointer/touch.js`): down while the distance is within the down radius. */
function iwsdkTouchIsDown(distance: number): boolean {
  return distance <= TOUCH_DEFAULTS.downRadius;
}

describe("near-pointer constants against IWSDK 1.0.0", () => {
  it("takes the touch hover exit and press distances from IWSDK's TOUCH_DEFAULTS", () => {
    expect(NEAR_POINTER_DEFAULTS.touchHoverExit).toBe(TOUCH_DEFAULTS.hoverRadius);
    expect(NEAR_POINTER_DEFAULTS.touchDown).toBe(TOUCH_DEFAULTS.downRadius);
    // `enterHoverDistance` is not exported by multi-pointer.js; 0.15 is read from its source.
    expect(NEAR_POINTER_DEFAULTS.touchHoverEnter).toBe(0.15);
  });

  it("takes the grab radius from the sphere IWSDK's GrabPointer is built with", () => {
    const grip = new Object3D();
    const xrOrigin = { gripSpaces: { left: grip, right: grip } } as never;
    const pointer = new GrabPointer(new PerspectiveCamera(), xrOrigin, "left").pointer as unknown as {
      intersector: { getSphereRadius(): number };
    };
    expect(NEAR_POINTER_DEFAULTS.grabRadius).toBe(pointer.intersector.getSphereRadius());
  });

  it("orders the pointers as IWSDK's MultiPointer does: touch, grab, ray", () => {
    expect(POINTER_PRIORITY).toEqual(["touch", "grab", "ray"]);
  });

  it("presses and releases on the same frames as IWSDK's touch pointer for a fingertip that arrives from outside", () => {
    const distances = [0.3, 0.19, 0.1, 0.05, 0.02, 0.01, 0.0, 0.015, 0.025, 0.05, 0.19, 0.25];
    const core = new TouchPointerState();
    const { touchHoverEnter, touchHoverExit, touchDown } = NEAR_POINTER_DEFAULTS;
    for (const distance of distances) {
      const update = core.update(distance, touchHoverEnter, touchHoverExit, touchDown);
      // IWSDK only asks its touch pointer for a press while it has a hover candidate.
      const iwsdk = update.hovering && iwsdkTouchIsDown(distance);
      expect(update.pressed).toBe(iwsdk);
    }
  });

  it("differs from IWSDK on exactly one frame: a fingertip first seen inside the band does not press until it has been outside", () => {
    const core = new TouchPointerState();
    const { touchHoverEnter, touchHoverExit, touchDown } = NEAR_POINTER_DEFAULTS;
    const first = core.update(0.01, touchHoverEnter, touchHoverExit, touchDown);
    expect(iwsdkTouchIsDown(0.01)).toBe(true);
    expect(first.pressed).toBe(false);
    core.update(0.05, touchHoverEnter, touchHoverExit, touchDown);
    expect(core.update(0.01, touchHoverEnter, touchHoverExit, touchDown).pressed).toBe(true);
  });
});
