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

function list(name) {
  try {
    const got = JSON.parse(fs.readFileSync(fileFor(name), 'utf8'));
    // Only entries for this exact agent: another name with the same store key never reads them (see add).
    return Array.isArray(got) ? got.filter((e) => e && typeof e.id === 'string' && typeof e.envelope === 'string' && e.to === String(name)) : [];
  } catch { return []; }
}

function write(name, entries) {
  // force: a file already gone is no error, so any error here is a removal that failed.
  if (!entries.length) { try { fs.rmSync(fileFor(name), { force: true }); } catch { return false; } return true; }
  fs.mkdirSync(dir(), { recursive: true });
  require('./securewrite').writeSecret(fileFor(name), JSON.stringify(entries), 0o600, { atomicOnly: true });
  return true;
}

/* Keep one message for `name`. Returns true when kept. */
function add(name, entry) {
  try {
    if (!entry || typeof entry.id !== 'string' || typeof entry.envelope !== 'string') return false;
    const now = list(name).filter((e) => e.id !== entry.id);
    if (now.length >= MAX_KEPT || now.filter((e) => e.from === String(entry.from || '')).length >= MAX_PER_SENDER) return false;
    now.push({ id: entry.id, from: String(entry.from || ''), to: String(name), envelope: entry.envelope, at: entry.at, reset: entry.reset,
      key: typeof entry.key === 'string' ? entry.key : '', spill: typeof entry.spill === 'string' ? entry.spill : null,
      ...(entry.behind === true ? { behind: true } : {}) });
    return write(name, now);
  } catch { return false; }
}

function has(name, id) { return list(name).some((e) => e.id === id); }
/* The kept message with this send key (sender, text and the message it answers), at any age, or null. */
function keptByKey(name, key) { return (key && list(name).find((e) => e.key === key)) || null; }

function remove(name, id) {
  try { return write(name, list(name).filter((e) => e.id !== id)); } catch { return false; }
}

/* The agents that have kept messages. */
function names() {
  try {
    return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => {
      let first = null;
      try {
        const got = JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8'));
        first = Array.isArray(got) ? got.find((e) => e && typeof e.to === 'string' && fileFor(e.to) === path.join(dir(), f)) || null : null;
      } catch { first = null; }
      // Nothing readable left in it: removed, so it is not looked at every minute for ever.
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
const typing = new Set();
function isTyping(id) { return typing.has(id); }   // read by the tests; the sweep reads `typing` itself
/* What the recipient is told about a kept message as it is typed: kept, and when it was sent, so a day-old go-ahead
   does not read as new. */
function keptNote(e) { return ' [kept for you while you were out of usage; sent ' + e.at + ']'; }
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
async function flushOnce(roster, { deliver, isReleased, resolveCard, DELIVERY, onDelivered, onDropped, now = Date.now() }) {
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
        // Still kept, and not typed by a run that outlived the one-run guard: checked just before typing.
        // Claimed by a run that outlived the guard: this agent waits, so nothing is typed ahead of it.
        if (typing.has(e.id)) break;
        if (done.has(e.id) || !has(name, e.id)) continue;
        if (typedNow >= PER_RUN) break;
        typedNow += 1;
        typing.add(e.id);
        let v;
        try { v = await deliver(name, e.envelope + keptNote(e), roster); } catch { v = null; } finally { typing.delete(e.id); }
        const state = v && v.state;
        if (state !== DELIVERY.PLACED && state !== DELIVERY.UNCONFIRMED) break;
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

function resetForTests() { done.clear(); typing.clear(); flushingSince = 0; }

module.exports = { keptNote, isTyping, resetForTests, add, has, keptByKey, list, remove, names, flush, fileFor, dir, DROP_AFTER_MS, MAX_KEPT, MAX_PER_SENDER, PER_RUN };
