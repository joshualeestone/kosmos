'use strict';

/**
 * #5158: token usage for the providers that are not Claude (Codex, Gemini CLI, Grok, Antigravity), in the SAME shape as
 * usage.js's Claude scan: `{ days: { [day]: { [model]: buckets } }, folders: { [day]: { [launchCwd]: buckets } } }`,
 * so the per-day, per-model and per-agent views take them without a second code path.
 *
 * Each provider's session reader (codexsession, geminisession, groksession) answers "how full is the context window
 * right now"; none adds usage up. This module does, from the same files, and only reads them.
 *
 * ⚠️ FOUR BUCKETS, NEVER BLENDED, exactly as usage.js. Reasoning / thinking tokens are counted as OUTPUT, which is how
 * all three providers bill them; measured on this fleet 2026-10-03:
 *   - Codex `total_token_usage.total_tokens` = input + output, with `reasoning_output_tokens` inside output;
 *   - Grok `totalTokens` = input + output, with `reasoningTokens` inside output;
 *   - Gemini `tokens.total` = input + output + thoughts + tool, so thoughts are ADDED to output and tool to input.
 * Each provider's `input` includes its cached reads (Codex: codexsession says so; Grok: total = in + out; Gemini: the
 * API's prompt count includes cached content, unmeasured locally because every sample had cached 0), so the cached
 * part is moved OUT of input into cache_read, as Claude's own transcript reports it.
 *
 * 🛑 COUNTED ONCE. Each provider repeats itself differently, so each has its own once-only key:
 *   - Codex writes a running session total; a `token_count` event can repeat the previous total unchanged. The change
 *     in the total between events is what is counted, so a repeat adds 0. A total that goes DOWN starts a new run
 *     (a reset), counted from that event's own total.
 *   - Gemini writes a reply more than once (a bare line and a `$set` of messages): de-duplicated by message id across
 *     the whole scan.
 *   - Grok writes each turn once in usage.json: keyed by sessionId + turnNumber.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const BUCKET_FIELDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
function emptyBuckets() {
  return { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 0 };
}
const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);

function utcDay(ts) {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/* Every folder a provider's sessions can live under: its default home plus every account folder by NAME (`.codex-*`,
   `.removed-codex-*`, ...), found by listing the home directory. Not the account modules' list(): that drops an account
   with no sign-in left, and a forgotten one, whose agents' past usage still happened (review 1). Deduped by real path, so
   a linked folder is not read twice. Never throws. */
function homesByPrefix(homeDir, defaultDir, prefixes, storage = (d) => d, problems = null) {
  const out = [];
  const seen = new Set();
  const add = (d) => {
    if (typeof d !== 'string' || !d) return;
    const s = path.resolve(storage(d));
    let key = s;
    try { key = fs.realpathSync(s); } catch { /* missing: keyed by its own path */ }
    if (!seen.has(key)) { seen.add(key); out.push(s); }
  };
  add(defaultDir);
  let names = [];
  try { names = fs.readdirSync(homeDir).sort(); }
  catch (err) { names = []; if (problems && err && err.code !== 'ENOENT') problems.push(err.code || 'readdir'); }
  for (const name of names) if (prefixes.some((pre) => name.startsWith(pre))) add(path.join(homeDir, name));
  return out;
}

/* All files under `dir` whose name matches `re`, recursively. Async, as usage.js's walk is, so the board keeps
   answering while a big history is read. */
async function walk(dir, re, out = [], acc = null) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (err) { if (acc && err && err.code !== 'ENOENT') acc.incomplete = true; return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, re, out, acc);
    else if (e.isFile() && re.test(e.name)) out.push(p);
  }
  return out;
}

/* A file last written before the first wanted day cannot hold a row on or after it (every row is stamped when it is
   written), so it is not read. This is what keeps the common call (only today missing) to the files touched today;
   NOT the Codex YYYY/MM/DD folders, which record the day a session started, and sessions run across days. */
async function touchedSince(file, sinceDay, acc = null) {
  if (!sinceDay) return true;
  try { return (await fsp.stat(file)).mtimeMs >= Date.parse(sinceDay + 'T00:00:00Z'); }
  catch (err) { if (acc && err && err.code !== 'ENOENT') acc.incomplete = true; return false; }
}

/* A file that cannot be read or parsed blocks freezing only while it is fresh (being written right now). One that has
   stayed bad (a zero-byte file from a crashed session, a permanent permission error) is skipped and said once, or it
   would keep every day in the window unfrozen and re-read on every request (review 2). */
