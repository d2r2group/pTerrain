import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storeTheme, THEME_KEY } from "../src/ui/theme";

/** An in-memory `Storage` stand-in. */
function memoryStorage() {
  const items = new Map<string, string>();
  return { setItem: (key: string, value: string) => void items.set(key, value), items };
}

/** A storage that throws on every write, as a browser with blocked site data does. */
const blocked = {
  setItem(): void {
    throw new DOMException("blocked", "SecurityError");
  },
};

// Reading the choice back is the inline script in index.html; the Playwright reload test runs it.
describe("stored theme", () => {
  it("stores the latest choice under its key", () => {
    const storage = memoryStorage();
    storeTheme("dark", storage);
    expect(storage.items.get(THEME_KEY)).toBe("dark");
    storeTheme("light", storage);
    expect(storage.items.get(THEME_KEY)).toBe("light");
  });

  it("does not throw when storage is blocked or missing", () => {
    expect(() => storeTheme("dark", blocked)).not.toThrow();
    expect(() => storeTheme("dark", null)).not.toThrow();
  });

  it("is read before the first paint by index.html under the same key", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).toContain(`localStorage.getItem("${THEME_KEY}")`);
  });
});
