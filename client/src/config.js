// The server puts its config in the page (<meta name="ledgerly-config">), so
// the demo banner is drawn on the first paint. In development (Vite serves
// the page) there's no tag, and App falls back to asking /api/config.

/** Parse the tag's JSON; null if it's missing or broken. */
export function readPageConfig(doc) {
  const content = doc
    ?.querySelector('meta[name="ledgerly-config"]')
    ?.getAttribute("content");
  if (!content) return null;
  try {
    const config = JSON.parse(content);
    return config && typeof config === "object" ? config : null;
  } catch {
    return null;
  }
}
