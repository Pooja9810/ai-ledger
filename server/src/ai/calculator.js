/**
 * The "calculate" tool: exact arithmetic for the AI, so it never does math
 * in its head. Money is handled as integer cents; plain numbers (counts,
 * months) as ordinary numbers.
 *
 * Deliberately a fixed list of OPERATIONS, not a free-form expression:
 * evaluating text from the AI as code (eval) would let it run anything on
 * our server. Structured input is safe and easy to validate.
 */
import { formatCents } from "../money.js";

export const OPERATIONS = [
  "add",
  "subtract",
  "multiply",
  "divide",
  "average",
  "percent_of",
  "percent_change",
];
const MAX_VALUES = 50;

/** How many values each operation takes: [min, max]. */
const ARITY = {
  add: [2, MAX_VALUES],
  subtract: [2, MAX_VALUES], // first minus all the rest
  multiply: [2, MAX_VALUES],
  divide: [2, 2],
  average: [1, MAX_VALUES],
  percent_of: [2, 2], // [part, whole]
  percent_change: [2, 2], // [old, new]
};

/**
 * "$1,234.56" → { money: true, cents: 123456 }; "−$4.00" → cents -400;
 * "10.5" or 10.5 → { money: false, number: 10.5 }. Anything else → null.
 */
export function parseValue(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? { money: false, number: value } : null;
  }
  if (typeof value !== "string") return null;
  let text = value.trim().replace(/[−–]/g, "-").replace(/[,\s]/g, "");
  const negative = text.startsWith("-");
  if (negative) text = text.slice(1);
  const money = text.startsWith("$");
  if (money) text = text.slice(1);
  if (!/^\d+(\.\d+)?$/.test(text)) return null;

  if (money) {
    const [dollars, cents = ""] = text.split(".");
    if (cents.length > 2) return null; // "$1.234" isn't money
    const total = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
    return { money: true, cents: negative ? -total : total };
  }
  const number = Number(text);
  return { money: false, number: negative ? -number : number };
}

/** A plain number for display: at most 4 decimals, no trailing zeros. */
const showNumber = (n) => String(Number(n.toFixed(4)));
/** A percentage with one decimal and an explicit sign when asked. */
const showPercent = (p, signed = false) =>
  `${signed && p > 0 ? "+" : ""}${p.toFixed(1)}%`.replace("-", "−");

/**
 * @param operation  one of OPERATIONS
 * @param values     list of "$12.50" money strings or plain numbers
 * @returns { result: { operation, values, answer } } or { error }
 */
export function calculate({ operation, values }) {
  if (!OPERATIONS.includes(operation)) {
    return { error: `operation must be one of: ${OPERATIONS.join(", ")}` };
  }
  if (!Array.isArray(values)) return { error: "values must be a list" };
  const [min, max] = ARITY[operation];
  if (values.length < min || values.length > max) {
    return {
      error:
        min === max
          ? `${operation} needs exactly ${min} values`
          : `${operation} needs ${min} to ${max} values`,
    };
  }

  const parsed = values.map(parseValue);
  const bad = parsed.findIndex((p) => p === null);
  if (bad !== -1) {
    return {
      error: `value ${JSON.stringify(values[bad])} isn't a number or an amount like "$12.50"`,
    };
  }

  const answer = compute(operation, parsed);
  if (answer.error) return answer;
  return { result: { operation, values, answer: answer.text } };
}

function compute(operation, vals) {
  const allMoney = vals.every((v) => v.money);
  const noMoney = vals.every((v) => !v.money);
  const sameKind = allMoney || noMoney;
  const mixed = {
    error: `${operation} can't mix amounts ("$12.50") and plain numbers`,
  };
  // As one plain number per value (cents for money), for ratios and percentages.
  const raw = vals.map((v) => (v.money ? v.cents : v.number));

  switch (operation) {
    case "add":
    case "subtract":
    case "average": {
      if (!sameKind) return mixed;
      const [first, ...rest] = raw;
      const total =
        operation === "subtract"
          ? rest.reduce((sum, x) => sum - x, first)
          : raw.reduce((sum, x) => sum + x, 0);
      const value = operation === "average" ? total / raw.length : total;
      return {
        text: allMoney ? formatCents(Math.round(value)) : showNumber(value),
      };
    }

    case "multiply": {
      const moneyCount = vals.filter((v) => v.money).length;
      if (moneyCount > 1)
        return { error: "can't multiply two amounts together" };
      const product = raw.reduce((p, x) => p * x, 1);
      return {
        text: moneyCount
          ? formatCents(Math.round(product))
          : showNumber(product),
      };
    }

    case "divide": {
      const [a, b] = vals;
      if (raw[1] === 0) return { error: "can't divide by zero" };
      if (!a.money && b.money)
        return { error: "can't divide a number by an amount" };
      if (a.money && !b.money) {
        return { text: formatCents(Math.round(a.cents / b.number)) }; // $ ÷ count
      }
      return { text: showNumber(raw[0] / raw[1]) }; // a ratio
    }

    case "percent_of": {
      if (!sameKind) return mixed;
      if (raw[1] === 0) return { error: "the whole can't be zero" };
      return { text: showPercent((raw[0] * 100) / raw[1]) };
    }

    case "percent_change": {
      if (!sameKind) return mixed;
      if (raw[0] === 0) return { error: "can't compute a change from zero" };
      return {
        text: showPercent(((raw[1] - raw[0]) * 100) / Math.abs(raw[0]), true),
      };
    }
  }
  return { error: "unsupported operation" }; // unreachable: checked above
}
