'use strict';
/* kosmos#7152 slice 2: the persisted setting for usage auto-balance (Settings > AI Models): when on, agents on a
 * Claude account that is running out are moved to one with room. In slice 2 nothing moves; the setting decides only
 * whether the "would move" lines are worked out and shown (engine/autobalance.js).
 *
 * SCOPE (this module is the SETTING, not the behaviour), as engine/assigner-setting.js: atomic save, safe defaults,
 * a write failure returns a reason and never throws. ON BY DEFAULT, as the card asks ("on by default when a person
 * has more than one account linked"): a missing file reads on, a corrupt or unreadable one reads off. With fewer than
 * two Claude subscription accounts it does nothing whatever it says (autobalance.eligible).
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const BASE = store.ROOT;
const FILE = path.join(BASE, 'autobalance.json');

/** @returns {{on:boolean,ok:boolean}} */
function read() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { on: true, ok: true };   // never configured -> on
    return { on: false, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, ok: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { on: false, ok: false };
  return { on: typeof parsed.on === 'boolean' ? parsed.on : true, ok: true };
}

function write(patch) {
  const cur = read();
  const on = patch && typeof patch.on === 'boolean' ? patch.on : cur.on;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    store.saveFlushed(FILE, JSON.stringify({ on }) + '\n');
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

module.exports = { read, write, FILE };
