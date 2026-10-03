'use strict';

/**
 * #5158: token usage for the providers that are not Claude (Codex, Gemini CLI, Grok), in the SAME shape as
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

/* Every directory (deduped, resolved) a provider's sessions can live under: the account module's own list (the default
   home included) plus the default home itself, in case the list drops a home with no sign-in left. Never throws. */
function homes(listFn, defaultFn, storage = (d) => d) {
  const out = [];
  const seen = new Set();
  const add = (d) => {
    if (typeof d !== 'string' || !d) return;
    const s = path.resolve(storage(d));
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  };
  try { for (const r of listFn() || []) add(r && r.dir); } catch { /* no accounts: the default below */ }
  try { add(defaultFn()); } catch { /* no default either */ }
  return out;
}

/* All files under `dir` whose name matches `re`, recursively. Async, as usage.js's walk is, so the board keeps
   answering while a big history is read. */
async function walk(dir, re, out = []) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, re, out);
    else if (e.isFile() && re.test(e.name)) out.push(p);
  }
  return out;
}

class Acc {
  constructor(sinceDay, untilDay) { this.days = {}; this.folders = {}; this.sinceDay = sinceDay; this.untilDay = untilDay; }
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
    for (const file of (await walk(path.join(home, 'sessions'), /^rollout-.*\.jsonl$/)).sort()) {
      let text;
      try { text = await fsp.readFile(file, 'utf8'); } catch { continue; }
      let cwd = '';
      let model = null;
      let prev = null;   // the previous running total in this file
      for (const line of text.split('\n')) {
        if (!line) continue;
        let r;
        try { r = JSON.parse(line); } catch { continue; }
        const p = (r && r.payload) || {};
        if (r.type === 'session_meta' && !cwd && typeof p.cwd === 'string') cwd = p.cwd;
        if (r.type === 'turn_context' && typeof p.model === 'string') model = p.model;
        if (p.type !== 'token_count' || !p.info || !p.info.total_token_usage) continue;
        const t = p.info.total_token_usage;
        const cur = { in: n(t.input_tokens), cached: n(t.cached_input_tokens), cw: n(t.cache_write_input_tokens), out: n(t.output_tokens) };
        /* The change since the last event; a total that went down is a new run, counted from its own total. */
        const reset = prev && (cur.in < prev.in || cur.out < prev.out || cur.cached < prev.cached || cur.cw < prev.cw);
        const base = prev && !reset ? prev : { in: 0, cached: 0, cw: 0, out: 0 };
        const d = { in: cur.in - base.in, cached: cur.cached - base.cached, cw: cur.cw - base.cw, out: cur.out - base.out };
        prev = cur;
        acc.add(utcDay(r.timestamp), model, cwd, {
          input_tokens: Math.max(0, d.in - d.cached - d.cw),
          output_tokens: d.out,
          cache_creation_input_tokens: d.cw,
          cache_read_input_tokens: d.cached,
        });
      }
    }
  }
}

/* ---------- Gemini CLI: <storage home>/tmp/<slug>/chats/session-*.jsonl ---------- */
async function geminiProjectRoot(slugDir) {
  try { return (await fsp.readFile(path.join(slugDir, '.project_root'), 'utf8')).split('\n')[0].trim(); } catch { return ''; }
}
async function scanGemini(acc, geminiHomes) {
  const seen = new Set();
  for (const home of geminiHomes) {
    let slugs;
    try { slugs = (await fsp.readdir(path.join(home, 'tmp'), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort(); }
    catch { continue; }
    for (const slug of slugs) {
      const slugDir = path.join(home, 'tmp', slug);
      const cwd = await geminiProjectRoot(slugDir);
      for (const file of (await walk(path.join(slugDir, 'chats'), /^session-.*\.jsonl$/)).sort()) {
        let text;
        try { text = await fsp.readFile(file, 'utf8'); } catch { continue; }
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
            const t = m.tokens;
            if (!t || typeof t !== 'object') continue;
            /* A message with no id cannot be de-duplicated and is still counted (dropping it would be a silent
               undercount), as usage.js does for Claude. */
            if (m.id) { if (seen.has(m.id)) continue; seen.add(m.id); }
            acc.add(utcDay(m.timestamp), m.model || fileModel, cwd, {
              input_tokens: Math.max(0, n(t.input) - n(t.cached)) + n(t.tool),
              output_tokens: n(t.output) + n(t.thoughts),
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: n(t.cached),
            });
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
    for (const file of (await walk(path.join(home, 'sessions'), /^usage\.json$/)).sort()) {
      let d;
      try { d = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { continue; }
      if (!d || !Array.isArray(d.turns)) continue;
      const sessionDir = path.dirname(file);
      const sid = String(d.sessionId || path.basename(sessionDir));
      const cwd = grokCwd(path.basename(path.dirname(sessionDir)));
      for (const t of d.turns) {
        if (!t || typeof t !== 'object') continue;
        const key = sid + '\0' + String(t.turnNumber);
        if (seen.has(key)) continue;
        seen.add(key);
        const day = utcDay(t.endedAt || d.updatedAt);
        /* Per model when the turn says how it split; else the turn's primary model. */
        const parts = t.modelUsage && typeof t.modelUsage === 'object' && Object.keys(t.modelUsage).length
          ? Object.entries(t.modelUsage) : [[t.primaryModelId, t]];
        for (const [model, u] of parts) {
          if (!u || typeof u !== 'object') continue;
          acc.add(day, model, cwd, {
            input_tokens: Math.max(0, n(u.inputTokens) - n(u.cachedReadTokens) - n(u.cacheCreationTokens)),
            output_tokens: n(u.outputTokens),
            cache_creation_input_tokens: n(u.cacheCreationTokens),
            cache_read_input_tokens: n(u.cachedReadTokens),
          });
        }
      }
    }
  }
}

/* The homes each provider's sessions live under. Lazy requires, so this module loads without the account modules
   (and a test can pass its own homes). */
function defaultHomes() {
  const openai = require('./openaiaccounts');
  const gemini = require('./geminiaccounts');
  const grok = require('./grokaccounts');
  const codexDefault = () => require('./codexupdate').defaultHome();
  return {
    codex: homes(() => openai.list(), codexDefault),
    /* The Gemini CLI keeps its data in a `.gemini` folder BELOW a per-account home (create.js geminiStorageHome);
       the default home already is that folder. */
    gemini: (() => {
      const def = path.resolve(gemini.defaultDir());
      return homes(() => gemini.list(), () => def, (d) => (path.resolve(d) === def ? d : path.join(d, '.gemini')));
    })(),
    grok: homes(() => grok.list(), () => grok.defaultDir()),
  };
}

/**
 * Codex, Gemini CLI and Grok usage between sinceDay and untilDay (UTC, inclusive), as usage.js's scan returns it.
 * `opts.homes` = { codex: [...], gemini: [...], grok: [...] } overrides discovery (tests). Never throws.
 */
async function scanProviders({ sinceDay, untilDay, homes: h } = {}) {
  const acc = new Acc(sinceDay, untilDay);
  let hs = h;
  if (!hs) { try { hs = defaultHomes(); } catch { hs = { codex: [], gemini: [], grok: [] }; } }
  try { await scanCodex(acc, hs.codex || []); } catch { /* one provider failing does not lose the others */ }
  try { await scanGemini(acc, hs.gemini || []); } catch { /* as above */ }
  try { await scanGrok(acc, hs.grok || []); } catch { /* as above */ }
  return { days: acc.days, folders: acc.folders, homesRead: hs };
}

module.exports = { scanProviders, defaultHomes, BUCKET_FIELDS };
