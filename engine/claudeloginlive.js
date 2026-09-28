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
 * ASYNC and cached for CACHE_MS per entry: the keychain read is a `security` subprocess, and GET /api/accounts
 * already waits on one `claude auth status` per row, so this runs beside it rather than after it. */
const { execFile } = require('child_process');
const loginexpiry = require('./loginexpiry');

// Off by ruling C. Josh can turn it on if he overrules his own green rule: an idle account with a good login would
// then show green instead of the neutral state.
const GREEN_FROM_LOGIN = false;
const CACHE_MS = 60 * 1000;

let reader = null;
/** Tests only: inject the expiry reader, ccd -> number | null (or a promise of one). */
function setReaderForTests(fn) { reader = typeof fn === 'function' ? fn : null; }

const cache = new Map();   // service name -> { at, until }
function _clearForTest() { cache.clear(); }

function readCredAsync(service) {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', service, '-w'],
      { encoding: 'utf8', timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

/* The row's login expiry (epoch ms), or null when there is none to read. Never rejects. */
async function validUntil(row, now = Date.now()) {
  if (!row || row.apiKey) return null;   // a key account has its own live check (claudeaccounts)
  const ccd = row.isDefault ? undefined : row.dir;
  if (!row.isDefault && !ccd) return null;
  const service = loginexpiry.serviceNameFor(ccd);
  const hit = cache.get(service);
  if (hit && now - hit.at < CACHE_MS) return hit.until;
  let until = null;
  try {
    if (reader) until = await reader(ccd);
    else if (process.platform === 'darwin' && !process.env.NODE_TEST_CONTEXT) {
      const body = await readCredAsync(service);
      until = loginexpiry.refreshExpiryFor(ccd, { readCred: () => body });
    }
  } catch { until = null; }
  until = Number.isFinite(until) ? until : null;
  cache.set(service, { at: now, until });
  return until;
}

/* Whether this row shows its login as good: an unverified badge on a signed-in account whose login date is still
   ahead. `latestOutcome` is the newest recorded outcome of ANY age: a recorded rejection keeps the row where the
   verdict put it, since a token refused by Anthropic can still carry a date ahead. */
function loginGood({ badge, checkLiveState, latestOutcome, until, now = Date.now(), rejected = '401' } = {}) {
  return badge === 'signed_in_unverified' && checkLiveState === 'connected' && latestOutcome !== rejected
    && Number.isFinite(until) && until > now;
}
/* Whether that good login also turns the row green: only with the switch on. */
function greenFromLogin(args) { return GREEN_FROM_LOGIN && loginGood(args); }

module.exports = { validUntil, loginGood, greenFromLogin, setReaderForTests, _clearForTest, GREEN_FROM_LOGIN, CACHE_MS };
