'use strict';
/* kosmos#7725: a time just past, for a test that needs a printed reset a capped card is still held on (held for an hour).
   In the repeated fall-back hour a printed time reads as its later instant (status.limitResetAt), so 15 minutes ago can
   read as 45 minutes ahead: try closer, then near the far end of the hour. Returns null in the minutes either side of
   the two hours meeting, where no printed time qualifies; the caller skips. */
function justPast(status, resetAt) {
  const now = Date.now();
  for (const minutes of [15, 5, 1, 58]) {
    const ms = now - minutes * 60e3;
    const reading = status.limitResetAt(`resets ${resetAt(ms)} (America/Chicago)`, now);
    if (reading !== null && reading < now) return ms;
  }
  return null;
}

module.exports = { justPast };
