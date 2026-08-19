/**
 * @realitycollective/webxr-interactions — the engine-free interaction core.
 *
 * Layers (each strictly on the one below):
 *  - behaviours (press, pulse, hinge, dial, slide, grab, tossScore) —
 *    pure state machines driven by `update(dt)`;
 *  - the runtime/binder — targeting, press/grab transitions, gaze gating
 *    + dwell, capability negotiation, events, feedback intents;
 *  - the shared input contracts, re-exported from
 *    `@realitycollective/webxr-input`.
 *
 * Pair with an engine adapter: `@realitycollective/threejs-interactions`
 * (standalone WebXR + three.js), `@realitycollective/iwsdk-interactions`
 * (Meta IWSDK) or `@realitycollective/xrblocks-interactions` (Google XR
 * Blocks, experimental).
 */
export * from "@realitycollective/webxr-input";

export * from "./math.js";
export * from "./events.js";
export * from "./feedback.js";
export * from "./ports.js";
export * from "./gaze.js";
export * from "./descriptor.js";
export * from "./runtime.js";
export * from "./pointer-bridge.js";

export * from "./behaviours/behaviour.js";
export * from "./behaviours/press.js";
export * from "./behaviours/pulse.js";
export * from "./behaviours/hinge.js";
export * from "./behaviours/dial.js";
export * from "./behaviours/slide.js";
export * from "./behaviours/grab.js";
export * from "./behaviours/toss-score.js";
export * from "./behaviours/factory.js";
