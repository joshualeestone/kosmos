'use strict';

/**
 * #5805 slice 2a: `kosmos msg` messages kept for an agent that is out of usage, typed after the reset.
 *
 * messages.sendWithDelivery keeps a message here when chat.limitHeldVerdict holds its recipient; the board's minute
 * sweep (flush) types the kept messages in order once the recipient's card reads released, and drops one still kept
 * DROP_AFTER_MS past its reset. One small file per agent under the store. Never throws.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const DROP_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_KEPT = 200;   // per agent, from all senders together
const MAX_PER_SENDER = 20;   // per agent per sender: one sender in a loop cannot crowd out the others
/* Typed per agent per minute: the roster is read once a minute, so an agent that hits its limit again mid-backlog is
   noticed within this many messages, not after the whole backlog. */
const PER_RUN = 5;

function dir() { return path.join(store.ROOT, 'limitqueue'); }
/* The store key alone can make two names one file (it lowercases and strips); a short hash of the exact name keeps
   every agent its own file, so no name has to be refused. */
function fileFor(name) {
  const n = String(name);
  return path.join(dir(), store.safeKey(n) + '-' + crypto.createHash('sha256').update(n).digest('hex').slice(0, 12) + '.json');
}

/* One agent's kept messages, read from its file: { ok, entries }. A missing file is ok and empty; a file that cannot be
   read or parsed (a rename in progress, too many open files) is NOT ok, so nothing built on it overwrites it. Only
   entries for this exact agent are returned. */
function readEntries(name) {
  let raw;
  try { raw = fs.readFileSync(fileFor(name), 'utf8'); }
  catch (err) { return { ok: !!err && err.code === 'ENOENT', entries: [] }; }
  let got;
  try { got = JSON.parse(raw); } catch { return { ok: false, entries: [] }; }
  if (!Array.isArray(got)) return { ok: false, entries: [] };
  return { ok: true, entries: got.filter((e) => e && typeof e.id === 'string' && typeof e.envelope === 'string' && e.to === String(name)) };
}
function list(name) { return readEntries(name).entries; }

function write(name, entries) {
  // force: a file already gone is no error, so any error here is a removal that failed.
  if (!entries.length) { try { fs.rmSync(fileFor(name), { force: true }); } catch { return false; } return true; }
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });   // the file names say which agents have kept messages
  require('./securewrite').writeSecret(fileFor(name), JSON.stringify(entries), 0o600, { atomicOnly: true });
  return true;
}

/* Keep one message for `name`. Returns true when kept. */
function add(name, entry) { return addOrWhy(name, entry) === ''; }
/* As add, answering why a message was not kept ('' when it was): 'sender-cap', 'agent-cap', or 'store' (the file could
   not be read or written), so the sender is told the true reason. */
function addOrWhy(name, entry) {
  try {
    if (!entry || typeof entry.id !== 'string' || typeof entry.envelope !== 'string') return 'store';
    const read = readEntries(name);
    if (!read.ok) return 'store';   // an unreadable file is never overwritten: the sender is told it could not be kept
    const now = read.entries.filter((e) => e.id !== entry.id);
    if (now.length >= MAX_KEPT) return 'agent-cap';
    if (now.filter((e) => e.from === String(entry.from || '')).length >= MAX_PER_SENDER) return 'sender-cap';
    now.push({ id: entry.id, from: String(entry.from || ''), to: String(name), envelope: entry.envelope, at: entry.at, reset: entry.reset,
      key: typeof entry.key === 'string' ? entry.key : '', spill: typeof entry.spill === 'string' ? entry.spill : null,
      ...(entry.behind === true ? { behind: true } : {}),
      // #5805 slice 2b: a person's own message: its text and trailer are typed with the envelope, as the route types them.
      ...(entry.kind === 'dm' ? { kind: 'dm', text: String(entry.text || ''), trailer: String(entry.trailer || '') } : {}),
      // A task message's line: typed as it is, and on a drop its sender is told which task it was in.
      ...(entry.kind === 'task' ? { kind: 'task', about: String(entry.about || '') } : {}) });
    return write(name, now) ? '' : 'store';
  } catch { return 'store'; }
}

function has(name, id) { return list(name).some((e) => e.id === id); }
/* The kept message with this send key (sender, text and the message it answers), at any age, or null. */
function keptByKey(name, key) { return (key && list(name).find((e) => e.key === key)) || null; }

function remove(name, id) {
  try {
    const read = readEntries(name);
    if (!read.ok) return false;   // unreadable: not rewritten (the caller remembers the id instead)
    return write(name, read.entries.filter((e) => e.id !== id));
  } catch { return false; }
}

