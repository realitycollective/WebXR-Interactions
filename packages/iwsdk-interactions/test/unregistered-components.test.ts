/**
 * An IWSDK app may create its world with a feature off (`physics: false`,
 * `grabbing: false`). The world then never registers that feature's
 * components, and elics throws when an entity is asked about a component it
 * has never registered. `register` must work in such a world: this drives it
 * with a real elics entity whose world registered only what IWSDK always
 * registers (the interactable tags), never the physics components.
 */
import { describe, expect, it } from "vitest";
import { World as EcsWorld } from "elics";
import { Object3D } from "three";
import { PhysicsBody, PhysicsShape, PokeInteractable, RayInteractable, type Entity, type World } from "@iwsdk/core";
import { registerInteractions } from "@realitycollective/iwsdk-interactions";
import { makeWorld } from "./helpers.js";

describe("register in a world with physics off", () => {
  it("registers a pressable entity without asking about unregistered physics components", () => {
    const ecs = new EcsWorld();
    ecs.registerComponent(RayInteractable).registerComponent(PokeInteractable);
    const entity = ecs.createEntity() as unknown as Entity & { object3D: Object3D };
    (entity as { object3D: Object3D }).object3D = new Object3D();
    // What elics does with a component its world never registered: the question itself throws.
    expect(() => entity.hasComponent(PhysicsBody)).toThrow();

    const host = registerInteractions(makeWorld() as unknown as World);
    expect(() =>
      host.register({ id: "button", behaviours: [{ kind: "press" }] } as never, entity),
    ).not.toThrow();
    expect(entity.hasComponent(PokeInteractable)).toBe(true);
    expect(entity.hasComponent(RayInteractable)).toBe(true);
    expect(PhysicsShape.bitmask ?? null).toBeNull();
    host.dispose();
  });
});
