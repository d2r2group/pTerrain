import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../vite.config";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("vite config", () => {
  it("builds with relative asset paths so the site works at any Pages subpath", () => {
    expect(config.base).toBe("./");
  });
});

describe("license", () => {
  it("is MIT, in LICENSE and in package.json", () => {
    expect(read("LICENSE").startsWith("MIT License\n")).toBe(true);
    expect(JSON.parse(read("package.json")).license).toBe("MIT");
  });
});
