import { describe, it, expect } from "vitest";
import {
  parseAmountCents,
  detectDateFormat,
  parseDate,
  readCsv,
  detectMapping,
  toTransactions,
  suggestFlip,
  fileProblem,
  isConfident,
  describeMapping,
} from "./csv.js";

// ------------------------------------------------ fake bank exports (no real data)

// 1. Simple: ISO dates, one signed amount column.
const SIMPLE = `Date,Description,Amount
2026-11-09,TIM HORTONS #123,-4.25
2026-11-10,ACME PAYROLL,4125.00
`;

// 2. Quoted fields with commas, $ signs, MM/DD/YYYY, accounting negatives, a balance column.
const QUOTED = `"Transaction Date","Payee","Amount","Balance"
"11/09/2026","TIM HORTONS, TORONTO ON","($4.25)","$1,995.75"
"11/13/2026","ACME CORP PAYROLL","$4,125.00","$6,120.75"
`;

// 3. No header row; separate withdrawal / deposit columns; running balance last.
const NO_HEADER_DEBIT_CREDIT = `11/09/2026,TIM HORTONS #123,4.25,,1995.75
11/13/2026,ACME PAYROLL,,4125.00,6120.75
11/14/2026,NO FRILLS #33,67.31,,6053.44
`;

// 4. Credit card: purchases POSITIVE, payments negative; two date columns.
const CREDIT_CARD = `Transaction Date,Posting Date,Description,Amount
2026-11-09,2026-11-10,UBER *EATS,31.50
2026-11-11,2026-11-12,NETFLIX.COM,16.99
2026-11-12,2026-11-12,AMZN MKTP CA*7X1,45.99
2026-11-15,2026-11-15,PAYMENT - THANK YOU,-200.00
`;

// 5. Day-first dates (25/12 can only be DD/MM), Debit/Credit headers, a BOM.
const DAY_FIRST = `﻿Date,Details,Debit,Credit
25/10/2026,CINEPLEX,28.75,
03/11/2026,E-TRANSFER RECEIVED,,50.00
`;

/** read → detect → convert, like the import dialog does. */
function importText(text, options = {}) {
  const { headers, rows, hasHeader, firstLine } = readCsv(text);
  const mapping = detectMapping(headers, rows);
  const result = toTransactions(rows, mapping, { firstLine, ...options });
  return { headers, hasHeader, mapping, ...result };
}
const simplified = (txs) =>
  txs.map((t) => [t.date, t.description, t.amount_cents]);

