'use strict';
/**
 * The live, Kosmos-owned Claude sessions on this machine, keyed by the name the
 * board shows (#570).
 *
 * 🛑 ONE JOIN, BECAUSE IT IS AN OWNERSHIP DECISION. `claude agents --json` lists
 * EVERY Claude session on the machine, INCLUDING the operator's own. Turning
 * that list into "the sessions Kosmos may act on" is therefore the same
 * fail-closed decision `win32sessions` exists to make, and it is needed in three
 * places: `win32roster` emits the board's rows from it, `win32capture` reads each
 * row's live state through it, and `win32stop` ENDS one by it.
 *
 * `win32capture` used to carry a hand-maintained second copy of `win32roster`'s
 * resolution, with a comment promising it stayed "BYTE-IDENTICAL" to the first.
 * That promise is what this module makes structural. A THIRD hand-copy was the
 * alternative, in the module whose job is to kill a process -- and the failure
 * mode of a drifted ownership gate there is not a blank row on a board, it is
 * ending a session Kosmos does not own.
 *
 * 🔑 THE KEY IS THE ROSTER'S EMITTED NAME. Every caller holds that string: it is
 * what the board renders, what `remove`/`restart` are handed, and what
 * `status.paneRoster` ties an agent to. The live name from `claude agents --json`
 * is a DIFFERENT string (Claude derives it from the cwd), which is why the join
 * runs through the sessionId and why nothing here is looked up by live name.
 *
 * ⚠️ A FAILED LOOK IS `null`, NEVER AN EMPTY MAP. An empty map says "no Kosmos
 * agents are running", which is a claim; a failed read has made no claim at all.
 * Every caller distinguishes them -- the roster refuses, the capture answers
 * UNKNOWN, and the stop declines to kill anything -- and none of them can if the
 * two arrive as the same value. This is the false-zero rule the win32 module
 * family is built around.
 *
 * 📌 NAME UNIQUENESS AMONG LIVE OWNED SESSIONS is assumed, and the assumption is
 * now REACHABLE where it was not before. If two sessionIds carry the same
 * recorded name -- a stale record never `forget()`-ed before a same-named session
 * is created again -- the later-iterated one wins the key silently. Until #570's
 * create and restart flows were wired that could not happen; a restart now ends
 * one session and lets the supervisor start another under the same name, which is
 * exactly the sequence that mints the second record. `win32stop.end` closes it at
 * the source by forgetting the session it ended, so the stale entry never
 * outlives the process it described.
 */
const win32sessions = require('./win32sessions');
const win32roster = require('./win32roster');
const win32codexlive = require('./win32codexlive');

/**
 * The live owned sessions, keyed by emitted name.
 *
 * @param {object} [opts]
 * @param {() => (Array|null)} [opts.run] the `claude agents --json` reader
 *   (default `win32roster.defaultRun` -- ONE definition of the read, shared with
 *   the source seam), returning the parsed array or null on failure.
 * @param {{ read: () => object }} [opts.record] the ownership record (default the
 *   real `win32sessions`), injectable for tests.
 * @returns {Map<string, {sessionId: string, pid: *, status: *, liveName: *}>|null}
 *   the map, or null if the live list could not be read.
 */
function byName(opts) {
  const run = opts && typeof opts.run === 'function' ? opts.run : win32roster.defaultRun;
  const record = opts && opts.record ? opts.record : win32sessions;
  /* #3380: the codex live source, injectable for tests. Its default reads the
     ownership record and the codex supervisors' presence, never `agents --json`. */
  const codexLive = opts && typeof opts.codexLive === 'function' ? opts.codexLive : win32codexlive.liveSessions;

  const agents = run();
  const claudeOk = Array.isArray(agents);
  /* #3380: the codex live source is INDEPENDENT of `claude agents --json` (it reads
     the ownership record + each supervisor's presence, never claude), so it is asked
     whether or not the claude read succeeded. */
  let codexRows = [];
  try { codexRows = codexLive() || []; } catch { codexRows = []; }
  /* 🛑 #3380 THE null IS NOW CLAUDE-ONLY. `null` is the "we could not look" that makes
     every caller refuse rather than read an empty machine -- but a failed CLAUDE read
     says nothing about a CODEX agent, whose liveness is local and deterministic. When
     the whole map refused on a claude blip, a running codex agent vanished from the
     roster win32roster builds off this, so it drew no card ("Can't tell") and became
     undeliverable (chat.deliver gates on a card). So refuse ONLY when the claude read
     failed AND no codex agent is up. The claude answer is byte-identical whenever the
     claude read SUCCEEDS: the array is consumed exactly as before and codex is unioned
     exactly as before. */
  if (!claudeOk && codexRows.length === 0) return null;

  /* Read the record only AFTER the live reads, so a persistently failing
     `agents --json` with no codex agents costs no disk read -- the order win32roster
     and win32capture both already use. */
  const owned = record.read();

  // sessionId -> the live entry. Built from the external array, so the entries
  // are shape-checked here rather than trusted at the join below.
  const live = new Map();
  if (claudeOk) for (const a of agents) {
    if (a && typeof a === 'object' && typeof a.sessionId === 'string') live.set(a.sessionId, a);
  }
  /* UNION the live codex agents into the same map, so a codex agent joins the
     ownership record below with no branch. Guarded against overwriting a claude row
     of the same id (ids are UUIDs; a collision is ~0, but the record is the trust
     root and a claude row must win if it happens). */
  for (const c of codexRows) {
    if (c && typeof c === 'object' && typeof c.sessionId === 'string' && !live.has(c.sessionId)) live.set(c.sessionId, c);
  }

  const out = new Map();
  /* Iterate the RECORD, not the live list: ownership is the gate, so the owned
     set is what bounds the loop. `Object.keys` yields own keys only, so a
     reserved key (`__proto__` and friends) arrives as an ordinary string and is
     rejected by validId below rather than needing a hasOwnProperty guard. */
  for (const sid of Object.keys(owned)) {
    /* Re-validate the stored key against the SAME gate `record()` writes under,
       so the record store is the trust root EXPLICITLY and not merely by
       construction -- a hand-corrupted store is the one path that would
       otherwise slip through. */
    if (!win32sessions.validId(sid)) continue;
    const a = live.get(sid);
    // Recorded but not running: not live, so not in this map. (The record keeps
    // the entry; a dead session simply stops appearing in `agents --json`.)
    if (!a) continue;
    const rec = owned[sid] || {};
    /* The emitted name, resolved EXACTLY as win32roster resolves it: the recorded
       name, falling back to the live name. `flat` is win32roster's own, so the
       coercion of a hand-corrupted non-string name matches too -- this is the
       resolution the "byte-identical" comment used to promise by hand. */
    const name = win32roster.flat(rec.name || a.name || '');
    // Re-checked against the same visible-character gate for the same reason
    // validId is re-checked: a corrupted store must not key a degenerate row.
    if (!win32sessions.validName(name)) continue;
    /* #3380: the recorded runner rides along so `runningas` can answer for a codex
       agent (whose pid is its supervisor, not a claude process). Additive: a claude
       row carries 'claude'/'' and nothing read it before. */
    const runner = win32roster.flat(rec.runner || (a && a.runner) || '');
    out.set(name, { sessionId: sid, pid: a.pid, status: a.status, liveName: a.name, runner });
  }
  return out;
}

module.exports = { byName };
