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
| **Setup** | One call: `registerInteractions(world)` |

## Usage

```ts
import { registerInteractions } from "@realitycollective/iwsdk-interactions";

const interactions = registerInteractions(world);

interactions.register({ id: "handle", behaviours: [{ kind: "grab" }] }, entity);

interactions.runtime.onEvent((event) => console.log(event.type));
```

`registerInteractions` is idempotent per world and registers the bridge system for you; the render loop is driven by IWSDK, so there is no `update` call to make.

## Peer dependency

`@iwsdk/core >=0.4.0 <0.6.0`.

## Live demo

The interaction playground - the full station set, mouse-capable on desktop, VR button for headsets: **[webxr-interactions.pages.dev](https://webxr-interactions.pages.dev)**

## Documentation

See the [repository README](https://github.com/realitycollective/WebXR-Interactions#readme).

## License

MIT - see [LICENSE](./LICENSE).
