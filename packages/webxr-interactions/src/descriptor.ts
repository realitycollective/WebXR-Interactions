/**
 * InteractionDescriptor — the portable scene-interaction format. Plain
 * JSON-able data: which interactables exist, which behaviours they carry
 * (with tuning), and their gaze policy. Every adapter builds the SAME
 * playground from the same descriptor — the portability proof inherited
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
  /** Poke/proximity trigger radius in meters (default 0.05). */
  pokeRadius?: number;
}

export interface InteractionDescriptor {
  interactables: InteractableDescriptor[];
}
