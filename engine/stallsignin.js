'use strict';

/**
 * #7212 slice 3: when no message has reached a Claude agent for half an hour (its card's deliveryStall), is it because
 * its Claude account was signed out? A revocation on Anthropic's side leaves the local credentials looking fine, so only
 * a live check can see it, and the accounts route rules a live check out for the status tick. So the tick asks this
 * module, which answers from what it last learned and starts at most ONE live check of that agent's own account per
 * stall and per hour (CHECK_EVERY_MS, from when the last one started), in the background. Nothing is checked until an
 * agent is already stuck.
 *
 * Only a positive "signed out" (subscription STATE.NONE) changes the card: unreachable, a check still running, or no
 * account row is "not known", and the card keeps slice 2's reason. A connected answer, here or from the accounts screen
 * (heard, review round 1), clears it at once, so a person who signed in again is not told to sign in again.
 * In memory, on the board. Never throws.
 */

const CHECK_EVERY_MS = 60 * 60 * 1000;

/* name -> { since (the stall it was read for), at (ms the check started), running, signedOut (true | false | null),
   apiKey (the row is a stored key, so "signed out" means the key was refused), dir, isDefault (the row checked) } */
const memo = new Map();
let deps = null;   // setDepsForTests only: { list, checkRow }

const accountsMod = () => require('./accounts');
const listRows = () => (deps && deps.list ? deps.list() : accountsMod().list());
const checkRow = (row) => (deps && deps.checkRow ? deps.checkRow(row) : accountsMod().checkRowLive(row));

/* The full accounts.list() row for a card's account summary (the card carries the folder, not the row). */
function rowFor(account) {
  const rows = listRows();
  return (Array.isArray(rows) ? rows : []).find((r) => r && (account.isDefault === true ? r.isDefault === true : r.dir === account.dir)) || null;
}

/* Never throws: a fault before the check (the account list unreadable) is a rejected promise, so the record's
   `running` is always cleared (review round 1). */
function check(account, entry) {
  try {
    const row = rowFor(account);
    if (!row) return Promise.resolve(null);
    entry.apiKey = Boolean(row.apiKey);
    entry.dir = row.dir; entry.isDefault = row.isDefault === true;
    return Promise.resolve(checkRow(row)).then((r) => (r && r.connection ? r.connection.state : null));
  } catch (err) { return Promise.reject(err); }
}

/* True when `name`'s own account was last seen signed out during THIS stall (`stall.since`), else false. Starts a check
   when this stall has none yet, or the last started an hour ago and is not still running. `account` is the card's
   account summary; a vendor or Qwen folder (`provider`) is not a Claude account and is never checked. */
function signedOut(name, stall, account, now = Date.now()) {
  const m = entryFor(name, stall, account, now);
  return Boolean(m && m.signedOut === true);
}
function entryFor(name, stall, account, now) {
  try {
    if (!name || !stall || typeof stall.since !== 'string' || !account || account.provider) return null;
    const key = String(name);
    let m = memo.get(key);
    if (m && m.since !== stall.since) { memo.delete(key); m = null; }   // a new stall: what the last one learned is old
    if (!m || (!m.running && now - m.at >= CHECK_EVERY_MS)) {
      const entry = { since: stall.since, at: now, running: true, signedOut: m ? m.signedOut : null, apiKey: m ? m.apiKey : false, dir: m ? m.dir : null, isDefault: m ? m.isDefault : false };
      memo.set(key, entry);
      check(account, entry).then((state) => {
        const { STATE } = require('./subscription');
        // Only an answer moves it: unreachable or no row leaves what the last check learned.
        if (state === STATE.NONE) entry.signedOut = true;
        else if (state === STATE.CONNECTED) entry.signedOut = false;
      }, () => { /* not known: the card keeps its reason */ }).finally(() => { entry.running = false; });
      m = entry;
    }
    return m;
  } catch { return null; }
}

/* The card as the person should read it: a stuck Claude agent (runner empty or claude) whose own account was last seen
   signed out (or whose stored key was refused) names that cause, in deliverystreak's words; any other card is returned
   as it is. */
function overlay(card, now = Date.now()) {
  try {
    if (!card || !card.deliveryStall || (card.runner && card.runner !== 'claude')) return card;
    const m = entryFor(card.sessionName, card.deliveryStall, card.account, now);
    if (!m || m.signedOut !== true) return card;
    const ds = require('./deliverystreak');
    const why = m.apiKey ? 'keyrefused' : 'signedout';
    return { ...card, deliveryStall: { ...card.deliveryStall, signedOut: true, words: ds.WHY_WORDS[why], next: ds.NEXT_WORDS[why] } };
  } catch { return card; }
}

/* accounts.checkRowLive saw `row` connected (the accounts screen, or this module's own check): every stuck agent on that
   account stops saying it is signed out, at once. */
function heard(row, state) {
  try {
    if (!row || state !== require('./subscription').STATE.CONNECTED) return;
    for (const m of memo.values()) {
      if (m.signedOut === true && (row.isDefault === true ? m.isDefault === true : (m.dir && m.dir === row.dir))) m.signedOut = false;
    }
  } catch { /* the next check clears it */ }
}

/* Agents no longer stuck (or gone) lose their record, so the next stall checks again; but never a record whose check is
   still running or started within the hour (review round 1: a card that leaves its stall for a minute and comes back
   would otherwise start a second check at once). */
function sweep(stuckNames, now = Date.now()) {
  const keep = new Set(Array.from(stuckNames || [], String));
  for (const [k, m] of [...memo.entries()]) if (!keep.has(k) && !m.running && now - m.at >= CHECK_EVERY_MS) memo.delete(k);
}

function setDepsForTests(d) { deps = d; }
function resetForTests() { memo.clear(); deps = null; }

module.exports = { CHECK_EVERY_MS, signedOut, overlay, heard, sweep, setDepsForTests, resetForTests };
