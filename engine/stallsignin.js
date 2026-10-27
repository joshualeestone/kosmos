'use strict';

/**
 * #7212 slice 3: when no message has reached a Claude agent for half an hour (its card's deliveryStall), is it because
 * its Claude account was signed out? A revocation on Anthropic's side leaves the local credentials looking fine, so only
 * a live check can see it, and the accounts route rules a live check out for the status tick. So the tick asks this
 * module, which answers from what it last learned about that agent's OWN account and starts at most one live check of
 * that account an hour (CHECK_EVERY_MS, from when the last one started), in the background. Nothing is checked until an
 * agent on the account is already stuck.
 *
 * Review 2: the record is the ACCOUNT's, not the agent's, so fifteen stuck agents on one signed-out account cost one
 * check an hour, not fifteen, and an agent moved to another account reads that account's record.
 *
 * Review 3: "signed out" is decided as the AI Models screen decides its badge (observed.verdict): the account's live
 * check AND the freshest real request Kosmos saw for it. Review 5: that evidence is the badge's own, handed in by the
 * status route (server.js claudeObservationsFor: any agent on the account, or a Check now on its folder), so the card
 * and the badge cannot disagree; reading only the stuck agent's requests missed a sibling's 401 and contradicted a
 * sibling's good request. `claude
 * auth status` alone is expiry-blind (#874): it says logged in while Anthropic refuses every request, the very case
 * this card is for, so a fresh 401 is "signed out" whatever it says. Unreachable, a check still running, or no account
 * row is "not known", and the card keeps slice 2's reason. As on the badge, the live state is the latest answer (an
 * unknown one is unknown, review 5) and a fresh request outcome outranks it, either way. A connected answer clears the
 * live check's "none" at once (`heard`; for a stored key only from the reader that tries the key), and a "none" from
 * a check that started before it was heard is ignored. In memory, on the board. Never throws.
 */

const CHECK_EVERY_MS = 60 * 60 * 1000;

/* account key ('default' or its folder) -> { at (ms the last check started), running, state (the live check's last
   answer: 'connected' | 'none' | null),
   apiKey (the row is a stored key: "signed out" means the key was refused), connectedAt (ms a connected answer was
   last heard), usedAt (ms a stuck card last read it, for the sweep) } */
const accounts = new Map();
let deps = null;   // setDepsForTests only: { list, checkRow }

const accountsMod = () => require('./accounts');
const listRows = () => (deps && deps.list ? deps.list() : accountsMod().list());
const checkRow = (row) => (deps && deps.checkRow ? deps.checkRow(row) : accountsMod().checkRowLive(row));

/* The key a card's account summary (or a row) is filed under; null when it names no Claude account. */
function keyOf(account) {
  if (!account || account.provider) return null;   // a vendor or Qwen folder is not a Claude account
  if (account.isDefault === true) return 'default';
  try { if (account.dir && accountsMod().isDefaultDir(account.dir)) return 'default'; } catch { /* filed by its folder */ }   // review 5
  return typeof account.dir === 'string' && account.dir ? 'dir:' + account.dir : null;
}

/* The full accounts.list() row for a card's account summary (the card carries the folder, not the row). */
function rowFor(account) {
  const rows = listRows();
  return (Array.isArray(rows) ? rows : []).find((r) => r && (account.isDefault === true ? r.isDefault === true : r.dir === account.dir)) || null;
}

/* Never throws: a fault before the check (the account list unreadable) is a rejected promise, so `running` is always
   cleared. */
function check(account, rec) {
  try {
    const row = rowFor(account);
    if (!row) return Promise.resolve(null);
    rec.apiKey = Boolean(row.apiKey);
    return Promise.resolve(checkRow(row)).then((r) => (r && r.connection ? r.connection.state : null));
  } catch (err) { return Promise.reject(err); }
}

