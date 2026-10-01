# @realitycollective/iwsdk-interactions

The Meta IWSDK adapter for the Reality Collective Interaction Extensions. It connects the [`@realitycollective/webxr-interactions`](https://www.npmjs.com/package/@realitycollective/webxr-interactions) core to Meta's [Immersive Web SDK](https://iwsdk.dev).

```sh
npm install @realitycollective/iwsdk-interactions @iwsdk/core
```

It re-exports everything from the core, so this is the only interaction package your app needs.

## What it binds

| Layer | Detail |
| --- | --- |
| **Input** | IWSDK's player rig, controller state and hand joints |
| **Targeting** | IWSDK already knows what is being pressed or grabbed, through its `Pressed` and `Grabbed` tags. The adapter passes that answer straight through instead of working it out again with rays |
| **Grab** | Where the app has IWSDK grabbing or physics turned on, IWSDK performs the grab itself |
| **Setup** | One call: `registerInteractions(world)`; `interactionsFor(world)` finds it again |
| **Pointer visuals** | `IWSDKPointerVisuals` applies the app's `pointerDisplay` to IWSDK's own `RayPointer` and `CursorVisual` (`pointerVisuals` defaults to true); `pointers` shares one `PointerArbiter` with the UI Extensions host |
| **Physics** | `IWSDKPhysicsFacility` over IWSDK's own `PhysicsBody` / `PhysicsShape`: `register()` builds the held-pose binding for an entity that carries them, so a throw carries the object's velocity. A world created with `features.physics` off works unchanged |
| **Eye gaze** | `IWSDKInputProvider` reports `eyeGaze` when the session carries a gaze source and reads IWSDK's own eye pose; `eyeGaze` options tune the cone and dwell |
| **Parity proofs** | `test/near-pointer-reference.test.ts` and `test/trace-parity.test.ts` drive IWSDK 1.0.0's own pointer classes and every recorded trace beside the core rule, so this binding stays the reference the others are held to |

## Usage

```ts
import { registerInteractions } from "@realitycollective/iwsdk-interactions";

const interactions = registerInteractions(world);

interactions.register({ id: "handle", behaviours: [{ kind: "grab" }] }, entity);

interactions.runtime.onEvent((event) => console.log(event.type));
```

`registerInteractions` is idempotent per world and registers the bridge system for you; the render loop is driven by IWSDK, so there is no `update` call to make.

## Peer dependencies

`@iwsdk/core >=1.0.0 <2.0.0`. 1.0 is the only line CI exercises, so that is the only line supported.

`@iwsdk/xr-input >=1.0.0 <2.0.0` and `three >=0.170.0`. Every IWSDK application already has both: `@iwsdk/core` installs `@iwsdk/xr-input`, and IWSDK projects carry `three` (aliased to `super-three`). The adapter imports three.js classes from `three` and `InputComponent` from `@iwsdk/xr-input` directly, rather than through `@iwsdk/core`'s star re-exports, so it prebundles even when an application excludes one of those packages from Vite's dependency optimizer to transform its source.

## Live demo

The interaction playground - the full station set on every platform, mouse-capable on desktop, VR button for headsets; add `?engine=iwsdk` for this adapter: **[webxr-interactions.pages.dev](https://webxr-interactions.pages.dev)**

## Documentation

See the [repository README](https://github.com/realitycollective/WebXR-Interactions#readme).

## License

MIT - see [LICENSE](./LICENSE).
