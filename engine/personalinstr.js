'use strict';

/* #4446: the PERSONAL instructions file an agent's own terminal agent loads at startup
   from OUTSIDE the agent's folder, so the Instructions panel can say so.

   Kosmos does not add these. Each provider's CLI reads its user-level files itself; `filesFor`
   lists them per runner.
   The ruling on the card was to keep them and tell the person, so this only answers
   whether such a file is there. It never reads the file's text and never returns its path:
   the panel does not show paths (Josh 2026-08-17), and the answer is a tool name.

   Grok's import of the person's CLAUDE.md is a different thing, turned off at launch by
   #4426; this reports Grok's OWN files only.

   Not covered, on purpose: Antigravity (no documented user-level file path to check) and
   Meta Muse (runs one turn at a time through engine/musefront.js, not a CLI home). Both
   answer null, which reads as "nothing to say", the same as no file. */

const fs = require('fs');
const path = require('path');

const TOOL = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', grok: 'Grok' };

/* Every `*.md` in `dir` (and below it when `deep`), or none when it cannot be read. */
function mdIn(dir, deep) {
  let names = [];
  try { names = fs.readdirSync(dir, { recursive: deep }).map(String).filter((n) => n.endsWith('.md')).sort(); } catch { names = []; }
  return names.map((n) => path.join(dir, n));
}

/* The user-level files this runner's CLI may read for an agent launched with `configDir`
   (null = the default account). Empty for a runner with none. */
function filesFor(runner, configDir, create) {
  if (runner === 'claude') {
    const dir = configDir || path.join(require('./accounts').homeDir(), '.claude');
    return [path.join(dir, 'CLAUDE.md'), ...mdIn(path.join(dir, 'rules'), true)];
  }
  if (runner === 'codex') {
    const home = configDir || create.defaultAgentCodexHome();
    return [path.join(home, 'AGENTS.override.md'), path.join(home, 'AGENTS.md')];
  }
  if (runner === 'gemini') return [path.join(create.geminiStorageHome(configDir || null), 'GEMINI.md')];
  if (runner === 'grok') {
    const home = configDir || create.defaultAgentGrokHome();
    return [path.join(home, 'AGENTS.md'), ...mdIn(path.join(home, 'rules'), false)];
  }
  return [];
}

/* A regular file with something in it. statSync follows a symlink, which is the point:
   on a multi-account Mac each account's CLAUDE.md is often a link to ~/.claude/CLAUDE.md,
   and the CLI follows it too. An empty file loads nothing, so it is not reported. */
function hasContent(file) {
  try {
    const st = fs.statSync(file);
    return st.isFile() && st.size > 0;
  } catch { return false; }
}

/* `{ tool }` when the agent's CLI will load a personal instructions file, else null.
   Never throws: a job that cannot be read answers null rather than failing the panel. */
function personalInstructions(name, deps = {}) {
  const create = deps.create || require('./create');
  let job = null;
  try { job = create.readJob(name); } catch { job = null; }
  let runner = job && job.runner;
  if (!runner) {
    try { runner = create.recordedRunner(name); } catch { runner = null; }
  }
  if (!TOOL[runner]) return null;
  let files;
  try { files = filesFor(runner, job ? job.configDir : null, create); } catch { files = []; }
  const has = deps.hasContent || hasContent;
  if (!files.some((f) => has(f))) return null;
  return { tool: TOOL[runner] };
}

module.exports = { personalInstructions, filesFor, TOOL };
