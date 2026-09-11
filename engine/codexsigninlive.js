'use strict';
/**
 * kosmos#2790 -- a REAL liveness check for a codex ChatGPT SIGN-IN, the one thing
 * `openaiaccounts.checkLive` lacked. Before this, checkLive returned UNKNOWN for every
 * chatgpt-mode account (a sign-in hands an id_token, not a bearer key it could test with
 * GET /v1/models), so a DEAD sign-in was indistinguishable from a healthy one: the agent
 * sat Idle / "Not yet read" forever with no red. That silent failure is the whole card
 * (a real prod user, 5 codex agents on a stale sign-in, no signal).
 *
 * THE SIGNAL, measured on a real codex-cli (0.149.1), not from docs. `codex doctor --json`
 * runs codex's OWN health report, which includes a LIVE WebSocket handshake to
 * chatgpt.com/backend-api using the sign-in's credentials. Its machine-readable
 * `checks["network.websocket_reachability"]` is the auth-gated verdict:
 *   - status "ok"  (handshake "HTTP 101 Switching Protocols")  -> the credential was ACCEPTED.
 *   - status not ok (a synthetic dead token measured "warning" + "handshake transport error")
 *     WHILE `checks["network.provider_reachability"].status` is "ok"  -> the endpoint is
 *     reachable, so the handshake was REFUSED for the credential, not the network -> DEAD.
 *   - anything else (provider itself unreachable, doctor failed/timed out, no codex bin,
 *     unparseable output) -> UNKNOWN.
 *
 * 🛑 WHY NOT `codex login status` OR the doctor's `auth.credentials` CHECK. Both only
 * confirm the token FILE exists ("Logged in using ChatGPT", exit 0). That is the exact
 * false-green class `claude auth status` produced in #1560/#874 -- a present-but-dead
 * credential reads as logged in. The QA matrix (#1562) warns about precisely this. Only the
 * live handshake actually exercises the credential.
 *
 * 🛑 NEVER 'dead' ON A NETWORK FAULT (the #1930 never-false-red doctrine, applied to the
 * PRODUCE direction like codexauthprobe). 'dead' requires the endpoint to be reachable
 * (`provider_reachability` ok) so a refused handshake can only be the credential. A network
 * problem is UNKNOWN, never a red. The one accepted residual: a transient WS-only warning on
 * a HEALTHY sign-in (endpoint reachable, handshake momentarily failed) reads 'dead' for up to
 * one cache TTL, then self-heals on the next probe. That is bounded and self-healing, and it
 * replaces a PERMANENT silent-idle, which is the trade the card is about.
 *
 * OFF-TICK + CACHED like codexauthprobe: `codex doctor` is a live handshake with codex's own
 * ~15s WS timeout, so it must never run on the board's 5s tick. Callers cache the checkLive
 * result (codexauthprobe, TTL 30s); this module ALSO caches per codex-home so the Settings
 * page (listLive, which calls checkLive fresh per row) does not re-handshake every load.
 */

const { execFile } = require('node:child_process');
const runners = require('./runners');

// Same TTL/reasoning as codexauthprobe.TTL_MS: short enough that a repair or a fresh death
// shows within a poll or two, long enough that nothing storms subprocesses.
const TTL_MS = 30 * 1000;
// Headroom over codex doctor's own ~15s websocket timeout, so a slow-but-live handshake is
// not cut off and misread as dead by our own timeout.
const TIMEOUT_MS = 20 * 1000;

const DEFAULT_KEY = '(default)';
function homeKey(dir) { return dir ? String(dir) : DEFAULT_KEY; }

/**
 * Pure classifier: codex doctor --json stdout (string) -> 'live' | 'dead' | 'unknown'.
 * Exported so a test can pin every arm against a real captured report without spawning.
 */
function classify(stdout) {
  let d;
  try { d = JSON.parse(stdout); } catch { return 'unknown'; }
  const checks = d && d.checks;
  if (!checks || typeof checks !== 'object') return 'unknown';
  const ws = checks['network.websocket_reachability'];
  const prov = checks['network.provider_reachability'];
  // status "ok" is codex's own verdict that the handshake completed (HTTP 101). Trust it.
  if (ws && ws.status === 'ok') return 'live';
  // Handshake not ok. Only call the credential dead if the endpoint itself was reachable,
  // so a refused handshake cannot be a network fault. provider_reachability must be present
  // AND ok -- a missing provider check is not evidence the network is fine.
  if (ws && ws.status && ws.status !== 'ok' && prov && prov.status === 'ok') return 'dead';
  return 'unknown';
}

// Injectable so tests never spawn codex. Real one runs `CODEX_HOME=<dir> codex doctor --json`
// and resolves { ok, stdout } | { ok:false } -- it never rejects, so a caller on a kicked
// promise never sees an unhandled rejection.
function defaultRunner(dir) {
  let bin;
  try { bin = runners.resolveBin('openai').bin; } catch { bin = null; }
  if (!bin) return Promise.resolve({ ok: false });
  const env = { ...process.env };
  // A null/empty dir means the default codex home; leave CODEX_HOME as the process inherits
  // it (codex resolves its own default) rather than forcing an empty value.
  if (dir) env.CODEX_HOME = String(dir);
  return new Promise((resolve) => {
    execFile(bin, ['doctor', '--json'], { env, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        // doctor exits non-zero on a "warning" overall status, so a non-zero exit with usable
        // JSON on stdout is still a valid report -- classify the stdout, not the exit code.
        if (typeof stdout === 'string' && stdout.trim()) resolve({ ok: true, stdout });
        else resolve({ ok: false });
      });
  });
}

let runner = defaultRunner;
function setRunner(fn) { runner = fn; }              // tests
// homeKey -> { verdict, at }
const cache = new Map();
// homeKey -> Promise<verdict>, so concurrent callers on a miss share one doctor run.
const inflight = new Map();
function resetForTest() { cache.clear(); inflight.clear(); runner = defaultRunner; }

/**
 * liveness(dir, nowMs?) -> Promise<'live'|'dead'|'unknown'>. Never throws. Returns a cached
 * verdict when fresh; otherwise runs `codex doctor` once (shared across concurrent callers)
 * and caches the result. `nowMs` is injectable for deterministic TTL tests.
 */
async function liveness(dir, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const key = homeKey(dir);
  const cur = cache.get(key);
  if (cur && (now - cur.at) < TTL_MS) return cur.verdict;
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve()
    .then(() => runner(dir))
    .then((r) => (r && r.ok ? classify(r.stdout) : 'unknown'))
    .catch(() => 'unknown')
    .then((verdict) => {
      cache.set(key, { verdict, at: (typeof nowMs === 'number' ? nowMs : Date.now()) });
      inflight.delete(key);
      return verdict;
    });
  inflight.set(key, p);
  return p;
}

module.exports = { liveness, classify, setRunner, resetForTest, TTL_MS, TIMEOUT_MS };
