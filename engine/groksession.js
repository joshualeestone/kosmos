'use strict';

/**
 * Reading a Grok Build session, the way codexsession reads a Codex one and
 * geminisession reads a Gemini one.
 *
 * #3391, the FOURTH provider path -- Grok Build, xAI's official terminal coding
 * agent (open source, github.com/xai-org/grok-build). Kosmos does not call an
 * API: it launches a terminal agent, keeps it alive, and READS WHAT THAT AGENT
 * WROTE TO DISK. So a fourth provider is mostly a fourth reader.
 *
 * 📌 GROK BUILD WRITES A SESSION DIRECTORY per session at
 *   $GROK_HOME/sessions/<url-encoded-cwd>/<session-id>/
 * holding summary.json (metadata), signals.json (token usage) and
 * updates.jsonl/chat_history.jsonl (the conversation). GROK_HOME defaults to
 * ~/.grok and IS the storage root itself (unlike GEMINI_CLI_HOME, which is the
 * PARENT of the .gemini dir). All shapes below are read from the AUTHORITATIVE
 * open-source serde structs (xai-org/grok-build), not documentation:
 *   - summary.json = the `Summary` struct, SNAKE_CASE (no rename_all): info{id,cwd},
 *     created_at / updated_at / last_active_at (chrono DateTime<Utc> -> RFC3339
 *     strings), num_messages, current_model_id, last_turn_summary.
 *   - signals.json = the `SessionSignals` struct, CAMELCASE
 *     (#[serde(rename_all = "camelCase")]): contextTokensUsed, contextWindowTokens,
 *     contextWindowUsage, turnCount, ...
 *
 * ⚠️ THE TWO FILES USE DIFFERENT CASING (summary snake, signals camel), verified
 * against the serde attributes ON the structs -- an earlier spike note had signals
 * as snake_case, which would have read `undefined` on every real file while
 * snake_case fixtures passed green (the classic hand-rolled-fixture trap). This
 * reader uses the verified wire names.
 *
 * ⚠️ NOT YET VERIFIED AGAINST A LIVE CAPTURED SESSION (gated on an xAI key, #3391).
 * The field NAMES, casing and RFC3339 timestamps are from the authoritative serde
 * structs, so this is not a guess; what a live capture will still confirm is field
 * POPULATION in practice (e.g. whether last_turn_summary / signals.json are always
 * present) and the exact serialization of the `current_model_id` ModelId type. The
 * reader is defensive on all of these (null when absent/unexpected, never throws),
 * so a live capture confirms rather than corrects, but the caveat is stated so the
 * launcher slice's e2e run is understood as the verification, not a formality.
 *
 * 🔑 KEYED ON summary.json's info.cwd, NOT the url-encoded dir name. Grok records
 * the launch cwd both as the <url-encoded-cwd> DIRECTORY and inside summary.json's
 * info.cwd. Matching on info.cwd (canonicalized, #2417) avoids re-implementing the
 * CLI's `urlencoding::encode` in JS AND handles the long-path case for free (when
 * the encoded name exceeds the dir-name byte cap, Grok slugs+hashes the dir and the
 * real path lives in info.cwd anyway). This mirrors codexsession keying on meta.cwd.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const trust = require('./trust');
/* ⚠️ THE REASONS A PERSON READS ARE SHARED WITH THE CLAUDE/CODEX/GEMINI PATHS,
   never written here -- a reason is about the AGENT, not the runtime, so no error
   message reveals which provider an agent runs on. Same require codexsession and
   geminisession make; it loads cleanly because status.js requires the provider
   readers only lazily inside functions, never at module load. */
const { NO_READING } = require('./status');

/** Overridable so tests never read the operator's real Grok home. GROK_HOME is the
 *  real CLI env var and IS the storage root (sessions/ sits directly under it);
 *  defaults to ~/.grok. AGENT_WORKFORCE_GROK_HOME is our own test/launcher override,
 *  the sibling of AGENT_WORKFORCE_CODEX_HOME / AGENT_WORKFORCE_GEMINI_HOME. */
const HOME = () => process.env.AGENT_WORKFORCE_GROK_HOME
  || process.env.GROK_HOME
  || path.join(process.env.AGENT_WORKFORCE_HOME || os.homedir(), '.grok');

const SESSIONS = (home) => path.join(home || HOME(), 'sessions');

/**
 * Every session's summary.json path, newest first by the summary's mtime. Layout
 * is sessions/<enc-cwd>/<session-id>/summary.json -- exactly two directory levels
 * under sessions/, so this is a bounded two-level walk (not an unbounded home walk).
 * Returns [] on a missing/unreadable sessions root; never throws.
 */
function summaries(home) {
  const root = SESSIONS(home);
  const files = [];
  let cwdDirs;
  try { cwdDirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  for (const c of cwdDirs) {
    if (!c.isDirectory()) continue;
    const cdir = path.join(root, c.name);
    let sessDirs;
    try { sessDirs = fs.readdirSync(cdir, { withFileTypes: true }); } catch { continue; }
    for (const s of sessDirs) {
      if (!s.isDirectory()) continue;
      const file = path.join(cdir, s.name, 'summary.json');
      let mtime;
      try { const st = fs.statSync(file); if (!st.isFile()) continue; mtime = st.mtimeMs; }
      catch { continue; }
      files.push({ file, mtime });
    }
  }
  files.sort((a, b) => (b.mtime !== a.mtime ? b.mtime - a.mtime : (a.file < b.file ? 1 : a.file > b.file ? -1 : 0)));
  return files.map((f) => f.file);
}

/** Parse one summary.json into an object, or null on missing/malformed. */
function summaryOf(file) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch { return null; }
}

