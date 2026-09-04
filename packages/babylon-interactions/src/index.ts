/**
 * @realitycollective/babylon-interactions - the Babylon.js engine adapter:
 * Babylon WebXR input, sphere or app-supplied hit-testing, and transform
 * ports over Babylon nodes. The core is re-exported wholesale, so apps
 * depend on exactly this package.
 *
 * Structurally typed against the Babylon API rather than importing
 * `@babylonjs/core`, in the same way as the XR Blocks adapter, so an
 * upstream release cannot break the install.
 */
export * from "@realitycollective/webxr-interactions";

export * from "./babylon-types.js";
export * from "./provider.js";
export * from "./hit-tester.js";
export * from "./transform-port.js";
export * from "./host.js";
