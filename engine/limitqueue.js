'use strict';

/**
 * #5805 slice 2a: `kosmos msg` messages kept for an agent that is out of usage, typed after the reset.
 *
 * messages.sendWithDelivery keeps a message here when chat.limitHeldVerdict holds its recipient; the board's minute
 * sweep (flush) types the kept messages in order once the recipient's card reads released, and drops one still kept
 * DROP_AFTER_MS past its reset. One small file per agent under the store. Never throws.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const DROP_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_KEPT = 200;   // per agent, from all senders together
const MAX_PER_SENDER = 20;   // per agent per sender: one sender in a loop cannot crowd out the others

function dir() { return path.join(store.ROOT, 'limitqueue'); }
function fileFor(name) { return path.join(dir(), store.safeKey(String(name)) + '.json'); }

function list(name) {
  try {
    const got = JSON.parse(fs.readFileSync(fileFor(name), 'utf8'));
    return Array.isArray(got) ? got.filter((e) => e && typeof e.id === 'string' && typeof e.envelope === 'string') : [];
  } catch { return []; }
}

function write(name, entries) {
  if (!entries.length) { try { fs.rmSync(fileFor(name), { force: true }); } catch { /* nothing to remove */ } return true; }
  fs.mkdirSync(dir(), { recursive: true });
  require('./securewrite').writeSecret(fileFor(name), JSON.stringify(entries), 0o600, { atomicOnly: true });
  return true;
}

/* Keep one message for `name`. Returns true when kept. A name whose store key is not the name itself is refused: two
   such names can share one file, and one agent's messages would be typed to the other. */
function add(name, entry) {
  try {
    if (!entry || typeof entry.id !== 'string' || typeof entry.envelope !== 'string') return false;
    if (store.safeKey(String(name)) !== String(name)) return false;
    const now = list(name).filter((e) => e.id !== entry.id);
    if (now.length >= MAX_KEPT || now.filter((e) => e.from === String(entry.from || '')).length >= MAX_PER_SENDER) return false;
    now.push({ id: entry.id, from: String(entry.from || ''), to: String(name), envelope: entry.envelope, at: entry.at, reset: entry.reset,
      key: typeof entry.key === 'string' ? entry.key : '', spill: typeof entry.spill === 'string' ? entry.spill : null });
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
      const first = list(f.slice(0, -5))[0];
      // Nothing readable left in it: removed, so it is not looked at every minute for ever.
      if (!first) { try { fs.rmSync(path.join(dir(), f), { force: true }); } catch { /* next minute */ } }
      return first ? first.to : null;
    }).filter(Boolean);
  } catch { return []; }
}

/* The minute sweep. For each agent with kept messages: drop those DROP_AFTER_MS past their reset (onDropped); then,
   when `isReleased(card)` (the card for the agent in `roster`), type the rest in order with `deliver`. A message typed
   (placed or unconfirmed) is removed and reported (onDelivered); the first that is not stops that agent's run and
   stays. Returns [{ name, id, state }] for what was typed. */
let flushing = false;
async function flush(roster, opts) {
  // One run at a time: a run still typing a backlog when the next minute starts would type each message twice.
  if (flushing) return [];
  flushing = true;
  try { return await flushOnce(roster, opts); } finally { flushing = false; }
}
async function flushOnce(roster, { deliver, isReleased, resolveCard, DELIVERY, onDelivered, onDropped, now = Date.now() }) {
  const out = [];
  for (const name of names()) {
    try {
      const kept = list(name).filter((e) => e.to === name);
      const live = [];
      for (const e of kept) {
        const reset = Date.parse(e.reset);
        if (Number.isFinite(reset) && now - reset > DROP_AFTER_MS) {
          remove(name, e.id);
          try { if (onDropped) onDropped(e, roster); } catch { /* the drop stands */ }
        } else live.push(e);
      }
      if (!live.length) continue;
      const card = resolveCard(roster, name);
      if (!card || !isReleased(card, roster)) continue;
      for (const e of live) {
        let v;
        try { v = await deliver(name, e.envelope, roster); } catch { v = null; }
        const state = v && v.state;
        if (state !== DELIVERY.PLACED && state !== DELIVERY.UNCONFIRMED) break;
        remove(name, e.id);
        try { if (onDelivered) onDelivered(e, v); } catch { /* it was typed */ }
        out.push({ name, id: e.id, state });
        // Unconfirmed: it may still be in the composer; the next one waits a minute rather than type on top of it.
        if (state === DELIVERY.UNCONFIRMED) break;
      }
    } catch { /* this agent's messages stay for the next minute */ }
  }
  return out;
}

module.exports = { add, has, keptByKey, list, remove, names, flush, fileFor, dir, DROP_AFTER_MS, MAX_KEPT, MAX_PER_SENDER };
