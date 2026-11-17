import { useState } from "react";
import { CloseIcon } from "./Icons.jsx";

const KEY = "ledgerly-welcome-dismissed";

/**
 * First visit to the public demo: three things worth trying, so a visitor
 * (say, a recruiter) isn't left guessing what to click. Dismissed for good
 * in this browser with ✕. Shown only in the demo.
 */
export function WelcomeCard({ onQuickAdd, onImport }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      // Not remembered; it just shows again next visit.
    }
  }

  return (
    <section className="card welcome-card" aria-labelledby="welcome-title">
      <div className="welcome-text">
        <h2 id="welcome-title">Welcome to Ledgerly</h2>
        <p className="caption">
          A personal finance ledger with AI built in. This demo has six months
          of made-up data. Three things to try:
        </p>
      </div>
      <ol className="welcome-steps">
        <li>
          <a className="button-secondary" href="#ask">
            Ask “Which month did I spend the most on dining out?”
          </a>
        </li>
        <li>
          <button
            type="button"
            className="button-secondary"
            onClick={onQuickAdd}
          >
            Quick add: “coffee at Tims for 4”
          </button>
        </li>
        <li>
          <button type="button" className="button-secondary" onClick={onImport}>
            Import a bank CSV
          </button>
          <a
            className="caption welcome-sample"
            href="/samples/visa-2026-11.csv"
            download
          >
            Get a sample Visa file first
          </a>
        </li>
      </ol>
      <button
        type="button"
        className="icon-button welcome-close"
        onClick={dismiss}
        aria-label="Dismiss the welcome"
      >
        <CloseIcon size={18} />
      </button>
    </section>
  );
}
