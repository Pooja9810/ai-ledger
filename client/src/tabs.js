// The app's four screens. Each has its own address (#budgets), so the
// browser's Back button works and a link can open a screen directly.

export const TABS = [
  { id: "home", label: "Home" },
  { id: "transactions", label: "Transactions" },
  { id: "budgets", label: "Budgets" },
  { id: "ask", label: "Ask" },
];

/** '#budgets' → 'budgets'; anything unknown (or empty) → 'home'. */
export function tabFromHash(hash) {
  const id = String(hash ?? "")
    .replace(/^#\/?/, "")
    .toLowerCase();
  return TABS.some((t) => t.id === id) ? id : "home";
}

/** 'budgets' → '#budgets' */
export const hashFor = (id) => `#${id}`;
