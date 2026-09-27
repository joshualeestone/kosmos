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
 *   - a candidate is a member whose told record on a project it is still on reads could_not;
 *   - its instruction file's mtime must be newer than the newest such verdict (`told.at`), so a file
 *     nobody touched since the failure is never retried (a retry would fail the same way);
 *   - and at least SETTLE_MS old. There is no server-side record of a file open in the Kosmos
 *     editor, so this is the guard against rewriting the Kosmos block under a person mid-edit: act
 *     only once the file has stopped changing;
 *   - one retell per change: `acted` remembers the mtime acted on per agent, so a retell that
 *     leaves the verdict could_not (or throws and stores nothing) is not repeated every sweep. A
 *     retell that stores a verdict moves `told.at` past the mtime anyway; the memory is for the
 *     case where nothing was stored. It lives in memory: a board restart may act once more on the
 *     same change, which is one more retry of a file the person changed.
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
function due({ projects, mtimeOf, now, acted }) {
  const verdictAt = new Map();   // name -> { at, id }, the newest could_not verdict
  for (const p of Array.isArray(projects) ? projects : []) {
    if (!p || !p.id || !p.told || typeof p.told !== 'object') continue;
    for (const name of Array.isArray(p.agents) ? p.agents : []) {
      if (typeof name !== 'string' || !name) continue;
      const t = p.told[name];
      if (!t || t.state !== COULD_NOT) continue;
      const at = Date.parse(t.at || '');
      if (!Number.isFinite(at)) continue;
      const seen = verdictAt.get(name);
      if (!seen || at > seen.at) verdictAt.set(name, { at, id: p.id });
    }
  }
  const out = [];
  for (const [name, v] of verdictAt) {
    let mtime = null;
    try { mtime = mtimeOf(name); } catch { mtime = null; }
    if (!Number.isFinite(mtime)) continue;               // no file yet, or one we cannot read
    if (mtime <= v.at) continue;                          // unchanged since the verdict
    if (now - mtime < SETTLE_MS) continue;                // still being edited, perhaps
    if (acted && acted.get(name) === mtime) continue;     // this change was already acted on
    out.push({ name, id: v.id, mtime });
  }
  return out;
}

/* One sweep: decide, remember, retell. Each retell is its own try, so one agent's failure does not
   stop the next. Returns what was acted on, for the log line. */
function sweepOnce({ projects, mtimeOf, now, acted, retell, log }) {
  const done = [];
  for (const d of due({ projects, mtimeOf, now, acted })) {
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
