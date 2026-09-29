'use strict';

/* #4446: the PERSONAL instructions file an agent's own terminal agent loads at startup
   from OUTSIDE the agent's folder, so the Instructions panel can say so.

   Kosmos does not add these. Each provider's CLI reads its user-level files itself.
   The ruling on the card was to keep them and tell the person, so this only answers
   whether such a file is there. The answer is a tool name, never the path or the text:
   the panel does not show paths (Josh 2026-08-17).

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
    return { files: [path.join(dir, 'CLAUDE.md')], rules: [{ dir: path.join(dir, 'rules'), deep: true, scoped: true }] };
  }
  if (runner === 'codex') {
    const home = configDir || create.defaultAgentCodexHome();
    return { files: [path.join(home, 'AGENTS.override.md'), path.join(home, 'AGENTS.md')], rules: [] };
  }
  if (runner === 'gemini') return { files: [path.join(create.geminiStorageHome(configDir || null), 'GEMINI.md')], rules: [] };
  if (runner === 'grok') {
    const home = configDir || create.defaultAgentGrokHome();
    return { files: [path.join(home, 'AGENTS.md')], rules: [{ dir: path.join(home, 'rules'), deep: false, scoped: false }] };
  }
  return { files: [], rules: [] };
}

/* Runs synchronously on every Instructions read. */
const RULES_MAX_DEPTH = 4;
const RULES_MAX_ENTRIES = 500;

function rulesHaveContent(dir, deep, scoped, has) {
  let seen = 0;
  let stopped = false;
  const walk = (d, depth) => {
    if (stopped) return false;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return false; }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));   // same answer on every filesystem
    const sub = [];
    for (const e of ents) {
      if (++seen > RULES_MAX_ENTRIES) { stopped = true; return false; }
      const p = path.join(d, e.name);
      let isDir = e.isDirectory();
      if (!isDir && deep && e.isSymbolicLink()) { try { isDir = fs.statSync(p).isDirectory(); } catch { isDir = false; } }
      if (isDir) { if (deep && depth < RULES_MAX_DEPTH) sub.push(p); continue; }
      if (e.name.endsWith('.md') && has(p) && !(scoped && pathScoped(p))) return true;
    }
    return sub.some((p) => walk(p, depth + 1));
  };
  return walk(dir, 0);
}

const HEAD_BYTES = 4096;

/* The first HEAD_BYTES of a regular file, or null. statSync follows a symlink, as the CLIs do:
   on a multi-account Mac each account's CLAUDE.md is often a link to ~/.claude/CLAUDE.md. */
function headOf(file) {
  let fd = null;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) return null;
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(st.size, HEAD_BYTES));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return { text: buf.toString('utf8', 0, n), size: st.size };
  } catch { return null; } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* nothing to do */ } }
  }
}

/* Loads something: not empty and not only whitespace (a file longer than the head counts). */
function hasContent(file) {
  const h = headOf(file);
  return !!h && (h.size > HEAD_BYTES || h.text.trim() !== '');
}

/* A Claude rule whose front matter carries `paths:` loads only when the agent touches matching
   files, so it is not reported as always followed. */
function pathScoped(file) {
  const h = headOf(file);
  if (!h || !/^---\r?\n/.test(h.text)) return false;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(h.text);
  return /^paths\s*:/m.test(fm ? fm[1] : h.text);   // front matter longer than the head: what we have of it
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
  const found = src.files.some((f) => has(f)) || src.rules.some((r) => rulesHaveContent(r.dir, r.deep, r.scoped, has));
  return found ? { tool: TOOL[runner] } : null;
}

module.exports = { personalInstructions, sourcesFor, TOOL, RULES_MAX_DEPTH, RULES_MAX_ENTRIES };
