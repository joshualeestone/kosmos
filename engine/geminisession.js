'use strict';

/**
 * Reading a Gemini install's project list AND its session transcripts, the way
 * codexsession reads a Codex one and status.js reads a Claude one.
 *
 * #2243, the third provider DISCOVERY path (projects/agentFiles); #3296, the
 * third provider RUNNER path (read/forWorkdir -- the context ring + liveness a
 * launched Gemini agent's board row needs). Kosmos does not call an API: it
 * launches a terminal agent, keeps it alive, and reads what that agent's tool
 * wrote to disk. So a third provider is mostly a third reader.
 *
 * 📌 GEMINI RECORDS ITS PROJECT CWDS in a JSON MAP at <HOME()>/projects.json,
 * shaped { "projects": { "<abs-cwd>": "<slug>" } }, and a project's instructions
 * live in <cwd>/GEMINI.md, the disk sibling of CLAUDE.md and AGENTS.md.
 * <HOME()> is the `.gemini` STORAGE dir (the one that holds projects.json,
 * tmp/, history/, agents/) -- see HOME below for how each override resolves to
 * it. Measured from a real projects.json + a real session on this machine
 * (2026-09-21, CLI 0.61.0-preview.0), not taken from documentation.
 *
 * 📌 A LAUNCHED SESSION's TRANSCRIPT (#3296) is a JSONL log at
 * <HOME()>/tmp/<slug>/chats/session-<ts>-<id>.jsonl, where <slug> is the
 * projects.json VALUE for the launch cwd. It is an INCREMENTAL log: a first line
 * of session_meta ({sessionId, projectHash, startTime, kind}), then a mix of
 * `{ "$set": { ... } }` snapshot/bookkeeping ops and bare message objects
 * ({id, timestamp, type:'user'|'gemini', content, [model], [tokens]}). Messages
 * arrive in BOTH `$set.messages` arrays and bare lines, so read() de-dupes by
 * id. This is the SHAPE codex writes (one JSONL per session, keyed on launch
 * cwd), in a different place and with different field names. `read` returns the
 * SAME contract codexsession.read returns, so status.js reads all three
 * providers through one shape.
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
const trust = require('./trust');
/* ⚠️ THE REASONS A PERSON READS ARE SHARED WITH THE CLAUDE + CODEX PATHS, never
   written here. A reason is about the AGENT, not the runtime underneath it, so
   all three providers say the same sentence about the same condition -- and
   nobody can tell which provider an agent runs on from an error message. This is
   the same require codexsession.js makes for the same reason (Mona Lisa's
   principle for the whole multi-provider phase); it loads cleanly because
   status.js requires discover/codex/gemini only LAZILY inside functions, never
   at module load, so there is no top-level cycle. */
const { NO_READING } = require('./status');

/** Overridable so tests never read the operator's real Gemini home. An arrow
 *  const (lazy) so it resolves per call, never frozen at require time.
 *
 *  🔑 HOME() ALWAYS RESOLVES TO THE `.gemini` STORAGE DIR -- the dir that holds
 *  projects.json, tmp/<slug>/chats/, history/, agents/ -- so every reader below
 *  can join its subpath onto HOME() directly. The three overrides get there
 *  differently, and #3296 corrected the middle one:
 *    - AGENT_WORKFORCE_GEMINI_HOME: VERBATIM. Our own override (tests + the
 *      launcher) points it straight AT the .gemini dir, so no segment is added.
 *    - GEMINI_CLI_HOME: the REAL Gemini CLI env var, and the CLI documents it as
 *      "the ROOT directory ... the CLI will create a .gemini directory below
 *      that root" (bundled docs/reference/configuration.md; confirmed by a live
 *      capture writing to <GEMINI_CLI_HOME>/.gemini/). So we APPEND `.gemini` --
 *      before #3296 this returned the root verbatim and read one segment too
 *      HIGH, missing every projects.json/session under it. No test exercised
 *      this branch (all set AGENT_WORKFORCE_GEMINI_HOME), so the divergence
 *      shipped silently; it is a bugfix, not a behaviour a caller relied on.
 *    - default: os.homedir()/.gemini (or AGENT_WORKFORCE_HOME/.gemini) -- already
 *      the .gemini dir, matching the CLI's own default of $HOME/.gemini. */
