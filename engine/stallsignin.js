'use strict';

/**
 * #7212 slice 3: when no message has reached a Claude agent for half an hour (its card's deliveryStall), is it because
 * its Claude account was signed out? A revocation on Anthropic's side leaves the local credentials looking fine, so only
 * a live check can see it, and the accounts route rules a live check out for the status tick. So the tick asks this
 * module, which answers from what it last learned and starts at most ONE live check of that agent's own account per
 * stall and per hour (CHECK_EVERY_MS), in the background. Nothing is checked until an agent is already stuck.
 *
 * Only a positive "signed out" (subscription STATE.NONE) changes the card: unreachable, a check still running, or no
 * account row is "not known", and the card keeps slice 2's reason. In memory, on the board. Never throws.
 */

const CHECK_EVERY_MS = 60 * 60 * 1000;

/* name -> { since (the stall it was read for), at (ms the check started), running, signedOut (true | false | null) } */
const memo = new Map();
let checker = null;   // setCheckerForTests only

/* The full accounts.list() row for a card's account summary (the card carries the folder, not the row). */
function rowFor(account) {
  const accounts = require('./accounts');
  const rows = accounts.list();
  return rows.find((r) => (account.isDefault === true ? r.isDefault === true : r.dir === account.dir)) || null;
}

function check(account) {
  if (checker) return Promise.resolve(checker(account));
  const row = rowFor(account);
  if (!row) return Promise.resolve(null);
  return require('./accounts').checkRowLive(row).then((r) => (r && r.connection ? r.connection.state : null));
}

/* True when `name`'s own account was last seen signed out during THIS stall (`stall.since`), else false. Starts a check
   when this stall has none yet, or the last finished an hour ago. `account` is the card's account summary; a vendor or
   Qwen folder (`provider`) is not a Claude account and is never checked. */
function signedOut(name, stall, account, now = Date.now()) {
  try {
    if (!name || !stall || typeof stall.since !== 'string' || !account || account.provider) return false;
    const key = String(name);
    let m = memo.get(key);
    if (m && m.since !== stall.since) { memo.delete(key); m = null; }   // a new stall: what the last one learned is old
    if (!m || (!m.running && now - m.at >= CHECK_EVERY_MS)) {
      const entry = { since: stall.since, at: now, running: true, signedOut: m ? m.signedOut : null };
      memo.set(key, entry);
      check(account).then((state) => {
        const { STATE } = require('./subscription');
        // Only an answer moves it: unreachable or no row leaves what the last check learned.
        if (state === STATE.NONE) entry.signedOut = true;
        else if (state === STATE.CONNECTED) entry.signedOut = false;
      }, () => { /* not known: the card keeps its reason */ }).finally(() => { entry.running = false; });
      m = entry;
    }
    return m.signedOut === true;
  } catch { return false; }
}

/* The card as the person should read it: a stuck Claude agent (runner empty or claude) whose own account was last seen
   signed out names that cause, in deliverystreak's words; any other card is returned as it is. */
function overlay(card, now = Date.now()) {
  try {
    if (!card || !card.deliveryStall || (card.runner && card.runner !== 'claude')) return card;
    if (!signedOut(card.sessionName, card.deliveryStall, card.account, now)) return card;
    const ds = require('./deliverystreak');
    return { ...card, deliveryStall: { ...card.deliveryStall, signedOut: true, words: ds.WHY_WORDS.signedout, next: ds.NEXT_WORDS.signedout } };
  } catch { return card; }
}

/* Agents no longer stuck (or gone) lose their record, so the next stall checks again. */
function sweep(stuckNames) {
  const keep = new Set(Array.from(stuckNames || [], String));
  for (const k of [...memo.keys()]) if (!keep.has(k)) memo.delete(k);
}

function setCheckerForTests(fn) { checker = fn; }
function resetForTests() { memo.clear(); checker = null; }

module.exports = { CHECK_EVERY_MS, signedOut, overlay, sweep, setCheckerForTests, resetForTests };
