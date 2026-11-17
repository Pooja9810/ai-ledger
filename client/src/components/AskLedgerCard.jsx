import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { keepMoneyTogether, todayLocal } from "../format.js";
import {
  askErrorMessage,
  basedOnText,
  EXAMPLE_QUESTIONS,
  historyForRequest,
} from "../ask.js";
import { getSpeechRecognition, startListening } from "../speech.js";
import { AnswerChart } from "./Charts.jsx";
import { Skeleton } from "./ui.jsx";

/**
 * "Ask your ledger": a short conversation about the user's money.
 * The server answers with POST /api/ai/ask, which lets the AI call
 * read-only ledger tools. See ask.js for the rules.
 */
export function AskLedgerCard() {
  const [turns, setTurns] = useState([]); // { id, question, status, answer, basedOn, chart, error }
  const [text, setText] = useState("");
  const nextIdRef = useRef(1);
  const listRef = useRef(null);
  const busy = turns.some((t) => t.status === "loading"); // one question at a time

  // 🎙 Voice: same behaviour as Quick add (asks when the speaker pauses).
  const [Recognition] = useState(() => getSpeechRecognition());
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  const listenRef = useRef(null);
  const askRef = useRef(null); // latest ask(), for the speech callback

  // Keep the newest turn in view inside the conversation box.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns]);

  // Stop listening if the card goes away.
  useEffect(() => () => listenRef.current?.abort(), []);

  /**
   * Ask a question. With retryOf, re-ask a failed turn in place, using
   * only the turns before it as history.
   */
  async function ask(question, { retryOf } = {}) {
    const q = question.trim();
    if (q === "" || busy) return;

    const before = retryOf
      ? turns.slice(
          0,
          turns.findIndex((t) => t.id === retryOf),
        )
      : turns;
    const history = historyForRequest(before);
    const id = retryOf ?? nextIdRef.current++;
    const loading = { id, question: q, status: "loading" };
    setTurns((prev) =>
      retryOf
        ? prev.map((t) => (t.id === id ? loading : t))
        : [...prev, loading],
    );
    setText("");

    // If the conversation is cleared meanwhile, the id is gone and
    // these updates do nothing: a built-in guard against late answers.
    const update = (fields) =>
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...fields } : t)),
      );
    try {
      const { answer, based_on, chart } = await api("/ai/ask", {
        method: "POST",
        body: { question: q, today: todayLocal(), history },
      });
      update({ status: "done", answer, basedOn: based_on, chart });
    } catch (err) {
      update({
        status: "error",
        error: askErrorMessage(err),
        // Retrying right away can't help when the demo's AI limit is reached.
        canRetry: err?.status !== 429,
      });
    }
  }

  useEffect(() => {
    askRef.current = ask;
  });

  function toggleListening() {
    if (listening) {
      listenRef.current?.stop(); // finish now and keep the words
      return;
    }
    setVoiceError(null);
    setText("");
    try {
      listenRef.current = startListening(Recognition, {
        lang: navigator.language,
        onText: setText,
        onError: setVoiceError,
        onEnd: (spoken) => {
          listenRef.current = null;
          setListening(false);
          if (spoken) askRef.current(spoken);
        },
      });
      setListening(true);
    } catch {
      setVoiceError("Voice input couldn't start; try again or type instead");
    }
  }

  return (
    <section className="card ask-card" aria-labelledby="ask-title">
      <header className="card-header">
        <h2 id="ask-title">✨ Ask your ledger</h2>
        {turns.length > 0 && (
          <button
            type="button"
            className="link-button"
            onClick={() => setTurns([])}
          >
            Clear
          </button>
        )}
      </header>

      {turns.length === 0 ? (
        // Empty state, with a next step: example questions to click.
        <div className="ask-empty">
          <p className="caption">
            Ask anything about your money. Answers come from your real
            transactions.
          </p>
          <div className="ask-examples">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className="chip"
                onClick={() => ask(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className="ask-turns" ref={listRef} aria-live="polite">
          {turns.map((t) => (
            <li key={t.id} className="ask-turn">
              <p className="ask-question">{t.question}</p>

              {t.status === "loading" && (
                <div className="ask-loading" aria-busy="true">
                  <span className="caption">Looking at your ledger…</span>
                  <Skeleton width="90%" />
                  <Skeleton width="60%" />
                </div>
              )}

              {t.status === "done" && (
                <>
                  <p className="ask-answer">{keepMoneyTogether(t.answer)}</p>
                  {t.chart && <AnswerChart chart={t.chart} />}
                  {basedOnText(t.basedOn) && (
                    <p className="ask-based-on">{basedOnText(t.basedOn)}</p>
                  )}
                </>
              )}

              {t.status === "error" && (
                <p className="error-text ask-error" role="alert">
                  ⚠ {t.error}{" "}
                  {t.canRetry && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => ask(t.question, { retryOf: t.id })}
                      disabled={busy}
                    >
                      Try again
                    </button>
                  )}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <label htmlFor="ask-input" className="visually-hidden">
          Ask a question about your money
        </label>
        <input
          id="ask-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            turns.length > 0
              ? "Ask a follow-up…"
              : "e.g. How much did I spend on groceries?"
          }
          maxLength={500}
          disabled={busy}
          readOnly={listening} // the transcript is streaming in
        />
        {Recognition && (
          <button
            type="button"
            className={`button-secondary mic-button${listening ? " is-listening" : ""}`}
            onClick={toggleListening}
            disabled={busy}
            aria-pressed={listening}
            aria-label={listening ? "Stop listening" : "Ask by voice"}
            title={listening ? "Stop listening" : "Ask by voice"}
          >
            <span aria-hidden="true">{listening ? "■" : "🎙"}</span>
          </button>
        )}
        <button
          type="submit"
          className="button-primary"
          disabled={busy || listening || text.trim() === ""}
        >
          Ask
        </button>
      </form>
      {listening && (
        <p className="ask-hint" role="status">
          🎙 Listening… ask your question
        </p>
      )}
      {!listening && voiceError && (
        <p className="ask-hint error-text" role="alert">
          ⚠ {voiceError}
        </p>
      )}
    </section>
  );
}
