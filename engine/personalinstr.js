'use strict';

/* #4446: the PERSONAL instructions file an agent's own terminal agent loads at startup
   from OUTSIDE the agent's folder, so the Instructions panel can say so.

   Kosmos does not add these. Each provider's CLI reads its user-level file itself:
   Claude Code `<config dir>/CLAUDE.md` (CLAUDE_CONFIG_DIR, else ~/.claude), Codex
   `<CODEX_HOME>/AGENTS.md`, Gemini CLI `<storage home>/GEMINI.md`, Grok `<GROK_HOME>/AGENTS.md`.
   The ruling on the card was to keep them and tell the person, so this only answers
   whether such a file is there. It never reads the file's text and never returns its path:
   the panel does not show paths (Josh 2026-08-17), and the answer is a tool name.

   Grok's import of the person's CLAUDE.md is a different thing, turned off at launch by
   #4426; this reports Grok's OWN file only.

   Not covered, on purpose: Antigravity (no documented user-level file path to check) and
   Meta Muse (runs one turn at a time through engine/musefront.js, not a CLI home). Both
   answer null, which reads as "nothing to say", the same as no file. */

const fs = require('fs');
const path = require('path');

const TOOL = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', grok: 'Grok' };

/* The user-level file this runner's CLI reads for an agent launched with `configDir`
   (null = the default account). Null for a runner with none. Pure apart from the
   default-home helpers, which only read the environment. */
function fileFor(runner, configDir, create) {
  if (runner === 'claude') {
    const home = require('./accounts').homeDir();
    return path.join(configDir || path.join(home, '.claude'), 'CLAUDE.md');
  }
  if (runner === 'codex') return path.join(configDir || create.defaultAgentCodexHome(), 'AGENTS.md');
  if (runner === 'gemini') return path.join(create.geminiStorageHome(configDir || null), 'GEMINI.md');
  if (runner === 'grok') return path.join(configDir || create.defaultAgentGrokHome(), 'AGENTS.md');
  return null;
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
  let file;
  try { file = fileFor(runner, job ? job.configDir : null, create); } catch { file = null; }
  if (!file || !(deps.hasContent || hasContent)(file)) return null;
  return { tool: TOOL[runner] };
}

module.exports = { personalInstructions, fileFor, TOOL };
