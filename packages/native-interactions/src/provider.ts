/**
 * NativeInputProvider - the native host's input provider.
 *
 * A thin, copying pass-through over the `input` slice a native app (OpenXR,
 * visionOS) installs on `globalThis.__rcHost`, or hands in directly for
 * tests. Every snapshot, and every tuple inside it, is copied before it
 * leaves this class, so a host that reuses its own sample buffers still
 * meets the ownership rule the shared contract suite checks.
 *
 * Optional members - `getHeadPose`, `sampleHints`, `pulse`,
 * `setPresenceVisible`, `setPresenceModality` - are only ever assigned when
 * the host itself carries them, so `typeof provider.pulse` answers honestly
 * for a host that cannot pulse rather than a method that is present but
 * always returns false.
 */
import {
  type Handedness,
  type HeadPose,
  type InputCapabilities,
  type InputHitHint,
  type InputProvider,
  type InputSourceSnapshot,
  type PresenceModality,
  type Unsubscribe,
} from "@realitycollective/webxr-input";
import { copyPose, copySnapshot, resolveHostSlice, type NativeInputHost } from "./native-types.js";

export interface NativeInputProviderOptions {
  /** The `input` slice. Omit to read `globalThis.__rcHost.input`. */
  input?: NativeInputHost;
}

export class NativeInputProvider implements InputProvider {
  private readonly host: NativeInputHost;

  readonly getHeadPose?: () => HeadPose;
  readonly sampleHints?: () => readonly InputHitHint[];
  readonly pulse?: (sourceId: string, intensity: number, durationMs: number) => boolean;
  readonly setPresenceVisible?: (target: Handedness | "all", visible: boolean) => boolean;
  readonly setPresenceModality?: (mode: PresenceModality) => boolean;

  constructor(options: NativeInputProviderOptions = {}) {
    this.host = resolveHostSlice("input", options.input);

    if (this.host.getHeadPose) {
      const host = this.host;
      this.getHeadPose = () => copyPose(host.getHeadPose!());
    }
    if (this.host.sampleHints) {
      const host = this.host;
      this.sampleHints = () => host.sampleHints!().map((hint) => ({ ...hint }));
    }
    if (this.host.pulse) {
      const host = this.host;
      this.pulse = (sourceId, intensity, durationMs) => host.pulse!(sourceId, intensity, durationMs);
    }
    if (this.host.setPresenceVisible) {
      const host = this.host;
      this.setPresenceVisible = (target, visible) => host.setPresenceVisible!(target, visible);
    }
    if (this.host.setPresenceModality) {
      const host = this.host;
      this.setPresenceModality = (mode) => host.setPresenceModality!(mode);
    }
  }

  getCapabilities(): InputCapabilities {
    return this.host.getCapabilities();
  }

  onCapabilitiesChanged(listener: (capabilities: InputCapabilities) => void): Unsubscribe {
    return this.host.onCapabilitiesChanged(listener);
  }

  onSourcesChanged(listener: () => void): Unsubscribe {
    return this.host.onSourcesChanged(listener);
  }

  sample(): readonly InputSourceSnapshot[] {
    return this.host.sample().map(copySnapshot);
  }
}
