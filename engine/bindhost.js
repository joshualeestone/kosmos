'use strict';
/**
 * Where the board binds: the ONE reading of KOSMOS_BIND_HOST. server.js listens on it, and the
 * uninstall's and the move's board probes (engine/win32handoff.js probeBoardOnEveryAddress) look for
 * a board there (win32-installer-native round 4, finding 1: the probe asked 127.0.0.1 while the board
 * could be listening elsewhere, two derivations of one address).
 *
 * Loopback by default; a network host ONLY when the operator explicitly opts in with KOSMOS_BIND_HOST
 * (#1112 phase 2). An un-opted-in board binds byte-identically to before that change.
 *
 * 🔑 SAFE ONLY BECAUSE server.js's `remoteWriteGuard` EXISTS. Opening this bind exposes the board's port
 * to the network; the guard is what keeps every write except the token-gated agent surface unreachable
 * from it. The two are one change -- do not LISTEN on this host anywhere the guard is not also in force.
 * (Probing it, as the uninstall and the move do, opens nothing.)
 *
 * Read at listen time (boot). A Settings toggle would need a restart to take effect, so the env is the
 * honest mechanism.
 *
 * ⚠️ OPENING THE BIND IS A TWO-PART OPT-IN, AND THIS IS THE SECOND PART. A remote agent connects with
 * `Host: <mac-ip>` (or a hostname), and server.js `pathOf`'s DNS-rebind check 400s any request whose
 * Host is neither loopback nor in `AGENT_WORKFORCE_ALLOWED_HOSTS` -- BEFORE `remoteWriteGuard` ever
 * runs. So the operator must ALSO declare the reachable host in `AGENT_WORKFORCE_ALLOWED_HOSTS`, or a
 * token-holding remote agent is refused at the door. This is deliberate, not an oversight: the Host
 * check is DNS-rebind protection, a different layer from reachability, and it matters MOST when the
 * board is network-reachable, so it is not relaxed just because the bind opened. Two explicit opt-ins to
 * expose the board is the safer posture. (Fails closed: with only KOSMOS_BIND_HOST set, a remote agent
 * gets a 400, never an unguarded surface.)
 *
 * @param {object} [env] the environment to read; process.env, read at call time, when omitted
 */
function bindHost(env) {
  const v = String((env || process.env).KOSMOS_BIND_HOST || '').trim();
  return v || '127.0.0.1';
}

module.exports = { bindHost };
