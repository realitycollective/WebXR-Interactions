/**
 * The playground's stations as NAMED SCENE-ASSETS for the native host: the
 * same three.js builders the web playground uses (`stations-three.ts`),
 * cooked to glTF by the conversion pipeline (`rc assets`), one asset per
 * part, placed by `scenes/playground.iwsdk.scene.json`. Only the cook runs
 * this module; the harness bundle never imports three.js.
 *
 * Each asset is the part's own mesh at the origin: position, rotation and
 * scale live in the scene document, as the pipeline expects.
 */
import { AssetType, defineAssets } from "@iwsdk/core";
import { Mesh, type Object3D } from "three";
import { buildStations } from "../../demos/playground/src/stations-three.js";
import { STATION_PARTS } from "../../demos/playground/src/scene.js";

void AssetType;

const built = buildStations();
const assets: Record<string, Object3D> = {};
for (const part of STATION_PARTS) {
  // A group part (a mount) has no geometry: the document carries it as a plain node with no content.
  if (part.shape.kind === "group") continue;
  const object = built.parts.get(part.name);
  if (!object) continue;
  // A bare mesh at the origin, detached from its parent: the document places it.
  if (!(object instanceof Mesh)) continue;
  const asset = new Mesh(object.geometry, object.material);
  asset.name = part.name;
  assets[part.name] = asset;
}

// IWSDK's typings widen three.js's Object3D with pointer-capture members the cook never reads.
export default defineAssets(assets as never);
