/**
 * Light the harness's scene through the native host's `environment` slice,
 * read structurally. A native scene has no light until something applies
 * one, and an unlit scene draws every mesh that is not self-lit black. The
 * web playground adds its own lights with its engine; here the host owns
 * rendering, so the harness asks it for a plain studio look: a soft gradient
 * sky, an ambient light and one key light from above and behind the viewer.
 *
 * This family owns no lighting contract. The members and the value shapes are
 * the Environment family's native contract (`applySky`, `applyAmbient`,
 * `applyKeyLight`: colours as `[r, g, b]` from 0 to 1, the key light's
 * direction the way the light travels), declared here as the three calls the
 * harness makes and nothing more.
 */
type Rgb = [number, number, number];

interface EnvironmentSliceLike {
  applySky?(sky: { kind: "gradient"; top: Rgb; bottom: Rgb; horizon: number } | null): void;
  applyAmbient?(light: { colour: Rgb; intensity: number } | null): void;
  applyKeyLight?(light: { colour: Rgb; intensity: number; direction: [number, number, number] } | null): void;
}

const rgb = (hex: number): Rgb => [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];

/** Apply the studio look. Returns what was applied, or why nothing was, for the log. */
export function lightStage(host: unknown): { lit: boolean; note: string } {
  const environment = (host as { environment?: EnvironmentSliceLike } | null | undefined)?.environment;
  if (!environment) return { lit: false, note: "the host has no environment slice: the scene is unlit" };
  try {
    environment.applySky?.({ kind: "gradient", top: rgb(0x1b2a41), bottom: rgb(0x5d6f86), horizon: 0.5 });
    environment.applyAmbient?.({ colour: rgb(0xdfe9f5), intensity: 1.1 });
    environment.applyKeyLight?.({ colour: rgb(0xfff4e0), intensity: 2, direction: [-0.35, -0.85, -0.4] });
    return { lit: true, note: "gradient sky, ambient and one key light" };
  } catch (error) {
    return { lit: false, note: `the environment slice refused the stage light: ${String((error as Error)?.message ?? error)}` };
  }
}
