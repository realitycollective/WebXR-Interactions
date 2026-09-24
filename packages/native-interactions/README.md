# @realitycollective/native-interactions

The native host adapter for the Reality Collective Interaction Extensions. A native app (OpenXR on Quest, CompositorServices on visionOS, or any other shell embedding a JavaScript engine such as Hermes) installs `globalThis.__rcHost`, and this package reads its `input` and `interactions` slices into the [`@realitycollective/webxr-interactions`](https://www.npmjs.com/package/@realitycollective/webxr-interactions) core.

```sh
npm install @realitycollective/native-interactions
```

It re-exports everything from the core, so this is the only interaction package your app needs.

## What it binds

| Layer | Detail |
| --- | --- |
| **Input** | `__rcHost.input` - the same members as `InputProvider`: capabilities, source sampling, optional head pose, hints, haptics and presence |
| **Hit-testing** | `__rcHost.interactions.hitRay` / `hitProximity` - the native app owns the scene and physics, so targeting is entirely its answer |
| **Movement** | `__rcHost.interactions`, keyed by the target id you chose when you registered the object with the native scene |
| **No engine dependency** | Assets and rendering stay in the native app; only numbers, strings, booleans and tuples cross the boundary |

## Usage

One call, the same shape as `createBabylonInteractions` and `createThreeInteractions`:

```ts
import { createNativeInteractions } from "@realitycollective/native-interactions";

// Reads globalThis.__rcHost.input / .interactions when no slice is passed in,
// and drives update(dt) from the app's own frame callback, __rcHost.onFrame.
const interactions = createNativeInteractions({ attachToHost: true });

interactions.register({ id: "button", behaviours: [{ kind: "press" }] });
interactions.runtime.onEvent((event) => console.log(event.type));
```

The native app owns the scene, so an interactable is registered by id alone. The app answers hit queries and pose reads for that id through the `interactions` slice. Without `attachToHost`, call `interactions.update(dtSeconds)` from your own loop. `dispose()` detaches from the frame callback and disposes the runtime.

The provider, hit tester and transform port are exported too, as on every adapter, for an app that composes the runtime itself.

Pass the slices directly, typically in a test or when your host object is not on `globalThis`:

```ts
const provider = new NativeInputProvider({ input: myInputSlice });
const hitTester = new NativeHitTester({ interactions: myInteractionSlice });
const port = new NativeTransformPort("button", { interactions: myInteractionSlice });
```

A missing slice - neither passed in nor found on `globalThis.__rcHost` - throws one clear error naming it, at construction, rather than failing on the first call that needed it.

## Things to know

- **Copies, not references.** Every snapshot `sample()` returns, and every tuple inside it, is copied before it leaves `NativeInputProvider`, so a host that reuses its own sample buffers cannot change a snapshot your app is still holding. The same applies to hit results and to poses read through `NativeTransformPort`.
- **Optional members are honest.** `getHeadPose`, `sampleHints`, `pulse`, `setPresenceVisible` and `setPresenceModality` on `NativeInputProvider`, and `setWorldPose`/`setEffect` on `NativeTransformPort`, are only ever present when the host slice itself carries the matching member - never a method that silently no-ops.
- **One port per interactable.** `TransformPort` is per object; the native host is one object serving every registered interactable, so `NativeTransformPort` binds one `targetId` onto it, the same idea as an engine adapter's port binding to one scene node.
- **`NativeHit.targetId`** is renamed to the core's `interactableId` on the way through `NativeHitTester` - the native host names the thing it hit, the core names the thing it manages.

## Peer dependency

None. No engine object crosses the boundary in either direction.

## Documentation

See the [repository README](https://github.com/realitycollective/WebXR-Interactions#readme).

## License

MIT - see [LICENSE](./LICENSE).
