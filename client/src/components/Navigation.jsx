import { useState } from "react";
import { TABS, hashFor } from "../tabs.js";
import {
  applyTheme,
  loadTheme,
  nextTheme,
  saveTheme,
  themeLabel,
} from "../theme.js";
import {
  BarsIcon,
  ChatIcon,
  DeviceIcon,
  HomeIcon,
  ListIcon,
  MoonIcon,
  SunIcon,
} from "./Icons.jsx";

const TAB_ICONS = {
  home: HomeIcon,
  transactions: ListIcon,
  budgets: BarsIcon,
  ask: ChatIcon,
};

/**
 * The four screens as links (#home, #budgets…), so Back works and a screen
 * can be shared. "top" sits in the desktop header; "bottom" is the phone's
 * tab bar. CSS shows one or the other by screen width.
 */
export function TabNav({ current, variant }) {
  return (
    <nav
      className={`tab-nav tab-nav-${variant}`}
      aria-label={variant === "top" ? "Main" : "Main (bottom)"}
    >
      {TABS.map(({ id, label }) => {
        const TabIcon = TAB_ICONS[id];
        return (
          <a
            key={id}
            href={hashFor(id)}
            aria-current={current === id ? "page" : undefined}
          >
            {variant === "bottom" && <TabIcon size={22} />}
            {label}
          </a>
        );
      })}
    </nav>
  );
}

/** One button cycling Match device → Light → Dark; remembered per browser. */
export function ThemeToggle() {
  const [theme, setTheme] = useState(() => loadTheme(safeStorage()));
  const ThemeIcon = { system: DeviceIcon, light: SunIcon, dark: MoonIcon }[
    theme
  ];

  function cycle() {
    const next = nextTheme(theme);
    setTheme(next);
    applyTheme(document.documentElement, next);
    saveTheme(safeStorage(), next);
  }

  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      onClick={cycle}
      aria-label={themeLabel(theme)}
      title={themeLabel(theme)}
    >
      <ThemeIcon size={18} />
    </button>
  );
}

// localStorage itself can throw (blocked site data), not just its methods.
function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
