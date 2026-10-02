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
  if (hit && now - hit.at < (hit.until == null ? MISS_CACHE_MS : CACHE_MS)) return Promise.resolve(hit.until);
  if (inflight.has(service)) return inflight.get(service);
  const read = (async () => {
    let until = null;
    try {
      if (reader) until = await reader(ccd);
      else if (process.platform === 'darwin' && !process.env.NODE_TEST_CONTEXT) {
        const body = await loginexpiry.readCredAsync(service);
        until = loginexpiry.refreshExpiryFor(ccd, { readCred: () => body });
      }
    } catch { until = null; }
    until = Number.isFinite(until) ? until : null;
    cache.set(service, { at: now, until });
    inflight.delete(service);
    return until;
  })();
  inflight.set(service, read);
  return read;
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
