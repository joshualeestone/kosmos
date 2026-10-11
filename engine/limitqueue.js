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

/* Keep one message for `name`. Returns true when kept. */
function add(name, entry) {
  try {
    if (!entry || typeof entry.id !== 'string' || typeof entry.envelope !== 'string') return false;
    const now = list(name).filter((e) => e.id !== entry.id);
    now.push({ id: entry.id, from: String(entry.from || ''), to: String(name), envelope: entry.envelope, at: entry.at, reset: entry.reset });
    return write(name, now);
  } catch { return false; }
}

function has(name, id) { return list(name).some((e) => e.id === id); }

function remove(name, id) {
  try { return write(name, list(name).filter((e) => e.id !== id)); } catch { return false; }
}

/* The agents that have kept messages. */
function names() {
  try {
    return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => {
      const first = list(f.slice(0, -5))[0];
      return first ? first.to : null;
    }).filter(Boolean);
  } catch { return []; }
}

/* The minute sweep. For each agent with kept messages: drop those DROP_AFTER_MS past their reset (onDropped); then,
   when `isReleased(card)` (the card for the agent in `roster`), type the rest in order with `deliver`. A message typed
   (placed or unconfirmed) is removed and reported (onDelivered); the first that is not stops that agent's run and
   stays. Returns [{ name, id, state }] for what was typed. */
async function flush(roster, { deliver, isReleased, resolveCard, DELIVERY, onDelivered, onDropped, now = Date.now() }) {
  const out = [];
  for (const name of names()) {
    try {
      const kept = list(name);
      const live = [];
      for (const e of kept) {
        const reset = Date.parse(e.reset);
        if (Number.isFinite(reset) && now - reset > DROP_AFTER_MS) {
          remove(name, e.id);
          try { if (onDropped) onDropped(e); } catch { /* the drop stands */ }
        } else live.push(e);
      }
      if (!live.length) continue;
      const card = resolveCard(roster, name);
      if (!card || !isReleased(card)) continue;
      for (const e of live) {
        let v;
        try { v = await deliver(name, e.envelope, roster); } catch { v = null; }
        const state = v && v.state;
        if (state !== DELIVERY.PLACED && state !== DELIVERY.UNCONFIRMED) break;
        remove(name, e.id);
        try { if (onDelivered) onDelivered(e, v); } catch { /* it was typed */ }
        out.push({ name, id: e.id, state });
      }
    } catch { /* this agent's messages stay for the next minute */ }
  }
  return out;
}

module.exports = { add, has, list, remove, names, flush, fileFor, dir, DROP_AFTER_MS };
