import { describe, it, expect } from "vitest";
import { readPageConfig } from "./config.js";

const docWith = (content) => ({
  querySelector: () =>
    content === undefined ? null : { getAttribute: () => content },
});

describe("readPageConfig", () => {
  it("reads the config the server put in the page", () => {
    expect(
      readPageConfig(docWith('{"demo":true,"resets_every_minutes":60}')),
    ).toEqual({ demo: true, resets_every_minutes: 60 });
  });

  it("is null without the tag (development) or with broken JSON", () => {
    expect(readPageConfig(docWith(undefined))).toBeNull();
    expect(readPageConfig(docWith("{oops"))).toBeNull();
    expect(readPageConfig(docWith("42"))).toBeNull();
    expect(readPageConfig(undefined)).toBeNull();
  });
});