const FRESH_MS = 10 * 60 * 1000;
async function badFile(acc, file, why, lastWriteMs = null) {
  let fresh = true;
  /* `lastWriteMs`: a caller that knows a later write than the file's own mtime (an Antigravity -wal) passes it. */
  try { fresh = Date.now() - Math.max((await fsp.stat(file)).mtimeMs, lastWriteMs || 0) < FRESH_MS; } catch { fresh = true; }
  if (fresh) acc.incomplete = true;
  else console.error('usage: skipping an unreadable ' + why + ': ' + file);
}

class Acc {
  constructor(sinceDay, untilDay) { this.days = {}; this.folders = {}; this.sinceDay = sinceDay; this.untilDay = untilDay; this.incomplete = false; this.codexSeen = new Set(); }
  inRange(day) { return day && !(this.sinceDay && day < this.sinceDay) && !(this.untilDay && day > this.untilDay); }
  add(day, model, folder, b) {
    if (!this.inRange(day)) return;
    if (!BUCKET_FIELDS.some((f) => b[f] > 0)) return;
    const m = model || 'unknown';
    if (!this.days[day]) this.days[day] = {};
    if (!this.days[day][m]) this.days[day][m] = emptyBuckets();
    if (!this.folders[day]) this.folders[day] = {};
    const fk = folder || '';
    if (!this.folders[day][fk]) this.folders[day][fk] = emptyBuckets();
    for (const into of [this.days[day][m], this.folders[day][fk]]) {
      for (const f of BUCKET_FIELDS) into[f] += b[f];
      into.rows += 1;
    }
  }
}

/* ---------- Codex: <home>/sessions/YYYY/MM/DD/rollout-*.jsonl ---------- */
async function scanCodex(acc, codexHomes) {
  for (const home of codexHomes) {
    /* `archived_sessions` too: archiving MOVES a rollout there, so its usage would otherwise drop out of every day not
       yet frozen. A moved file is never in both places, so nothing is counted twice. */
    const rollouts = [];
    for (const sub of ['sessions', 'archived_sessions']) await walk(path.join(home, sub), /^rollout-.*\.jsonl$/, rollouts, acc);
    for (const file of rollouts.sort()) {
      /* One session, one file name (`rollout-<ts>-<uuid>.jsonl`): a copy in both places, or a copied home, is read once. */
      const base = path.basename(file);
      if (acc.codexSeen.has(base)) continue;
      if (!(await touchedSince(file, acc.sinceDay, acc))) continue;
      let text;
      try { text = await fsp.readFile(file, 'utf8'); } catch { await badFile(acc, file, 'Codex session'); continue; }
      acc.codexSeen.add(base);   // only once read: a skipped or unreadable copy must not hide a fresh one (review 3)
      let cwd = '';
      let model = null;
      let prev = null;   // the previous running total in this file
      /* A FORKED rollout (session_meta.forked_from_id) begins with the parent's history replayed into it, its token totals
         included, so its first total is the parent's and was already counted in the parent's file. That first total is
         the baseline, not usage (review 1; no fork exists on this fleet to measure, so this is from Codex's design: the
         cost is the first turn after a fork going uncounted, rather than the whole parent counted twice). */
      let forked = false;
      let forkAt = NaN;   // when the fork was made: a replayed total is stamped at or before it
      let totals = 0;     // #5153: token totals seen so far in this file (a receipt skips a fork's replay by the same rule)
      for (const line of text.split('\n')) {
        if (!line) continue;
        let r;
        try { r = JSON.parse(line); } catch { continue; }
        const p = (r && r.payload) || {};
        if (r.type === 'session_meta') {
          if (!cwd && typeof p.cwd === 'string') cwd = p.cwd;
          if (p.forked_from_id) { forked = true; forkAt = Date.parse(p.timestamp || r.timestamp); }
        }
        if (r.type === 'turn_context' && typeof p.model === 'string') model = p.model;
        if (acc.onRow) acc.onRow('codex', r, file, cwd, { forked, forkAt, totals });   // #5153: tool calls, same pass
        if (p.type !== 'token_count' || !p.info || !p.info.total_token_usage) continue;
        totals += 1;
        const t = p.info.total_token_usage;
        const cur = { in: n(t.input_tokens), cached: n(t.cached_input_tokens), cw: n(t.cache_write_input_tokens), out: n(t.output_tokens) };
        /* The change since the last event; a total that went down is a new run, counted from its own total. */
        /* Every total replayed from the parent is a baseline: by time when the replay kept the parent's timestamps, and
           at least the first one when it did not (review 2: a fork can replay several totals, not one). */
        if (forked && (!prev || Date.parse(r.timestamp) <= forkAt)) { prev = cur; continue; }
        const reset = prev && (cur.in < prev.in || cur.out < prev.out || cur.cached < prev.cached || cur.cw < prev.cw);
        const base = prev && !reset ? prev : { in: 0, cached: 0, cw: 0, out: 0 };
        const d = { in: cur.in - base.in, cached: cur.cached - base.cached, cw: cur.cw - base.cw, out: cur.out - base.out };
        prev = cur;
        acc.add(utcDay(r.timestamp), model, cwd, {
          input_tokens: Math.max(0, d.in - d.cached - d.cw),
          output_tokens: d.out,
          cache_creation_input_tokens: d.cw,
          cache_read_input_tokens: d.cached,
        }, r.timestamp);   // #5153: the row's own time, for a receipt
      }
    }
  }
}

