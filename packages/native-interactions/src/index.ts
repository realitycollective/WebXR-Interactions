/**
 * Public entry point of the native adapter: the same kinds of export as the
 * Babylon, three.js, IWSDK and XR Blocks adapters. The core is re-exported;
 * the provider, hit tester and transform port implement its contracts; the
 * setup entry point wires them together; and the slice types describe what
 * the native app installs on `globalThis.__rcHost`. One addition the web
 * adapters do not need: the host conformance kit a native app runs on its
 * device against its real slices. Slice reading and tuple copying stay
 * internal.
 */
export * from "@realitycollective/webxr-interactions";
export type {
  NativeFrameSource,
  NativeHit,
  NativeHostSlices,
  NativeInputFacts,
  NativeInputHost,
  NativeInteractionHost,
  NativeInteractionsTestHost,
  NativePresenceShown,
} from "./native-types.js";
export * from "./provider.js";
export * from "./hit-tester.js";
export * from "./transform-port.js";
export * from "./host.js";
export { nativeInteractionsHostConformanceCases } from "./conformance.js";
export type {
  NativeInteractionsHostConformanceCase,
  NativeInteractionsHostConformanceSetup,
} from "./conformance.js";
