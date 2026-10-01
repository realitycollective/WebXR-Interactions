// Write harness/native/scenes/playground.iwsdk.scene.json from the playground's station layout
// (demos/playground/src/scene.ts), so the native host places the same parts at the same poses the
// web playground builds. Run after changing the layout: node harness/native/scripts/write-scene.mjs
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = resolve(here, "../build/scene");
mkdirSync(out, { recursive: true });
const bundle = resolve(out, "scene.cjs");
await build({
  entryPoints: [resolve(root, "demos/playground/src/scene.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  outfile: bundle,
  alias: { "@realitycollective/webxr-interactions": resolve(root, "packages/webxr-interactions/src/index.ts") },
  logLevel: "warning",
});
const scene = createRequire(import.meta.url)(bundle);

const deg = (radians) => Number(((radians * 180) / Math.PI).toFixed(4));
const round = (n) => Number(n.toFixed(5));

/** A node for one part: its asset, its transform, and its children (parts that hang from it). */
function node(part, parts) {
  const transform = { position: part.position.map(round) };
  if (part.yaw !== undefined || part.pitch !== undefined) transform.rotationDeg = [deg(part.pitch ?? 0), deg(part.yaw ?? 0), 0];
  if (part.scale !== undefined) transform.scale = [part.scale, part.scale, part.scale];
  const children = parts.filter((p) => p.parent === part.name).map((p) => node(p, parts));
  return {
    id: part.name,
    name: part.name,
    transform,
    ...(part.shape.kind === "group" ? {} : { content: { type: "asset", asset: part.name } }),
    ...(children.length ? { children } : {}),
  };
}

const parts = scene.STATION_PARTS;
const doc = {
  version: "iwsdk.scene.v1",
  units: "meters",
  metadata: {
    "com.realitycollective.interactions-harness":
      "The Interactions playground stations, generated from demos/playground/src/scene.ts by harness/native/scripts/write-scene.mjs. Interactable parts are the nodes named pg-*; the harness registers them by id.",
  },
  resources: {},
  nodes: parts.filter((p) => !p.parent).map((p) => node(p, parts)),
};
const target = resolve(here, "../scenes/playground.iwsdk.scene.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(doc, null, 2) + "\n");
console.log(JSON.stringify({ step: "scene", file: target, nodes: doc.nodes.length, interactables: parts.filter((p) => p.name.startsWith("pg-")).length }));
