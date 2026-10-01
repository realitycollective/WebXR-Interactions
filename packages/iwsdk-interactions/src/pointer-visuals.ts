/**
 * IWSDKPointerVisuals - applies the app's pointer display settings to IWSDK's
 * own ray and cursor.
 *
 * IWSDK is the reference platform and draws its own pointer (`@iwsdk/xr-input`
 * `MultiPointer`: a 1 m ray mesh and a cursor disc per hand). This class draws
 * nothing. Each frame it reads the core's `PointerDrawing` per source
 * (`InteractionRuntime.onPointerDrawing`) and:
 *
 * - sets the ray's display mode from the app's `ray` setting;
 * - sets the ray mesh length from `rayLength` (IWSDK's mesh is 1 m);
 * - hides the ray and the cursor where the core says not to draw them, for
 *   example while a near pointer owns the hand or the app turned the cursor off.
 *
 * It never makes anything visible that IWSDK hid: IWSDK's own near-pointer
 * decision is the reference and the core agrees with it. The bridge system
 * runs after IWSDK's own pointer update, so a write made here holds for the
 * frame. The IWSDK types are structural, so no value import is needed.
 */
import type { InteractionRuntime, RayDisplayMode, Unsubscribe } from "@realitycollective/webxr-interactions";

/** The slice of IWSDK's `RayPointer` this class writes. */
export interface RayPointerLike {
  /** IWSDK's `RayDisplayMode`: Visible = 1, VisibleOnIntersection = 2, Invisible = 3. */
  rayDisplayMode: number;
  /** The ray mesh, 1 m long along -Z: `scale.z` is its length in metres. */
  ray: { scale: { z: number }; visible: boolean };
}

/** The slice of IWSDK's `MultiPointer` this class writes. */
export interface MultiPointerLike {
  /** IWSDK's `ray` wrapper; `visual` is the `RayPointer`. */
  ray: { visual: RayPointerLike };
  /** IWSDK's `CursorVisual`. */
  cursorVisual: { setVisible(visible: boolean): void; cursor: { visible: boolean } };
}

/** The slice of an IWSDK world this class reads: `world.input.xr.multiPointers`. */
export interface PointerVisualsWorld {
  input: { xr: { multiPointers?: Partial<Record<"left" | "right", MultiPointerLike>> } };
}

export interface IWSDKPointerVisualsOptions {
  world: PointerVisualsWorld;
  /** The runtime whose drawings and display settings are applied. */
  runtime: InteractionRuntime;
}

// IWSDK's RayDisplayMode values, as numbers so no value import is needed.
const VISIBLE = 1;
const VISIBLE_ON_INTERSECTION = 2;
const INVISIBLE = 3;

const MODE: Record<RayDisplayMode, number> = {
  never: INVISIBLE,
  always: VISIBLE,
  whileHitting: VISIBLE_ON_INTERSECTION,
};

export class IWSDKPointerVisuals {
  private readonly world: PointerVisualsWorld;
  private readonly runtime: InteractionRuntime;
  private readonly touched = new Set<RayPointerLike>();
  private unsubscribe: Unsubscribe | null;

  constructor(options: IWSDKPointerVisualsOptions) {
    this.world = options.world;
    this.runtime = options.runtime;
    this.unsubscribe = this.runtime.onPointerDrawing((drawings) => {
      const config = this.runtime.getPointerDisplay().get();
      for (const drawing of drawings) {
        const side = this.runtime.getSource(drawing.sourceId)?.handedness;
        if (side !== "left" && side !== "right") continue;
        const pointer = this.world.input.xr.multiPointers?.[side];
        if (!pointer) continue;
        const rayPointer = pointer.ray.visual;
        this.touched.add(rayPointer);
        rayPointer.rayDisplayMode = MODE[config.ray];
        rayPointer.ray.scale.z = config.rayLength;
        if (!drawing.ray) rayPointer.ray.visible = false;
        if (!drawing.cursor) pointer.cursorVisual.setVisible(false);
      }
    });
  }

  /** Stop applying, and give every pointer touched IWSDK's defaults back (mode 2, length 1 m). */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const rayPointer of this.touched) {
      rayPointer.rayDisplayMode = VISIBLE_ON_INTERSECTION;
      rayPointer.ray.scale.z = 1;
    }
    this.touched.clear();
  }
}
