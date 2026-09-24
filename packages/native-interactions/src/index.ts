/**
 * Public entry point of the native adapter: the same kinds of export as the
 * Babylon, three.js, IWSDK and XR Blocks adapters. The core is re-exported;
 * the provider, hit tester and transform port implement its contracts; the
 * setup entry point wires them together; and the slice types describe what
 * the native app installs on `globalThis.__rcHost`. Slice reading and tuple
 * copying stay internal.
 */
export * from "@realitycollective/webxr-interactions";
export type {
  NativeFrameSource,
  NativeHit,
  NativeHostSlices,
  NativeInputHost,
  NativeInteractionHost,
} from "./native-types.js";
export * from "./provider.js";
export * from "./hit-tester.js";
export * from "./transform-port.js";
export * from "./host.js";
