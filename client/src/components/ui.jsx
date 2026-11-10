// Small shared building blocks used across the app.
import { useEffect } from "react";

/** Gray placeholder shapes shown while loading, so the layout doesn't jump. */
export function Skeleton({ width = "100%", height = 16 }) {
  return (
    <span className="skeleton" style={{ width, height }} aria-hidden="true" />
  );
}

/** The Ledgerly logo mark: a rounded tile with ledger lines. */
export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path
        d="M9 11h14M9 16h14M9 21h8"
        stroke="var(--on-accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * A short confirmation message at the bottom of the screen.
 * aria-live makes screen readers announce it without moving focus.
 */
export function Toast({ message, onDone }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDone, 3500);
    return () => clearTimeout(timer);
  }, [message, onDone]);

  return (
    <div className="toast-region" aria-live="polite">
      {message && <div className="toast">{message}</div>}
    </div>
  );
}