/* The agents that have kept messages. */
function names() {
  try {
    return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => {
      let got;
      try { got = JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')); } catch { return null; }   // unreadable now: left alone, next minute
      const first = Array.isArray(got) ? got.find((e) => e && typeof e.to === 'string' && fileFor(e.to) === path.join(dir(), f)) || null : null;
      // Read, and nothing in it belongs here: removed, so it is not looked at every minute for ever.
      if (!first) { try { fs.rmSync(path.join(dir(), f), { force: true }); } catch { /* next minute */ } }
      return first ? first.to : null;
    }).filter(Boolean);
  } catch { return []; }
}

/* Ids this board already typed or dropped whose removal from the file failed: skipped (and their removal tried again)
   so a failed write never types a message twice or tells its sender twice. */
const done = new Set();
/* Ids being typed this moment: claimed before the await, so no other flush run (one that outlived the guard below)
   types the same message alongside it, or ahead of it. */
const typing = new Map();   // id -> when it was claimed
/* A claim older than CLAIM_STALE_MS is a paste that never settled: dropped, so one hung message does not hold its
   agent's queue until a restart (it is then tried again, the stated cost). Longer than FLUSH_STUCK_MS on purpose: a
   newer run that starts after the one-run guard frees waits behind a paste that is merely slow. */
const CLAIM_STALE_MS = 60 * 60 * 1000;
function claimedNow(id) {
  const since = typing.get(id);
  if (since === undefined) return false;
  if (Date.now() - since > CLAIM_STALE_MS) { typing.delete(id); return false; }
  return true;
}
function isTyping(id) { return claimedNow(id); }   // read by the tests
/* Typed (or dropped) already, its removal from the file having failed: still in the file, but not kept. */
function isDone(id) { return done.has(id); }   // read by the tests; the sweep reads `typing` itself
/* What the recipient is told about a kept message as it is typed: kept, and when it was sent, so a day-old go-ahead
   does not read as new. */
function keptNote(e) {
  return e && e.behind ? ' [kept behind earlier messages; sent ' + e.at + ']' : ' [kept for you while you were out of usage; sent ' + e.at + ']';
}
/* Send now anyway (slice 2b) takes the same claim while it types a kept message, so the sweep skips it and a crash
   mid-typing leaves it kept (typed again, at worst) rather than lost. False when it is already claimed, or already
   typed (its removal from the file having failed), so Send now anyway answers 409 rather than type it twice. */
function claim(id) { if (claimedNow(id) || done.has(id)) return false; typing.set(id, Date.now()); return true; }
function release(id) { typing.delete(id); }
/* A kept message typed by another path (Send now anyway): removed, or, when the removal fails, remembered as done so
   the sweep never types it again. */
function settle(name, id) { if (!remove(name, id)) done.add(id); }
let flushingSince = 0;
let runToken = 0;
const FLUSH_STUCK_MS = 15 * 60 * 1000;
/* The minute sweep. For each agent with kept messages: drop those DROP_AFTER_MS past their reset (onDropped); then,
   when `isReleased(card)` (the card for the agent in `roster`), type the rest in order with `deliver`. A message typed
   (placed or unconfirmed) is removed and reported (onDelivered); the first that is not stops that agent's run and
   stays. Returns [{ name, id, state }] for what was typed. */
async function flush(roster, opts) {
  // One run at a time: a run still typing a backlog when the next minute starts would type each message twice. A run
  // that has not finished in FLUSH_STUCK_MS (a delivery that never settled) no longer blocks the next one.
  if (flushingSince && Date.now() - flushingSince < FLUSH_STUCK_MS) return [];
  const mine = ++runToken;
  flushingSince = Date.now();
  // Only this run frees the guard: a stuck run that finishes late must not clear a newer run's.
  try { return await flushOnce(roster, opts); } finally { if (runToken === mine) flushingSince = 0; }
}
async function flushOnce(roster, { deliver, isReleased, resolveCard, DELIVERY, onDelivered, onDropped, onStuck, now = Date.now() }) {
  const out = [];
  for (const name of names()) {
    try {
      const kept = [];
      for (const e of list(name)) {
        if (done.has(e.id)) { if (remove(name, e.id)) done.delete(e.id); continue; }   // typed or dropped already
        kept.push(e);
      }
      const live = [];
      for (const e of kept) {
        // Its reset, or when it arrived if the reset cannot be read: nothing is kept for ever.
        const reset = Number.isFinite(Date.parse(e.reset)) ? Date.parse(e.reset) : Date.parse(e.at);
        // Being typed this moment (a run that outlived the guard): not dropped under it.
        if (claimedNow(e.id)) { live.push(e); continue; }
        if (!Number.isFinite(reset) || now - reset > DROP_AFTER_MS) {
          if (!remove(name, e.id)) done.add(e.id);
          try { if (onDropped) onDropped(e, roster); } catch { /* the drop stands */ }
        } else live.push(e);
      }
      if (!live.length) continue;
      const card = resolveCard(roster, name);
      if (!card || !isReleased(card, roster)) continue;
      let typedNow = 0;
      for (const e of live) {
        // Claimed by a run that outlived the guard: this agent waits, so nothing is typed ahead of it.
        if (claimedNow(e.id)) break;
        // Still kept (not typed or dropped meanwhile): checked just before typing. A file that cannot be read now stops
        // this agent's run (skipping one would type the next ahead of it).
        const kept = readEntries(name);
        if (!kept.ok) break;
        if (done.has(e.id) || !kept.entries.some((x) => x.id === e.id)) continue;
        if (typedNow >= PER_RUN) break;
        typedNow += 1;
        typing.set(e.id, Date.now());
        let v;
        try { v = await deliver(name, e.envelope + keptNote(e), roster, e); } catch { v = null; } finally { typing.delete(e.id); }
        const state = v && v.state;
        if (state !== DELIVERY.PLACED && state !== DELIVERY.UNCONFIRMED) {
          try { if (onStuck) onStuck(e, v); } catch { /* it stays kept either way */ }
          break;
        }
        if (!remove(name, e.id)) done.add(e.id);
        try { if (onDelivered) onDelivered(e, v); } catch { /* it was typed */ }
        out.push({ name, id: e.id, state });
        // Unconfirmed: it may still be in the composer; the next one waits a minute rather than type on top of it.
        if (state === DELIVERY.UNCONFIRMED) break;
      }
    } catch { /* this agent's messages stay for the next minute */ }
  }
  return out;
}

