# WebXR Interactions

A framework-agnostic **interaction library for WebXR** - an engine-free core (interactables, interactors, behaviours, gaze-dwell, capability negotiation, feedback hooks) plus swappable engine adapters, built to the same conventions as the Reality Collective [WebXR-UIExtensions](https://github.com/realitycollective/WebXR-UIExtensions).

## Packages

| Package | Role |
| --- | --- |
| [`@realitycollective/webxr-input`](../WebXR-Input/README.md) | **Shared input contracts** (zero deps) - now its OWN sibling folder/repo-to-be (`../WebXR-Input`), consumed here via workspace aliases and a root `file:` dev-link; both extension families depend on it. |
| `@realitycollective/webxr-interactions` | **THE CORE** (engine-free): behaviours (`press` incl. latching, `pulse`, `hinge`, `dial`, `slide`, `grab` poseOnly/native, `tossScore`), gaze (`required` gating + dwell-to-press), the runtime/binder (hints > poke > ray targeting, hysteresis, lifecycle, capability negotiation with visible `behaviourDisabled`), events as the ONLY outbound pathway, feedback intents (haptics/audio are the client's - `routeHapticsToProvider` is an explicit opt-in). |
| `@realitycollective/threejs-interactions` | **Default standalone adapter**: raw WebXR (`XRSession` sources, hand joints, select/squeeze + gamepad analog, haptic pulse) + three.js hit-testing/transform ports + desktop mouse fallback. No framework required. |
| `@realitycollective/iwsdk-interactions` | **Meta IWSDK adapter**: player-rig poses + stateful gamepads as the provider; IWSDK's own targeting (`Pressed`/`Grabbed` tags) forwarded as pre-resolved hints - provider power wins; native grab fulfilment (`nativeGrab: true` when the app enables IWSDK grabbing/physics). `registerInteractions(world)` one-call setup. |
| `@realitycollective/xrblocks-interactions` | **EXPERIMENTAL Google XR Blocks adapter**, structurally typed against xrblocks v0.20.0 (`Input.getFrame()` ray sources + direct touches; pooled structs copied; no haptics upstream). |

Adapters re-export the core wholesale - an app depends on exactly one package.

## Demo

`demos/playground` - the independent interaction playground (standalone three.js/WebXR, desktop mouse mode included): the full station set from one portable `InteractionDescriptor` (button, gaze-dwell button with progress ring, three lever mounts, dial, pulley, grab-ball + scoring hoop), with client-side audio cues, opt-in controller haptics and client-side toss ballistics (physics is a property of the object, not the interaction layer).

```bash
cd WebXR-Interactions
npm install
npm run dev:playground     # http://localhost:8082 - mouse works, VR button for headsets
```

## Commands

| Command | What |
| --- | --- |
| `npm install` | set up the workspace |
| `npm test` | vitest - engine-free architecture gates + behaviour/runtime/adapter suites |
| `npm run typecheck` | strict typecheck, all packages |
| `npm run build` | `tsc` → `dist/` per package |
| `npm run dev:playground` | run the playground demo |

## Layering rule

```
app → ONE adapter (threejs | iwsdk | xrblocks) → core (webxr-interactions) → contracts (@realitycollective/webxr-input, separate repo)
```

Arrows only point down; the core's architecture test fails the moment an engine import lands in it. Physics deliberately stays with the client/app - adapters surface it only as the `grabs: "native"` capability.