const HOME = () => process.env.AGENT_WORKFORCE_GEMINI_HOME
  || (process.env.GEMINI_CLI_HOME
        ? path.join(process.env.GEMINI_CLI_HOME, '.gemini')
        : path.join(process.env.AGENT_WORKFORCE_HOME || os.homedir(), '.gemini'));

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

/* ------------------------------------------------------------------------- *
 * #3296 THE RUNNER READER: the launched-agent session transcript, keyed on the
 * launch folder, returned in codexsession.read's EXACT contract so status.js
 * reads Claude, Codex and Gemini agents through one shape.
 * ------------------------------------------------------------------------- */

/** A Gemini message `content` is EITHER a bare string ('CLI-GEMINI-OK') OR an
 *  array of parts ([{ text }]) -- the session_context seed is an array, a plain
 *  reply is a string. Flatten to the text a person would read; null when there
 *  is no text (e.g. a tool-only part with no `text`). */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
      .filter((t) => t.length > 0);
    return parts.length ? parts.join('') : null;
  }
  return null;
}

/**
 * The newest session transcript Gemini recorded for a given working directory.
 *
 * 🔑 KEYED ON THE LAUNCH FOLDER, exactly as the Claude and Codex readers are,
 * because the launch directory is the one fact Kosmos controls. Gemini does not
 * write the cwd into the transcript the way codex writes `meta.cwd`; instead it
 * maps cwd -> <slug> in <home>/projects.json and stores the session under
 * <home>/tmp/<slug>/chats/. So this resolves the slug from projects.json, then
 * picks the newest session-*.jsonl in that slug's chats dir.
 *
 * ⚠️ CANONICALIZE BOTH SIDES with trust.canonicalOnDisk (realpathSync.native --
 * folds the /private twin AND case), the #2417 discipline: a projects.json key is
 * already the on-disk /private spelling, while `dir` is the launch folder Kosmos
 * derives, which may be the /var symlink twin or a case-divergent spelling. Plain
 * path.resolve would miss the match and the ring would read "not yet" for a live
 * agent -- the exact door #2417 closed for codex.
 *
 * ⚠️ NEWEST BY MTIME, not by name. codexsession sorts rollouts by name because a
 * codex filename carries a full second-precision timestamp; a Gemini filename is
 * session-<YYYY-MM-DDTHH-MM>-<id8>.jsonl -- MINUTE precision then the sessionId
 * prefix, which is NOT chronological within a minute. Sorting by name would pick
 * by id prefix among same-minute sessions; mtime is the honest "most recently
 * written". Bounded by the session count in ONE workdir's chats dir (small), so
 * the per-file stat is cheap. Name is the tiebreak for equal mtimes.
 *
 * Returns { file, slug } or null. Never throws.
 */
function forWorkdir(dir, home) {
  if (!dir) return null;
  const h = home || HOME();
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(path.join(h, 'projects.json'), 'utf8')); }
  catch { return null; }
  const map = parsed && parsed.projects;
  if (!map || typeof map !== 'object') return null;

  const want = trust.canonicalOnDisk(path.resolve(dir));
  let slug = null;
  for (const cwd of Object.keys(map)) {
    if (trust.canonicalOnDisk(cwd) === want) { slug = map[cwd]; break; }
  }
  if (!slug || typeof slug !== 'string') return null;

  const chatsDir = path.join(h, 'tmp', slug, 'chats');
  let entries;
  try { entries = fs.readdirSync(chatsDir); } catch { return null; }
  const sessions = entries.filter((n) => /^session-.*\.jsonl$/.test(n));
  if (!sessions.length) return null;
  /* Newest by mtime; name breaks a tie. A file that vanished between readdir and
     stat sorts oldest (mtime 0) rather than throwing. */
  sessions.sort((a, b) => {
    let ma = 0; let mb = 0;
    try { ma = fs.statSync(path.join(chatsDir, a)).mtimeMs; } catch { ma = 0; }
    try { mb = fs.statSync(path.join(chatsDir, b)).mtimeMs; } catch { mb = 0; }
    if (mb !== ma) return mb - ma;
    return a < b ? 1 : a > b ? -1 : 0;
  });
  return { file: path.join(chatsDir, sessions[0]), slug };
}

