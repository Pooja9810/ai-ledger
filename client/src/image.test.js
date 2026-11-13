import { describe, it, expect } from "vitest";
import { fitWithin, imageFileProblem, MAX_FILE_BYTES } from "./image.js";

describe("fitWithin", () => {
  it.each([
    [[4032, 3024], { width: 1600, height: 1200 }], // phone photo, landscape
    [[3024, 4032], { width: 1200, height: 1600 }], // portrait
    [[800, 600], { width: 800, height: 600 }], // already small: never enlarge
    [[1600, 1600], { width: 1600, height: 1600 }],
    [[10000, 10], { width: 1600, height: 2 }], // a very long strip
    [[10000, 1], { width: 1600, height: 1 }], // never 0 px
  ])("%j → %j", ([w, h], expected) => {
    expect(fitWithin(w, h)).toEqual(expected);
  });
});

describe("imageFileProblem", () => {
  const file = (name, type, size = 1000) => ({ name, type, size });

  it.each([
    file("receipt.jpg", "image/jpeg"),
    file("receipt.png", "image/png"),
    file("IMG_0001.HEIC", ""), // some browsers give HEIC no type
    file("photo.webp", "image/webp"),
  ])("accepts %j", (f) => {
    expect(imageFileProblem(f)).toBeNull();
  });

  it.each([
    [null, /Choose a photo/],
    [file("statement.pdf", "application/pdf"), /isn't a photo/],
    [file("bank.csv", "text/csv"), /isn't a photo/],
    [file("huge.jpg", "image/jpeg", MAX_FILE_BYTES + 1), /too large/],
  ])("rejects %j", (f, message) => {
    expect(imageFileProblem(f)).toMatch(message);
  });
});
