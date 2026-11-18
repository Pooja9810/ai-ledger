import { useState } from "react";
import { SparkleIcon } from "./Icons.jsx";

/**
 * The AI, front and center on Home: type what you spent in plain words and
 * the add dialog opens with the transaction already filled in. It's the same
 * "✨ Fill" the dialog has, just started from here, so you still check the
 * draft and nothing is saved until you press Save.
 *
 * Props:
 *   onFill – called with the sentence the user typed
 */
export function AiEntryBar({ onFill }) {
  const [text, setText] = useState("");
  const empty = text.trim() === "";

  function submit(e) {
    e.preventDefault(); // stay on the page instead of reloading it
    if (empty) return;
    onFill(text.trim());
    setText("");
  }

  return (
    <section className="card ai-bar" aria-labelledby="ai-bar-title">
      <h2 id="ai-bar-title" className="ai-bar-title">
        <SparkleIcon size={18} /> Tell Ledgerly what you spent
      </h2>
      <form className="ai-bar-form" onSubmit={submit}>
        <label htmlFor="ai-bar-input" className="visually-hidden">
          Describe a transaction in your own words
        </label>
        <input
          id="ai-bar-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. “coffee at Tims for 4.50 yesterday”"
          autoComplete="off"
        />
        <button type="submit" className="button-primary" disabled={empty}>
          <SparkleIcon size={16} /> Fill
        </button>
      </form>
      <p className="caption">
        AI drafts it, you check it. Nothing is saved until you press Save.
      </p>
    </section>
  );
}
