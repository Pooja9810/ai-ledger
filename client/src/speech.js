/**
 * Voice input via the browser's built-in speech recognition (Web Speech API).
 * Free and needs no server code. Chrome and Edge send the audio to Google
 * to transcribe; Safari uses Apple. Firefox doesn't support it, so callers
 * hide the mic when getSpeechRecognition() returns null.
 */

/**
 * The browser's SpeechRecognition class, or null if voice won't work here.
 * Brave exposes the API (it's built on Chrome's engine) but, for privacy,
 * doesn't connect to Google's speech service, so every attempt fails with a
 * "network" error. We treat it as unsupported. Brave identifies itself
 * with navigator.brave.
 */
export function getSpeechRecognition(win = globalThis.window) {
  if (win?.navigator?.brave) return null;
  return win?.SpeechRecognition ?? win?.webkitSpeechRecognition ?? null;
}

/** Turn a recognition error code into a message, or null to stay quiet. */
export function speechErrorMessage(code) {
  switch (code) {
    case "aborted":
      return null; // we cancelled it ourselves
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked; allow it in your browser settings";
    case "no-speech":
      return "Didn't hear anything, try again";
    case "audio-capture":
      return "No microphone found";
    case "network":
      // The browser couldn't reach its speech service (offline, VPN/firewall,
      // or a browser without one).
      return "Couldn't reach the speech service. Check your connection, or try Chrome or Safari";
    default:
      return "Voice input stopped; try again or type instead";
  }
}

/**
 * Start listening for one phrase. It stops by itself after a pause.
 *
 * @param Recognition  class from getSpeechRecognition()
 * @param onText(text)        the transcript so far, as words arrive
 * @param onEnd(finalText)    when listening ends; "" after an error or abort
 * @param onError(message)    a user-facing message (never called for "aborted")
 * @returns { stop, abort }   stop = finish and keep the text; abort = discard
 */
export function startListening(Recognition, { onText, onEnd, onError, lang }) {
  const recognition = new Recognition();
  if (lang) recognition.lang = lang;
  recognition.interimResults = true; // show words while speaking
  recognition.continuous = false; // one phrase, then stop on a pause
  recognition.maxAlternatives = 1;

  let transcript = "";
  let failed = false;

  recognition.onresult = (event) => {
    // event.results holds every phrase so far: join them into one string.
    transcript = Array.from(event.results, (result) => result[0].transcript)
      .join("")
      .trim();
    onText(transcript);
  };
  recognition.onerror = (event) => {
    failed = true;
    const message = speechErrorMessage(event.error);
    if (message) onError(message);
  };
  recognition.onend = () => onEnd(failed ? "" : transcript);

  recognition.start();
  return {
    stop: () => recognition.stop(),
    abort: () => recognition.abort(),
  };
}
