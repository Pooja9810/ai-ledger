// Calendar dates in the server's LOCAL timezone.
// (toISOString() would use UTC — at 9pm in New York that's already "tomorrow".)

/** Today as 'YYYY-MM-DD'. */
export const today = () => new Date().toLocaleDateString("en-CA");

/** This month as 'YYYY-MM'. */
export const currentMonth = () => today().slice(0, 7);
