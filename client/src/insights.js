/** Rules for the monthly insights card. Pure, so they're easy to test. */

/**
 * Icon + label for a point's tone. Color is never the only signal
 * (CLAUDE.md): the icon is visible, the label is read by screen readers.
 */
export function toneMarker(tone) {
  switch (tone) {
    case "attention":
      return { icon: "⚠", label: "Needs attention:" };
    case "good":
      return { icon: "✅", label: "Good news:" };
    default:
      return { icon: "•", label: "" };
  }
}

/** A friendly message for a failed request (useApi gives the error text). */
export function insightsErrorMessage(error) {
  if (/not configured/i.test(error ?? "")) {
    return {
      info: true,
      text: "AI isn't set up, so there's no written summary yet.",
    };
  }
  return {
    info: false,
    text: "Couldn't write the summary right now; try again later.",
  };
}
