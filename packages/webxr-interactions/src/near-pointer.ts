/**
 * Near pointers - the touch press, the grip grab, which pointer owns a hand
 * and what that means for the ray and cursor. Pure logic, no engine.
 *
 * The template is IWSDK 1.0.0's pointer stack (`@iwsdk/xr-input`
 * `multi-pointer.js`, `touch-pointer.js`, `grab-pointer.js`, over
 * `@pmndrs/pointer-events`), restated here so every binding runs the same
 * rule from the facts it already reports (`indexTip`, `gripPose`, `ray`):
 *
 * - **Touch.** A fingertip (a controller's ray origin stands in for one)
 *   hovers a target once its distance to the target's SURFACE is within
 *   `touchHoverEnter` (0.15 m) and keeps hovering until it is beyond
 *   `touchHoverExit` (0.2 m): `TOUCH_HYSTERESIS`. It presses while that
 *   distance is at or under `touchDown` (0.02 m): `TOUCH_DEFAULTS.downRadius`,
 *   which `@pmndrs/pointer-events` compares every frame, so the release is
 *   the way out past the same distance.
 * - **Grab.** The grip is a sphere of `grabRadius` (0.07 m,
 *   `createGrabPointer`'s default) and a target whose surface it reaches is
 *   the grab candidate. The squeeze (or a hand's pinch on a grab-only
 *   target) then grabs it.
 * - **Priority.** Per source, the first of touch, grab, ray with a candidate
 *   is the active pointer (`PRIORITY_ORDER`), and once it is pressing or
 *   grabbing it stays active until the release (IWSDK's selection lock).
 *   Since 29 September 2026 that decision is made ONCE per source across
 *   interactables and UI panels by the `PointerArbiter` in
 *   `@realitycollective/webxr-input` (`pointer-arbiter.ts`), which this
 *   runtime feeds and reads; `POINTER_PRIORITY`, `pickActivePointer`,
 *   `PointerCandidate` and `PointerVisuals` live there and are re-exported
 *   here unchanged.
 * - **Visuals.** The ray and its cursor show only while the ray is the active
 *   pointer or nothing is (`shouldHideRay`); a near pointer owning the hand
 *   hides them, and the shared cursor sits at the active pointer's hit. What
 *   the app then shows of them is its `PointerDisplay` configuration.
 *
 * One rule is deliberately stricter than the template, as the Pale Signal
 * work order of 28 September 2026 required: a touch never presses from inside
 * or from behind. A fingertip first seen already within the press band, a
 * hand that pops into tracking inside the target, does not press until it has
 * been seen outside the band and comes back in. IWSDK's touch pointer would
 * press on that first frame; `touch-reference.test.ts` records the one frame
 * on which the two differ, and that they agree everywhere else.
 */
export {
  POINTER_PRIORITY,
  pickActivePointer,
  pointerVisualsFor,
  type ActivePointerKind,
  type PointerCandidate,
  type PointerVisuals,
} from "@realitycollective/webxr-input";

export interface NearPointerOptions {
  /** Surface distance, metres, within which a fingertip starts hovering a target. IWSDK `enterHoverDistance` 0.15. */
  touchHoverEnter: number;
  /** Surface distance, metres, beyond which a hovering fingertip stops hovering. IWSDK `exitHoverDistance` 0.2. Never less than `touchHoverEnter`. */
  touchHoverExit: number;
  /** Surface distance, metres, at or under which a hovering fingertip presses, and above which it releases. IWSDK `downRadius` 0.02. */
  touchDown: number;
  /** Radius, metres, of the grip sphere that finds a grab candidate. `createGrabPointer` default 0.07. */
  grabRadius: number;
}

/** IWSDK 1.0.0's constants: `TOUCH_HYSTERESIS`, `TOUCH_DEFAULTS.downRadius`, `createGrabPointer`'s radius. */
export const NEAR_POINTER_DEFAULTS: Readonly<NearPointerOptions> = Object.freeze({
  touchHoverEnter: 0.15,
  touchHoverExit: 0.2,
  touchDown: 0.02,
  grabRadius: 0.07,
});

export function resolveNearPointerOptions(options: Partial<NearPointerOptions> = {}): NearPointerOptions {
  const resolved = { ...NEAR_POINTER_DEFAULTS, ...options };
  if (resolved.touchDown < 0 || resolved.touchHoverEnter < 0 || resolved.grabRadius < 0) {
    throw new Error("[webxr-interactions] near pointer distances must be >= 0");
  }
  if (resolved.touchHoverExit < resolved.touchHoverEnter) {
    throw new Error(
      `[webxr-interactions] touchHoverExit (${resolved.touchHoverExit}) must be >= touchHoverEnter (${resolved.touchHoverEnter})`,
    );
  }
  return resolved;
}

/** What the touch machine reports after one frame. */
export interface TouchPointerUpdate {
  /** The fingertip is hovering a target this frame (the touch pointer has a candidate). */
  hovering: boolean;
  /** The touch is pressing this frame. */
  pressed: boolean;
  /** True on the exact frame a press started. */
  pressStarted: boolean;
  /** True on the exact frame a press ended. */
  pressEnded: boolean;
}

/**
 * One source's touch pointer: hover with hysteresis, press at `touchDown`
 * armed only from outside the band. Feed it the fingertip's surface distance
 * to the nearest target each frame, or `null` when no target is in reach.
 */
export class TouchPointerState {
  private hovering = false;
  private pressed = false;
  /** The fingertip has been seen outside the press band since it last lost contact. */
  private armed = false;

  get isHovering(): boolean {
    return this.hovering;
  }

  get isPressed(): boolean {
    return this.pressed;
  }

  /**
   * Advance one frame. `enter`/`exit` are the hover band for the target in
   * question (an interactable may widen the default), `down` the press
   * distance.
   */
  update(distance: number | null, enter: number, exit: number, down: number): TouchPointerUpdate {
    const wasPressed = this.pressed;
    const threshold = this.hovering ? exit : enter;
    if (distance === null || distance > threshold) {
      this.hovering = false;
      this.pressed = false;
      this.armed = false;
      return { hovering: false, pressed: false, pressStarted: false, pressEnded: wasPressed };
    }
    this.hovering = true;
    if (distance > down) {
      // Outside the press band: released if it was pressing, and armed for the next press.
      this.armed = true;
      this.pressed = false;
      return { hovering: true, pressed: false, pressStarted: false, pressEnded: wasPressed };
    }
    // Within the press band. IWSDK presses here unconditionally; the core
    // requires the fingertip to have arrived from outside (see the file comment).
    if (!this.pressed && this.armed) {
      this.pressed = true;
      this.armed = false;
      return { hovering: true, pressed: true, pressStarted: true, pressEnded: false };
    }
    return { hovering: true, pressed: this.pressed, pressStarted: false, pressEnded: false };
  }

  /** Drop everything without reporting (the source went away). */
  reset(): void {
    this.hovering = false;
    this.pressed = false;
    this.armed = false;
  }
}