/**
 * What the board needs from a Gemini session -- the SAME contract
 * codexsession.read returns, so status.js's context ring and liveness overlay
 * read all three providers through one shape.
 *
 * ⚠️ EVERY FIELD IS null WHEN UNKNOWN, never a default (codexsession's rule).
 *
 * 📌 TWO FIELDS ARE STRUCTURALLY null FOR GEMINI, and honestly so:
 *   - contextWindow: Gemini does not state its window in the transcript the way
 *     codex states model_context_window on task_started. It is the Claude case
 *     ("a limit we assume rather than watch"), so the ceiling stays assumed; the
 *     model IS known (see `model`) if a caller wants to map model -> window
 *     elsewhere, but this reader never infers it.
 *   - cliVersion: the Gemini session_meta header carries sessionId/projectHash/
 *     startTime/kind, not a CLI version. Left null rather than guessed.
 *
 * ⭐ contextUsed IS MEASURED. A Gemini `gemini` message carries a `tokens` object
 * { input, output, cached, thoughts, tool, total }. `tokens.input` is the prompt
 * of that turn -- the whole conversation re-sent -- i.e. current window occupancy,
 * the exact analog of codex's last_token_usage.input_tokens (and, like it, the
 * right number: `total` climbs across turns and never resets on a compaction).
 * Taken from the LAST gemini message that reported one; null until one has.
 */
function read(dir, home) {
  const found = forWorkdir(dir, home);
  if (!found) return { found: false, because: NO_READING.NO_TRANSCRIPT };
  let raw;
  try { raw = fs.readFileSync(found.file, 'utf8'); }
  catch { return { found: false, because: NO_READING.UNREADABLE }; }

  let sessionId = null;
  let lastAt = null; // freshest ISO timestamp seen
  const byId = new Map(); // id -> message object (later occurrence wins)
  const order = []; // ids in first-seen (chronological, append-log) order
  const touch = (iso) => {
    if (typeof iso === 'string' && iso && (lastAt === null || iso > lastAt)) lastAt = iso;
  };
  const recordMsg = (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.type !== 'user' && m.type !== 'gemini') return;
    const key = typeof m.id === 'string' ? m.id : `__anon_${order.length}`;
    if (!byId.has(key)) order.push(key);
    byId.set(key, m);
    touch(m.timestamp);
  };

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    /* session_meta header: has sessionId + kind and is NOT a $set op. */
    if (row.sessionId && row.kind && !row.$set) {
      sessionId = row.sessionId;
      touch(row.startTime);
      touch(row.lastUpdated);
      continue;
    }
    if (row.$set && typeof row.$set === 'object') {
      touch(row.$set.lastUpdated);
      if (Array.isArray(row.$set.messages)) for (const m of row.$set.messages) recordMsg(m);
      continue;
    }
    if (row.id && (row.type === 'user' || row.type === 'gemini')) recordMsg(row);
  }

  const msgs = order.map((k) => byId.get(k));
  const messages = msgs.length;

  let lastGemini = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].type === 'gemini') { lastGemini = msgs[i]; break; }
  }
  const lastAgentMessage = lastGemini ? contentText(lastGemini.content) : null;
  const model = lastGemini && typeof lastGemini.model === 'string' ? lastGemini.model : null;

  let contextUsed = null;
  let contextUsedAt = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.type === 'gemini' && m.tokens && typeof m.tokens.input === 'number') {
      contextUsed = m.tokens.input;
      const t = m.timestamp ? Date.parse(m.timestamp) : NaN;
      contextUsedAt = Number.isFinite(t) ? t : null;
      break;
    }
  }

  return {
    found: true,
    file: found.file,
    sessionId,
    provider: 'gemini',
    cliVersion: null,
    contextWindow: null,
    contextUsed,
    contextUsedAt,
    messages,
    lastAt,
    lastAgentMessage,
    /* Extra beyond codex's contract: Gemini names the model per gemini-message,
       so surface it (harmless to codex/Claude consumers, which never read it).
       The board's model column can use it directly rather than re-deriving. */
    model,
  };
}

module.exports = { HOME, projects, agentFiles, forWorkdir, read, contentText };
