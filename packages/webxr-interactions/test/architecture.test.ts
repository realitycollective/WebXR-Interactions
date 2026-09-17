/**
 * Architectural gate: the interaction core must stay engine-free. Its only
 * permitted runtime dependency is the shared input-contract package.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const FORBIDDEN = [
  "'@iwsdk/",
  '"@iwsdk/',
  "'three'",
  '"three"',
  "'@pmndrs/",
  '"@pmndrs/',
  "'super-three",
  "'xrblocks",
  '"xrblocks',
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("engine-free package", () => {
  it("src/ imports no engine packages anywhere", () => {
    const files = tsFiles(SRC);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const marker of FORBIDDEN) {
        expect(
          source.includes(`from ${marker}`) || source.includes(`import ${marker}`),
          `${file} must not import ${marker}`,
        ).toBe(false);
      }
    }
  });

  it("runtime dependencies are exactly the shared input contracts", () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([
      "@realitycollective/webxr-input",
    ]);
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });
});
