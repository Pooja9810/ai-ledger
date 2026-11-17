import { describe, it, expect } from "vitest";
import {
  applyTheme,
  loadTheme,
  nextTheme,
  saveTheme,
  themeLabel,
} from "./theme.js";

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
};

describe("theme", () => {
  it("cycles system → light → dark → system", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });

  it("remembers light and dark, and forgets on system", () => {
    const storage = memoryStorage();
    expect(loadTheme(storage)).toBe("system");
    saveTheme(storage, "dark");
    expect(loadTheme(storage)).toBe("dark");
    saveTheme(storage, "system");
    expect(loadTheme(storage)).toBe("system");
  });

  it("falls back to system when storage throws or holds junk", () => {
    const broken = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(loadTheme(broken)).toBe("system");
    expect(() => saveTheme(broken, "dark")).not.toThrow();
    expect(loadTheme({ getItem: () => "purple" })).toBe("system");
    expect(loadTheme(undefined)).toBe("system");
  });

  it("sets or removes data-theme on the root element", () => {
    const attrs = {};
    const root = {
      setAttribute: (k, v) => (attrs[k] = v),
      removeAttribute: (k) => delete attrs[k],
    };
    applyTheme(root, "dark");
    expect(attrs["data-theme"]).toBe("dark");
    applyTheme(root, "system");
    expect(attrs["data-theme"]).toBeUndefined();
  });

  it("names what each click will do", () => {
    expect(themeLabel("dark")).toMatch(/Switch to match your device/);
  });
});
