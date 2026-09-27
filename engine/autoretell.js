'use strict';

/**
 * #3932: re-tell an agent once the person fixes what the project notice's Act row asked.
 *
 * An Act row (#3923: no instructions file, several Kosmos project sections, too short, at the size
 * limit) asks the person to fix the agent's instruction file. `syncAgent` runs only on membership,
 * task and project changes, so after the fix the row kept asking for something already done until
 * the next project change. This sweep closes that: an agent whose stored verdict is could_not, and
 * whose instruction file changed after that verdict, is re-told once, through the same path as the
 * notice's Try again (server.js retellMember).
 *
 * The rules:
 *   - a candidate is a member whose NEWEST told record, across the projects it is still on, reads
 *     could_not;
 *   - its instruction file's mtime must be newer than that verdict (`told.at`), so a file nobody
 *     touched since the failure is never retried (a retry would fail the same way). Any later write
 *     counts as a change, Kosmos's own included, so an unrelated Kosmos write can cost one extra
 *     retell; nothing is typed into the agent on a could_not;
 *   - and at least SETTLE_MS old, so a file still being saved in bursts is left alone;
 *   - and `ready(name)`: the caller's word that retelling now would not hide anything. A RUNNING agent
 *     whose file a person changed after it started has not read that change, and a retell writes the
 *     file as Kosmos, which the board would then read as "told it on its screen". Such an agent is
 *     left for its restart, and the change is not spent: it is retold once it has restarted;
 *   - one retell per change: `acted` remembers the mtime acted on per agent. A retell that stores a
 *     verdict moves `told.at` past the mtime anyway, so a failure, even a passing one, is not
 *     retried until the file changes again: the notice's Try again is the way to retry sooner. The
 *     memory is for a retell that throws and stores nothing. It lives in memory: a board restart
 *     may act once more on the same change.
 *
 * Pure over what it is handed: the projects list, an mtime reader, the clock and the retell call
 * are all injected, so the decision is testable without a board.
 */

/* Ten seconds: long enough that a save made in bursts (an editor's autosave, a paste then a fix)
   settles before we write, short enough that the person sees the row clear while still looking at
   it. The sweep's own 30s timer means the real wait is 10 to 40 seconds. */
const SETTLE_MS = 10 * 1000;
const COULD_NOT = 'could_not';

/* The agents to re-tell now, as [{ name, id, mtime }], `id` being one project whose stored verdict
   for it is could_not (the retell writes every project the agent is on; `id` only picks which
   project's answer is `said` rather than `alsoSaid`). */
function due({ projects, mtimeOf, now, acted, ready }) {
  const verdictAt = new Map();   // name -> { at, id, state }, the newest verdict of any state
  for (const p of Array.isArray(projects) ? projects : []) {
    if (!p || !p.id || !p.told || typeof p.told !== 'object') continue;
    for (const name of Array.isArray(p.agents) ? p.agents : []) {
      if (typeof name !== 'string' || !name) continue;
      const t = p.told[name];
      if (!t) continue;
      const at = Date.parse(t.at || '');
      if (!Number.isFinite(at)) continue;
      const seen = verdictAt.get(name);
      if (!seen || at > seen.at) verdictAt.set(name, { at, id: p.id, state: t.state });
    }
  }
  const out = [];
  for (const [name, v] of verdictAt) {
    if (v.state !== COULD_NOT) continue;
    let mtime = null;
    try { mtime = mtimeOf(name); } catch { mtime = null; }
    if (!Number.isFinite(mtime)) continue;               // no file yet, or one we cannot read
    if (mtime <= v.at) continue;                          // unchanged since the verdict
    if (now - mtime < SETTLE_MS) continue;                // still being edited, perhaps
    if (acted && acted.get(name) === mtime) continue;     // this change was already acted on
    let ok = true;
    if (typeof ready === 'function') { try { ok = ready(name) !== false; } catch { ok = false; } }
    if (!ok) continue;                                     // not spent: looked at again next sweep
    out.push({ name, id: v.id, mtime });
  }
  return out;
}

/* One sweep: decide, remember, retell. Each retell is its own try, so one agent's failure does not
   stop the next. Returns what was acted on, for the log line. */
function sweepOnce({ projects, mtimeOf, now, acted, ready, retell, log }) {
  const done = [];
  for (const d of due({ projects, mtimeOf, now, acted, ready })) {
    if (acted) acted.set(d.name, d.mtime);
    let told = null;
    try { told = (retell(d.name, d.id) || {}).told || null; } catch { told = null; }
    const row = { name: d.name, id: d.id, state: told && told.state ? told.state : 'error' };
    done.push(row);
    if (typeof log === 'function') { try { log(row); } catch { /* the log is not the work */ } }
  }
  return done;
}

module.exports = { SETTLE_MS, due, sweepOnce };
