'use strict';
/* #3532: warn before an agent's Claude login (refresh token) expires.
 *
 * WHY the refresh-token expiry and not the on-screen banner or the access token:
 *   - `claudeAiOauth.expiresAt` is the SHORT-LIVED access token (hours, auto-refreshes),
 *     so it reads healthy right up to the day the login dies. Useless as an early signal.
 *   - `claudeAiOauth.refreshTokenExpiresAt` (epoch ms) is the real login-death date. It is
 *     what Claude Code's "expires in N days" banner is about, and it jumps ~1 month when
 *     /login is run. Reading it gives an exact date at ANY lead time, version-independent.
 *
 * 🛑 SECRET DISCIPLINE: this module reads a credential that also contains tokens. It returns
 *    ONLY the timestamp (a number). It never returns, logs, or threads the token values.
 *    The keychain body is parsed and discarded in one place (refreshExpiryFor).
 *
 * 📌 macOS keychain service name (measured on Agent1s 2026-09-23): the DEFAULT config dir
 *    (~/.claude) uses the bare `Claude Code-credentials`; any other dir uses
 *    `Claude Code-credentials-<first 8 hex of sha256(ABSOLUTE dir path, no trailing slash)>`.
 *    Verified against all 5 config dirs on the box.
 *
 * 📌 ADVISORY, not a classify state: the agent is still WORKING while its login nears expiry,
 *    so callers consume this as a per-account OVERLAY, never a working/idle precedence arm.
 *    FAIL SOFT everywhere: an unreadable/absent credential yields no advisory, never a throw.
 */
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_SERVICE = 'Claude Code-credentials';
const DAY_MS = 86400000;

/* The default config dir uses the bare service name; every other dir is suffixed with
 * the first 8 hex of sha256 of its absolute path (no trailing slash). A null/undefined
 * configDir means the default dir. */
function serviceNameFor(configDir, { homeDir = os.homedir() } = {}) {
  const def = path.join(homeDir, '.claude');
  const abs = configDir ? path.resolve(configDir) : def;
  if (abs === def) return DEFAULT_SERVICE;
  const hex = crypto.createHash('sha256').update(abs).digest('hex').slice(0, 8);
  return `${DEFAULT_SERVICE}-${hex}`;
}

/* Default keychain reader. Returns the raw credential body (JSON string) or null.
 * NEVER logs it; stderr is discarded so a "not found" is a quiet null. */
function readCredDefault(service) {
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/* Returns claudeAiOauth.refreshTokenExpiresAt (epoch ms) for a config dir, or null.
 * The credential body is parsed and dropped here; only the number leaves this function. */
function refreshExpiryFor(configDir, { readCred = readCredDefault, homeDir } = {}) {
  const service = serviceNameFor(configDir, { homeDir });
  let raw;
  try { raw = readCred(service); } catch { return null; }
  if (!raw) return null;
  let obj;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  const ms = obj && obj.claudeAiOauth && obj.claudeAiOauth.refreshTokenExpiresAt;
  return (typeof ms === 'number' && Number.isFinite(ms)) ? ms : null;
}

function severityFor(daysLeft) {
  if (daysLeft <= 1) return 'urgent';   // dies today/tomorrow, or already expired
  if (daysLeft <= 3) return 'warn';
  return 'notice';
}

/* accounts: [{ configDir, account?, agents:[names] }] -- already deduped per config dir by
 * the caller, since agents share a dir. Returns one advisory per account whose refresh token
 * expires within warnWithinDays, soonest first. daysLeft is floored (a 1.5-day expiry reads
 * "1 day", an already-expired one reads negative -> the UI says "expired"). Fail soft: an
 * account whose credential can't be read is skipped, never breaking the others. */
function advisoriesFor({ accounts = [], now = Date.now(), warnWithinDays = 5, readCred, homeDir } = {}) {
  const out = [];
  for (const acct of accounts) {
    const expiresAt = refreshExpiryFor(acct.configDir, { readCred, homeDir });
    if (expiresAt == null) continue;
    const daysLeft = Math.floor((expiresAt - now) / DAY_MS);
    if (daysLeft > warnWithinDays) continue;
    out.push({
      configDir: acct.configDir || null,
      account: acct.account || null,
      agents: Array.isArray(acct.agents) ? acct.agents.slice() : [],
      expiresAt,
      daysLeft,
      expired: daysLeft < 0,
      severity: severityFor(daysLeft),
    });
  }
  out.sort((a, b) => a.daysLeft - b.daysLeft);
  return out;
}

module.exports = {
  serviceNameFor, refreshExpiryFor, advisoriesFor, severityFor,
  DEFAULT_SERVICE, DAY_MS,
};