/* The record for `account`, starting its check when it has none or its last started an hour ago and is not running. */
function recordFor(account, now) {
  const key = keyOf(account);
  if (!key) return null;
  let rec = accounts.get(key);
  if (!rec || (!rec.running && now - rec.at >= CHECK_EVERY_MS)) {
    if (!rec) { rec = { at: now, running: false, state: null, apiKey: false, connectedAt: 0, usedAt: now }; accounts.set(key, rec); }
    const startedAt = now;
    rec.at = now; rec.running = true;
    check(account, rec).then((state) => {
      try {
        const { STATE } = require('./subscription');
        // Only an answer moves it, and a "signed out" that started before a connected answer was heard is stale.
        // The latest answer, as the badge reads it (review 5): unknown is unknown, not the last answer kept.
        if (state === STATE.NONE) { if (startedAt > rec.connectedAt) rec.state = 'none'; }   // a tie is not newer: never claim signed out on it
        else rec.state = state === STATE.CONNECTED ? 'connected' : null;
      } catch { /* not known */ }
    }, () => { /* not known: the card keeps its reason */ }).finally(() => { rec.running = false; });
  }
  rec.usedAt = now;
  return rec;
}

/* The AI Models badge's own verdict (observed.verdict) for this card's account: its live check, and the freshest real
   request seen for the agent or the folder. True for "rejected" (a fresh 401) or "signed_out". */
function outBy(card, rec, now, obsFor) {
  const observed = require('./observed');
  const dir = card.account && card.account.dir;
  // The badge's evidence when the route hands it in; without it (a caller with no account join), the folder's Check now.
  const obs = typeof obsFor === 'function' ? ((obsFor(dir) || {}).obs || null) : (dir ? observed.readDir(observed.PROVIDER.ANTHROPIC, dir) : null);
  const v = observed.verdict({ checkLiveState: rec.state, observedOutcome: obs && obs.outcome, observedAt: obs && obs.at, now });
  return v.badge === 'rejected' || v.badge === 'signed_out';
}

/* The card as the person should read it: a stuck Claude agent (runner empty or claude) whose own account was last seen
   signed out (or whose stored key was refused) names that cause, in deliverystreak's words; any other card is returned
   as it is. */
function overlay(card, now = Date.now(), { obsFor } = {}) {
  try {
    if (!card || !card.deliveryStall || typeof card.deliveryStall.since !== 'string' || (card.runner && card.runner !== 'claude')) return card;
    const rec = recordFor(card.account, now);
    if (!rec || !outBy(card, rec, now, obsFor)) return card;
    const ds = require('./deliverystreak');
    const why = rec.apiKey ? 'keyrefused' : 'signedout';
    return { ...card, deliveryStall: { ...card.deliveryStall, signedOut: true, words: ds.WHY_WORDS[why], next: ds.NEXT_WORDS[why] } };
  } catch { return card; }
}

/* A live check saw this account (`{ dir }` or `{ isDefault: true }`) connected: its live state is connected at once, and
   a slower "none" already in flight is ignored when it lands. `fromRow`: the answer came from accounts.checkRowLive
   (review 3: a stored key's "refused" is cleared only by that reader, which tries the key; `claude auth status` answers
   another question for a key folder). */
function heard(account, state, now = Date.now(), { fromRow = false } = {}) {
  try {
    if (state !== require('./subscription').STATE.CONNECTED) return;
    const rec = accounts.get(keyOf(account));
    if (rec && (!rec.apiKey || fromRow)) { rec.state = 'connected'; rec.connectedAt = now; }
  } catch { /* the next check clears it */ }
}

/* Accounts no stuck card has read for an hour lose their record, unless a check is still running. */
function sweep(now = Date.now()) {
  for (const [k, rec] of [...accounts.entries()]) if (!rec.running && now - rec.usedAt >= CHECK_EVERY_MS) accounts.delete(k);
}

function setDepsForTests(d) { deps = d; }
function resetForTests() { accounts.clear(); deps = null; }

module.exports = { CHECK_EVERY_MS, overlay, heard, sweep, setDepsForTests, resetForTests };
