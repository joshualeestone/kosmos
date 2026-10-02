'use strict';

/**
 * Reading a Codex session, the way `status.js` reads a Claude Code one.
 *
 * #244, phase 1 of running agents on OpenAI. Kosmos does not call an API: it
 * launches a terminal agent, keeps it alive, addresses its pane, and READS THE
 * LOG THAT AGENT WRITES. So a second provider is mostly a second reader.
 *
 * 📌 CODEX WRITES A JSONL ROLLOUT, one object per line, at
 * `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<time>-<uuid>.jsonl` -- the same
 * SHAPE Claude writes, in a different place. (It also keeps a SQLite index over
 * that file; this reads the file, because the file is the record and the index
 * is derived from it.) Measured from a real session on 2026-08-22, not taken
 * from documentation, which does not describe this at all.
 *
 * ⭐ AND IT CARRIES ONE THING CLAUDE'S DOES NOT: the context window, stated by
 * the tool on `task_started`. Kosmos has to ASSUME that number for Claude --
 * the card literally says "against a limit we have assumed rather than
 * watched". Here it is measured, so an OpenAI agent's memory ring rests on a
 * firmer footing than a Claude one.
 *
 * ⭐ THE USED HALF IS NOW MEASURED TOO (#2257). A completed Codex turn reports a
 * `token_count` event carrying `info.last_token_usage.input_tokens` -- the last
 * prompt, i.e. how full the window is right now. `contextUsed` reads it from the
 * last such event; it stays null (rendering as the honest "we could not tell")
 * only until a turn has reported usage. This was the field the original version
 * refused to guess -- settled by six real gpt-5.6-sol rollouts on 2026-09-07, not
 * from documentation, which still does not describe it. See the note in `read`.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const codexupdate = require('./codexupdate');
const trust = require('./trust');
/* ⚠️ THE REASONS A PERSON READS ARE SHARED WITH THE CLAUDE PATH, never written
   here. A reason is about the AGENT, not about the runtime underneath it, so
   both providers say the same sentence about the same condition -- and nobody
   can tell which provider an agent runs on from an error message. See
   NO_READING's own note in status.js. (Mona Lisa's principle for the whole
   OpenAI phase.) */
const { NO_READING } = require('./status');

/** Overridable so tests never read the operator's real Codex history. */
/* 🛑 ONE derivation (#1337): call codexupdate rather than restate the rule.
   This copy did not honour `CODEX_HOME`, so it could READ a different home
   than the launch path WROTE to. */
const HOME = () => codexupdate.defaultHome();

/* #2906: an OPTIONAL explicit home. Callers that pass one read THAT account's
   sessions; callers that omit it keep the process-default home, so every existing
   direct caller is unchanged. The status reader passes the target agent's own
   account home so a multi-account agent is not read against the board's account. */
const SESSIONS = (home) => path.join(home || HOME(), 'sessions');

/** Every rollout file, newest first by name (the name carries the timestamp). */
function rollouts(home) {
  const root = SESSIONS(home);
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      /* Bounded rather than unbounded: the layout is year/month/day, so three
         levels is the whole tree. An unbounded walk of somebody's home
         directory is a different and much worse function. */
      if (e.isDirectory() && depth < 3) walk(full, depth + 1);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) out.push(full);
    }
  };
  walk(root, 0);
  return out.sort().reverse();
}

/*
 * #5054: the session_meta is the FIRST line of a rollout, and a rollout is append-only with a
 * uniquely-named file (timestamp + id), so its head never changes for a given path. forWorkdir called
 * metaOf on every rollout, every refresh, each a 64 KB read -- 60 files is ~4 MB of re-reads per refresh
 * on top of the full-parse this card's main fix removes. Cache the parsed meta (including a null for a
 * non-session_meta or unreadable head) by path, so the walk stays cheap and does not re-open every file.
 * A new rollout is a new path, so it is metaOf'd once; the cache never masks a newer session.
 */
const META_CACHE = new Map();   // file -> payload | null

/**
 * The first line of a rollout is its `session_meta`, which carries the folder
 * the session was launched in.
 *
 * ⚠️ THE HEAD, NOT THE TAIL, and that distinction already cost a bug once in
 * this product: the same reader for Claude read the END of the file looking for
 * something written at the START.
 */
