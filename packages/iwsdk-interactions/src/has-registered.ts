import type { Entity } from "@iwsdk/core";

/**
 * Whether `entity` carries `component`, answering false for a component its
 * world never registered. IWSDK registers a feature's components only when
 * the app turns that feature on (`PhysicsBody` and `PhysicsShape` with
 * `features.physics`), and elics throws when an entity is asked about an
 * unregistered component: an app with physics off would otherwise fail on
 * its first registration. elics gives a component its `bitmask` when a world
 * registers it, and never before.
 */
export function hasRegistered(entity: Entity, component: Parameters<Entity["hasComponent"]>[0]): boolean {
  return (component as { bitmask?: unknown }).bitmask != null && entity.hasComponent(component);
}
