# @realitycollective/webxr-interactions

The core of the Reality Collective Interaction Extensions. It holds all the interaction logic for WebXR and contains no 3D engine code at all.

Two words are used throughout. An **interactable** is an object that can be interacted with, such as a button. An **interactor** is the thing doing the interacting: a hand, controller, ray or mouse.

```sh
npm install @realitycollective/webxr-interactions
```

> You usually do **not** install this directly. Install an adapter for your engine instead. Each adapter re-exports everything here, so your app depends on one package: [`threejs-interactions`](https://www.npmjs.com/package/@realitycollective/threejs-interactions) · [`iwsdk-interactions`](https://www.npmjs.com/package/@realitycollective/iwsdk-interactions) · [`xrblocks-interactions`](https://www.npmjs.com/package/@realitycollective/xrblocks-interactions)

## What it provides

| Area | Detail |
| --- | --- |
| **Behaviours** | Ready-made interaction types: `press` (with an optional latching mode that stays down until pressed again), `pulse`, `hinge`, `dial`, `slide`, `grab`, and `tossScore` for throw-and-catch scoring |
| **Gaze** | Optional look-to-activate. Require the user to be looking before an object responds, or let a sustained look trigger the press by itself |
| **Targeting** | Picks one target per hand, trying the platform's own answer first, then a close-range touch, then a pointing ray. A short delay stops the target flickering between two objects on a boundary |
| **Capability checks** | If the headset cannot do what a behaviour needs, the behaviour switches itself off and reports `behaviourDisabled`, rather than silently doing nothing |
| **Events** | The core never calls into your code. It emits events and you subscribe |
| **Feedback** | The core asks for a haptic pulse or a sound. Playing it is your app's job. `routeHapticsToProvider` is an opt-in helper that sends those requests straight to the controller |

All input arrives through the shared [`@realitycollective/webxr-input`](https://www.npmjs.com/package/@realitycollective/webxr-input) types, so the same core runs on any runtime that has an adapter.

## Design rules

- **No engine imports.** No `three`, no `@iwsdk/*`, no `xrblocks`. The adapter supplies the code that works out what a ray hits, and the code that moves an object.
- **Events out, never callbacks in.** The core never reaches into your objects.
- **Fail loudly, not silently.** A behaviour the hardware cannot support reports `behaviourDisabled` instead of quietly doing nothing.

## Live demo

The interaction playground - the full station set, mouse-capable on desktop, VR button for headsets: **[webxr-interactions.pages.dev](https://webxr-interactions.pages.dev)**

## Documentation

Full architecture notes, the behaviour catalogue and the playground demo live in the [repository README](https://github.com/realitycollective/WebXR-Interactions#readme).

## License

MIT - see [LICENSE](./LICENSE).