function metaOf(file) {
  if (META_CACHE.has(file)) return META_CACHE.get(file);
  const r = metaOfUncached(file);
  /* Cache only a CLEAN read (a parsed payload, or a confirmed-null non-session_meta head). A transient
     open/read failure (the file briefly gone, too many fds) is NOT cached: a rollout head never changes,
     so caching a transient null would hide a real session until a board restart. It is retried next call. */
  if (r.ok) META_CACHE.set(file, r.payload);
  return r.payload;
}
function metaOfUncached(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return { ok: false, payload: null }; }
  try {
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const first = buf.slice(0, n).toString('utf8').split('\n')[0];
    const row = JSON.parse(first);
    if (!row || row.type !== 'session_meta') return { ok: true, payload: null };
    return { ok: true, payload: row.payload || null };
  } catch { return { ok: false, payload: null }; }
  finally { try { fs.closeSync(fd); } catch { /* already gone */ } }
}

/**
 * The newest session Codex recorded for a given working directory.
 *
 * 🔑 KEYED ON THE LAUNCH FOLDER, exactly as the Claude reader is, because that
 * is the one fact Kosmos controls: it chooses the directory it starts an agent
 * in. Anything else -- a name, a title, a pane id -- is a coincidence the agent
 * could change.
 */
function forWorkdir(dir, home) {
  if (!dir) return null;
  const want = path.resolve(dir);
  for (const file of rollouts(home)) {
    const meta = metaOf(file);
    if (!meta || !meta.cwd) continue;
    /* #2417: canonicalOnDisk (realpathSync.native) on BOTH sides, not plain realpathSync.
       `want` is the launch folder Kosmos DERIVES; `meta.cwd` is the ON-DISK spelling codex
       wrote via std::fs::canonicalize. Plain realpathSync resolved the /private twin but
       PRESERVED case on macOS, so a case-divergent launch folder (agent started in the
       lowercase 'work' spelling, disk holds 'Work') never matched its rollout and the OpenAI
       ring read "not yet" -- the #2257 symptom via this door, the reason this site was
       deferred into #2417. realpathSync.native folds case + /private + unicode exactly as
       codex's canonicalize did, so the two match by construction; both fall back to
       path.resolve on an absent path, so the gone-folder behavior is unchanged. */
    if (trust.canonicalOnDisk(want) === trust.canonicalOnDisk(meta.cwd)) return { file, meta };
  }
  return null;
}

/* The running fields read() derives from a rollout, all null/0 when nothing has set them. */
function freshAcc() {
  return { contextWindow: null, contextUsed: null, contextUsedAt: null, lastAt: null, messages: 0, model: null, lastAgentMessage: null };
}

/* Apply one parsed rollout row to the running fields. Extracted from read()'s old per-line loop
   UNCHANGED so the incremental fold (#5054) produces exactly what a full re-parse did; every "last X"
   field takes the latest row and `messages` counts, so folding lines in file order is order-correct. */
