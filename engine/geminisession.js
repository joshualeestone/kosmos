'use strict';

/**
 * Reading a Gemini install's project list, the way codexsession reads a Codex
 * one and status.js reads a Claude one.
 *
 * #2243, the third provider path. Kosmos does not call an API: it launches a
 * terminal agent, keeps it alive, and reads what that agent's tool wrote to
 * disk. So a third provider is mostly a third reader.
 *
 * 📌 GEMINI RECORDS ITS PROJECT CWDS in a JSON MAP at
 * <GEMINI_CLI_HOME>/projects.json, shaped { "projects": { "<abs-cwd>": "<name>" } },
 * and a project's instructions live in <cwd>/GEMINI.md, the disk sibling of
 * CLAUDE.md and AGENTS.md. Measured from a real projects.json on this machine,
 * not taken from documentation.
 *
 * 🛑 THIS FILE OWNS THE ~/.gemini RESOLUTION so discover.js never reaches
 * os.homedir() for Gemini, the same separation codexsession keeps for Codex.
 * That is not only tidiness: a home resolver defined IN discover.js chains
 * found() into check-frozen-roots' resolver set (#1432), which then false-flags
 * an unrelated frozen const whose COMMENT merely mentions found(). Keeping the
 * resolver in this module keeps discover.js's found() out of that set.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Overridable so tests never read the operator's real Gemini home. An arrow
 *  const (lazy) so it resolves per call, never frozen at require time. */
const HOME = () => process.env.AGENT_WORKFORCE_GEMINI_HOME
  || process.env.GEMINI_CLI_HOME
  || path.join(process.env.AGENT_WORKFORCE_HOME || os.homedir(), '.gemini');

/**
 * The absolute project cwds Gemini has recorded, de-duplicated and
 * projects.json-first ordered. Two sources, unioned (#2243 part 3):
 *   1. <home>/projects.json, shaped { "projects": { "<abs-cwd>": "<name>" } } -- the
 *      current map, part 2's source.
 *   2. <home>/history/<name>/.project_root, a plain-text file holding one absolute
 *      cwd. A Gemini agent that ran but whose project never landed in projects.json
 *      (or whose projects.json was cleared) is recorded ONLY here, so projects.json
 *      alone left it invisible to foundGemini -- the weakest premise part 2 named,
 *      measured on this machine (history/<name>/.project_root is byte-identical to
 *      that project's projects.json key when both exist, so the de-dupe collapses the
 *      overlap and source 2 adds only the history-only projects).
 * Returns [] on missing or malformed sources and NEVER throws: the caller decides
 * what a cwd without a GEMINI.md means (a Gemini project is not an agent unless its
 * GEMINI.md introduces one).
 */
function projects() {
  /* Keep only absolute values: connect records a folder, so a relative or empty
     value is not a launch folder we could offer. De-dupe across both sources. */
  const seen = new Set();
  const out = [];
  const add = (cwd) => {
    if (typeof cwd !== 'string') return;
    let p = cwd.trim();
    /* Strip a trailing slash (a lone "/" left as-is) so /x and /x/ from the two
       sources de-dupe to one row: foundGemini keys byDir on the raw cwd, so an
       un-normalized trailing-slash divergence would surface the SAME agent twice.
       Cheap, no filesystem. A symlink-spelling divergence (/tmp vs /private/tmp) is
       NOT collapsed here -- that needs realpathSync (a per-cwd stat + throw-handling
       for a moved cwd that must stay returnable), deferred as the sources are
       byte-identical in practice; revisit if they ever diverge by symlink. */
    if (p.length > 1) p = p.replace(/\/+$/, '');
    if (!p || !path.isAbsolute(p) || seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };

  // Source 1: projects.json (part 2). Order preserved. NOTE (#2243 part 3): its keys
  // now flow through add() too, so they are trimmed + trailing-slash-stripped, not pushed
  // verbatim as part 2 did -- a benign change (the sole consumer foundGemini joins
  // GEMINI.md onto the cwd and keys byDir, both of which normalization only helps) and it
  // is what lets a projects.json key de-dupe against a differently-spelled history value.
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(path.join(HOME(), 'projects.json'), 'utf8')); }
  catch { parsed = null; }
  const map = parsed && parsed.projects;
  if (map && typeof map === 'object') for (const cwd of Object.keys(map)) add(cwd);

  // Source 2: history/<name>/.project_root (#2243 part 3). One readFileSync per history
  // subdir; bounded by the number of Gemini projects (per-project, comparable to
  // projects.json in practice), so no depth/count cap -- if history ever becomes
  // session-keyed and unbounded, add one. Per-entry and tolerant --
  // a missing history dir, a non-directory entry, an unreadable subdir, or an
  // absent/blank/relative .project_root is simply skipped, never thrown.
  let entries;
  try { entries = fs.readdirSync(path.join(HOME(), 'history'), { withFileTypes: true }); }
  catch { entries = []; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    let root;
    try { root = fs.readFileSync(path.join(HOME(), 'history', e.name, '.project_root'), 'utf8'); }
    catch { continue; }
    /* First line only, matching codexsession's meta discipline: a .project_root is one
       absolute cwd, so extra lines in a malformed/multi-line file must not become an
       embedded newline in the cwd (which survives trim and would defeat de-dupe against
       the clean projects.json key). */
    add(root.split('\n')[0]);
  }

  return out;
}

/**
 * The Gemini CLI's CUSTOM AGENT DEFINITION files (#2410). Distinct from projects()
 * above: those are project cwds whose <cwd>/GEMINI.md may introduce an agent; these
 * are the agent DEFINITIONS the Gemini CLI stores as markdown-with-YAML-front-matter
 * under <HOME()>/agents/*.md (measured shape: `---\nname: <name>\ndescription: <role>\n---\n`
 * then a generic body). foundGemini/the disk scan never reached them: the location is a
 * dotdir the scan skips, and their identity is in the front-matter, not a "You are <Name>"
 * prose line.
 *
 * Returns absolute file paths, sorted for a stable order, [] on a missing/unreadable
 * agents dir. NEVER throws: the caller decides what each file means (a Gemini agent
 * file is offered by front-matter identity; a non-front-matter .md falls back to the
 * generic loose-file rule). Bounded by MAX so a pathological agents dir cannot make the
 * scan read thousands of files -- Gemini agents are few in practice.
 */
const MAX_AGENT_FILES = 200;
function agentFiles() {
  let entries;
  try { entries = fs.readdirSync(path.join(HOME(), 'agents'), { withFileTypes: true }); }
  catch { return []; }
  const names = [];
  for (const e of entries) {
    /* A regular file named *.md / *.markdown. Directories under agents/ are not agent
       definitions; a dotfile (e.g. .DS_Store) is skipped. withFileTypes lets us skip
       directories without a stat. A symlink is passed through here, but the caller's head
       reader (readClaudeHead) lstats and refuses ANY non-regular-file -- a symlink to a
       file included -- so symlinks are ultimately not offered; that is the same
       no-symlink-escape contract the disk walk keeps, enforced at read time. */
    if (e.isDirectory()) continue;
    const name = e.name;
    if (name.startsWith('.')) continue;
    const lower = name.toLowerCase();
    if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) continue;
    names.push(name);
  }
  // Sort BEFORE the cap so a pathological (>MAX) agents dir truncates to a STABLE set --
  // capping in readdir order would keep a non-deterministic subset and only then sort it.
  names.sort();
  return names.slice(0, MAX_AGENT_FILES).map((name) => path.join(HOME(), 'agents', name));
}

module.exports = { HOME, projects, agentFiles };
