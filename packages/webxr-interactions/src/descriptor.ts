/**
 * InteractionDescriptor - the portable scene-interaction format. Plain
 * JSON-able data: which interactables exist, which behaviours they carry
 * (with tuning), and their gaze policy. Every adapter builds the SAME
 * playground from the same descriptor - the portability proof inherited
 * from the UI Extensions' SceneDescriptor.
 */
import type { BehaviourConfig } from "./behaviours/factory.js";
import type { GazeConfig } from "./gaze.js";

export interface InteractableDescriptor {
  id: string;
  behaviours: BehaviourConfig[];
  gaze?: GazeConfig;
  /** Registered disabled when false (enable later via the runtime). */
  enabled?: boolean;
  /**
   * The touch hover ENTER distance for this target, metres to its surface:
   * a fingertip within it makes touch the active pointer (default 0.15,
   * IWSDK's `enterHoverDistance`; the exit distance is 0.05 beyond it). The
   * press distance (0.02) is the runtime's `nearPointer` option, not per
   * target. See `near-pointer.ts`.
   */
  pokeRadius?: number;
}

export interface InteractionDescriptor {
  interactables: InteractableDescriptor[];
}
