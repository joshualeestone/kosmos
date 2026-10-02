'use strict';
/* #3997 (reopened 2026-09-28): an idle Claude account shows its login as good, without spending anything.
 *
 * A Claude row went green only from a real outcome (an agent's request, or Check now, which runs a paid
 * `claude -p`), so a signed-in account no agent was using sat amber. This reads the login's own death date,
 * `claudeAiOauth.refreshTokenExpiresAt`, from the same keychain entry Claude Code uses, through loginexpiry
 * (which returns only that number and never a token). When `claude auth status` says signed in, this date is
 * still ahead and no rejection has been recorded, the row carries the date and the page shows a calm neutral
 * "Signed in · login good until <date>" (Liu Kang's ruling C on #3997): neither amber, which reads as broken, nor
 * green, which Josh's rule reserves for an answer from Anthropic (#874/#1921). It never renews or rotates a token.
 *
 * WHICH ENTRY: the one `claude auth status` reads for the same row (engine/accounts.js listLiveNow): the
 * default account with CLAUDE_CONFIG_DIR UNSET (the bare entry), any other account with it set to its folder.
 * loginexpiry.serviceNameFor keys on that set-vs-unset bit (the #2129 class).
 *
 * ASYNC, shared and cached: the keychain read is a `security` subprocess. GET /api/accounts waits for it only
 * READ_BUDGET_MS (validUntilWithin); a read that takes longer goes on, and its answer is there on the next poll.
 * An answer is kept CACHE_MS, no answer (no entry, a slow or refused read) MISS_CACHE_MS, so a missing or slow
 * entry is not asked again every minute (review iteration 1). */
const loginexpiry = require('./loginexpiry');
const { OUTCOME } = require('./observed');

// Off by ruling C. Josh can turn it on if he overrules his own green rule: an idle account with a good login would
// then show green instead of the neutral state.
const GREEN_FROM_LOGIN = false;
const CACHE_MS = 60 * 1000;
const MISS_CACHE_MS = 10 * 60 * 1000;
const READ_BUDGET_MS = 750;

let reader = null;
/** Tests only: inject the expiry reader, ccd -> number | null (or a promise of one). */
function setReaderForTests(fn) { reader = typeof fn === 'function' ? fn : null; }

const cache = new Map();      // service name -> { at, until }
const inflight = new Map();   // service name -> the read under way
function _clearForTest() { cache.clear(); inflight.clear(); }

/* The row's login expiry (epoch ms), or null when there is none to read. Never rejects. */
function validUntil(row, now = Date.now()) {
  if (!row || row.apiKey) return Promise.resolve(null);   // a key account has its own live check (claudeaccounts)
  const ccd = row.isDefault ? undefined : row.dir;
  if (!row.isDefault && !ccd) return Promise.resolve(null);
  const service = loginexpiry.serviceNameFor(ccd);
  const hit = cache.get(service);
  const gen = loginexpiry.loginGeneration();   // #5018: a sign-in since this was read makes it stale
  if (hit && hit.gen === gen && now - hit.at < (hit.until == null ? MISS_CACHE_MS : CACHE_MS)) return Promise.resolve(hit.until);
  const busy = inflight.get(service);
  if (busy && busy.gen === gen) return busy.read;
  // The entry is in the map BEFORE the read starts: a read with no await (no keychain on this platform) runs to its
  // end synchronously, and its cleanup must find its own entry, not a binding that does not exist yet.
  const entry = { gen, read: null };
  inflight.set(service, entry);
  entry.read = (async () => {
    let until = null;
    try {
      if (reader) until = await reader(ccd);
      else if (process.platform === 'darwin' && !process.env.NODE_TEST_CONTEXT) {
        const body = await loginexpiry.readCredAsync(service);
        until = loginexpiry.refreshExpiryFor(ccd, { readCred: () => body });
      }
    } catch { until = null; }
    until = Number.isFinite(until) ? until : null;
    const prev = cache.get(service);
    if (!prev || !(prev.gen > gen)) cache.set(service, { at: now, until, gen });   // an older read never overwrites a newer one
    if (inflight.get(service) === entry) inflight.delete(service);
    return until;
  })();
  return entry.read;
}

/* validUntil, waited on for at most budgetMs: null when the read has not answered by then (it goes on). */
async function validUntilWithin(row, budgetMs = READ_BUDGET_MS, now = Date.now()) {
  let timer = null;
  const late = new Promise((ok) => { timer = setTimeout(() => ok(null), budgetMs); if (timer.unref) timer.unref(); });
  try { return await Promise.race([validUntil(row, now), late]); } finally { clearTimeout(timer); }
}

/* Whether this row shows its login as good: an unverified badge on a signed-in account whose login date is still
   ahead. `latestOutcome` is the newest outcome engine/observed holds for the row, whatever its age; observed keeps
   them in memory, so that reaches back to the board's last start. A rejection it holds keeps the row where the
   verdict put it, since a token refused by Anthropic can still carry a date ahead. */
function loginGood({ badge, checkLiveState, latestOutcome, until, now = Date.now(), rejected = OUTCOME.REJECTED } = {}) {
  return badge === 'signed_in_unverified' && checkLiveState === 'connected' && latestOutcome !== rejected
    && Number.isFinite(until) && until > now;
}
/* Whether that good login also turns the row green: only with the switch on. */
function greenFromLogin(args) { return GREEN_FROM_LOGIN && loginGood(args); }

module.exports = { validUntil, validUntilWithin, loginGood, greenFromLogin, setReaderForTests, _clearForTest,
  GREEN_FROM_LOGIN, CACHE_MS, MISS_CACHE_MS, READ_BUDGET_MS };
