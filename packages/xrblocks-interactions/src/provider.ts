/**
 * XRBlocksInputProvider — EXPERIMENTAL.
 *
 * Binds to the SHAPE of Google XR Blocks (verified against xrblocks
 * v0.20.0 source, 2026-08) without importing `xrblocks`, per the
 * UI Extensions structural-typing convention:
 *
 *  - `xb.input.getFrame()` → `{ raySources, directTouches }`. Those slot
 *    objects are POOLED AND MUTATED per frame upstream — everything is
 *    copied here, never retained.
 *  - `RaySourceInput`: `{ controller, sourceType: 'mouse'|'controller-ray'
 *    |'hand-ray'|'gaze'|'simulator', ray, selected }` — handedness from
 *    `controller.inputSource?.handedness`; analog select only via
 *    `controller.gamepad?.buttons[0].value`; squeeze only as the boolean
 *    `controller.userData.squeezing`.
 *  - `DirectTouchInput`: `{ handIndex (0=left,1=right), point }` — the
 *    index-fingertip world position, merged into the matching hand source.
 *  - Grip poses are not exposed by the frame struct; the ray pose doubles
 *    as the carry pose (XR Blocks keeps grip transforms behind
 *    `options.controllers.visualization`).
 *  - Gaze rides `sourceType: 'gaze'` and never raw-selects (XR Blocks
 *    selects gaze via its own dwell; ours is the core's dwell).
 *  - Haptics: none in XR Blocks (verified) — capability stays false.
 */
import {
  NO_CAPABILITIES,
  type HeadPose,
  type InputCapabilities,
  type InputProvider,
  type InputSourceSnapshot,
  type Unsubscribe,
} from "@realitycollective/webxr-input";

/** Structural slice of THREE.Vector3 / Quaternion. */
interface Vec3Like {
  x: number;
  y: number;
  z: number;
}
interface QuatLike extends Vec3Like {
  w: number;
}

interface RayLike {
  origin: Vec3Like;
  direction: Vec3Like;
}

interface ControllerLike {
  inputSource?: { handedness?: string };
  gamepad?: { buttons?: ReadonlyArray<{ value: number }> };
  userData?: { squeezing?: boolean; selected?: boolean; id?: number };
}

/** Structural `RaySourceInput` (xrblocks src/interaction/InteractionTypes.ts). */
export interface XBRaySourceLike {
  controller: ControllerLike;
  sourceType: string; // 'mouse' | 'controller-ray' | 'hand-ray' | 'gaze' | 'simulator'
  ray: RayLike;
  selected: boolean;
}

/** Structural `DirectTouchInput`. */
export interface XBDirectTouchLike {
  controller: ControllerLike;
  handIndex: number; // 0 = LEFT, 1 = RIGHT (xrblocks Handedness enum)
  point: Vec3Like;
  selected: boolean;
}

export interface XBFrameLike {
  raySources: readonly XBRaySourceLike[];
  directTouches: readonly XBDirectTouchLike[];
}

/** The slice of the XR Blocks singletons the provider binds to. */
export interface XRBlocksContext {
  /** `xb.input` — must expose `getFrame()`. */
  input: { getFrame(): XBFrameLike };
  /** `xb.camera` / `xb.core.camera` — the head pose. */
  camera: {
    getWorldPosition(target: Vec3Like): Vec3Like;
    getWorldQuaternion(target: QuatLike): QuatLike;
  };
}

const SCRATCH_V = { x: 0, y: 0, z: 0 };
const SCRATCH_Q = { x: 0, y: 0, z: 0, w: 1 };

export class XRBlocksInputProvider implements InputProvider {
  private readonly context: XRBlocksContext;
  private capabilities: InputCapabilities = { ...NO_CAPABILITIES, headPose: true, gaze: true };
  private readonly capsListeners = new Set<(c: InputCapabilities) => void>();

  constructor(context: XRBlocksContext) {
    this.context = context;
  }

  getCapabilities(): InputCapabilities {
    return this.capabilities;
  }

