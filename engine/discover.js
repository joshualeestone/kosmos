'use strict';

/**
 * Agents that already exist on this computer, whether or not they are running.
 *
 * 🛑 WHY THIS EXISTS, IN JOSH'S WORDS (2026-08-22, after the first install by
 * somebody outside this team): *"if people already have agents anywhere, we need
 * to be able to find them and bring them into the Kosmos platform... It's the
 * most catastrophic flaw in the entire system."*
 *
 * Until now "your agents" meant `status.paneRoster()`, which is tmux, which is
 * PROCESSES RUNNING RIGHT NOW. A person means the agents they have made. Those
 * two are the same set only on a machine where nothing has ever been closed --
 * which describes every Mac this project has been tested on, because on all of
 * them Kosmos created the agents itself. The case has never been run.
 *
 * 🔑 SO THIS READS THE DISK INSTEAD. Claude keeps one folder per working
 * directory under `~/.claude/projects`; each holds that directory's session
 * transcripts, and a transcript records the real `cwd` it ran in. A directory
 * with a `CLAUDE.md` that introduces an agent IS an agent, running or not.
 *
 * ⚠️ THE FOLDER NAME IS NOT THE PATH, and reading it as one is the obvious
 * shortcut. `~/work/workers/angel` is filed as `-Users-agent1-work-workers-angel`
 * -- every non-alphanumeric becomes a dash, so a path with a dash in it and one
 * with a slash arrive identical and there is no way back. The transcript's own
 * `cwd` is the only reliable answer, which is why this opens a file per folder
 * rather than parsing a name.
 *
 * ⚠️ READ-ONLY, AND NOTHING HERE STARTS OR TOUCHES AN AGENT. Finding is a
 * separate act from connecting, and this module does only the first.
 */

const fs = require('node:fs');
const path = require('node:path');
const status = require('./status');

/** The newest transcript in a project folder, or null. */
function newestTranscript(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  let best = null;
  let bestAt = 0;
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const full = path.join(dir, n);
    let at = 0;
    try { at = fs.statSync(full).mtimeMs; } catch { continue; }
    if (at > bestAt) { bestAt = at; best = full; }
  }
  return best;
}

/**
 * Every agent this computer has on disk.
 *
 * ⚠️ NEVER THROWS, and answers `ok:false` rather than an empty list when it
 * could not look. "We found none" and "we could not look" are different
 * sentences and this codebase exists because they were once the same one.
 */
function found() {
  let roots;
  try { roots = status.configRoots(); } catch (err) {
    return { ok: false, agents: [], because: 'we could not work out where Claude keeps its records' };
  }

  const byDir = new Map();
  let looked = 0;

  for (const root of roots) {
    const projects = path.join(root, 'projects');
    let dirs;
    try { dirs = fs.readdirSync(projects); } catch { continue; }
    looked += 1;
    for (const d of dirs) {
      const folder = path.join(projects, d);
      let st;
      try { st = fs.statSync(folder); } catch { continue; }
      if (!st.isDirectory()) continue;

      const transcript = newestTranscript(folder);
      if (!transcript) continue;
      let cwd = null;
      try { cwd = status.transcriptCwd(transcript); } catch { cwd = null; }
      if (!cwd || byDir.has(cwd)) continue;

      /* The instruction file is what makes a working directory an AGENT rather
         than a folder somebody once ran Claude in. Most of these are the
         second thing. */
      const file = path.join(cwd, 'CLAUDE.md');
      let text;
      try { text = fs.readFileSync(file, 'utf8').slice(0, 4000); } catch { continue; }

      const id = status.identityFromText(text);
      /* ⚠️ A `CLAUDE.md` THAT DOES NOT INTRODUCE ANYBODY IS NOT AN AGENT. Every
         repo in this org has one and they are project instructions; listing
         them as agents would bury the real ones in a list nobody trusts. */
      if (!id || !id.displayName) continue;

      byDir.set(cwd, {
        dir: cwd,
        name: id.displayName,
        role: id.role,
        instructions: file,
      });
    }
  }

  if (!looked) {
    return { ok: false, agents: [], because: 'we could not read where Claude keeps its records' };
  }
  /* Stable and human: by the name a person would look for. */
  const agents = [...byDir.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, agents, because: null };
}

module.exports = { found };
