import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";
import { createAiClient, AiError } from "../src/ai/client.js";
import {
  scanReceipt,
  imageProblem,
  MAX_IMAGE_BYTES,
} from "../src/ai/scan-receipt.js";

// Tiny "images": just the right first bytes (magic numbers) plus padding.
const bytes = (...head) => Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);
const dataUrl = (type, buffer) =>
  `data:${type};base64,${buffer.toString("base64")}`;
const JPEG = dataUrl("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0));
const PNG = dataUrl("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a));
const GIF = dataUrl(
  "image/gif",
  Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(16)]),
);
const WEBP = dataUrl(
  "image/webp",
  Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBPVP8 "),
    Buffer.alloc(8),
  ]),
);

const CATEGORIES = [
  { id: 1, name: "Salary", kind: "income" },
  { id: 3, name: "Groceries", kind: "expense" },
  { id: 6, name: "Shopping", kind: "expense" },
];
const RECEIPT = {
  kind: "expense",
  amount: "30.08",
  date: "2026-11-08",
  description: "Maple Leaf Market",
  category: "Groceries",
};
const fakeAi = (data) => ({
  model: "fake",
  completeJson: vi.fn().mockResolvedValue({ data, usage: {} }),
});

describe("completeJson with images", () => {
  it("sends the image and the text as a list of parts", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "{}" } }],
    });
    const ai = createAiClient({ sdk: { chat: { completions: { create } } } });
    await ai.completeJson({
      system: "s json",
      user: "read it",
      images: [JPEG],
    });

    expect(create.mock.calls[0][0].messages[1]).toEqual({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: JPEG } },
        { type: "text", text: "read it" },
      ],
    });
  });

  it("keeps plain text messages as a string without images", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "{}" } }],
    });
    const ai = createAiClient({ sdk: { chat: { completions: { create } } } });
    await ai.completeJson({ system: "s json", user: "hi" });
    expect(create.mock.calls[0][0].messages[1]).toEqual({
      role: "user",
      content: "hi",
    });
  });
});

describe("scanReceipt", () => {
  const scan = (data) =>
    scanReceipt(fakeAi(data), {
      image: JPEG,
      today: "2026-11-13",
      categories: CATEGORIES,
    });

  it("returns a validated draft from the receipt", async () => {
    expect(await scan({ transactions: [RECEIPT] })).toEqual([
      {
        kind: "expense",
        amount_cents: -3008,
        date: "2026-11-08",
        description: "Maple Leaf Market",
        category: { id: 3, name: "Groceries" },
      },
    ]);
  });

  it("sends the photo, today with its weekday, and both category lists", async () => {
    const ai = fakeAi({ transactions: [] });
    await scanReceipt(ai, {
      image: PNG,
      today: "2026-11-13",
      categories: CATEGORIES,
    });
    const { images, user, system } = ai.completeJson.mock.calls[0][0];
    expect(images).toEqual([PNG]);
    expect(user).toContain("Today: 2026-11-13 (Friday)");
    expect(user).toContain("Expense categories: Groceries, Shopping");
    expect(system).toMatch(/FINAL total/);
    expect(system).toContain("json");
  });

  it("applies the same field checks as typed notes", async () => {
    const [draft] = await scan({
      transactions: [
        {
          ...RECEIPT,
          date: "2026-12-25",
          amount: "thirty",
          category: "Coffee",
        },
      ],
    });
    expect(draft).toMatchObject({
      date: null,
      amount_cents: null,
      category: null,
    });
  });

  it("treats a refund receipt as income", async () => {
    const [draft] = await scan({
      transactions: [{ ...RECEIPT, kind: "income", category: null }],
    });
    expect(draft.amount_cents).toBe(3008);
  });

  it.each([
    ["no receipt in the photo", { transactions: [] }],
    ["an unreadable answer", { nonsense: true }],
    ["an empty item", { transactions: [{}] }],
  ])("returns no drafts for %s", async (_label, data) => {
    expect(await scan(data)).toEqual([]);
  });
});

