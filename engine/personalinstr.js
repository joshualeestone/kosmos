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

/* This runner's user-level sources for an agent launched with `configDir` (null = the default
   account): fixed `files`, and `rules` folders whose `*.md` files also load (`deep` = subfolders
   too). Both empty for a runner with none. */
function sourcesFor(runner, configDir, create) {
  if (runner === 'claude') {
    const dir = configDir || path.join(require('./accounts').homeDir(), '.claude');
    return { files: [path.join(dir, 'CLAUDE.md')], rules: [{ dir: path.join(dir, 'rules'), deep: true }] };
  }
  if (runner === 'codex') {
    const home = configDir || create.defaultAgentCodexHome();
    return { files: [path.join(home, 'AGENTS.override.md'), path.join(home, 'AGENTS.md')], rules: [] };
  }
  if (runner === 'gemini') return { files: [path.join(create.geminiStorageHome(configDir || null), 'GEMINI.md')], rules: [] };
  if (runner === 'grok') {
    const home = configDir || create.defaultAgentGrokHome();
    return { files: [path.join(home, 'AGENTS.md')], rules: [{ dir: path.join(home, 'rules'), deep: false }] };
  }
  return { files: [], rules: [] };
}

/* This runs on every Instructions read, synchronously, so a rules folder is walked lazily and
   bounded: it stops at the first `*.md` with content, never enters a symlinked folder (no loops),
   and gives up after RULES_MAX_DEPTH levels or RULES_MAX_ENTRIES entries. Giving up answers false. */
const RULES_MAX_DEPTH = 4;
const RULES_MAX_ENTRIES = 500;

function rulesHaveContent(dir, deep, has) {
  let seen = 0;
  const walk = (d, depth) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return false; }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));   // same answer on every filesystem
    const sub = [];
    for (const e of ents) {
      if (++seen > RULES_MAX_ENTRIES) return false;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (deep && depth < RULES_MAX_DEPTH) sub.push(p); continue; }
      if (e.name.endsWith('.md') && has(p)) return true;
    }
    return sub.some((p) => walk(p, depth + 1));
  };
  return walk(dir, 0);
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
  let src;
  try { src = sourcesFor(runner, job ? job.configDir : null, create); } catch { src = { files: [], rules: [] }; }
  const has = deps.hasContent || hasContent;
  const found = src.files.some((f) => has(f)) || src.rules.some((r) => rulesHaveContent(r.dir, r.deep, has));
  return found ? { tool: TOOL[runner] } : null;
}

module.exports = { personalInstructions, sourcesFor, TOOL, RULES_MAX_DEPTH, RULES_MAX_ENTRIES };
