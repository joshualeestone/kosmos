'use strict';

/**
 * kosmos#7212 slice 2: the agents whose messages have waited at least half an hour behind their input box, as the
 * board's minute sweep last saw them, by session name: { since, count, box }. `since` is the oldest kept message's
 * arrival (ISO), `count` how many are kept, `box` what the box read ('text', 'empty' or 'unread').
 *
 * The sweep is the only writer (setAll, once a minute); the status rows read it (peek), so polling the board never
 * reads a pane. In memory only: after a restart the first sweep fills it again.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const seen = new Map();

function setAll(rows) {
  seen.clear();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && typeof r.name === 'string' && r.name) seen.set(r.name, { since: r.since, count: r.count, box: r.box });
  }
}

function peek(name) {
  const v = seen.get(String(name));
  return v ? { ...v } : null;
}

/* The held stretches already said (name -> when last said, ms), kept on disk so a board restart or update neither says
   nor pushes them again: limitqueue.heldInputToSay keeps the map, the sweep saves it when it changes (review 1). */
function saidFile() { return path.join(store.ROOT, 'heldinput-said.json'); }
function loadSaid() {
  try {
    const got = JSON.parse(fs.readFileSync(saidFile(), 'utf8'));
    if (!got || typeof got !== 'object' || Array.isArray(got)) return new Map();
    return new Map(Object.entries(got).filter(([k, v]) => k && Number.isFinite(v)));
  } catch { return new Map(); }
}
function saveSaid(said) {
  try {
    fs.mkdirSync(store.ROOT, { recursive: true, mode: 0o700 });
    require('./securewrite').writeSecret(saidFile(), JSON.stringify(Object.fromEntries(said)), 0o600, { atomicOnly: true });
    return true;
  } catch { return false; }
}

/* The board's minute step, after the limit queue's flush has settled: record every agent held past half an hour with
   what its box reads (for the cards), then say each stretch due (limitqueue.heldInputToSay, once and then daily) in the
   log, and tell the phone on a stretch's first saying. `said` is the board's map (loadSaid at start); it is saved
   whenever it changes. Skipped while a flush run is typing, so a box is never read under a delivery. The pane reads
   and the push are passed in: readBox(name) -> 'text' | 'empty' | 'unread', cardName(name), log(line), push(event).
   Never throws. Returns what it said, for the tests. */
function sweep({ said, readBox, cardName, log, push, now = Date.now() }) {
  const out = [];
  try {
    const limitqueue = require('./limitqueue');
    if (limitqueue.isFlushing()) return out;
    const held = limitqueue.heldBehindInput(now, limitqueue.HELD_INPUT_SAY_MS).map((h) => {
      let box = 'unread';
      try { box = readBox(h.name); } catch { /* could not be read */ }
      return { ...h, box: box === 'text' || box === 'empty' ? box : 'unread' };
    });
    setAll(held);
    const boxOf = new Map(held.map((h) => [h.name, h.box]));
    const before = JSON.stringify([...said]);
    const toSay = limitqueue.heldInputToSay(now, limitqueue.HELD_INPUT_SAY_MS, said);
    if (JSON.stringify([...said]) !== before) saveSaid(said);
    for (const h of toSay) {
      const box = boxOf.get(h.name) || 'unread';
      const reads = box === 'text' ? 'holds text that was not sent' : box === 'empty' ? 'reads empty' : 'could not be read';
      try { log('limit-queue: ' + h.name + ' has ' + h.count + ' message(s) held behind its input box, the oldest kept since ' + h.since + '; the box ' + reads + '\n'); } catch { /* best effort */ }
      // The phone once per held stretch, as a stuck terminal error is (the card says why).
      if (h.first) {
        let shown = h.name;
        try { shown = cardName(h.name) || h.name; } catch { /* the queue name */ }
        try { push({ kind: 'needs_you', id: 'heldinput:' + h.name + ':' + now, agent: shown, session: h.name, project: null }); } catch { /* best effort */ }
      }
      out.push({ ...h, box });
    }
  } catch { /* said next minute */ }
  return out;
}

function resetForTests() { seen.clear(); try { fs.rmSync(saidFile(), { force: true }); } catch { /* none */ } }

module.exports = { setAll, peek, loadSaid, saveSaid, sweep, resetForTests };
