# Changelog

Change log for the Reality Collective WebXR Interaction Extensions packages. All four packages are versioned and released together; the version below is the one carried by the `v<version>` release tag.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Preview builds are not listed separately. The entry for a version accumulates while its previews are published, and is dated when that version is released.

## [0.1.0]

### Added

- `@realitycollective/webxr-interactions` - engine-free core: interactables and interactors, the behaviour set (`press` including latching, `pulse`, `hinge`, `dial`, `slide`, `grab` in poseOnly and native modes, `tossScore`), gaze (`required` gating and dwell-to-press), the runtime/binder with hints > poke > ray targeting, hysteresis and lifecycle, capability negotiation with a visible `behaviourDisabled` outcome, events as the only outbound pathway, and feedback intents (haptics and audio remain the client's, with `routeHapticsToProvider` as an explicit opt-in).
- `@realitycollective/threejs-interactions` - the default standalone adapter: raw WebXR (`XRSession` sources, hand joints, select/squeeze plus gamepad analog, haptic pulse), three.js hit-testing and transform ports, and a desktop mouse fallback. No framework required.
- `@realitycollective/iwsdk-interactions` - Meta IWSDK adapter: player-rig poses and stateful gamepads as the provider, IWSDK's own targeting (`Pressed` / `Grabbed` tags) forwarded as pre-resolved hints, and native grab fulfilment when the app enables IWSDK grabbing/physics. One-call `registerInteractions(world)` setup.
- `@realitycollective/xrblocks-interactions` - EXPERIMENTAL Google XR Blocks adapter, structurally typed against xrblocks v0.20.0 (`Input.getFrame()` ray sources and direct touches, pooled structs copied, no haptics upstream).
- `demos/playground` - the standalone interaction playground: the full station set from one portable `InteractionDescriptor`, with client-side audio cues, opt-in controller haptics and client-side toss ballistics.

### Changed

- `@realitycollective/iwsdk-interactions` targets **IWSDK 0.5.x**. Its peer range is now `>=0.5.0 <0.6.0` and it is developed and tested against `@iwsdk/core` 0.5.3. The adapter is source-compatible with 0.4.x and needed no code change, but 0.5 is the only line exercised, so it is the only line supported. Every symbol and runtime member the provider uses is present in both, and it already reads `world.input.xr.gamepads` rather than the accessor 0.5 deprecates.
- `demos/playground` no longer compiles UIKitML at build time. `@iwsdk/vite-plugin-uikitml` was discontinued at 0.4.2 and only ever did `JSON.stringify(parse(source))`, so the panel is served as `.uikitml` from `public/ui/` and parsed on load. The demo drops that plugin, and its station markup uses `rgba()` rather than `background-opacity`, which the 0.5 parser removed.

### Notes

- All four packages depend on `@realitycollective/webxr-input`, released independently from the [WebXR-Input](https://github.com/realitycollective/WebXR-Input) repository. That package must be published before this one.
- The interaction packages themselves carry no IWSDK coupling beyond the adapter: `webxr-interactions` is engine-free, and `threejs-interactions` and `xrblocks-interactions` peer only on three.js.

[0.1.0]: https://github.com/realitycollective/WebXR-Interactions/commits/main
