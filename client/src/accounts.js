/**
 * Which account a new transaction starts on: the one used last time,
 * or the first account if that's unknown or has since been deleted.
 * Remembered per browser in localStorage (a convenience only; the app
 * works the same when storage is blocked or empty).
 */
const KEY = "ledgerly-last-account";

/**
 * @param {Array<{id: number|string}>} accounts
 * @param {string|null} rememberedId - last-used account id, if any
 * @returns {string} account id for the form ("" when there are no accounts)
 */
export function defaultAccountId(accounts, rememberedId) {
  if (!accounts || accounts.length === 0) return "";
  const remembered = accounts.find(
    (a) => String(a.id) === String(rememberedId),
  );
  return String((remembered ?? accounts[0]).id);
}

export function readLastAccount() {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null; // storage blocked (private mode, etc.)
  }
}

export function rememberAccount(id) {
  try {
    window.localStorage.setItem(KEY, String(id));
  } catch {
    // Not remembered; next time starts on the first account.
  }
}