describe("whole files, from different bank styles", () => {
  it("1. simple ISO dates and a signed amount", () => {
    const out = importText(SIMPLE);
    expect(out.mapping).toMatchObject({
      date: 0,
      description: 1,
      amount: 2,
      dateFormat: "YMD",
    });
    expect(simplified(out.transactions)).toEqual([
      ["2026-11-09", "TIM HORTONS #123", -425],
      ["2026-11-10", "ACME PAYROLL", 412500],
    ]);
    expect(out.problems).toEqual([]);
  });

  it("2. quotes, commas inside fields, $ and (accounting) negatives; ignores the balance", () => {
    const out = importText(QUOTED);
    expect(out.mapping).toMatchObject({
      date: 0,
      description: 1,
      amount: 2,
      dateFormat: "MDY",
    });
    expect(out.mapping.dateAmbiguous).toBe(false); // 11/13 proves month-first
    expect(simplified(out.transactions)).toEqual([
      ["2026-11-09", "TIM HORTONS, TORONTO ON", -425],
      ["2026-11-13", "ACME CORP PAYROLL", 412500],
    ]);
  });

  it("3. no header row, withdrawal/deposit columns, balance last", () => {
    const out = importText(NO_HEADER_DEBIT_CREDIT);
    expect(out.hasHeader).toBe(false);
    expect(out.headers).toEqual([
      "Column 1",
      "Column 2",
      "Column 3",
      "Column 4",
      "Column 5",
    ]);
    expect(out.mapping).toMatchObject({
      date: 0,
      description: 1,
      amount: null,
      debit: 2,
      credit: 3,
    });
    expect(simplified(out.transactions)).toEqual([
      ["2026-11-09", "TIM HORTONS #123", -425], // withdrawal → negative
      ["2026-11-13", "ACME PAYROLL", 412500], // deposit → positive
      ["2026-11-14", "NO FRILLS #33", -6731],
    ]);
    expect(out.transactions[0].line).toBe(1); // no header: data starts on line 1
  });

  it("4. credit card: suggests flipping, and flipping makes purchases negative", () => {
    const raw = importText(CREDIT_CARD);
    expect(raw.mapping.date).toBe(0); // the transaction date, not the posting date
    expect(suggestFlip(raw.transactions, raw.mapping)).toBe(true);

    const flipped = importText(CREDIT_CARD, { flipSign: true });
    expect(simplified(flipped.transactions)).toEqual([
      ["2026-11-09", "UBER *EATS", -3150],
      ["2026-11-11", "NETFLIX.COM", -1699],
      ["2026-11-12", "AMZN MKTP CA*7X1", -4599],
      ["2026-11-15", "PAYMENT - THANK YOU", 20000], // a payment adds to the card
    ]);
  });

  it("5. day-first dates, Debit/Credit headers, a BOM", () => {
    const out = importText(DAY_FIRST);
    expect(out.headers[0]).toBe("Date"); // BOM removed
    expect(out.mapping).toMatchObject({
      debit: 2,
      credit: 3,
      dateFormat: "DMY",
    });
    expect(simplified(out.transactions)).toEqual([
      ["2026-10-25", "CINEPLEX", -2875],
      ["2026-11-03", "E-TRANSFER RECEIVED", 5000],
    ]);
  });

  it("doesn't suggest flipping a normal bank account", () => {
    const out = importText(NO_HEADER_DEBIT_CREDIT);
    expect(suggestFlip(out.transactions, out.mapping)).toBe(false); // debit/credit style
    const simple = importText(SIMPLE.replace("4125.00", "-4125.00"));
    expect(suggestFlip(simple.transactions, simple.mapping)).toBe(false);
  });

  it("reports problem rows by line number and skips blank lines", () => {
    const out = importText(`Date,Description,Amount
2026-11-09,GOOD,-1.00

2026-02-30,BAD DATE,-2.00
2026-11-10,NO AMOUNT,
2026-11-11,ZERO,0.00
`);
    expect(simplified(out.transactions)).toEqual([
      ["2026-11-09", "GOOD", -100],
    ]);
    expect(out.problems).toEqual([
      { line: 4, reason: 'can\'t read the date "2026-02-30"' },
      { line: 5, reason: "no amount" },
      { line: 6, reason: "no amount" },
    ]);
  });
});

describe("parseAmountCents", () => {
  it.each([
    ["-4.25", -425],
    ["4.25", 425],
    ["$1,234.56", 123456],
    ["($4.25)", -425],
    ["4.25-", -425],
    ["−4.25", -425], // unicode minus
    ["+5", 500],
    ["$-4.00", -400],
    ["-$4.00", -400],
    [" 7.5 ", 750],
    ["CAD 10.00", 1000],
    ["0.10", 10],
  ])("%j → %i", (text, cents) => {
    expect(parseAmountCents(text)).toBe(cents);
  });

  it.each([[""], ["abc"], ["1.234"], ["."], [null], ["4.25.1"]])(
    "rejects %j",
    (text) => {
      expect(parseAmountCents(text)).toBeNull();
    },
  );
});

describe("detectDateFormat", () => {
  it.each([
    [["2026-11-09", "2026-11-10"], { format: "YMD", ambiguous: false }],
    [["11/09/2026", "11/13/2026"], { format: "MDY", ambiguous: false }],
    [["25/10/2026", "03/11/2026"], { format: "DMY", ambiguous: false }],
    [["03/04/2026", "05/06/2026"], { format: "MDY", ambiguous: true }], // can't tell: ask
    [["Nov 9, 2026", "9 Nov 2026"], { format: "TEXT", ambiguous: false }],
  ])("%j → %j", (values, expected) => {
    expect(detectDateFormat(values)).toEqual(expected);
  });

  it.each([[["hello"]], [["13/25/2026"]], [[]]])(
    "returns null for %j",
    (values) => {
      expect(detectDateFormat(values)).toBeNull();
    },
  );
});

describe("parseDate", () => {
  it.each([
    ["2026-11-09", "YMD", "2026-11-09"],
    ["2026/1/5", "YMD", "2026-01-05"],
    ["03/04/2026", "MDY", "2026-03-04"],
    ["03/04/2026", "DMY", "2026-04-03"], // same text, different meaning
    ["9.11.26", "DMY", "2026-11-09"], // 2-digit year
    ["Nov 9, 2026", "TEXT", "2026-11-09"],
    ["9 November 2026", "TEXT", "2026-11-09"],
    ["Sept 30 2026", "TEXT", "2026-09-30"],
  ])("%s as %s → %s", (text, format, expected) => {
    expect(parseDate(text, format)).toBe(expected);
  });

  it.each([
    ["2026-02-30", "YMD"],
    ["02/30/2026", "MDY"],
    ["2026-11-09", "MDY"], // wrong format for the text
    ["Foo 9, 2026", "TEXT"],
  ])("rejects %s as %s", (text, format) => {
    expect(parseDate(text, format)).toBeNull();
  });
});

