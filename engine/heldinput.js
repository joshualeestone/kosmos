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

/* Replace the readings with this minute's. Rows naming one card (two queue names can resolve to it) are one reading:
   their counts added, the oldest `since` kept (review 3). A box read as 'text' says so only when the last reading for
   that card read text too: one read can catch a delivery mid-typing (a room post, a nudge), which is not text left
   unsent, and the real case lasts days, so a minute's wait costs nothing (review 3). Until then the card keeps the
   last reading's word, or 'unread' (which only asks the person to look). */
function setAll(rows) {
  const before = new Map(seen);
  seen.clear();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.name !== 'string' || !r.name) continue;
    const had = seen.get(r.name);
    if (!had) { seen.set(r.name, { since: r.since, count: Number(r.count) || 0, read: r.box }); continue; }
    if (Date.parse(r.since) < Date.parse(had.since)) had.since = r.since;
    had.count += Number(r.count) || 0;
    if (r.box === 'text' || (r.box === 'empty' && had.read === 'unread')) had.read = r.box;   // the word that asks most
  }
  for (const [name, v] of seen) {
    const last = before.get(name);
    v.box = v.read !== 'text' ? v.read : last && last.read === 'text' ? 'text' : (last ? last.box : 'unread');
  }
}

function peek(name) {
  const v = seen.get(String(name));
  return v ? { since: v.since, count: v.count, box: v.box } : null;
}

/* The held stretches already said (name -> when last said, ms), kept on disk so a board restart or update does not say
   them again: limitqueue.heldInputToSay keeps the map, the sweep saves it when it changes (review 1). */
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
   log. `said` is the board's map (loadSaid at start); it is saved whenever it changes. Skipped while a flush run is
   typing, so a box is never read under a delivery. Passed in: readBox(name) -> 'text' | 'empty' | 'unread', and
   cardKey(name), the session name of the card a queue name resolves to (a queue can be named as a send route spelled
   it), so the card's row finds its reading (review 2). Slice 2b: push(event) tells the phone once per stretch, the
   first minute the stretch COUNTS as needing the person (counts(name): an agent Kosmos started, idle or working, the
   same gate as needsPerson), so the phone never says needs-you where the board does not. `pushed` (loadPushed) is
   saved, so a restart does not tell it again. Never throws. Returns what it said, for the tests. */
function sweep({ said, pushed = new Map(), readBox, cardKey, log, counts = () => false, push = () => {}, now = Date.now() }) {
  const out = [];
  try {
    const limitqueue = require('./limitqueue');
    if (limitqueue.isFlushing()) return out;
    const held = limitqueue.heldBehindInput(now, limitqueue.HELD_INPUT_SAY_MS).map((h) => {
      let box = 'unread';
      try { box = readBox(h.name); } catch { /* could not be read */ }
      let key = h.name;
      try { key = cardKey(h.name) || h.name; } catch { /* the queue name */ }
      return { ...h, key, box: box === 'text' || box === 'empty' ? box : 'unread' };
    });
    setAll(held.map((h) => ({ ...h, name: h.key })));
    const boxOf = new Map(held.map((h) => [h.name, h.box]));
    const before = JSON.stringify([...said]);
    const toSay = limitqueue.heldInputToSay(now, limitqueue.HELD_INPUT_SAY_MS, said);
    if (JSON.stringify([...said]) !== before) saveSaid(said);
    // The phone: a stretch that ended (no longer in `said`) is forgotten; one that counts now and was not told is told.
    const pushedBefore = JSON.stringify([...pushed]);
    for (const n of [...pushed.keys()]) if (!said.has(n)) pushed.delete(n);
    for (const h of held) {
      if (!said.has(h.name) || pushed.has(h.name)) continue;   // only a stretch already said in the log, told once
      let yes = false;
      try { yes = counts(h.name) === true; } catch { yes = false; }
      if (!yes) continue;
      pushed.set(h.name, now);
      try { push({ kind: 'needs_you', id: 'heldinput:' + h.key + ':' + now, session: h.key, project: null }); } catch { /* best effort */ }
    }
    if (JSON.stringify([...pushed]) !== pushedBefore) savePushed(pushed);
    for (const h of toSay) {
      const box = boxOf.get(h.name) || 'unread';
      const reads = box === 'text' ? 'holds text that was not sent' : box === 'empty' ? 'reads empty' : 'could not be read';
      try { log('limit-queue: ' + h.name + ' has ' + h.count + ' message(s) held behind its input box, the oldest kept since ' + h.since + '; the box ' + reads + '\n'); } catch { /* best effort */ }
      out.push({ ...h, box });
    }
  } catch { /* said next minute */ }
  return out;
}

/* Slice 2b: the stretches the phone was already told about (queue name -> when), on disk like `said`, so a restart does
   not tell it again. Kept apart from `said` because the phone is told when a stretch first COUNTS as needing the person
   (an agent Kosmos started, idle or working), which can be later than its first log line (review 1 of 2b). */
function pushedFile() { return path.join(store.ROOT, 'heldinput-pushed.json'); }
function loadPushed() {
  try {
    const got = JSON.parse(fs.readFileSync(pushedFile(), 'utf8'));
    if (!got || typeof got !== 'object' || Array.isArray(got)) return new Map();
    return new Map(Object.entries(got).filter(([k, v]) => k && Number.isFinite(v)));
  } catch { return new Map(); }
}
function savePushed(pushed) {
  try {
    fs.mkdirSync(store.ROOT, { recursive: true, mode: 0o700 });
    require('./securewrite').writeSecret(pushedFile(), JSON.stringify(Object.fromEntries(pushed)), 0o600, { atomicOnly: true });
    return true;
  } catch { return false; }
}

function resetForTests() { seen.clear(); for (const f of [saidFile(), pushedFile()]) { try { fs.rmSync(f, { force: true }); } catch { /* none */ } } }

module.exports = { setAll, peek, loadSaid, saveSaid, loadPushed, savePushed, sweep, resetForTests };
