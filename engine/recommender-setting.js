'use strict';
/* #2619: the persisted setting for the Recommender automation (Settings >
 * Automation). When on, blocked agents work together to consensus on a
 * recommendation, document it, and implement it - bounded by three guards.
 *
 * SCOPE (this module is the SETTING, not the behaviour): it persists the person's
 * choice (on/off + the three guards) the same way engine/heartbeat-setting.js
 * persists the heartbeat setting (atomic tmp + rename, safe defaults, a write
 * failure returns a reason and never throws). The actual consensus-and-implement
 * behaviour is a separate, larger build (agent orchestration, coupled to the v2
 * flywheel); it will READ this setting. Persisting the preference first is the
 * Settings-card deliverable (#2619) and gives the behaviour a stable contract.
 *
 * OFF BY DEFAULT, deliberately (and unlike heartbeat/auto-save, which are on):
 * an automation whose behaviour is not yet wired must not read as ON - a person
 * flipping an on-by-default Recommender would expect agents to start acting and
 * see nothing. Off means "not enabled", which is honest until the behaviour lands.
 * (Recorded on the card: flip the default to on WITH the behaviour, not before.)
 *
 * THE THREE GUARDS ARE ON BY DEFAULT (Josh, #2619): they are the irreversible-
 * consequence carve-outs (money moving, something public under the person's name,
 * deleting the only copy). A guard being on RESTRICTS the Recommender, so on-by-
 * default is the safe direction: a never-configured install is maximally guarded.
 * Guard state is independent of `on` - a person can pre-set the guards before ever
 * enabling the Recommender, and the behaviour must honour whichever guards are on.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

// #1856: route through the one data-root derivation (store.ROOT), not the raw
// AGENT_WORKFORCE_DATA switch - prod-inert when unset, Kosmos-leaf-aware under #1704.
const BASE = store.ROOT;
const FILE = path.join(BASE, 'recommender.json');

// The three guards, frozen so a consumer cannot rewrite the product's notion of
// what a guard is. Order is the display order in Settings.
const GUARD_KEYS = Object.freeze(['money', 'public', 'delete']);

// A fresh, all-guards-on guard object (the safe default: maximally restricted).
function defaultGuards() {
  return { money: true, public: true, delete: true };
}

// Coerce an arbitrary parsed value into a complete guard object. A missing or
// non-boolean guard falls to ON (the safe/restrictive direction), so a corrupt
// or partial config never SILENTLY drops a guard and lets the Recommender act
// where it should not.
function coerceGuards(g) {
  const out = defaultGuards();
  if (g && typeof g === 'object' && !Array.isArray(g)) {
    for (const k of GUARD_KEYS) {
      if (typeof g[k] === 'boolean') out[k] = g[k];
    }
  }
  return out;
}

/**
 * The setting as stored, with defaults filled in. `ok` reports whether the file
 * read cleanly (a parse failure still yields safe defaults, ok:false).
 * @returns {{on:boolean,guards:{money:boolean,public:boolean,delete:boolean},ok:boolean}}
 */
function read() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    // Never configured -> off, all guards on. This is a clean read of "default".
    if (err && err.code === 'ENOENT') return { on: false, guards: defaultGuards(), ok: true };
    return { on: false, guards: defaultGuards(), ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, guards: defaultGuards(), ok: false }; }
  // Reject arrays and non-plain-objects: `[].on` is undefined -> off (fine here),
  // but coerceGuards on an array would drop to all-on anyway; be explicit so a
  // corrupt config is always a clean safe-default read.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { on: false, guards: defaultGuards(), ok: false };
  }
  // OFF by default: only an explicit true enables it. A missing flag (old build,
  // hand-edit) reads off, exactly as an absent file does.
  const on = parsed.on === true;
  return { on, guards: coerceGuards(parsed.guards), ok: true };
}

function write(patch) {
  const cur = read();
  const next = {
    on: typeof patch.on === 'boolean' ? patch.on : cur.on,
    guards: patch.guards ? coerceGuards(patch.guards) : cur.guards,
  };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ on: next.on, guards: next.guards }) + '\n');
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

// Set one guard by name. An unknown guard name is rejected (a typo must not
// silently no-op and leave the person believing a guard is set).
function setGuard(name, value) {
  if (!GUARD_KEYS.includes(name)) {
    return { ok: false, because: 'unknown guard: ' + String(name) };
  }
  if (typeof value !== 'boolean') return { ok: false, because: 'a guard has to be on or off' };
  const cur = read();
  const guards = { ...cur.guards, [name]: value };
  return write({ guards });
}

module.exports = { read, write, setOn, setGuard, GUARD_KEYS, defaultGuards, FILE };
