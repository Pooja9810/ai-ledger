import { describe, it, expect } from "vitest";
import { toneMarker, insightsErrorMessage } from "./insights.js";

describe("toneMarker", () => {
  it.each([
    ["attention", "⚠", "Needs attention:"],
    ["good", "✅", "Good news:"],
    ["neutral", "•", ""],
    ["anything else", "•", ""],
  ])("%s → %s %s", (tone, icon, label) => {
    expect(toneMarker(tone)).toEqual({ icon, label });
  });
});

describe("insightsErrorMessage", () => {
  it("treats 'AI not configured' as information, not an error", () => {
    expect(
      insightsErrorMessage("AI features are not configured"),
    ).toMatchObject({ info: true });
  });
  it("shows the demo's AI limit as information, with its own message", () => {
    const limit = "You've reached the demo's AI limit; try again in 12 min";
    expect(insightsErrorMessage(limit)).toEqual({ info: true, text: limit });
  });
  it("treats anything else as an error", () => {
    expect(
      insightsErrorMessage("AI service is unavailable, try again"),
    ).toMatchObject({
      info: false,
    });
  });
});
