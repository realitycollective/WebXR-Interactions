/** Test doubles: a scripted input provider, hit tester and transform port. */
import {
  NO_CAPABILITIES,
  type InputCapabilities,
  type InputHitHint,
  type InputProvider,
  type InputSourceSnapshot,
  type HeadPose,
  type PoseTuple,
  type QuatTuple,
  type RayTuple,
  type Vec3Tuple,
} from "@realitycollective/webxr-input";
import type { HitTester, InteractableHit, TransformPort } from "@realitycollective/webxr-interactions";

export class FakeProvider implements InputProvider {
  capabilities: InputCapabilities = {
    ...NO_CAPABILITIES,
    rays: true,
    pokes: true,
    grabs: "poseOnly",
    handJoints: true,
    pinch: true,
    headPose: true,
    haptics: true,
  };
  sources: InputSourceSnapshot[] = [];
  hints: InputHitHint[] = [];
  headPose: HeadPose = { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] };
  pulses: Array<{ sourceId: string; intensity: number; durationMs: number }> = [];
  private capsListeners = new Set<(c: InputCapabilities) => void>();

  getCapabilities(): InputCapabilities {
    return this.capabilities;
  }

  setCapabilities(capabilities: Partial<InputCapabilities>): void {
    this.capabilities = { ...this.capabilities, ...capabilities };
    for (const listener of [...this.capsListeners]) listener(this.capabilities);
  }

  onCapabilitiesChanged(listener: (c: InputCapabilities) => void): () => void {
    this.capsListeners.add(listener);
    return () => this.capsListeners.delete(listener);
  }

  onSourcesChanged(): () => void {
    return () => undefined;
  }

  sample(): readonly InputSourceSnapshot[] {
    return this.sources;
  }

  sampleHints(): readonly InputHitHint[] {
    return this.hints;
  }

  getHeadPose(): HeadPose {
    return this.headPose;
  }

  pulse(sourceId: string, intensity: number, durationMs: number): boolean {
    this.pulses.push({ sourceId, intensity, durationMs });
    return true;
  }
}

export class FakeHitTester implements HitTester {
  rayTarget: string | null = null;
  proximityTarget: string | null = null;

  hitRay(_ray: RayTuple): InteractableHit | null {
    return this.rayTarget
      ? { interactableId: this.rayTarget, distance: 1, point: [0, 0, 0] }
      : null;
  }

  hitProximity(_point: Vec3Tuple, _radius: number): InteractableHit | null {
    return this.proximityTarget
      ? { interactableId: this.proximityTarget, distance: 0.01, point: [0, 0, 0] }
      : null;
  }
}

export class FakeTransform implements TransformPort {
  restPose: PoseTuple = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  localOffset: Vec3Tuple = [0, 0, 0];
  localRotation: QuatTuple = [0, 0, 0, 1];
  worldPose: PoseTuple | null = null;
  effect: { scale?: number; emissive?: number } | null = null;

  getWorldPose(): PoseTuple {
    return this.restPose;
  }

  getLocalOffset(): Vec3Tuple {
    return this.localOffset;
  }

  setLocalOffset(offset: Vec3Tuple): void {
    this.localOffset = offset;
  }

  setLocalRotation(quaternion: QuatTuple): void {
    this.localRotation = quaternion;
  }

  setWorldPose(pose: PoseTuple): void {
    this.worldPose = pose;
  }

  setEffect(effect: { scale?: number; emissive?: number }): void {
    this.effect = effect;
  }
}

export function raySource(
  id: string,
  overrides: Partial<InputSourceSnapshot> = {},
): InputSourceSnapshot {
  return {
    id,
    kind: "controller",
    handedness: "right",
    ray: { origin: [0, 1.5, 0], direction: [0, 0, -1] },
    select: 0,
    squeeze: 0,
    ...overrides,
  };
}

export function handSource(
  id: string,
  overrides: Partial<InputSourceSnapshot> = {},
): InputSourceSnapshot {
  return {
    id,
    kind: "hand",
    handedness: "right",
    ray: { origin: [0, 1.5, 0], direction: [0, 0, -1] },
    gripPose: { position: [0.1, 1.2, -0.3], quaternion: [0, 0, 0, 1] },
    indexTip: [0.1, 1.2, -0.35],
    select: 0,
    squeeze: 0,
    ...overrides,
  };
}
