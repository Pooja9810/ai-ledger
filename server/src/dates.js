// Calendar dates in the server's LOCAL timezone.
// (toISOString() would use UTC — at 9pm in New York that's already "tomorrow".)

/** Today as 'YYYY-MM-DD'. */
export const today = () => new Date().toLocaleDateString("en-CA");

/** This month as 'YYYY-MM'. */
export const currentMonth = () => today().slice(0, 7);

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/; // 'YYYY-MM', months 01–12

/**
 * First and last possible day of a month, as strings. '-31' works for every
 * month because ISO dates compare correctly as text: '2026-11-31' is after
 * every real November date and before '2026-12-01'.
 */
export const monthRange = (month) => [`${month}-01`, `${month}-31`];

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** '2026-11-11' → 'Wednesday' (computed from the parts, so no timezone shift). */
export function weekdayOf(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Last day of a month (1–12): day 0 of the next month. */
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Friendly label for a date range, for people (not machines):
 *   2026-11-01..2026-11-12 → "Nov 1–12, 2026"
 *   2026-10-01..2026-10-31 → "October 2026"          (a whole month)
 *   2026-10-15..2026-11-12 → "Oct 15 – Nov 12, 2026"
 *   2025-12-01..2026-01-31 → "Dec 1, 2025 – Jan 31, 2026"
 */
export function formatDateRange(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (fy === ty && fm === tm) {
    if (fd === 1 && td === lastDay(ty, tm))
      return `${MONTHS_LONG[fm - 1]} ${fy}`;
    if (fd === td) return `${MONTHS[fm - 1]} ${fd}, ${fy}`;
    return `${MONTHS[fm - 1]} ${fd}–${td}, ${fy}`;
  }
  if (fy === ty)
    return `${MONTHS[fm - 1]} ${fd} – ${MONTHS[tm - 1]} ${td}, ${fy}`;
  return `${MONTHS[fm - 1]} ${fd}, ${fy} – ${MONTHS[tm - 1]} ${td}, ${ty}`;
}

/**
 * Friendly label for a month or month range:
 *   "2026-11"            → "November 2026"
 *   "2026-06".."2026-11" → "Jun – Nov 2026"
 *   "2025-11".."2026-02" → "Nov 2025 – Feb 2026"
 */
export function formatMonthRange(fromMonth, toMonth = fromMonth) {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  if (fromMonth === toMonth) return `${MONTHS_LONG[fm - 1]} ${fy}`;
  if (fy === ty) return `${MONTHS[fm - 1]} – ${MONTHS[tm - 1]} ${fy}`;
  return `${MONTHS[fm - 1]} ${fy} – ${MONTHS[tm - 1]} ${ty}`;
}
