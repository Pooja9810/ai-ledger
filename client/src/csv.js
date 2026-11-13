/**
 * Reading bank CSV exports in the browser. Pure functions, so every bank
 * quirk can be tested. The raw file never leaves the user's computer; only
 * the normalized rows they approve are sent to the server, which
 * re-validates them.
 *
 * Banks differ: column names, date formats (MM/DD vs DD/MM!), one amount
 * column vs separate debit/credit columns, credit cards showing purchases
 * as positive, "$1,234.56" or "(4.00)" amounts, files with no header row.
 */
import Papa from "papaparse";

export const MAX_IMPORT_ROWS = 2000; // same limit as the server

// ---------------------------------------------------------------- amounts

/**
 * Text → signed integer cents, without floating-point math.
 *   "$1,234.56" → 123456   "-4.00" / "(4.00)" / "4.00-" / "−4" → -400
 * Returns null for anything that isn't an amount.
 */
export function parseAmountCents(value) {
  let text = String(value ?? "").trim();
  if (text === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true; // accounting style: (4.00) means -4.00
    text = text.slice(1, -1);
  }
  text = text
    .replace(/[−–]/g, "-")
    .replace(/[$,\s]/g, "")
    .replace(/^(CAD|USD)|(CAD|USD)$/i, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.endsWith("-")) {
    negative = !negative; // some banks write "4.00-"
    text = text.slice(0, -1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  const match = /^(\d*)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match || text === "" || text === ".") return null;
  const cents =
    Number(match[1] || "0") * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return negative ? -cents : cents;
}

// ------------------------------------------------------------------ dates

const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const ISO = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/; // 2026-11-09, 2026/11/09
const NUMERIC = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/; // 11/09/2026, 09.11.26
const TEXT_MDY = /^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/i; // Nov 9, 2026
const TEXT_DMY = /^(\d{1,2}) ([a-z]{3,9})\.?,? (\d{4})$/i; // 9 Nov 2026

/** A real calendar date as 'YYYY-MM-DD', or null (rejects 2026-02-30). */
function isoDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "Nov", "november", "Sept" → 11, 11, 9; unknown → undefined. */
const monthNumber = (name) => MONTHS[name.toLowerCase().slice(0, 3)];

/**
 * Work out a column's date format from its values.
 * @returns { format: "YMD" | "MDY" | "DMY" | "TEXT", ambiguous } or null
 *   ambiguous = true when every date fits both MM/DD and DD/MM
 *   (e.g. only 03/04/2026): the UI must ask the user.
 */
export function detectDateFormat(values) {
  const samples = values.map((v) => String(v ?? "").trim()).filter(Boolean);
  if (samples.length === 0) return null;
  if (samples.every((v) => ISO.test(v)))
    return { format: "YMD", ambiguous: false };
  if (samples.every((v) => TEXT_MDY.test(v) || TEXT_DMY.test(v))) {
    return { format: "TEXT", ambiguous: false };
  }
  const parts = samples.map((v) => NUMERIC.exec(v));
  if (parts.some((p) => !p)) return null;
  const firstOver12 = parts.some((p) => Number(p[1]) > 12);
  const secondOver12 = parts.some((p) => Number(p[2]) > 12);
  if (firstOver12 && secondOver12) return null; // not one consistent format
  if (firstOver12) return { format: "DMY", ambiguous: false }; // 25/12/2026
  if (secondOver12) return { format: "MDY", ambiguous: false }; // 12/25/2026
  return { format: "MDY", ambiguous: true }; // can't tell: North American default, ask
}

/** Parse one date in a known format → 'YYYY-MM-DD' or null. */
export function parseDate(value, format) {
  const text = String(value ?? "").trim();
  let match;
  if (format === "YMD" && (match = ISO.exec(text))) {
    return isoDate(+match[1], +match[2], +match[3]);
  }
  if ((format === "MDY" || format === "DMY") && (match = NUMERIC.exec(text))) {
    const year = match[3].length === 2 ? 2000 + +match[3] : +match[3];
    const [m, d] =
      format === "MDY" ? [+match[1], +match[2]] : [+match[2], +match[1]];
    return isoDate(year, m, d);
  }
  if (format === "TEXT") {
    if ((match = TEXT_MDY.exec(text))) {
      const m = monthNumber(match[1]);
      return m ? isoDate(+match[3], m, +match[2]) : null;
    }
    if ((match = TEXT_DMY.exec(text))) {
      const m = monthNumber(match[2]);
      return m ? isoDate(+match[3], m, +match[1]) : null;
    }
  }
  return null;
}

// ---------------------------------------------------------- reading files

/**
 * CSV text → { headers, rows, hasHeader, firstLine }. Uses papaparse for
 * quoting ("TIM HORTONS, TORONTO"), line breaks and BOMs. If the first row
 * already looks like data (has a date and an amount), the file has no header
 * and columns are named "Column 1", "Column 2", …
 *
 * Blank lines are KEPT (as empty rows) so row positions match line numbers
 * in the file; firstLine is the file line of rows[0], for error messages.
 */
export function readCsv(text) {
  const { data } = Papa.parse(String(text).replace(/^\uFEFF/, ""));
  const all = data.map((row) => row.map((cell) => String(cell).trim()));
  const isBlank = (row) => row.every((cell) => cell === "");
  const start = all.findIndex((row) => !isBlank(row)); // skip leading blank lines
  if (start === -1)
    return { headers: [], rows: [], hasHeader: false, firstLine: 1 };

  const width = Math.max(...all.map((r) => r.length));
  const padded = all.map((r) => [...r, ...Array(width - r.length).fill("")]);
  const first = padded[start];
  const hasDate = first.some((cell) => detectDateFormat([cell]) !== null);
  const hasAmount = first.some(
    (cell) =>
      /\d/.test(cell) &&
      detectDateFormat([cell]) === null &&
      parseAmountCents(cell) !== null,
  );
  if (hasDate && hasAmount) {
    return {
      headers: first.map((_, i) => `Column ${i + 1}`),
      rows: padded.slice(start),
      hasHeader: false,
      firstLine: start + 1,
    };
  }
  return {
    headers: first,
    rows: padded.slice(start + 1),
    hasHeader: true,
    firstLine: start + 2,
  };
}

// ------------------------------------------------------- column detection

const HEADER_PATTERNS = {
  date: /\bdate\b|posted|posting/i,
  description: /desc|payee|merchant|details|narrative|memo|name|particulars/i,
  debit: /debit|withdraw|money out|paid out|outflow|charge/i,
  credit: /credit|deposit|money in|paid in|inflow|payment/i,
  amount: /amount|value|\bcad\b|\busd\b/i,
  balance: /balance/i,
};

const columnValues = (rows, i) =>
  rows.map((r) => r[i] ?? "").filter((v) => v !== "");
const isMostly = (values, test) =>
  values.length > 0 && values.filter(test).length / values.length >= 0.8;

/**
 * Guess which column is which. Header names first, then content.
 * @returns { date, description, amount, debit, credit, dateFormat, dateAmbiguous }
 *   column indexes or null; either `amount` or both `debit` and `credit` are set.
 */
export function detectMapping(headers, rows) {
  const sample = rows
    .filter((r) => r.some((cell) => cell !== ""))
    .slice(0, 200);
  const used = new Set();
  const byName = (key) => {
    const i = headers.findIndex(
      (h, idx) =>
        !used.has(idx) &&
        HEADER_PATTERNS[key].test(h) &&
        !HEADER_PATTERNS.balance.test(h),
    );
    if (i === -1) return null;
    used.add(i);
    return i;
  };

  let date = byName("date");
  let debit = byName("debit");
  let credit = byName("credit");
  if (debit === null || credit === null) {
    // need both for the debit/credit style; give them back otherwise
    if (debit !== null) used.delete(debit);
    if (credit !== null) used.delete(credit);
    debit = credit = null;
  }
  let amount = debit === null ? byName("amount") : null;
  let description = byName("description");

  // Content fallbacks (files without headers, or unusual names).
  const columns = headers.map((_, i) => i);
  const isBalance = (i) => HEADER_PATTERNS.balance.test(headers[i]);
  if (date === null) {
    date =
      columns.find(
        (i) =>
          !used.has(i) && detectDateFormat(columnValues(sample, i)) !== null,
      ) ?? null;
    if (date !== null) used.add(date);
  }
  const numeric = columns.filter(
    (i) =>
      !used.has(i) &&
      !isBalance(i) &&
      isMostly(columnValues(sample, i), (v) => parseAmountCents(v) !== null),
  );
  if (amount === null && debit === null && numeric.length > 0) {
    const [a, b] = numeric;
    const filled = (i) => sample.filter((r) => (r[i] ?? "") !== "").length;
    const neverBoth =
      b !== undefined &&
      sample.every((r) => !((r[a] ?? "") !== "" && (r[b] ?? "") !== ""));
    if (
      b !== undefined &&
      neverBoth &&
      filled(a) < sample.length &&
      filled(b) < sample.length
    ) {
      [debit, credit] = [a, b]; // two half-empty columns: withdrawals, deposits
      used.add(a).add(b);
    } else {
      amount = a; // a later numeric column is usually a running balance
      used.add(a);
    }
  }
  if (description === null) {
    const avgLength = (i) => {
      const vals = columnValues(sample, i);
      return vals.reduce((s, v) => s + v.length, 0) / Math.max(vals.length, 1);
    };
    const text = columns.filter((i) => !used.has(i) && !isBalance(i));
    description = text.sort((x, y) => avgLength(y) - avgLength(x))[0] ?? null;
  }

  const detected =
    date === null ? null : detectDateFormat(columnValues(sample, date));
  return {
    date,
    description,
    amount,
    debit,
    credit,
    dateFormat: detected?.format ?? null,
    dateAmbiguous: detected?.ambiguous ?? false,
  };
}

// ------------------------------------------------------------- conversion

/**
 * Rows + mapping → transactions in Ledgerly's format, plus problems.
 * Expenses come out negative, income positive (see CLAUDE.md).
 *
 * @param flipSign   for credit cards, whose exports show purchases as positive
 * @param firstLine  file line of rows[0] (from readCsv), for messages
 * @returns { transactions: [{ line, date, description, amount_cents }],
 *            problems: [{ line, reason }] }   line = the line number in the file
 */
export function toTransactions(
  rows,
  mapping,
  { flipSign = false, firstLine = 2 } = {},
) {
  const transactions = [];
  const problems = [];
  rows.forEach((row, i) => {
    const line = firstLine + i; // matches the line number in the file
    if (row.every((cell) => cell === "")) return;

    const rawDate = row[mapping.date] ?? "";
    const date = parseDate(rawDate, mapping.dateFormat);

    let cents = null;
    if (mapping.amount !== null && mapping.amount !== undefined) {
      cents = parseAmountCents(row[mapping.amount]);
      if (cents !== null && flipSign) cents = -cents;
    } else {
      const out = parseAmountCents(row[mapping.debit]);
      const into = parseAmountCents(row[mapping.credit]);
      if (out !== null || into !== null) {
        cents = Math.abs(into ?? 0) - Math.abs(out ?? 0); // withdrawals negative
      }
    }

    if (!date)
      problems.push({ line, reason: `can't read the date "${rawDate}"` });
    else if (!cents) problems.push({ line, reason: "no amount" });
    else {
      transactions.push({
        line,
        date,
        description: String(row[mapping.description] ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        amount_cents: cents,
      });
    }
  });
  return { transactions, problems };
}

/**
 * Credit-card exports usually show purchases as POSITIVE numbers. If a
 * single amount column is mostly positive, suggest flipping the sign
 * (the user confirms with a checkbox).
 */
export function suggestFlip(transactions, mapping) {
  if (mapping.amount === null || mapping.amount === undefined) return false;
  if (transactions.length === 0) return false;
  const positive = transactions.filter((t) => t.amount_cents > 0).length;
  return positive / transactions.length > 0.7;
}