  onCapabilitiesChanged(listener: (c: InputCapabilities) => void): Unsubscribe {
    this.capsListeners.add(listener);
    return () => this.capsListeners.delete(listener);
  }

  onSourcesChanged(): Unsubscribe {
    return () => undefined;
  }

  sample(): readonly InputSourceSnapshot[] {
    const frame = this.context.input.getFrame();
    const snapshots: InputSourceSnapshot[] = [];
    const byHandedness = new Map<string, InputSourceSnapshot>();

    let sawRay = false;
    let sawTouch = false;
    let sawMouse = false;

    for (const source of frame.raySources) {
      if (source.sourceType === "gaze") {
        snapshots.push({
          id: "xb-gaze",
          kind: "gaze",
          handedness: "none",
          ray: copyRay(source.ray),
          select: 0, // gaze never raw-selects in XR Blocks
          squeeze: 0,
        });
        continue;
      }
      const handedness = normalizeHandedness(source.controller.inputSource?.handedness);
      const isMouse = source.sourceType === "mouse";
      if (isMouse) sawMouse = true;
      else sawRay = true;
      const analog = source.controller.gamepad?.buttons?.[0]?.value;
      const select = analog !== undefined && analog > 0 ? analog : source.selected ? 1 : 0;
      const ray = copyRay(source.ray);
      const snapshot: InputSourceSnapshot = {
        id: isMouse ? "xb-mouse" : `xb-${handedness}-${source.sourceType}`,
        kind: isMouse ? "pointer2d" : source.sourceType === "hand-ray" ? "hand" : "controller",
        handedness,
        ray,
        // XR Blocks does not expose grip transforms in the frame struct;
        // the ray pose doubles as the carry pose.
        gripPose: { position: ray.origin, quaternion: [0, 0, 0, 1] },
        select,
        squeeze: source.controller.userData?.squeezing ? 1 : 0,
      };
      snapshots.push(snapshot);
      if (handedness !== "none") byHandedness.set(handedness, snapshot);
    }

    for (const touch of frame.directTouches) {
      sawTouch = true;
      const handedness = touch.handIndex === 0 ? "left" : "right";
      const existing = byHandedness.get(handedness);
      const tip: [number, number, number] = [touch.point.x, touch.point.y, touch.point.z];
      if (existing) {
        existing.indexTip = tip;
        existing.kind = "hand";
      } else {
        snapshots.push({
          id: `xb-${handedness}-touch`,
          kind: "hand",
          handedness,
          indexTip: tip,
          gripPose: { position: tip, quaternion: [0, 0, 0, 1] },
          select: touch.selected ? 1 : 0,
          squeeze: 0,
        });
      }
    }

    this.refreshCapabilities(sawRay, sawTouch, sawMouse);
    return snapshots;
  }

  private refreshCapabilities(rays: boolean, touches: boolean, mouse: boolean): void {
    const next: InputCapabilities = {
      ...NO_CAPABILITIES,
      rays,
      pokes: touches,
      grabs: rays || touches ? "poseOnly" : "none",
      handJoints: touches,
      pinch: touches,
      gaze: true,
      pointer2d: mouse,
      headPose: true,
      haptics: false, // xrblocks v0.20.0 has no haptics API
    };
    if (JSON.stringify(next) !== JSON.stringify(this.capabilities)) {
      this.capabilities = next;
      for (const listener of [...this.capsListeners]) listener(next);
    }
  }

  getHeadPose(): HeadPose {
    const position = this.context.camera.getWorldPosition(SCRATCH_V);
    const quaternion = this.context.camera.getWorldQuaternion(SCRATCH_Q);
    return {
      position: [position.x, position.y, position.z],
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w ?? 1],
    };
  }
}

function normalizeHandedness(value: string | undefined): "left" | "right" | "none" {
  return value === "left" || value === "right" ? value : "none";
}

function copyRay(ray: RayLike): {
  origin: [number, number, number];
  direction: [number, number, number];
} {
  // Upstream slot objects are pooled — copy, never retain.
  return {
    origin: [ray.origin.x, ray.origin.y, ray.origin.z],
    direction: [ray.direction.x, ray.direction.y, ray.direction.z],
  };
}