/**
 * The newest session Grok recorded for a given launch folder, matched by the cwd
 * Grok stored in summary.json (info.cwd), canonicalized on both sides (#2417 --
 * folds the /private twin and case, so a launch folder Kosmos derives matches the
 * on-disk spelling Grok wrote). Returns { dir, summary } (dir is the session dir
 * holding summary.json + signals.json) or null. Never throws.
 */
function forWorkdir(dir, home) {
  if (!dir) return null;
  const want = trust.canonicalOnDisk(path.resolve(dir));
  for (const file of summaries(home)) {
    const s = summaryOf(file);
    const cwd = s && s.info && typeof s.info.cwd === 'string' ? s.info.cwd : null;
    if (!cwd) continue;
    if (trust.canonicalOnDisk(cwd) === want) return { dir: path.dirname(file), summary: s };
  }
  return null;
}

/**
 * What the board needs from a Grok session -- the SAME contract codexsession.read
 * and geminisession.read return, so status.js reads all four providers through one
 * shape.
 *
 * ⚠️ EVERY FIELD IS null WHEN UNKNOWN, never a default (the shared rule).
 *
 * ⭐ BOTH context halves are MEASURED for Grok (contextTokensUsed +
 * contextWindowTokens from signals.json), like Codex and firmer than Gemini/Claude
 * whose window is only assumed -- so a Grok agent's memory ring rests on a real
 * ceiling. contextUsedAt is the last-activity time (summary.last_active_at, RFC3339)
 * when usage is known, the freshness anchor a future account badge would use.
 */
function read(dir, home) {
  /* NOTE for the status-wiring slice: unlike codexsession/geminisession, this reader
     never returns NO_READING.UNREADABLE. forWorkdir must PARSE summary.json to match
     by info.cwd, so a corrupt/unparseable summary is skipped there and a workdir with
     only such a session surfaces as NO_TRANSCRIPT (we cannot identify it), not
     UNREADABLE. signals.json failing to read degrades to null halves, not UNREADABLE.
     So a Grok consumer's UNREADABLE branch is unreachable -- correct, just asymmetric. */
  const found = forWorkdir(dir, home);
  if (!found) return { found: false, because: NO_READING.NO_TRANSCRIPT };
  const s = found.summary;

  /* signals.json (camelCase) carries the token counts; absent/malformed -> null
     halves rather than a throw (a session early in its first turn may have none).
     Capture its mtime as the "when usage was measured" anchor below. */
  const signalsPath = path.join(found.dir, 'signals.json');
  let signals = null;
  let signalsMtime = null;
  try {
    signals = JSON.parse(fs.readFileSync(signalsPath, 'utf8'));
    try { signalsMtime = fs.statSync(signalsPath).mtimeMs; } catch { signalsMtime = null; }
  } catch { signals = null; }
  const num = (v) => (typeof v === 'number' ? v : null);
  const contextUsed = signals ? num(signals.contextTokensUsed) : null;
  const contextWindow = signals ? num(signals.contextWindowTokens) : null;

  const lastAt = (typeof s.last_active_at === 'string' && s.last_active_at)
    || (typeof s.updated_at === 'string' && s.updated_at) || null;

  /* ⭐ contextUsedAt anchors on signals.json's MTIME -- WHEN the usage was written --
     NOT on summary.last_active_at (challenge iter 1). Grok has no per-turn usage
     TIMESTAMP inside signals.json (unlike codex's token_count event, whose own
     timestamp codexsession uses), and last_active_at can stay fresh on ANY activity
     while the recorded usage is stale, which would make a future liveness badge
     green off non-usage traffic (the #874 harm). signals.json is rewritten each turn
     usage changes, so its mtime is the closest "usage measured at" signal on disk.
     Null unless usage is actually known. This is the freshness anchor the launcher
     slice's account badge should use; it is still weaker than a content timestamp,
     so that badge must gate on it, not assume it. */
  const contextUsedAt = (contextUsed != null && typeof signalsMtime === 'number') ? signalsMtime : null;

  const sessionId = s.info && typeof s.info.id === 'string' ? s.info.id : null;
  /* current_model_id is a ModelId; in practice a string. Take it only when it IS a
     string -- never String(obj) a struct into "[object Object]". Null otherwise
     (the shared "this model" fallback), a live-capture residual noted in the header. */
  const model = typeof s.current_model_id === 'string' ? s.current_model_id : null;
  const messages = num(s.num_messages);
  const lastAgentMessage = typeof s.last_turn_summary === 'string' ? s.last_turn_summary : null;

  return {
    found: true,
    file: path.join(found.dir, 'summary.json'),
    sessionId,
    provider: 'xai',
    cliVersion: null,
    contextWindow,
    contextUsed,
    contextUsedAt,
    messages: messages == null ? 0 : messages,
    lastAt,
    lastAgentMessage,
    /* Extra beyond codex's contract (as geminisession does): Grok names the model
       in summary.json, so surface it; codex/Claude consumers ignore it. */
    model,
  };
}

module.exports = { HOME, read, forWorkdir, summaries, summaryOf, SESSIONS };