describe("readCsv", () => {
  it("skips leading blank lines but keeps line numbers right", () => {
    const out = importText(
      "\n\nDate,Description,Amount\n2026-11-09,X,1.00\n2026-02-30,Y,1.00",
    );
    expect(out.headers).toEqual(["Date", "Description", "Amount"]);
    expect(out.transactions[0].line).toBe(4);
    expect(out.problems[0].line).toBe(5);
  });

  it("handles an empty file", () => {
    expect(readCsv("")).toEqual({
      headers: [],
      rows: [],
      hasHeader: false,
      firstLine: 1,
    });
  });

  it("pads short rows so every row has every column", () => {
    const { rows } = readCsv("Date,Description,Amount\n2026-11-09,X");
    expect(rows).toEqual([["2026-11-09", "X", ""]]);
  });
});

describe("fileProblem (catching files that aren't CSV)", () => {
  it.each([
    ["statement.numbers", /Numbers file.*Export To → CSV/],
    ["statement.XLSX", /Excel file.*Save As → CSV/],
    ["statement.xls", /Excel file/],
    ["statement.pdf", /PDF.*CSV download/],
  ])("explains how to export %s", (name, message) => {
    expect(fileProblem(name, "Date,Description,Amount")).toMatch(message);
  });

  it.each([
    ["a zip container", "PK\u0003\u0004[Content_Types].xml…"],
    ["null bytes", "Date,\u0000Description"],
    [
      "mostly unreadable bytes",
      "\uFFFD\uFFFD7\uFFFD\uFFFD7*\uFFFD\uFFFD".repeat(50),
    ],
  ])("rejects %s even when named .csv", (_label, text) => {
    expect(fileProblem("statement.csv", text)).toMatch(
      /doesn't look like a CSV/,
    );
  });

  it("accepts real CSV text, including a BOM and the odd replacement character", () => {
    expect(fileProblem("bank.csv", SIMPLE)).toBeNull();
    expect(fileProblem("bank.csv", DAY_FIRST)).toBeNull();
    expect(
      fileProblem("bank.csv", `${SIMPLE}2026-11-11,CAF\uFFFD,-3.00\n`),
    ).toBeNull();
  });
});

describe("isConfident (skip the column screen?)", () => {
  /** Run a file through detection and ask, like the dialog does. */
  const confident = (text) => {
    const { headers, rows, hasHeader, firstLine } = readCsv(text);
    const mapping = detectMapping(headers, rows);
    const { transactions, problems } = toTransactions(rows, mapping, {
      firstLine,
    });
    return isConfident({
      mapping,
      hasHeader,
      problems,
      flipSuggested: suggestFlip(transactions, mapping),
      count: transactions.length,
    });
  };

  it("skips for clear files: named columns, clear dates, no problems", () => {
    expect(confident(SIMPLE)).toBe(true);
    expect(confident(QUOTED)).toBe(true);
    expect(confident(DAY_FIRST)).toBe(true);
  });

  it.each([
    ["no header row (columns guessed from content)", NO_HEADER_DEBIT_CREDIT],
    ["a credit card (sign flip to confirm)", CREDIT_CARD],
    [
      "ambiguous dates",
      "Date,Description,Amount\n03/04/2026,X,-1.00\n05/06/2026,Y,-2.00\n",
    ],
    [
      "unreadable rows",
      "Date,Description,Amount\n2026-11-09,X,-1.00\n2026-02-30,Y,-2.00\n",
    ],
    ["an unusual header name", "Date,Ref,Amount\n2026-11-09,X,-1.00\n"],
  ])("asks when there's %s", (_label, text) => {
    expect(confident(text)).toBe(false);
  });
});

describe("describeMapping", () => {
  it("summarizes one amount column", () => {
    const { headers, rows } = readCsv(SIMPLE);
    expect(describeMapping(headers, detectMapping(headers, rows))).toBe(
      "Date (year first) · Description · Amount",
    );
  });

  it("summarizes withdrawal/deposit columns", () => {
    const { headers, rows } = readCsv(DAY_FIRST);
    expect(describeMapping(headers, detectMapping(headers, rows))).toBe(
      "Date (day first) · Details · Debit / Credit",
    );
  });
});
