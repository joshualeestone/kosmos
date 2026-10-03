'use strict';
/* #3997 (reopened 2026-09-28): an idle Claude account shows its login as good, without spending anything.
 *
 * A Claude row went green only from a real outcome (an agent's request, or Check now, which runs a paid
 * `claude -p`), so a signed-in account no agent was using sat amber. This reads the login's own death date,
 * `claudeAiOauth.refreshTokenExpiresAt`, from the same keychain entry Claude Code uses, through loginexpiry
 * (which returns only that number and never a token). When `claude auth status` says signed in, this date is
 * still ahead and no rejection has been recorded, the row carries the date and the page shows a calm neutral
 * "Signed in · login good until <date>". Ruling C (09-28) drew that neutral and grey; Josh's ruling A (10-02) makes it
 * green (GREEN_FROM_LOGIN below). It never renews or rotates a token.
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

// ON since 2026-10-02 (kosmos#3997, ruling A). Josh, testing 0.7.17: "claude continues to be the only one that will not
// show in green that I am signed in." A signed-in Claude account whose login is valid and unexpired shows green, like
// the other providers, without spending a `claude -p` turn to earn it; his older rule (green only from an answer,
// #874/#1921) is superseded for this case. A real failure still wins: loginGood is false for an expired login, a
// signed-out `claude auth status`, or any rejection on record, so those rows stay non-green with their reason.
const GREEN_FROM_LOGIN = true;
const CACHE_MS = 60 * 1000;
const MISS_CACHE_MS = 10 * 60 * 1000;
const READ_BUDGET_MS = 750;

let reader = null;
/** Tests only: inject the expiry reader, ccd -> number | null (or a promise of one). */
function setReaderForTests(fn) { reader = typeof fn === 'function' ? fn : null; }

const cache = new Map();      // service name -> { at, until, works, gen }: gen is the login generation it was read under (#5018);
                              // works (#5168) is when the access token Claude Code holds runs out
const inflight = new Map();   // service name -> { gen, read }: the read under way and its generation
function _clearForTest() { cache.clear(); inflight.clear(); refusedChecks.clear(); }

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
    let works = null;
    try {
      if (reader) {
        /* A test reader returns the login date, or (#5168) { until, works } with the access token's date too. */
        const got = await reader(ccd);
        if (got && typeof got === 'object') { until = got.until; works = got.works; } else until = got;
      } else if (process.platform === 'darwin' && !process.env.NODE_TEST_CONTEXT) {
        const body = await loginexpiry.readCredAsync(service);
        const t = loginexpiry.loginTimesFor(ccd, { readCred: () => body });   // #5168: both dates, one read
        until = t.refreshExpiresAt; works = t.accessExpiresAt;
      }
    } catch { until = null; works = null; }
    until = Number.isFinite(until) ? until : null;
    works = Number.isFinite(works) ? works : null;
    const prev = cache.get(service);
    if (!prev || !(prev.gen > gen)) cache.set(service, { at: now, until, works, gen });   // an older read never overwrites a newer one
    if (inflight.get(service) === entry) inflight.delete(service);
    return until;
  })();
  return entry.read;
}

/* #5168 (after #5164): a login that has ENDED while the access token Claude Code holds still works. Its agents keep
   working until that token runs out (at most 8 hours, measured), then stop. Returns that time (epoch ms) from the
   last read of this row's credential, or null: not ended, already stopped, or not read yet. No read of its own: the
   row's validUntil read (above) fills the cache this answers from, in the same request. */
function worksUntil(row, now = Date.now()) {
  if (!row || row.apiKey) return null;
  const ccd = row.isDefault ? undefined : row.dir;
  if (!row.isDefault && !ccd) return null;
  const hit = cache.get(loginexpiry.serviceNameFor(ccd));
  if (!hit || hit.gen !== loginexpiry.loginGeneration()) return null;
  return Number.isFinite(hit.until) && hit.until <= now && Number.isFinite(hit.works) && hit.works > now ? hit.works : null;
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
function loginGood({ badge, checkLiveState, latestOutcome, until, checkRefused = false, now = Date.now(), rejected = OUTCOME.REJECTED } = {}) {
  return badge === 'signed_in_unverified' && checkLiveState === 'connected' && latestOutcome !== rejected
    && !checkRefused && Number.isFinite(until) && until > now;
}
/* #3997 review 1: a Check now that Anthropic refused without the dead-sign-in words (a 403 permission error, a
   disabled organisation) records no outcome, so with ruling A the row would stay green on its login date while the
   person reads "Could not check". Marked here, by folder, until a later Check now answers connected or rejected, so
   the row falls back to the unverified state. In memory, like engine/observed: a board restart forgets it. */
const refusedChecks = new Map();   // folder -> when the failed check answered (epoch ms)
function noteCheck(dir, { state, refused } = {}, now = Date.now()) {
  if (!dir) return;
  if (state === 'connected' || state === 'none') refusedChecks.delete(dir);
  else if (refused) refusedChecks.set(dir, now);
}
/* Review 3: a real outcome seen AFTER the failed check (an agent's request, or a later check) outranks it, so a
   working account is not held amber once that outcome ages out. `newerOutcomeAt` is the time of the newest outcome
   the row holds. */
function checkRefused(dir, newerOutcomeAt = null) {
  if (!dir || !refusedChecks.has(dir)) return false;
  return !(Number.isFinite(newerOutcomeAt) && newerOutcomeAt > refusedChecks.get(dir));
}
/* Whether that good login also turns the row green: only with the switch on. */
function greenFromLogin(args) { return GREEN_FROM_LOGIN && loginGood(args); }

module.exports = { validUntil, validUntilWithin, worksUntil, loginGood, greenFromLogin, noteCheck, checkRefused, setReaderForTests, _clearForTest,
  GREEN_FROM_LOGIN, CACHE_MS, MISS_CACHE_MS, READ_BUDGET_MS };
