'use strict';
/* kosmos#8258: moments as this computer's own date and clock, for text an agent may copy a date from. */

/** The one shape the board writes an instant in; anything else is not worded. */
const STORED_INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
/** A timestamp from elsewhere (the community service) that says its zone, so it can be moved to this computer's. */
const HAS_ZONE = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d(:?\d\d)?)$/;

function twoDigits(number) { return String(number).padStart(2, '0'); }

/** YYYY-MM-DD HH:MM:SS on this computer's clock, or null for a moment that is not a time. */
function localStamp(ms) {
  if (typeof ms !== 'number') return null;
  const moment = new Date(ms);
  if (!Number.isFinite(moment.getTime())) return null;
  return moment.getFullYear() + '-' + twoDigits(moment.getMonth() + 1) + '-' + twoDigits(moment.getDate())
    + ' ' + twoDigits(moment.getHours()) + ':' + twoDigits(moment.getMinutes()) + ':' + twoDigits(moment.getSeconds());
}

/** An instant as stored ("...Z") in words: local first, the UTC beside it. Null unless it is a real date in that shape
 *  (a shape check alone lets 2026-02-30 through, and Date.parse then rolls it to March). */
function stampWords(stored) {
  if (typeof stored !== 'string' || !STORED_INSTANT.test(stored)) return null;
  const ms = Date.parse(stored);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== stored.slice(0, 19)) return null;
  return localStamp(ms) + ' local (' + stored.slice(0, 19).replace('T', ' ') + 'Z)';
}

/** YYYY-MM-DD on this computer's calendar for a timestamp carrying its zone. A value with no zone cannot be converted and
 *  keeps its own date. '' for anything that does not start with a date. */
function localDay(value) {
  const text = String(value == null ? '' : value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return '';
  const stamp = HAS_ZONE.test(text) ? localStamp(Date.parse(text)) : null;
  return stamp ? stamp.slice(0, 10) : text.slice(0, 10);
}

module.exports = { localStamp, stampWords, localDay };
