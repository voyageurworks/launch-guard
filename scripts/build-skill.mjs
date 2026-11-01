// Bundles dist/main.js (built by tsc) into one file the skill can run from a plain clone.
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Bundles `<workDir>/dist/main.js` into `outfile`. Deterministic: no timestamps, no absolute paths in the output.
 * `workDir` defaults to the project root; a test passes a temp folder holding its own `dist/`, so it never
 * touches the real build output (the bundle's `// dist/...` comments are relative to `workDir`).
 */
export async function bundle(outfile = join(root, "skill", "launch-guard.mjs"), workDir = root) {
  await build({
    entryPoints: ["dist/main.js"],
    absWorkingDir: workDir,
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "warning",
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await bundle();
