'use strict';
/* #1722: the persisted on/off + interval for the product heartbeat.
 *
 * Kept OUT of engine/heartbeat.js on purpose: that module is the PURE stall
 * decision (tick), unit-tested over synthetic rows with no disk. This one owns
 * the setting the person controls in Settings > Automation, persisted exactly as
 * engine/notify.js persists its own on/off (atomic tmp + rename, read defaults
 * to off, a write failure returns a reason and never throws). The runner reads
 * this to decide whether to sweep and how often; the HTTP routes read/write it.
 *
 * OFF BY DEFAULT, like notify: nothing nudges the person until they ask for it.
 * The interval is a CLOSED set of minute choices so the UI selector and the
 * stored value cannot disagree about what is valid, and 17 is the default
 * because it mirrors the fleet reference cadence (StartInterval 1020s = 17 min).
 *
 * ONE CONTROL FOR "OFF": the plan's interval list read "Off / 5 / 10 / 17 / 60",
 * but a distinct on/off toggle already owns Off, so an interval value of Off is
 * redundant and would let two controls disagree. The interval choices are the
 * live minutes {5,10,17,60}; `on:false` is the only Off. Decided here, once.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;
const FILE = path.join(BASE, 'heartbeat.json');

// The closed set of interval choices, in minutes. Frozen so a consumer cannot
// rewrite the product's notion of a valid interval from outside.
const INTERVAL_CHOICES = Object.freeze([5, 10, 17, 60]);
const DEFAULT_INTERVAL = 17;

function isValidInterval(m) {
  return typeof m === 'number' && INTERVAL_CHOICES.includes(m);
}

/**
 * The setting as stored, with defaults filled in. `ok` reports whether the file
 * was read cleanly (a parse failure still yields safe defaults, ok:false).
 * @returns {{on:boolean,intervalMinutes:number,ok:boolean}}
 */
function read() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { on: false, intervalMinutes: DEFAULT_INTERVAL, ok: true };
    return { on: false, intervalMinutes: DEFAULT_INTERVAL, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, intervalMinutes: DEFAULT_INTERVAL, ok: false }; }
  if (!parsed || typeof parsed !== 'object') return { on: false, intervalMinutes: DEFAULT_INTERVAL, ok: false };
  const on = parsed.on === true;
  // A stored interval outside the closed set (an old build, a hand-edit) falls
  // back to the default rather than driving the runner with a nonsense period.
  const intervalMinutes = isValidInterval(parsed.intervalMinutes) ? parsed.intervalMinutes : DEFAULT_INTERVAL;
  return { on, intervalMinutes, ok: true };
}

function write(patch) {
  const cur = read();
  const next = { on: cur.on, intervalMinutes: cur.intervalMinutes, ...patch };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ on: next.on, intervalMinutes: next.intervalMinutes }) + '\n');
    fs.renameSync(tmp, FILE);
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

function setOn(on) {
  if (typeof on !== 'boolean') return { ok: false, because: 'that has to be on or off' };
  return write({ on });
}

function setInterval(minutes) {
  if (!isValidInterval(minutes)) {
    return { ok: false, because: 'the interval must be one of ' + INTERVAL_CHOICES.join(', ') + ' minutes' };
  }
  return write({ intervalMinutes: minutes });
}

/** The interval in milliseconds, for the runner. */
function intervalMs() {
  return read().intervalMinutes * 60 * 1000;
}

module.exports = { FILE, INTERVAL_CHOICES, DEFAULT_INTERVAL, isValidInterval, read, setOn, setInterval, intervalMs };
