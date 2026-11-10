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
