// The light/dark theme. Until the sun/moon button is pressed the page follows
// `prefers-color-scheme`; pressing it sets `data-theme` on <html> and remembers the choice. The
// inline script in index.html applies the stored choice before the first paint.

import { icon, MOON, SUN } from "./icons";

export type Theme = "light" | "dark";

/** The `localStorage` key of the stored choice; index.html reads the same key. */
export const THEME_KEY = "pterrain-theme";

/** Fired on `document` when the button switches the theme. */
const THEME_EVENT = "pterrain-themechange";

/** The subset of `Storage` that the theme uses. */
type ThemeStorage = Pick<Storage, "setItem">;

/** Remembers the choice; a blocked storage only means it is forgotten on reload. */
export function storeTheme(theme: Theme, storage: ThemeStorage | null = safeLocalStorage()): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    // Nothing to do: the page still switches, it just does not remember.
  }
}

/** The theme in use: the chosen one, or the system's. */
export function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Sets and remembers `theme`, and tells `onThemeChange` listeners. */
export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  storeTheme(theme);
  document.dispatchEvent(new Event(THEME_EVENT));
}

/** Calls `listener` whenever the theme in use may have changed: by the button or by the system. */
export function onThemeChange(listener: () => void): () => void {
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", listener);
  document.addEventListener(THEME_EVENT, listener);
  return () => {
    scheme.removeEventListener("change", listener);
    document.removeEventListener(THEME_EVENT, listener);
  };
}

/**
 * The sun/moon button: the moon in light mode and the sun in dark mode, named after the theme it
 * switches to.
 */
export function createThemeToggle(container: HTMLElement): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme-toggle icon-button";
  container.append(button);

  const sync = () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    button.dataset.next = next;
    button.setAttribute("aria-label", `Switch to ${next} theme`);
    button.title = `Switch to ${next} theme`;
    button.innerHTML = icon(next === "dark" ? MOON : SUN);
  };
  button.addEventListener("click", () => setTheme(currentTheme() === "dark" ? "light" : "dark"));
  sync();
  onThemeChange(sync);
}

/** `localStorage`, or null where even reading the property throws (blocked site data). */
export function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
