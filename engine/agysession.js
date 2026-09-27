'use strict';

/**
 * #4039 / #4043: read an Antigravity (agy) agent's conversation, the way geminisession.js reads a
 * Gemini CLI session, so the board can draw its context ring (and, later, tell its liveness).
 *
 * 📌 WHERE AGY KEEPS IT (measured 2026-09-26 on Agent1s, agy from the 09-25 spike):
 *   <HOME()>/cache/last_conversations.json   a flat map { "<resolved workdir>": "<conversation id>" }
 *   <HOME()>/conversations/<id>.db           one SQLite file per conversation
 * with HOME() = ~/.gemini/antigravity-cli. In each db, `gen_metadata` holds one protobuf blob per
 * model generation. There is no published schema; the fields below were read raw and checked:
 *   1.19      the model id, e.g. "gemini-3.8-flash"
 *   1.4       the usage message:  1.4.2 prompt tokens, 1.4.9 reply tokens, 1.4.10 thought tokens,
 *             1.4.3 their output total. Check that held in every captured generation:
 *             1.4.3 === 1.4.9 + 1.4.10, the shape of Gemini's own usage metadata.
 * ⚠️ The mapping is inferred from short sign-in-check conversations, not documented. Every field
 * is optional here: a blob without the usage message reads as "no reading", never as 0.
 * ⚠️ agy does NOT record the model's window. An earlier reading took 3.13.2.22 (1048576) for it;
 * 3.13.2 is an edit tool's config and 1048576 is a 1 MiB byte limit (review, #4039 iteration 1).
 * The window comes from status.js's table of known Gemini windows instead, marked as assumed.
 *
 * 🔒 READ-ONLY OPEN. The db is agy's live file, opened with `readOnly: true`: nothing in it is
 * changed and no write lock is taken. ⚠️ agy's dbs are in WAL mode, and ANY SQLite reader of a WAL
 * db creates the `-wal`/`-shm` companion files beside it if they are absent (measured: a read-only
 * open of a copy left an empty -wal and a 32 KB -shm). They are SQLite's own shared-memory files,
 * the same ones agy makes while it runs; the db's bytes are untouched. A busy or unreadable file is
 * "cannot read", never retried in a loop. Only the newest generations are read (NEWEST_GENS).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NO_READING } = require('./status');

/** agy's storage dir. Overridable so tests never read the operator's real agy home. */
const HOME = () => process.env.AGENT_WORKFORCE_AGY_HOME || path.join(os.homedir(), '.gemini', 'antigravity-cli');

/* The field paths above, as data, so a later agy that moves one changes one line. */
const FIELD = {
  MODEL: [1, 19],
  USAGE: [1, 4],
  PROMPT_TOKENS: 2,
  REPLY_TOKENS: 9,
};
/* How many of the newest generations one read decodes: enough to find the newest that reported
   usage and named its model, without re-reading a long conversation (blobs run to ~80 KB) on every
   status poll. */
const NEWEST_GENS = 20;

/* ---- protobuf, raw: enough to walk length-delimited messages and read varints ---- */
/* A varint of up to 10 bytes (protobuf's longest: a negative int64 is 10). `value` is null when it
   is too large to hold exactly (past 2^53), so a caller treats that one field as absent while the
   rest of the message still reads; null for the whole read only when the bytes end mid-varint.
   agy does write int64 -1 (as 10 bytes) in fields beside the ones read here. */
function readVarint(buf, at) {
  let value = 0;
  let scale = 1;
  let i = at;
  for (let n = 0; n < 10; n += 1) {
    if (i >= buf.length) return null;
    const byte = buf[i++];
    value += (byte & 0x7f) * scale;
    if (!(byte & 0x80)) return { value: Number.isSafeInteger(value) ? value : null, next: i };
    scale *= 128;
  }
  return null;
}

/** The fields of one protobuf message: field number -> list of { wire, value | bytes }. */
function fieldsOf(buf) {
  const out = new Map();
  let i = 0;
  while (i < buf.length) {
    const key = readVarint(buf, i);
    if (!key || !key.value) return null;
    i = key.next;
    const field = Math.floor(key.value / 8);
    const wire = key.value % 8;
    let entry;
    if (wire === 0) {
      const v = readVarint(buf, i);
      if (!v) return null;
      entry = { wire, value: v.value };
      i = v.next;
    } else if (wire === 2) {
      const n = readVarint(buf, i);
      if (!n || n.value === null || n.next + n.value > buf.length) return null;
      entry = { wire, bytes: buf.subarray(n.next, n.next + n.value) };
      i = n.next + n.value;
    } else if (wire === 1) { i += 8; continue; } else if (wire === 5) { i += 4; continue; } else return null;
    if (!out.has(field)) out.set(field, []);
    out.get(field).push(entry);
  }
  return out;
}

