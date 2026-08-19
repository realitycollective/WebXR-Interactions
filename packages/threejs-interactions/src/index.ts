/**
 * @realitycollective/threejs-interactions — the default, standalone engine
 * adapter: raw WebXR input + three.js hit-testing/transform ports. The
 * core is re-exported wholesale, so apps depend on exactly this package.
 */
export * from "@realitycollective/webxr-interactions";

export * from "./webxr-provider.js";
export * from "./hit-tester.js";
export * from "./transform-port.js";
export * from "./host.js";
