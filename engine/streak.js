'use strict';
/**
 * kosmos#6160 (Josh, 10-14): the person's streak in the Kosmos. Hovering the top-left logo says how many days in
 * a row they have used Kosmos, and once on each new day (from day 2) a tiny note says "Congrats you've been in the
 * Kosmos for X days!".
 *
 * The calls, written on the card:
 *   - a DAY is a day the person opened the board, in their own time zone. The page sends its local date
 *     (YYYY-MM-DD); agents working while the person is away do not count.
 *   - a MISSED day starts the count again at 1.
 *   - the count lives on this board, in one small file, so every screen of this board adds to the same count and a
 *     restart keeps it. It is not synced across computers.
 *
 * The day logic is pure (visit, congratsDue, markCongratulated take and return plain objects), so the tests can walk
 * it through a rollover and a missed day with no clock and no disk. read and record are the board's.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Milliseconds at UTC midnight of a YYYY-MM-DD, or null when it is not a real calendar date. */
function dayMs(d) {
  const m = DAY.exec(String(d || ''));
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  // Date.UTC rolls 2026-02-31 over into March; a date that does not come back out as itself is not a date.
  return new Date(ms).toISOString().slice(0, 10) === d ? ms : null;
}

/** Whole days from a to b (both YYYY-MM-DD), or null when either is not a date. */
function daysBetween(a, b) {
  const x = dayMs(a), y = dayMs(b);
  return x == null || y == null ? null : Math.round((y - x) / 86400000);
}

/** A fresh state: no visit yet. */
function empty() { return { count: 0, last: null, congratulated: null }; }

/** Cleans a state read from disk; anything unexpected reads as no streak rather than a wrong number. */
function clean(s) {
  if (!s || typeof s !== 'object') return empty();
  const count = Number.isInteger(s.count) && s.count > 0 ? s.count : 0;
  const last = dayMs(s.last) != null ? s.last : null;
  if (!count || !last) return empty();
  return { count, last, congratulated: dayMs(s.congratulated) != null ? s.congratulated : null };
}

/**
 * A visit on `today`. Same day: nothing changes. The next day: the streak grows by one. A gap of two or more days:
 * it starts again at 1. A day EARLIER than the last one (the person flew west, or a second screen's clock is behind)
 * changes nothing, so travelling never costs a streak and never adds to it twice.
 */
function visit(state, today) {
  const s = clean(state);
  if (dayMs(today) == null) return s;
  if (!s.last) return { count: 1, last: today, congratulated: null };
  const gap = daysBetween(s.last, today);
  if (gap <= 0) return s;
  if (gap === 1) return { ...s, count: s.count + 1, last: today };
  return { count: 1, last: today, congratulated: null };
}

/** True when the daily note is owed on `today`: today is the streak's day, it is day 2 or later, and not shown yet. */
function congratsDue(state, today) {
  const s = clean(state);
  return s.count >= 2 && s.last === today && s.congratulated !== today;
}

/** The state after the note for `today` has been shown. */
function markCongratulated(state, today) {
  const s = clean(state);
  return dayMs(today) == null ? s : { ...s, congratulated: today };
}

/**
 * The page's date must be close to the board's own: every time zone's local date is within one day of the UTC date.
 * Anything further is a bad clock or a made-up request, and recording it could reset a real streak.
 */
function plausible(today, now = Date.now()) {
  const ms = dayMs(today);
  return ms != null && Math.abs(ms - Date.UTC(...utcParts(now))) <= 86400000;
}
function utcParts(now) { const d = new Date(now); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]; }

function file() { return path.join(store.ROOT, 'streak.json'); }

/** The state on disk; a missing or unreadable file reads as no streak. Never throws. */
function read() {
  try { return clean(JSON.parse(fs.readFileSync(file(), 'utf8'))); } catch { return empty(); }
}

function save(s) {
  try { store.saveFlushed(file(), JSON.stringify(s) + '\n'); return true; } catch { return false; }
}

/**
 * The board's entry point for a page load: records a visit on the page's local `today` and returns what to show,
 * `{ count, congrats }`. When the note is due, the same write records it as shown, so exactly one page load per day
 * is told to show it, even with two screens open at once. A `quiet` visit (a Kosmos+ remote screen, which has no K
 * mark to show it under) counts the day but never spends the note. An implausible date records nothing and returns
 * the streak as it stands, with no note. Writes only when something changed. Never throws.
 */
function record(today, now = Date.now(), { quiet = false } = {}) {
  const before = read();
  if (!plausible(today, now)) return { count: before.count, congrats: false };
  let after = visit(before, today);
  const congrats = !quiet && congratsDue(after, today);
  if (congrats) after = markCongratulated(after, today);
  if (JSON.stringify(after) !== JSON.stringify(before) && !save(after)) return { count: after.count, congrats: false };
  return { count: after.count, congrats };
}

module.exports = { visit, congratsDue, markCongratulated, plausible, daysBetween, read, record, file };
