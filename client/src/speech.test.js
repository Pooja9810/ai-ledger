import { describe, it, expect, vi } from "vitest";
import {
  getSpeechRecognition,
  speechErrorMessage,
  startListening,
} from "./speech.js";

/**
 * A fake of the browser's SpeechRecognition. Tests drive it by calling
 * the handlers the code under test attached (onresult, onerror, onend).
 */
class FakeRecognition {
  static last = null;
  constructor() {
    FakeRecognition.last = this;
    this.start = vi.fn();
    this.stop = vi.fn();
    this.abort = vi.fn();
  }
  // Simulate the browser reporting words so far.
  say(...phrases) {
    const results = phrases.map((text) => [{ transcript: text }]);
    this.onresult({ results });
  }
}

function listen() {
  const calls = { onText: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
  const handle = startListening(FakeRecognition, { ...calls, lang: "en-CA" });
  return { ...calls, handle, rec: FakeRecognition.last };
}

describe("getSpeechRecognition", () => {
  it("prefers the standard name, falls back to webkit, else null", () => {
    const Std = class {};
    const Webkit = class {};
    expect(getSpeechRecognition({ SpeechRecognition: Std })).toBe(Std);
    expect(getSpeechRecognition({ webkitSpeechRecognition: Webkit })).toBe(
      Webkit,
    );
    expect(getSpeechRecognition({})).toBeNull(); // e.g. Firefox
    expect(getSpeechRecognition(undefined)).toBeNull(); // e.g. tests, no window
  });

  it("treats Brave as unsupported (it has the API but no speech service)", () => {
    const Webkit = class {};
    expect(
      getSpeechRecognition({
        webkitSpeechRecognition: Webkit,
        navigator: { brave: { isBrave: async () => true } },
      }),
    ).toBeNull();
  });
});

describe("startListening", () => {
  it("configures and starts one-phrase recognition with live results", () => {
    const { rec } = listen();
    expect(rec.start).toHaveBeenCalled();
    expect(rec.lang).toBe("en-CA");
    expect(rec.interimResults).toBe(true);
    expect(rec.continuous).toBe(false);
  });

  it("reports the growing transcript, then the final text on end", () => {
    const { rec, onText, onEnd } = listen();
    rec.say("bought bread");
    rec.say("bought bread", " from no frills");
    rec.onend();

    expect(onText).toHaveBeenNthCalledWith(1, "bought bread");
    expect(onText).toHaveBeenNthCalledWith(2, "bought bread from no frills");
    expect(onEnd).toHaveBeenCalledWith("bought bread from no frills");
  });

  it("reports a friendly error and ends with empty text", () => {
    const { rec, onError, onEnd } = listen();
    rec.say("bought");
    rec.onerror({ error: "network" });
    rec.onend();

    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(
        /Couldn't reach the speech service.*Chrome or Safari/,
      ),
    );
    expect(onEnd).toHaveBeenCalledWith(""); // don't fill from a broken phrase
  });

  it("stays quiet when we abort it ourselves", () => {
    const { rec, onError, handle } = listen();
    handle.abort();
    rec.onerror({ error: "aborted" });
    expect(rec.abort).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("stop() asks the browser to finish (keeping the text)", () => {
    const { rec, handle } = listen();
    handle.stop();
    expect(rec.stop).toHaveBeenCalled();
  });
});

describe("speechErrorMessage", () => {
  it.each([
    ["not-allowed", /blocked/],
    ["no-speech", /Didn't hear/],
    ["audio-capture", /No microphone/],
    ["something-new", /try again or type/],
  ])("%s → helpful message", (code, pattern) => {
    expect(speechErrorMessage(code)).toMatch(pattern);
  });
});
