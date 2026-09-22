'use strict';
/**
 * The live, Kosmos-owned CODEX sessions on this machine (#3380).
 *
 * 🛑 WHY A SECOND LIVE SOURCE. Every win32 liveness question -- the roster's card,
 * `win32capture`'s state, `win32stop`'s kill, `runningas`'s whoami -- is answered
 * by joining the ownership record against `claude agents --json`. That command
 * lists claude sessions and has no codex arm at all, so a codex agent (recorded,
 * with a supervisor running) is invisible to every one of them: it draws no card,
 * reads UNKNOWN, and "stops" as a no-op. This module is the codex analog of
 * `claude agents --json`: it enumerates the codex agents that are actually up.
 *
 * 🔑 WHAT "UP" MEANS FOR A CODEX AGENT, AND WHY IT IS NOT A PROCESS LOOKUP. A codex
 * agent has no persistent runner process -- `win32codexsup` drives it one `codex
 * exec` turn at a time, so between turns there is nothing codex-shaped to find. The
 * durable process is its SUPERVISOR, and the supervisor stamps its own pid and the
 * agent's session id into the `win32streamstate` file at start and clears it on
 * stop. So a codex agent is live iff:
 *   - the ownership record files it under this name with `runner: 'codex'`, AND
 *   - its state file names a supervisor pid that is still alive, for the SAME id.
 * That pid is the one every consumer then uses: `stateFor` matches its state file,
 * `win32stop` kills its tree, `runningas` inspects it.
 *
 * ⚠️ THE ROWS ARE SHAPED LIKE `claude agents --json` ENTRIES on purpose, so
 * `win32live.byName` and `win32roster.make` can UNION them into the claude list
 * with no branch -- `{ sessionId, pid, name, kind:'interactive', runner:'codex' }`.
 * `status` is deliberately absent: a streaming/per-turn agent's working/idle comes
 * from the stream-state file (`stateFor`), exactly as it does for a claude one.
 *
 * 📌 FAIL-CLOSED, AND EMPTY IS A REAL ANSWER. Reading the record and stat-ing local
 * files is deterministic and local; unlike `claude agents --json` there is no
 * transient "we could not look" for it. An unreadable record is an empty list (the
 * same fail-closed reading `win32sessions.read` gives), which correctly says "no
 * codex agents are up" rather than blocking the claude answer the callers still
 * have.
 */
const win32sessions = require('./win32sessions');
const win32streamstate = require('./win32streamstate');
const win32orphan = require('./win32orphan');

/**
 * The live codex agents, as `claude agents --json`-shaped rows.
 *
 * @param {object} [opts]
 * @param {{ read: () => object }} [opts.record]   the ownership record (default win32sessions)
 * @param {(name:string) => ({pid:number,sessionId:string}|null)} [opts.identity]
 *        the state-file presence reader (default win32streamstate.liveIdentity)
 * @param {(pid:number) => boolean} [opts.pidAlive] the liveness check (default win32orphan.pidAlive)
 * @returns {Array<{sessionId:string, pid:number, name:string, kind:string, runner:string}>}
 */
function liveSessions(opts) {
  const o = opts || {};
  const record = o.record || win32sessions;
  const identity = typeof o.identity === 'function' ? o.identity : win32streamstate.liveIdentity;
  const pidAlive = typeof o.pidAlive === 'function' ? o.pidAlive : win32orphan.pidAlive;

  let owned;
  try { owned = record.read(); } catch { return []; }
  if (!owned || typeof owned !== 'object') return [];

  const out = [];
  for (const sid of Object.keys(owned)) {
    // Re-validate against the SAME gate record() writes under, matching win32live
    // and win32roster: the store is the trust root explicitly, not by construction.
    if (!win32sessions.validId(sid)) continue;
    const row = owned[sid] || {};
    if (row.runner !== 'codex') continue;
    const name = row.name;
    if (!win32sessions.validName(name)) continue;
    let id = null;
    try { id = identity(name); } catch { id = null; }
    // No presence file, or it names a different session (a stale record row whose
    // supervisor has moved on): not live under this id.
    if (!id || id.sessionId !== sid || !Number.isInteger(id.pid)) continue;
    let alive = false;
    try { alive = pidAlive(id.pid) === true; } catch { alive = false; }
    if (!alive) continue;
    out.push({ sessionId: sid, pid: id.pid, name, kind: 'interactive', runner: 'codex' });
  }
  return out;
}

module.exports = { liveSessions };
