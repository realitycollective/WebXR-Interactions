/**
 * Gaze support — first-class, per the design decision that gaze serves two
 * roles:
 *
 * 1. **Combination gating** (`gaze.required`): input on an interactable only
 *    counts while the viewer is looking at it.
 * 2. **Accessibility** (`gaze.dwell`): looking at an interactable fills a
 *    dwell meter; a full meter fires a synthesized press — no hands needed.
 *    Consumers render the meter from `dwellProgress` events.
 *
 * The dwell state machine is pure and headless-tested. The runtime feeds it
 * hover booleans; it never sees the engine.
 */

export interface DwellConfig {
  /** Seconds of sustained gaze to fire. */
  holdSeconds?: number;
  /** Drain speed multiplier when looking away. */
  decayFactor?: number;
  /** After firing, progress must fall below this before it can re-arm. */
  rearmBelow?: number;
}

export interface GazeConfig {
  /** Non-gaze input on this interactable only counts while gazed at. */
  required?: boolean;
  /** Enable dwell-to-press. `true` uses defaults. */
  dwell?: boolean | DwellConfig;
}

export const DWELL_DEFAULTS: Required<DwellConfig> = {
  holdSeconds: 1.8,
  decayFactor: 2.5,
  rearmBelow: 0.1,
};

export function resolveDwellConfig(
  config: boolean | DwellConfig | undefined,
  defaults: Required<DwellConfig> = DWELL_DEFAULTS,
): Required<DwellConfig> | null {
  if (!config) return null;
  if (config === true) return defaults;
  return {
    holdSeconds: config.holdSeconds ?? defaults.holdSeconds,
    decayFactor: config.decayFactor ?? defaults.decayFactor,
    rearmBelow: config.rearmBelow ?? defaults.rearmBelow,
  };
}

export interface DwellTick {
  /** Dwell meter 0..1. */
  progress: number;
  /** Progress moved enough to be worth re-rendering (≥ 1%). */
  changed: boolean;
  /** The meter just completed — fire the synthesized press. */
  fired: boolean;
}

export class DwellState {
  private progress = 0;
  private lastReported = 0;
  private armed = true;

  update(hovered: boolean, dt: number, config: Required<DwellConfig>): DwellTick {
    const before = this.progress;
    if (hovered) {
      this.progress = Math.min(1, this.progress + dt / config.holdSeconds);
    } else {
      this.progress = Math.max(
        0,
        this.progress - (dt * config.decayFactor) / config.holdSeconds,
      );
    }

    let fired = false;
    if (this.armed && this.progress >= 1) {
      fired = true;
      this.armed = false;
      this.progress = 0;
    } else if (!this.armed && this.progress <= config.rearmBelow) {
      this.armed = true;
    }

    const changed =
      Math.abs(this.progress - this.lastReported) >= 0.01 ||
      (this.progress === 0 && before !== 0);
    if (changed) this.lastReported = this.progress;
    return { progress: this.progress, changed, fired };
  }

  getProgress(): number {
    return this.progress;
  }
}