/* A person's message row (slice 2b) whose new delivery could not be written yet (the thread's lock busy, or its file
   unreadable for a moment): kept here and written by the next sweep, so a row never says "Held" for a message that
   was typed or dropped. In memory only: a restart leaves such a row held (stated in the plan). */
const rowFixes = new Map();
function setRow(name, at, delivery, chat) {
  const key = String(name) + '\u0000' + String(at);
  let ok = false;
  try { ok = chat.updateDmDelivery(name, at, delivery); } catch { ok = false; }
  if (ok) rowFixes.delete(key); else rowFixes.set(key, { name: String(name), at: String(at), delivery });
  return ok;
}
function retryRows(chat) {
  for (const f of [...rowFixes.values()]) setRow(f.name, f.at, f.delivery, chat);
}
/* The board's minute sweep, wired: `kosmos msg` messages (slice 2a) and a person's own messages (slice 2b, kind 'dm')
   are typed through the automatic gate, each as its own route types it, once chat.limitQueueReleased; a typed or
   dropped message is recorded where its sender looks (the message log and its sender's pane, or the person's
   conversation row). */
function sweepHooks({ chat, messages }) {
  retryRows(chat);
  return {
    deliver: (n, env, r, e) => (e && e.kind === 'dm' ? chat.deliverAutomaticAsync(n, e.text, r, e.envelope, (e.trailer || '') + keptNote(e)) : chat.deliverAutomaticAsync(n, env, r)),
    resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY, isReleased: chat.limitQueueReleased,
    // A task line has no message-log row to point back at: the task's own conversation is its record.
    onDelivered: (e, v) => (e.kind === 'dm' ? setRow(e.to, e.at, v, chat) : e.kind === 'task' ? undefined : messages.logHeldDelivered(e, v)),
    // A person's message the sweep could not type: its row stays held and says why (a menu up, no window), so it does
    // not read as merely waiting for the reset. Written straight, not retried: a later outcome replaces it anyway.
    onStuck: (e, v) => {
      if (e.kind !== 'dm') return;
      const because = String((v && v.because) || 'it could not be typed').replace(/^held: /, '');
      try { chat.updateDmDelivery(e.to, e.at, { state: 'held', stuck: because }); } catch { /* the row stays as it was */ }
    },
    onDropped: (e, r) => {
      if (e.kind === 'dm') { setRow(e.to, e.at, { state: chat.DELIVERY.COULD_NOT, because: 'Kosmos kept it for a day and could not type it' }, chat); return; }
      if (e.kind === 'task') { messages.tellTaskLineDropped(e, r).catch(() => { /* the drop stands */ }); return; }
      messages.tellHeldDropped(e, r).catch(() => { /* recorded */ });
    },
  };
}

function resetForTests() { done.clear(); typing.clear(); rowFixes.clear(); flushingSince = 0; }

module.exports = { keptNote, isTyping, isDone, addOrWhy, readEntries, resetForTests, add, has, keptByKey, list, remove, names, flush, fileFor, dir, DROP_AFTER_MS, MAX_KEPT, MAX_PER_SENDER, PER_RUN, CLAIM_STALE_MS, sweepHooks, setRow, claim, release, settle };
