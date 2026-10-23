import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths, so the same build works at any GitHub Pages subpath.
  base: "./",
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
