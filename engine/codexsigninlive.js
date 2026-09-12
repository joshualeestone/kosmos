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
 * (`provider_reachability`, an HTTPS probe, ok) so a refused handshake can only be the
 * credential. A general network problem is UNKNOWN, never a red.
 * ⚠️ THE RESIDUAL, STATED HONESTLY BECAUSE IT IS NOT ALWAYS SELF-HEALING. provider_reachability
 * attests HTTPS, and the WS handshake is a DISTINCT property HTTPS cannot vouch for: an
 * environment that allows HTTPS to chatgpt.com but blocks the WSS upgrade (a corporate proxy)
 * reads provider-ok + ws-not-ok = 'dead' PERSISTENTLY, not for one TTL. Two things bound the
 * harm. (1) A TRANSIENT ws blip on a healthy sign-in does self-heal within one TTL (the common
 * residual). (2) A PERSISTENT ws block is rare, and in it codex genuinely cannot run (codex's
 * own turn uses the same WSS backend), so flagging the agent as unable-to-run is the SAFE
 * direction even though the "sign in again" affordance will not fix a proxy. Both are better
 * than the PERMANENT silent-idle this replaces. The `because` below says what was observed
 * (could not reach OpenAI with this sign-in), not a claim we cannot prove (the credential is
 * revoked), so it does not overclaim the cause.
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
function classify(stdout) { return classifyDetailed(stdout).verdict; }

/**
 * The SINGLE source of both the verdict AND the NAMED CAUSE the #2790 UPDATE asked for
 * (authentication_rejected vs transport_unreachable): stdout -> { verdict, cause }.
 *   verdict  'live' | 'dead' | 'unknown'  -- WHETHER the sign-in is usable (classify()'s value).
 *   cause    the reason we could not confirm it, when we could not; null when nothing failed:
 *     'authentication_rejected'  endpoint reachable, handshake REFUSED  => the credential (verdict 'dead')
 *     'transport_unreachable'    the handshake failed AND the endpoint itself was not confirmed
 *                                reachable => the network is the suspect, NEVER the credential
 *                                (the #1930 never-false-red rule) (verdict 'unknown')
 *     'indeterminate'            no usable signal at all -- unparseable output, no checks, or a
 *                                missing/statusless websocket check (verdict 'unknown')
 *     null                       verdict 'live' -- nothing failed, so there is no cause.
 * ADDITIVE: classify() (and liveness()) keep their plain-verdict contracts, which kosmos#2338's
 * driver + the green-badge/tier consumers read verbatim; a consumer that wants to tell "sign in
 * again" (auth) from "network problem, will retry" (transport) apart reads the cause here. Because
 * classify() delegates to this, the verdict and its cause cannot drift out of one derivation.
 */
function classifyDetailed(stdout) {
  let d;
  try { d = JSON.parse(stdout); } catch { return { verdict: 'unknown', cause: 'indeterminate' }; }
  const checks = d && d.checks;
  if (!checks || typeof checks !== 'object') return { verdict: 'unknown', cause: 'indeterminate' };
  const ws = checks['network.websocket_reachability'];
  const prov = checks['network.provider_reachability'];
  // status "ok" is codex's own verdict that the handshake completed (HTTP 101). Trust it.
  if (ws && ws.status === 'ok') return { verdict: 'live', cause: null };
  if (ws && ws.status && ws.status !== 'ok') {
    // Handshake not ok. Only call the credential dead if the endpoint itself was reachable, so a
    // refused handshake cannot be a network fault. provider_reachability must be present AND ok --
    // a missing provider check is not evidence the network is fine.
    if (prov && prov.status === 'ok') return { verdict: 'dead', cause: 'authentication_rejected' };
    // The handshake failed but the transport was not confirmed reachable: blame the network, never
    // the credential. UNKNOWN (never a red), with the cause naming what we saw.
    return { verdict: 'unknown', cause: 'transport_unreachable' };
  }
  // No usable websocket signal at all (the check is absent or carries no status): we cannot say
  // why the sign-in is uncheckable, so the cause is indeterminate rather than a transport claim.
  return { verdict: 'unknown', cause: 'indeterminate' };
}

// Injectable so tests never spawn codex. Real one runs `CODEX_HOME=<dir> codex doctor --json`
// and resolves { ok, stdout } | { ok:false } -- it never rejects, so a caller on a kicked
// promise never sees an unhandled rejection.
function defaultRunner(dir) {
  let resolved;
  try { resolved = runners.resolveBin('openai'); } catch { resolved = null; }
  // .present, not just .bin: resolveBin returns a managed .bin path even when nothing is
  // installed there, so spawning it would be a doomed execFile that ENOENTs. Short-circuit to
  // 'unknown' (never a false dead) without the needless spawn when the runner is not runnable.
  const bin = resolved && resolved.present ? resolved.bin : null;
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
// homeKey -> { verdict, cause, at }
const cache = new Map();
// homeKey -> Promise<{ verdict, cause }>, so concurrent callers on a miss share one doctor run.
const inflight = new Map();
function resetForTest() { cache.clear(); inflight.clear(); runner = defaultRunner; }

/**
 * livenessDetailed(dir, nowMs?) -> Promise<{ verdict, cause }>. The full result: the verdict AND
 * the NAMED CAUSE (see classifyDetailed). Never throws. Returns a cached result when fresh;
 * otherwise runs `codex doctor` once (shared across concurrent callers) and caches it. A runner
 * that could not produce a report (no bin, timeout, empty output) is 'unknown'/'indeterminate' --
 * never a false 'dead'. `nowMs` is injectable for deterministic TTL tests.
 */
async function livenessDetailed(dir, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const key = homeKey(dir);
  const cur = cache.get(key);
  if (cur && (now - cur.at) < TTL_MS) return { verdict: cur.verdict, cause: cur.cause };
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve()
    .then(() => runner(dir))
    .then((r) => (r && r.ok ? classifyDetailed(r.stdout) : { verdict: 'unknown', cause: 'indeterminate' }))
    .catch(() => ({ verdict: 'unknown', cause: 'indeterminate' }))
    .then((res) => {
      cache.set(key, { verdict: res.verdict, cause: res.cause, at: (typeof nowMs === 'number' ? nowMs : Date.now()) });
      inflight.delete(key);
      return res;
    });
  inflight.set(key, p);
  return p;
}

/**
 * liveness(dir, nowMs?) -> Promise<'live'|'dead'|'unknown'>. The plain-verdict contract every
 * current caller (openaiaccounts.checkLive, codexauthprobe) reads; a thin projection of
 * livenessDetailed so the two share one cache, one inflight de-dup, and one derivation.
 */
async function liveness(dir, nowMs) { return (await livenessDetailed(dir, nowMs)).verdict; }

module.exports = { liveness, livenessDetailed, classify, classifyDetailed, setRunner, resetForTest, TTL_MS, TIMEOUT_MS };
