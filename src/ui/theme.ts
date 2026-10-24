// The light/dark theme. The page is light until the sun/moon button is pressed; pressing it sets
// `data-theme` on <html> and remembers the choice. The inline script in index.html applies the
// stored choice before the first paint.

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

/** The theme in use: the chosen one, or light. */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Sets and remembers `theme`, and tells `onThemeChange` listeners. */
export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  storeTheme(theme);
  document.dispatchEvent(new Event(THEME_EVENT));
}

/** Calls `listener` whenever the button switches the theme. */
export function onThemeChange(listener: () => void): () => void {
  document.addEventListener(THEME_EVENT, listener);
  return () => document.removeEventListener(THEME_EVENT, listener);
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