/* ---------- Gemini CLI: <storage home>/tmp/<slug>/chats/session-*.jsonl ---------- */
/* A session whose folder has no readable `.project_root` keeps its tokens under the folder '' ("elsewhere" on the
   per-agent split): counted in every total, just not given to an agent. */
async function geminiProjectRoot(slugDir, acc = null) {
  try { return (await fsp.readFile(path.join(slugDir, '.project_root'), 'utf8')).split('\n')[0].trim(); }
  catch (err) { if (acc && err && err.code !== 'ENOENT') acc.incomplete = true; return ''; }
}
async function scanGemini(acc, geminiHomes) {
  const seen = new Set();
  for (const home of geminiHomes) {
    let slugs;
    try { slugs = (await fsp.readdir(path.join(home, 'tmp'), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort(); }
    catch (err) { if (err && err.code !== 'ENOENT') acc.incomplete = true; continue; }
    for (const slug of slugs) {
      const slugDir = path.join(home, 'tmp', slug);
      const cwd = await geminiProjectRoot(slugDir, acc);
      for (const file of (await walk(path.join(slugDir, 'chats'), /^session-.*\.jsonl$/, [], acc)).sort()) {
        if (!(await touchedSince(file, acc.sinceDay, acc))) continue;
        let text;
        try { text = await fsp.readFile(file, 'utf8'); } catch { await badFile(acc, file, 'Gemini session'); continue; }
        /* A reply can carry tokens but no model (measured: one on this fleet, 2026-09-28). It takes the model the same
           session names elsewhere, so it is not filed as "unknown" while the answer is in the file. */
        const fileModel = (text.match(/"model"\s*:\s*"(gemini[^"]*)"/) || [])[1] || null;
        for (const line of text.split('\n')) {
          if (!line) continue;
          let r;
          try { r = JSON.parse(line); } catch { continue; }
          const msgs = r && r.type === 'gemini' ? [r]
            : (r && r.$set && Array.isArray(r.$set.messages) ? r.$set.messages.filter((m) => m && m.type === 'gemini') : []);
          for (const m of msgs) {
            if (acc.onRow) acc.onRow('gemini', m, file, cwd);   // #5153: a receipt reads the tool calls in the same pass
            const t = m.tokens;
            if (!t || typeof t !== 'object') continue;
            /* A message with no id cannot be de-duplicated and is still counted (dropping it would be a silent
               undercount), as usage.js does for Claude. */
            /* Only replies are keyed: their ids are uuids, unique across sessions (measured, 32 of 32). User-message ids
               are content hashes shared across sessions, so widening this to every message type would drop real rows. */
            if (m.id) { if (seen.has(m.id)) continue; seen.add(m.id); }
            acc.add(utcDay(m.timestamp), m.model || fileModel, cwd, {
              input_tokens: Math.max(0, n(t.input) - n(t.cached)) + n(t.tool),
              output_tokens: n(t.output) + n(t.thoughts),
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: n(t.cached),
            }, m.timestamp);
          }
        }
      }
    }
  }
}

/* ---------- Grok: <home>/sessions/<url-encoded cwd>/<sessionId>/usage.json ---------- */
function grokCwd(encoded) {
  try { return decodeURIComponent(encoded); } catch { return ''; }
}
async function scanGrok(acc, grokHomes) {
  const seen = new Set();
  for (const home of grokHomes) {
    const root = path.join(home, 'sessions');
    for (const file of (await walk(root, /^usage\.json$/, [], acc)).sort()) {
      /* Only <sessions>/<encoded cwd>/<session id>/usage.json: a deeper one would take its cwd from the wrong folder. */
      if (path.relative(root, file).split(path.sep).length !== 3) continue;
      if (!(await touchedSince(file, acc.sinceDay, acc))) continue;
      let d;
      try { d = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { await badFile(acc, file, 'Grok usage file'); continue; }
      if (!d || !Array.isArray(d.turns)) continue;
      const sessionDir = path.dirname(file);
      const sid = String(d.sessionId || path.basename(sessionDir));
      const cwd = grokCwd(path.basename(path.dirname(sessionDir)));
      for (const [i, t] of d.turns.entries()) {
        if (!t || typeof t !== 'object') continue;
        const key = sid + '\0' + String(t.turnNumber != null ? t.turnNumber : '#' + i);
        if (seen.has(key)) continue;
        seen.add(key);
        const day = utcDay(t.endedAt || d.updatedAt);
        /* Per model when the turn says how it split; else the turn's primary model. */
        const parts = t.modelUsage && typeof t.modelUsage === 'object' && Object.keys(t.modelUsage).length
          ? Object.entries(t.modelUsage) : [[t.primaryModelId, t]];
        for (const [model, u] of parts) {
          if (!u || typeof u !== 'object') continue;
          /* inputTokens includes the cached reads (total = input + output, measured). That it also includes the cache
             writes is assumed: every sample on this fleet had cacheCreationTokens 0. */
          acc.add(day, model, cwd, {
            input_tokens: Math.max(0, n(u.inputTokens) - n(u.cachedReadTokens) - n(u.cacheCreationTokens)),
            output_tokens: n(u.outputTokens),
            cache_creation_input_tokens: n(u.cacheCreationTokens),
            cache_read_input_tokens: n(u.cachedReadTokens),
          }, t.endedAt || d.updatedAt);
        }
      }
    }
  }
}

/* ---------- Antigravity: <agy home>/conversations/<id>.db (SQLite, one per conversation) ---------- */
/* Read raw and checked on 25 conversations (109 model calls) on this Mac, 2026-10-03; agysession.js has the field map.
   A model call (`gen_metadata`, one protobuf per call, keyed by idx) carries NO time. Its time is on the STEP the call
   produced: `steps.metadata` 1.1 is a protobuf Timestamp's seconds, and the step of type 15 carries the call's idx at
   20.3 (absent = 0). The folder is `trajectory_metadata_blob` 1.1, a file:// URI (`last_conversations.json` names only
   a folder's latest conversation, so it cannot place older ones). */
const AGY_STEP = { CALL_TYPE: 15, TIME: [1, 1], CALL_IDX: [20, 3] };
const AGY_WORKSPACE = [[1, 1], [7]];

/* The calls already decoded, per conversation file (review 1: today is never frozen, and decoding every call blob of a
   long conversation on every request held the board up). Each read lists every call's idx and size (no blobs) and
   decodes only a call that is new or changed size; a call no longer in the file is dropped. So a call committed late
   below others, or rewritten, reads exactly as a cold read would (review 2). `size` is agy's own byte length of the
   blob (equal to it in 109 of 109 calls measured). Steps are small and are read in full every time, so a step's time
   is never cached. Keyed by the file's inode and creation time, so a replaced file starts over; a file gone from the
   folder is forgotten. */
const agyCache = new Map();

function agyWorkspace(agy, blob) {
  if (!blob) return '';
  const buf = Buffer.from(blob);
  for (const at of AGY_WORKSPACE) {
    const b = agy.messageAt(buf, at);
    const s = b ? b.toString('utf8') : '';
    if (s.startsWith('file://')) { try { return require('node:url').fileURLToPath(s); } catch { /* not a file path */ } }
  }
  return '';
}

/* A table agy has not written is absent (the call still counts); any other error (busy, corrupt) is not, so the scan is
   not marked complete over a wrong day or folder (review 1). */
function unlessAbsent(read, absentValue) {
  try { return read(); } catch (err) { if (/no such table/i.test(String(err && err.message))) return absentValue; throw err; }
}

async function scanAntigravity(acc, agyHomes) {
  const agy = require('./agysession');
  const since = acc.sinceDay ? Date.parse(acc.sinceDay + 'T00:00:00Z') : -Infinity;
  const seenFiles = new Set();
  const listedHomes = [];
  for (const home of agyHomes) {
    let files;
    try { files = (await fsp.readdir(path.join(home, 'conversations'))).filter((f) => /^[0-9a-f-]{8,64}\.db$/i.test(f)).sort(); }
    catch (err) { if (err && err.code !== 'ENOENT') acc.incomplete = true; continue; }
    listedHomes.push(path.join(home, 'conversations') + path.sep);
    for (const name of files) {
      const file = path.join(home, 'conversations', name);
      seenFiles.add(file);
      /* Both stats BEFORE opening: opening a WAL db makes an empty -wal beside it, and an EMPTY -wal is not a write
         (agysession.js). agy commits into a -wal that holds bytes and leaves the db's own mtime alone. */
      let st;
      try { st = await fsp.stat(file); } catch (err) { if (err && err.code !== 'ENOENT') acc.incomplete = true; continue; }
      let walMs = 0;
      try { const w = await fsp.stat(file + '-wal'); if (w.size > 0) walMs = w.mtimeMs; }
      catch (err) { if (err && err.code !== 'ENOENT') { acc.incomplete = true; walMs = Date.now(); } }   // unknown: read it
      if (Math.max(st.mtimeMs, walMs) < since) continue;
      /* A call with no dated step takes the day the conversation file was CREATED (its mtime where the filesystem keeps
         no creation time): fixed for the file's life, so a call's day never moves after its day is frozen (review 1).
         It is never later than the call; at worst it is the conversation's first day. Where the filesystem keeps no
         creation time the mtime moves with every write, so an undated call there is shown but never frozen (review 3). */
      const hasBirth = st.birthtimeMs > 0;
      const born = hasBirth ? st.birthtimeMs : st.mtimeMs;
      const key = st.ino + ':' + born;
      const c = agyCache.get(file) && agyCache.get(file).key === key ? agyCache.get(file) : { key, cwd: '', calls: new Map() };
      let listed;
      const decoded = new Map();
      let steps;
      let meta = null;
      let db = null;
      try {
        const { DatabaseSync } = require('node:sqlite');
        db = new DatabaseSync(file, { readOnly: true });   // agy's live file: read-only, no write lock (agysession.js)
        db.exec('BEGIN');   // one snapshot for the three reads
        listed = db.prepare('SELECT idx, size FROM gen_metadata ORDER BY idx').all();
        const one = db.prepare('SELECT data FROM gen_metadata WHERE idx = ?');
        const newest = listed.length ? listed[listed.length - 1].idx : null;
        for (const { idx, size } of listed) {
          const had = c.calls.get(idx);
          /* The newest call is decoded every time: it is the one agy may still be writing. An older call rewritten in
             place at exactly the same byte length is the one change this cannot see (none measured; agy writes a call
             when it completes). */
          if (!had || had.size !== size || idx === newest) decoded.set(idx, { size, usage: agy.generationUsage((one.get(idx) || {}).data) });
        }
        steps = unlessAbsent(() => db.prepare('SELECT step_type, metadata FROM steps ORDER BY idx').all(), []);
        if (!c.cwd) meta = unlessAbsent(() => db.prepare("SELECT data FROM trajectory_metadata_blob WHERE id = 'main'").get(), null);
        db.exec('COMMIT');
      } catch {
        await badFile(acc, file, 'Antigravity conversation', walMs);   // busy mid-write: the -wal is the write (review 3)
        continue;
      } finally {
        try { if (db) db.close(); } catch { /* already closed */ }
      }
      if (!c.cwd) c.cwd = agyWorkspace(agy, meta && meta.data);
      /* A call's time: its type-15 step's, else the earliest step naming its idx at 20.3. A step with no 20.3 names no
         call except through type 15 (where absent means 0, proto3). */
      const byCall = new Map();
      const anyStep = new Map();
      for (const s of steps) {
        const m = Buffer.from(s.metadata || []);
        const secs = agy.numberAt(m, AGY_STEP.TIME);
        if (!secs) continue;
        const named = agy.numberAt(m, AGY_STEP.CALL_IDX);
        const into = (map, idx) => { if (!map.has(idx) || secs < map.get(idx)) map.set(idx, secs); };
        if (s.step_type === AGY_STEP.CALL_TYPE) into(byCall, named || 0);
        if (named !== null) into(anyStep, named);
      }
      const present = new Set(listed.map((r) => r.idx));
      for (const idx of [...c.calls.keys()]) if (!present.has(idx)) c.calls.delete(idx);
      for (const [idx, v] of decoded) c.calls.set(idx, v);
      agyCache.set(file, c);
      seenFiles.add(file);
      const recent = Date.now() - Math.max(st.mtimeMs, walMs) < FRESH_MS;
      for (const [idx, { usage: u }] of c.calls) {
        /* A failed call has no usage, or a usage message with no tokens in it (measured: 1 of 109, its steps of type 17
           and none of type 15): nothing to count, and nothing to date. */
        if (!u.found || !(u.uncached || u.cached || u.reply || u.thoughts)) continue;
        const secs = byCall.get(idx) || anyStep.get(idx);
        /* A call whose step is not written yet would be filed on the fallback day and move once its step lands: while
           the conversation is being written, such a scan is shown but not frozen (review 2). */
        if (!secs && (recent || !hasBirth)) acc.incomplete = true;
        acc.add(utcDay(new Date(secs ? secs * 1000 : born).toISOString()), u.model, c.cwd, {
          input_tokens: u.uncached,
          output_tokens: u.reply + u.thoughts,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: u.cached,
        });
      }
      await new Promise((resolve) => setImmediate(resolve));   // let the board answer between conversations
    }
  }
  /* A conversation deleted from a folder that was listed is forgotten (one skipped by date is kept). */
  for (const file of [...agyCache.keys()]) {
    if (!seenFiles.has(file) && listedHomes.some((h) => file.startsWith(h))) agyCache.delete(file);
  }
}

/* The homes each provider's sessions live under. Lazy requires, so this module loads without the account modules
   (and a test can pass its own homes). */
function defaultHomes(problems = []) {
  const openai = require('./openaiaccounts');
  const gemini = require('./geminiaccounts');
  const grok = require('./grokaccounts');
  const home = process.env.AGENT_WORKFORCE_HOME || require('node:os').homedir();
  const geminiDefault = path.resolve(gemini.defaultDir());
  return {
    codex: homesByPrefix(home, require('./codexupdate').defaultHome(), ['.codex-', openai.FORGOTTEN_PREFIX], undefined, problems),
    /* The Gemini CLI keeps its data in a `.gemini` folder BELOW a per-account home (create.js geminiStorageHome); the
       default home already is that folder. */
    gemini: homesByPrefix(home, geminiDefault, [gemini.DIR_PREFIX, gemini.FORGOTTEN_PREFIX],
      (d) => (path.resolve(d) === geminiDefault ? d : path.join(d, '.gemini')), problems),
    grok: homesByPrefix(home, grok.defaultDir(), [grok.DIR_PREFIX, grok.FORGOTTEN_PREFIX], undefined, problems),
    /* agy keeps one home (no per-account folders): agytrust.agyHome, the one derivation a sandbox moves. */
    antigravity: [require('./agytrust').agyHome()],
  };
}

/**
 * Codex, Gemini CLI, Grok and Antigravity usage between sinceDay and untilDay (UTC, inclusive), as usage.js's scan returns it.
 * `opts.homes` = { codex: [...], gemini: [...], grok: [...], antigravity: [...] } overrides discovery (tests). Never throws.
 */
async function scanProviders({ sinceDay, untilDay, homes: h } = {}) {
  const acc = new Acc(sinceDay, untilDay);
  let hs = h;
  if (!hs) {
    const problems = [];
    try { hs = defaultHomes(problems); } catch { hs = { codex: [], gemini: [], grok: [], antigravity: [] }; acc.incomplete = true; }
    if (problems.length) acc.incomplete = true;   // a home directory that could not be listed: do not freeze zeros
  }
  try { await scanCodex(acc, hs.codex || []); } catch { acc.incomplete = true; }   // one provider failing keeps the others
  try { await scanGemini(acc, hs.gemini || []); } catch { acc.incomplete = true; }
  try { await scanGrok(acc, hs.grok || []); } catch { acc.incomplete = true; }
  try { await scanAntigravity(acc, hs.antigravity || []); } catch { acc.incomplete = true; }
  /* `complete: false` when anything could not be read: the caller shows these numbers but must not FREEZE them, or a
     passing error on the first read after an update would fix a past day's provider usage at zero forever (review 1). */
  return { days: acc.days, folders: acc.folders, homesRead: hs, complete: !acc.incomplete };
}

/* #5153: the readers and their accumulator, so a task's receipt counts tokens by exactly these rules, from an accumulator
   of its own (its add() takes the row's time as a fifth argument) and an optional onRow(provider, row, file, folder). */
module.exports = { scanProviders, defaultHomes, homesByPrefix, BUCKET_FIELDS, Acc, scanCodex, scanGemini, _agyCache: agyCache }; // _agyCache: tests only
