// Light / dark / follow the device ("system"). The choice is remembered
// per browser; "system" stores nothing and follows the device setting.

export const THEMES = ["system", "light", "dark"];
const KEY = "ledgerly-theme";

/** The button cycles system → light → dark → system. */
export function nextTheme(theme) {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}

/** What the toggle button says (its accessible name). */
export function themeLabel(theme) {
  return {
    system: "Theme: matches your device. Switch to light",
    light: "Theme: light. Switch to dark",
    dark: "Theme: dark. Switch to match your device",
  }[theme];
}

/** Read the saved choice; storage can be missing or throw (private mode). */
export function loadTheme(storage) {
  try {
    const saved = storage?.getItem(KEY);
    return THEMES.includes(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(storage, theme) {
  try {
    if (theme === "system") storage?.removeItem(KEY);
    else storage?.setItem(KEY, theme);
  } catch {
    // Not saved: the choice still applies until the page is closed.
  }
}

/**
 * Apply to <html data-theme>. The CSS uses dark colors for data-theme="dark",
 * and for "system" when the device prefers dark.
 */
export function applyTheme(root, theme) {
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}
