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
 * 🛑 THE #2129 CLASS -- key on SET-vs-UNSET, not on a path compare. The macOS keychain
 *    service name is decided by the CLAUDE_CONFIG_DIR the agent's process ACTUALLY has:
 *      - UNSET                      -> bare `Claude Code-credentials`
 *      - SET to any value V         -> `Claude Code-credentials-<first 8 hex of sha256(V)>`
 *    An explicit CCD EQUAL to the default path (~/.claude) still uses the SUFFIXED entry, not
 *    the bare one. Measured on Agent1s: the gmail-slot bots set CLAUDE_CONFIG_DIR=/Users/
 *    agent1/.claude explicitly and read "...-2a1a4199" (sha256 of that path, expiry 09-29),
 *    while a CCD-UNSET process reads the bare entry (expiry 09-25). Same path, two different
 *    credentials, two different expiries. So the caller MUST pass the agent's REAL process
 *    CCD (undefined when unset), never a stored path that has lost the set-vs-unset bit.
 *
 * 📌 ADVISORY, not a classify state: the agent is still WORKING while its login nears expiry,
 *    so callers consume this as a per-account OVERLAY, never a working/idle precedence arm.
 *    FAIL SOFT everywhere: an unreadable/absent credential yields no advisory, never a throw.
 */
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DEFAULT_SERVICE = 'Claude Code-credentials';
const DAY_MS = 86400000;

/* Service name for the credential an agent will actually READ, given its CLAUDE_CONFIG_DIR
 * env value (`ccd`). undefined/null/'' means UNSET -> the bare entry; any other value is
 * hashed VERBATIM (Claude Code hashes the env string as set -- a trailing slash changes the
 * hash and is preserved; only a trailing newline from a capture is stripped). */
function serviceNameFor(ccd) {
  if (ccd == null) return DEFAULT_SERVICE;
  const v = String(ccd).replace(/[\r\n]+$/, '');
  if (v === '') return DEFAULT_SERVICE;
  const hex = crypto.createHash('sha256').update(v).digest('hex').slice(0, 8);
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

/* Returns claudeAiOauth.refreshTokenExpiresAt (epoch ms) for an agent's CCD env value, or
 * null. The credential body is parsed and dropped here; only the number leaves this function. */
function refreshExpiryFor(ccd, { readCred = readCredDefault } = {}) {
  const service = serviceNameFor(ccd);
  let raw;
  try { raw = readCred(service); } catch { return null; }
  if (!raw) return null;
  let obj;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  const ms = obj && obj.claudeAiOauth && obj.claudeAiOauth.refreshTokenExpiresAt;
  return (typeof ms === 'number' && Number.isFinite(ms)) ? ms : null;
}

/* Extract CLAUDE_CONFIG_DIR from a `ps eww <pid>` line (macOS appends the process env after
 * the command). Returns the value if the var is present, or null if it is ABSENT (unset).
 *
 * 🛑 WHY THE LIVE PROCESS ENV AND NOT THE LAUNCH JOB: create.js records `configDir:
 * acct.isDefault ? null : acct.dir`, so a DEFAULT-account agent has job.configDir=null even
 * when its launcher exports CLAUDE_CONFIG_DIR=~/.claude explicitly -- and that agent reads the
 * SUFFIXED keychain entry (sha256 of that path), NOT the bare one. job.configDir therefore
 * cannot distinguish the two #2129 arms. The live process env is the only source that captures
 * both set-vs-unset AND the exact value, which is precisely what Claude Code itself keys on. */
function ccdFromPsEnv(psText) {
  const m = String(psText == null ? '' : psText).match(/(?:^|\s)CLAUDE_CONFIG_DIR=(\S*)/);
  return m ? m[1] : null;
}

function severityFor(daysLeft) {
  if (daysLeft <= 1) return 'urgent';   // dies today/tomorrow, or already expired
  if (daysLeft <= 3) return 'warn';
  return 'notice';
}

/* accounts: [{ ccd, account?, agents:[names] }] -- grouped per credential by the caller.
 * The dedup KEY is the credential (serviceNameFor(ccd)), NOT the path: CCD-unset and
 * CCD=~/.claude are different credentials, so they are different buckets. Returns one advisory
 * per account whose refresh token expires within warnWithinDays, soonest first. daysLeft is
 * floored (a 1.5-day expiry reads "1 day", an already-expired one reads negative -> the UI says
 * "expired"). Fail soft: an account whose credential can't be read is skipped, never breaking
 * the others. */
function advisoriesFor({ accounts = [], now = Date.now(), warnWithinDays = 5, readCred } = {}) {
  const out = [];
  for (const acct of accounts) {
    const expiresAt = refreshExpiryFor(acct.ccd, { readCred });
    if (expiresAt == null) continue;
    const daysLeft = Math.floor((expiresAt - now) / DAY_MS);
    if (daysLeft > warnWithinDays) continue;
    out.push({
      ccd: acct.ccd == null ? null : String(acct.ccd),
      account: acct.account || null,
      agents: Array.isArray(acct.agents) ? acct.agents.slice() : [],
      service: serviceNameFor(acct.ccd),
      expiresAt,
      daysLeft,
      expired: daysLeft < 0,
      severity: severityFor(daysLeft),
    });
  }
  out.sort((a, b) => a.daysLeft - b.daysLeft);
  return out;
}

/* Group a roster of agents into per-credential advisories. `readCcd(agent)` returns the agent's
 * live CLAUDE_CONFIG_DIR value (a string, incl '' for set-but-empty), `null` for genuinely UNSET,
 * or `undefined` when it could not be resolved -- an unresolvable agent is SKIPPED (fail soft: no
 * warning beats a wrong-account warning), never bucketed as unset. Agents that resolve to the same
 * credential (serviceNameFor(ccd)) share one advisory. Pure: inject readCcd + readCred to test. */
function agentAdvisories({ agents = [], readCcd, now = Date.now(), readCred, warnWithinDays = 5 } = {}) {
  const buckets = new Map(); // service -> { ccd, agents: [] }
  for (const a of agents) {
    let ccd;
    try { ccd = readCcd ? readCcd(a) : undefined; } catch { ccd = undefined; }
    if (ccd === undefined) continue;
    const service = serviceNameFor(ccd);
    if (!buckets.has(service)) buckets.set(service, { ccd: ccd == null ? null : String(ccd), agents: [] });
    buckets.get(service).agents.push(a.name);
  }
  return advisoriesFor({ accounts: [...buckets.values()], now, readCred, warnWithinDays });
}

module.exports = {
  serviceNameFor, refreshExpiryFor, advisoriesFor, severityFor, ccdFromPsEnv, agentAdvisories,
  DEFAULT_SERVICE, DAY_MS,
};