function foldRow(acc, row) {
  if (row.timestamp) acc.lastAt = row.timestamp;
  if (row.type === 'response_item') acc.messages += 1;
  /* #4416: codex names the model on every turn_context; the last one is what it runs now. */
  if (row.type === 'turn_context' && row.payload && typeof row.payload.model === 'string' && row.payload.model) acc.model = row.payload.model;
  if (row.type === 'event_msg' && row.payload) {
    const p = row.payload;
    /* The tool states its own limit here. Taken only from `task_started`,
       where it is the model's window, rather than from any field that merely
       looks like a number of tokens. */
    if (p.type === 'task_started' && typeof p.model_context_window === 'number') {
      acc.contextWindow = p.model_context_window;
    }
    /* #2257: THE USED HALF, MEASURED. Codex reports usage on a `token_count`
       event as `info.last_token_usage` (the last turn) and `info.total_token_usage`
       (CUMULATIVE across the whole session). The window OCCUPANCY -- what the ring
       needs -- is the last turn's prompt, because each turn re-sends the whole
       conversation as input, so `last_token_usage.input_tokens` tracks how full the
       window is right now. `total_token_usage.total_tokens` is the wrong number: it
       climbs past the window and never resets on a compaction. Keep the LAST such
       event; a session with no completed turn has none, and `contextUsed` stays null.
       Measured against six real gpt-5.6-sol rollouts, 2026-09-07 (window 258400):
       last_token_usage.input_tokens ~11.7k held steady while total_tokens climbed
       23k -> 39k, which is what settled the "one real session decides this" note.
       📌 `input_tokens` already INCLUDES the cached prefix (adding
       `cached_input_tokens` would double-count), and it is the input to the LAST
       request -- so it omits that turn's own `output_tokens`, which the next
       prompt re-sends. That output is small next to the prompt (5 tokens in the
       measured runs) and reasoning tokens are dropped from later context, so the
       prompt size is the right stable proxy for occupancy; Codex's own TUI may
       read a hair differently, which is expected. */
    if (p.type === 'token_count' && p.info && p.info.last_token_usage
        && typeof p.info.last_token_usage.input_tokens === 'number') {
      acc.contextUsed = p.info.last_token_usage.input_tokens;
      /* #2413: WHEN this completed turn was reported, as epoch ms. A `token_count`
         carrying a real `last_token_usage` is a turn that ran to completion -- a
         dead-credential 401 reconnect loop NEVER emits one (#2790 fixture). The
         OpenAI badge overlay records an observed `ok` from this, gated on the
         timestamp's freshness, so a live sign-in greens from real traffic while a
         sign-in whose last real turn is old greys again on its own (no permanent
         green over a dead credential -- the #874 harm). Null when the row carries no
         parseable timestamp, which keeps the badge grey (the safe direction) rather
         than green off an untimed completion. */
      const t = row.timestamp ? Date.parse(row.timestamp) : NaN;
      acc.contextUsedAt = Number.isFinite(t) ? t : null;
    }
    if (p.type === 'task_complete' && typeof p.last_agent_message === 'string') {
      acc.lastAgentMessage = p.last_agent_message;
    }
  }
}

/* Fold every whole JSON line in `text` into `acc` (blank and unparseable lines skipped, exactly as the
   old `.split('\n')` loop did). */
function foldLines(acc, text) {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    foldRow(acc, row);
  }
}

/*
 * #5054: a per-rollout-file incremental cache, the same shape #562 gave messages.jsonl. Codex rollout
 * files reach 30-100 MB; re-reading and JSON-parsing the whole file on every status refresh took 70%
 * of a busy board's CPU and stopped it answering (a user's profile, 2026-10-02). Here each file keeps
 * its parsed running fields plus the byte offset of the last settled line; a later read folds only the
 * appended bytes. Keyed by absolute file path. Invalidation mirrors #562: a changed inode (replaced),
 * a size that went backwards (truncated), or a changed mtime at the same size (rewritten in place) each
 * drop the entry to a full re-parse, and a byte-exact SEAM check guards the offset before any tail is
 * trusted.
 */
const SEAM_BYTES = 256;
const ROLLOUT_CACHE = new Map();   // file -> { ino, mtimeMs, size, offset, seam, fragment, acc }

function readBytes(file, from, to) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(to - from);
    let got = 0;
    while (got < buf.length) {
      const n = fs.readSync(fd, buf, got, buf.length - got, from + got);
      if (n === 0) break;
      got += n;
    }
    return buf.slice(0, got);
  } finally { try { fs.closeSync(fd); } catch { /* the read is what mattered */ } }
}

/* The settled running fields plus the trailing half-written line for `file`, or null if it cannot be
   stat'd/read. The fragment is NOT folded into the cached acc (a line completed later must re-fold from
   its first byte), so read() folds it into its own copy for the answer -- the same pin #562 uses. */
