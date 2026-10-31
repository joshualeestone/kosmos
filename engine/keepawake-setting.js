'use strict';
/* kosmos#7416 slice 3: the persisted switch for "Keep this computer awake while agents are working" (Settings >
 * Computer, under the sleep row). engine/keepawake.js is the behaviour; this module is only the SETTING, as
 * engine/autobalance-setting.js: atomic save, a write failure returns a reason and never throws.
 *
 * OFF BY DEFAULT, as the card's wording asks: it uses more power, so it is the person's choice. A missing file reads
 * off, and so does a corrupt or unreadable one: a switch nobody can read must never hold a computer awake.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const FILE = path.join(store.ROOT, 'keepawake.json');

/** @returns {{on:boolean,ok:boolean}} */
function read() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { on: false, ok: true };   // never configured -> off
    return { on: false, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, ok: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { on: false, ok: false };
  return { on: parsed.on === true, ok: true };
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
