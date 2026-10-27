'use strict';
/**
 * #7369: Claude Code's own words for a sign-in that stopped working, in ONE place, read by both platforms.
 *
 * The Mac reads them off the screen (engine/status.js authFailed: the JSON envelope #874 was captured from, and the
 * friendly line #1884 found). Windows reads them off the agent's own event stream (engine/win32streamstate.js): a
 * Windows Claude agent runs `claude -p` stream-json, and a turn refused for the sign-in ends in a `result` event with
 * is_error and Claude's sentence. Before #7369 that result read as idle, so the card said nothing while messages were
 * typed into a session that answered every one "Not logged in" (a user went 5 days, #7366).
 *
 * 🔑 THE SCREEN PATTERNS LIVE HERE UNCHANGED. They were status.js's own constants; status.js now takes them from this
 * module, so the Mac detection is byte-for-byte what it was (its long rationale stays beside authFailed in status.js).
 * This module is small on purpose: the Windows supervisor loads it, and status.js is ten thousand lines.
 */

/* status.js #874/#1233: the JSON markers, and the envelope that must sit on the same row. */
const AUTH_FAILED_MARKERS = [
  /OAuth\s*access\s*token\s*is\s*invalid/i,
  /"type":\s*"authentication_error"/i,
];
const AUTH_ENVELOPE = /"type":\s*"error"/i;
/* status.js #1884: the friendly line is a message AND Claude Code's own remedy on one row. */
const AUTH_FRIENDLY_MESSAGE = /OAuth access token (?:has expired|has been revoked|is invalid)|API Error:\s*401\s+Invalid API key|OAuth token revoked|Login expired|Your session has expired/i;
const AUTH_FRIENDLY_REMEDY = /Please run \/login|Re-authenticate to continue/i;

/**
 * #7369: the stream-only phrases. Wider than the screen's, and safe to be: the screen has to tell a dead token from an
 * agent TALKING about one (#1233), while a stream result flagged is_error is Claude Code's own error sentence, never the
 * agent's prose. Read from the installed Claude Code binary on the Windows box (2026-10-27): "Not logged in · Please
 * run /login", "Not logged in · Run /login", "Invalid API key · Please run /login", "Invalid API key · Fix external
 * API key", plus the screen's own messages and the raw 401 envelope's authentication_error.
 * 📌 A bare 401 counts only beside an auth word, so a 401 from some tool's web request quoted in an error is not a
 * sign-in.
 */
const STREAM_SIGNIN = /Not logged in|Invalid API key|authentication_error|Please run \/login|\bRun \/login\b|OAuth token revoked|OAuth (?:access )?token (?:has expired|has been revoked|is invalid)|Login expired|Your session has expired|\b401\b[^\n]{0,80}\b(?:unauthori[sz]ed|auth|token|api key|log ?in)/i;

/** #7369: whether one stream `result` text is Claude Code saying its sign-in does not work. */
function isStreamSignInError(text) {
  if (typeof text !== 'string' || !text) return false;
  if (STREAM_SIGNIN.test(text)) return true;
  if (AUTH_FAILED_MARKERS.some((re) => re.test(text)) && AUTH_ENVELOPE.test(text)) return true;
  return AUTH_FRIENDLY_MESSAGE.test(text) && AUTH_FRIENDLY_REMEDY.test(text);
}

module.exports = { AUTH_FAILED_MARKERS, AUTH_ENVELOPE, AUTH_FRIENDLY_MESSAGE, AUTH_FRIENDLY_REMEDY, isStreamSignInError };