function readRolloutFields(file) {
  let st;
  try { st = fs.statSync(file); } catch { ROLLOUT_CACHE.delete(file); return null; }
  let cache = ROLLOUT_CACHE.get(file) || null;
  if (cache && (cache.ino !== st.ino || st.size < cache.offset
    || (st.size === cache.size && st.mtimeMs !== cache.mtimeMs))) {
    cache = null;
  }
  try {
    if (cache && cache.offset > 0 && (st.size !== cache.size || st.mtimeMs !== cache.mtimeMs)) {
      /* The seam proof, as BYTES not decoded text (a multibyte char across the boundary decodes
         differently from either side): the bytes just before the offset must still be the parsed ones. */
      const seamAt = Math.max(0, cache.offset - SEAM_BYTES);
      if (!readBytes(file, seamAt, cache.offset).equals(cache.seam)) cache = null;
    }
    if (!cache) {
      cache = { ino: st.ino, mtimeMs: 0, size: -1, offset: 0, seam: Buffer.alloc(0), fragment: '', acc: freshAcc() };
    }
    if (st.size !== cache.size || st.mtimeMs !== cache.mtimeMs) {
      const tailBuf = readBytes(file, cache.offset, st.size);
      const tail = tailBuf.toString('utf8');
      const lastNl = tail.lastIndexOf('\n');
      const settled = tail.slice(0, lastNl + 1);
      const settledBytes = Buffer.byteLength(settled, 'utf8');
      foldLines(cache.acc, settled);
      cache.offset += settledBytes;
      cache.fragment = lastNl + 1 < tail.length ? tail.slice(lastNl + 1) : '';
      cache.seam = Buffer.concat([cache.seam, tailBuf.slice(0, settledBytes)]).slice(-SEAM_BYTES);
      cache.size = st.size;
      cache.mtimeMs = st.mtimeMs;
    }
  } catch { ROLLOUT_CACHE.delete(file); return null; }
  ROLLOUT_CACHE.set(file, cache);
  return { acc: cache.acc, fragment: cache.fragment };
}

/**
 * What the board needs from a Codex session.
 *
 * ⚠️ EVERY FIELD IS null WHEN UNKNOWN, never a default. A model of "unknown"
 * and a context window of 0 would each render as a fact somebody could act on.
 *
 * #5054: ALWAYS reflects the current file (no result-level staleness) -- it folds only the appended
 * bytes since the last read via the per-file cache, and forWorkdir uses a cached head (metaOf) so it no
 * longer re-reads 64 KB of every rollout each call. A result memo was tried and dropped: it made read()
 * up to its TTL stale, which the status callers and their tests rely on NOT being.
 */
function read(dir, home) {
  const found = forWorkdir(dir, home);
  if (!found) return { found: false, because: NO_READING.NO_TRANSCRIPT };
  const fields = readRolloutFields(found.file);
  if (!fields) return { found: false, because: NO_READING.UNREADABLE };

  /* The settled fields are cached; fold the trailing fragment into a COPY for THIS answer, when it is a
     whole line (the old reader accepted a valid unterminated last line). Never into the cached acc. */
  const acc = { ...fields.acc };
  if (fields.fragment && fields.fragment.trim()) {
    let row;
    try { row = JSON.parse(fields.fragment); } catch { row = null; }
    if (row) foldRow(acc, row);
  }

  return {
    found: true,
    file: found.file,
    sessionId: found.meta.session_id || null,
    provider: found.meta.model_provider || null,
    model: acc.model,   // #4416: null until a turn_context names one
    cliVersion: found.meta.cli_version || null,
    contextWindow: acc.contextWindow,
    /* #2257: no longer deliberately null -- the last `token_count` event's
       `last_token_usage.input_tokens` is the measured window occupancy (see foldRow's
       note). Null only when no completed turn has reported usage yet. */
    contextUsed: acc.contextUsed,
    /* #2413: the epoch-ms timestamp of the `token_count` that set contextUsed -- WHEN
       the last real turn completed. The OpenAI liveness overlay uses it as the
       freshness anchor for a witnessed `ok`. Null when no completed turn, or when the
       completing row carried no parseable timestamp. */
    contextUsedAt: acc.contextUsedAt,
    messages: acc.messages,
    lastAt: acc.lastAt,
    lastAgentMessage: acc.lastAgentMessage,
  };
}

/* Test seam (#5054): clear the caches so a test reads a rollout fresh from zero. */
function _resetForTests() { ROLLOUT_CACHE.clear(); META_CACHE.clear(); }

module.exports = { read, forWorkdir, rollouts, metaOf, SESSIONS, _resetForTests };