/** The first sub-message at a path of field numbers, or null. */
function messageAt(buf, fieldPath) {
  let cur = buf;
  for (const f of fieldPath) {
    const fields = fieldsOf(cur);
    const hit = fields && (fields.get(f) || []).find((e) => e.wire === 2);
    if (!hit) return null;
    cur = hit.bytes;
  }
  return cur;
}

/** A varint at a path (the last number is the varint's own field), or null. */
function numberAt(buf, fieldPath) {
  const parent = fieldPath.length > 1 ? messageAt(buf, fieldPath.slice(0, -1)) : buf;
  if (!parent) return null;
  const fields = fieldsOf(parent);
  const hit = fields && (fields.get(fieldPath[fieldPath.length - 1]) || []).find((e) => e.wire === 0);
  return hit && hit.value !== null ? hit.value : null;
}

/** One generation's reading: { model, prompt, reply }, each null when absent. */
function decodeGeneration(blob) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob || []);
  const modelBytes = messageAt(buf, FIELD.MODEL);
  const model = modelBytes && /^[\w.-]{1,80}$/.test(modelBytes.toString('utf8')) ? modelBytes.toString('utf8') : null;
  const usage = messageAt(buf, FIELD.USAGE);
  const prompt = usage ? numberAt(usage, [FIELD.PROMPT_TOKENS]) : null;
  const reply = usage ? numberAt(usage, [FIELD.REPLY_TOKENS]) : null;
  return { model, prompt, reply };
}

/** The conversation id agy recorded for a workdir, trying the path as given and resolved. */
function conversationFor(dir, home = HOME()) {
  let map;
  try { map = JSON.parse(fs.readFileSync(path.join(home, 'cache', 'last_conversations.json'), 'utf8')); } catch { return null; }
  if (!map || typeof map !== 'object') return null;
  const tries = [dir];
  try { tries.push(fs.realpathSync(dir)); } catch { /* a folder that is gone matches only as given */ }
  for (const d of tries) {
    const id = map[d];
    if (typeof id === 'string' && /^[0-9a-f-]{8,64}$/i.test(id)) return id;
  }
  return null;
}

/**
 * Read a workdir's agy conversation. The contract is geminisession.read's, so the status arm can
 * map it the same way: { found, file, sessionId, provider, contextWindow, contextUsed, messages,
 * lastAt, model } or { found: false, because }.
 */
function read(dir, home = HOME()) {
  const id = conversationFor(dir, home);
  if (!id) return { found: false, because: NO_READING.NO_TRANSCRIPT };
  const file = path.join(home, 'conversations', id + '.db');
  if (!fs.existsSync(file)) return { found: false, because: NO_READING.NO_TRANSCRIPT };
  let rows;
  let total = 0;
  let db = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(file, { readOnly: true });
    rows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx DESC LIMIT ?').all(NEWEST_GENS);
    // The generation count for `messages`: a COUNT is cheap next to decoding, and not LIMIT-bounded.
    total = db.prepare('SELECT count(*) AS n FROM gen_metadata').get().n;
  } catch {
    return { found: false, because: NO_READING.UNREADABLE };
  } finally {
    try { if (db) db.close(); } catch { /* already closed */ }
  }

  /* Newest first: the model is the newest generation's that names one, and the occupancy is the
     newest generation's PROMPT tokens: the whole conversation as last sent. That is the same fact
     the Codex reader (last_token_usage.input_tokens) and the Gemini CLI reader (tokens.input) use,
     so the three rings mean the same thing (review, #4039 iteration 2). */
  let model = null;
  let contextUsed = null;
  for (const row of rows) {
    const g = decodeGeneration(row.data);
    if (model === null && g.model) model = g.model;
    if (contextUsed === null && g.prompt !== null) contextUsed = g.prompt;
    if (model !== null && contextUsed !== null) break;
  }
  let lastAt = null;
  try { lastAt = new Date(fs.statSync(file).mtimeMs).toISOString(); } catch { /* keep null */ }
  return {
    found: true,
    file,
    sessionId: id,
    provider: 'antigravity',
    cliVersion: null,
    contextWindow: null, // agy records none; status.js assumes the model's (see the header)
    contextUsed,
    contextUsedAt: null,
    messages: total,
    lastAt,
    lastAgentMessage: null,
    model,
  };
}

module.exports = { HOME, FIELD, NEWEST_GENS, decodeGeneration, conversationFor, read };
