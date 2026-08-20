/**
 * Pointer bridge - drive the UI Extensions (or anything speaking the
 * shared pointer contract) from the SAME input stack that drives the
 * interactions. One provider, both families: this is the coexistence
 * contract in code.
 *
 * The returned object implements `PointerInputSource` (structurally
 * identical in `@realitycollective/webxr-input` and
 * `@realitycollective/webxr-uiextensions`): press-move-release derived
 * from a source's ray + select signal, fed by the runtime's per-frame
 * sampling.
 */
import {
  SELECT_PRESS_THRESHOLD,
  SELECT_RELEASE_THRESHOLD,
  type PointerInputSource,
  type PointerSample,
  type Unsubscribe,
} from "@realitycollective/webxr-input";
import { Emitter } from "./events.js";
import type { InteractionRuntime } from "./runtime.js";

export interface PointerBridge {
  source: PointerInputSource;
  dispose(): void;
}

/**
 * Create a pointer stream from the runtime's sampled sources.
 * `match` picks which source drives it (default: any source with a ray -
 * first pressed wins and holds until release).
 */
export function createPointerBridge(
  runtime: InteractionRuntime,
  match: (sourceId: string) => boolean = () => true,
): PointerBridge {
  const press = new Emitter<PointerSample>();
  const move = new Emitter<PointerSample>();
  const release = new Emitter<PointerSample>();

  let activeSourceId: string | null = null;

  const unsubscribe = runtime.onSourcesSampled((sources) => {
    if (activeSourceId === null) {
      for (const source of sources) {
        if (!source.ray || !match(source.id)) continue;
        if (source.select >= SELECT_PRESS_THRESHOLD) {
          activeSourceId = source.id;
          press.emit({ origin: source.ray.origin, direction: source.ray.direction });
          break;
        }
      }
      return;
    }
    const active = sources.find((s) => s.id === activeSourceId);
    if (!active || !active.ray || active.select <= SELECT_RELEASE_THRESHOLD) {
      if (active?.ray) {
        release.emit({ origin: active.ray.origin, direction: active.ray.direction });
      } else if (activeSourceId !== null) {
        release.emit({ origin: [0, 0, 0], direction: [0, 0, -1] });
      }
      activeSourceId = null;
      return;
    }
    move.emit({ origin: active.ray.origin, direction: active.ray.direction });
  });

  return {
    source: {
      onPress: (l): Unsubscribe => press.subscribe(l),
      onMove: (l): Unsubscribe => move.subscribe(l),
      onRelease: (l): Unsubscribe => release.subscribe(l),
    },
    dispose: unsubscribe,
  };
}
