import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { testTimeout: 180_000, maxWorkers: 2, exclude: ["dist/**", "node_modules/**"] },
});