describe("imageProblem", () => {
  it.each([
    ["JPEG", JPEG],
    ["PNG", PNG],
    ["GIF", GIF],
    ["WebP", WEBP],
  ])("accepts a real %s", (_n, image) => {
    expect(imageProblem(image)).toBeNull();
  });

  it.each([
    ["a number", 42, /data URL/],
    [
      "a web address",
      "https://example.com/r.jpg",
      /JPEG, PNG, WebP or GIF data URL/,
    ],
    [
      "an SVG (can carry scripts)",
      "data:image/svg+xml;base64,PHN2Zz4=",
      /JPEG, PNG/,
    ],
    ["an empty image", "data:image/jpeg;base64,", /JPEG, PNG|empty/],
    [
      "a PDF labelled as JPEG",
      dataUrl("image/jpeg", Buffer.from("%PDF-1.7 hello")),
      /doesn't match/,
    ],
    [
      "a PNG labelled as JPEG",
      dataUrl("image/jpeg", bytes(0x89, 0x50, 0x4e, 0x47)),
      /doesn't match/,
    ],
    [
      "one over the size limit",
      dataUrl(
        "image/jpeg",
        Buffer.concat([bytes(0xff, 0xd8, 0xff), Buffer.alloc(MAX_IMAGE_BYTES)]),
      ),
      /too large/,
    ],
  ])("rejects %s", (_label, image, message) => {
    expect(imageProblem(image)).toMatch(message);
  });
});

describe("POST /api/ai/scan-receipt", () => {
  let db;
  beforeEach(() => {
    db = openDatabase(":memory:");
  });
  const body = { image: JPEG, today: "2026-11-13" };
  const post = (app, b = body) =>
    request(app).post("/api/ai/scan-receipt").send(b);

  it("returns drafts with category sources", async () => {
    const res = await post(
      createApp(db, { ai: fakeAi({ transactions: [RECEIPT] }) }),
    );
    expect(res.status).toBe(200);
    expect(res.body.drafts).toEqual([
      expect.objectContaining({
        amount_cents: -3008,
        description: "Maple Leaf Market",
        category: expect.objectContaining({ name: "Groceries" }),
        category_source: "ai",
      }),
    ]);
  });

  it("prefers the user's history for the category", async () => {
    const account = db
      .prepare("INSERT INTO accounts (name, type) VALUES ('C', 'checking')")
      .run().lastInsertRowid;
    const shopping = db
      .prepare("SELECT id FROM categories WHERE name = 'Shopping'")
      .get().id;
    db.prepare(
      "INSERT INTO transactions (account_id, category_id, date, amount_cents, description) VALUES (?, ?, '2026-11-01', -500, 'MAPLE LEAF MARKET #12')",
    ).run(account, shopping);
    const res = await post(
      createApp(db, { ai: fakeAi({ transactions: [RECEIPT] }) }),
    );
    expect(res.body.drafts[0]).toMatchObject({
      category: { name: "Shopping" },
      category_source: "history",
    });
  });

  it("returns 400 for a bad image or date, without calling the AI", async () => {
    const ai = fakeAi({ transactions: [RECEIPT] });
    const res = await post(createApp(db, { ai }), {
      image: "data:image/jpeg;base64,AAAA",
      today: "nope",
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveLength(2);
    expect(ai.completeJson).not.toHaveBeenCalled();
  });

  it("accepts a large photo (bigger than the default 100 KB body limit)", async () => {
    const big = dataUrl(
      "image/jpeg",
      Buffer.concat([bytes(0xff, 0xd8, 0xff), Buffer.alloc(3 * 1024 * 1024)]),
    );
    const res = await post(
      createApp(db, { ai: fakeAi({ transactions: [RECEIPT] }) }),
      {
        ...body,
        image: big,
      },
    );
    expect(res.status).toBe(200);
  });

  it("returns 503 without AI and a safe 502 when the AI fails", async () => {
    expect((await post(createApp(db))).status).toBe(503);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = {
      completeJson: vi
        .fn()
        .mockRejectedValue(new AiError("x", { cause: new Error("sk-secret") })),
    };
    const res = await post(createApp(db, { ai: failing }));
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("sk-secret");
  });
});
