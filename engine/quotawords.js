'use strict';

/**
 * #4588: how the board writes an Antigravity quota reset time, in one place. status.js (the card's `because`) and
 * accountproblem.js (the manager notice) both use this; web/index.html has its own copy of the same rule (the page
 * cannot require engine code), and web.agyquota-4588.test.js compares the two over past and future resets.
 *
 * With its zone: the sentence is formatted on the board's machine and can be read from another. With the day too
 * when the reset is more than 20 hours from now in EITHER direction: Google's weekly window can put it days out, and
 * the past-reset sentence ("the quota reset at ...") can be days old.
 */
const DAY_SHOWN_BEYOND_MS = 20 * 3600 * 1000;

function quotaResetWords(atMs, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const far = Math.abs(atMs - now) > DAY_SHOWN_BEYOND_MS;
  return new Date(atMs).toLocaleString([], { ...(far ? { weekday: 'short' } : {}), hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

module.exports = { quotaResetWords, DAY_SHOWN_BEYOND_MS };
