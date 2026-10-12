'use strict';
/**
 * kosmos#5883 slice 3: Antigravity (agy) agents' conversations in the company backup.
 *
 * MEASURED 2026-10-11 on this Mac (agy at ~/.local/bin/agy; schema and column shapes only, no content opened):
 *   <agy home>/conversations/<id>.db   one SQLite file per conversation, in WAL mode (-wal, -shm beside it)
 *   <agy home>/conversation_summaries.db, table conversation_summaries: one row per conversation, with
 *     conversation_id and workspace_uris, a JSON list of file:// folder URIs. No plain column in a conversation db
 *     names its folder, and cache/last_conversations.json names only each folder's LAST conversation.
 *
 * stageAgy({ home, stageDir, agents: [{ dir, seg }] }) -> Promise<roots>
 *   A conversation is an agent's when one of its workspace URIs, as a path, canonicalized (trust.canonicalOnDisk, as
 *   every other reader), is the agent's folder. Each owned conversation is copied with node:sqlite's backup() into
 *   ONE shared staging folder: a consistent copy, never the live file's bytes (a raw copy of a WAL db can be torn).
 *   Each agent gets one root over the staging folder naming its own copies (sessions/<seg>/agy). A conversation two
 *   agents claim is ONE staged file named by two roots, which the snapshot drops from both and records as skipped.
 *   NOT taken: the summaries db (titles and previews of every agent's conversations), the token beside it.
 *   Never throws: a home, a summaries db or a conversation that cannot be read gives nothing for it.
 * clearStage(stageDir): removes the staging folder; called after every run, whatever happened.
 */
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const ID = /^[0-9A-Za-z][0-9A-Za-z_-]{0,127}$/;

function canonical(p) { try { return require('./trust').canonicalOnDisk(path.resolve(p)); } catch { return null; } }

/* Each conversation id with the canonical folders it names. */
function owned(home) {
  const out = [];
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(path.join(home, 'conversation_summaries.db'), { readOnly: true });
    for (const row of db.prepare('SELECT conversation_id, workspace_uris FROM conversation_summaries').all()) {
      if (typeof row.conversation_id !== 'string' || !ID.test(row.conversation_id)) continue;
      let uris;
      try { uris = JSON.parse(String(row.workspace_uris)); } catch { continue; }
      if (!Array.isArray(uris)) continue;
      const folders = [];
      for (const u of uris) {
        if (typeof u !== 'string' || !u.startsWith('file://')) continue;
        try { const c = canonical(fileURLToPath(u)); if (c) folders.push(c); } catch { /* not a file URL */ }
      }
      if (folders.length) out.push({ id: row.conversation_id, folders });
    }
  } catch { return []; }
  finally { try { if (db) db.close(); } catch { /* closed */ } }
  return out;
}

async function stageAgy(opts) {
  const o = opts || {};
  if (typeof o.home !== 'string' || !path.isAbsolute(o.home) || typeof o.stageDir !== 'string' || !path.isAbsolute(o.stageDir)) return [];
  const agents = (o.agents || []).map((a) => ({ seg: a.seg, canon: canonical(a.dir) })).filter((a) => a.canon && typeof a.seg === 'string');
  if (!agents.length) return [];
  const mine = new Map(agents.map((a) => [a.seg, []]));
  const conversations = path.join(o.home, 'conversations');
  for (const conv of owned(o.home)) {
    const owners = agents.filter((a) => conv.folders.includes(a.canon));
    if (!owners.length) continue;
    const src = path.join(conversations, `${conv.id}.db`);
    // A plain file only, never a link (it could point anywhere).
    let st;
    try { st = fs.lstatSync(src); } catch { continue; }
    if (!st.isFile()) continue;
    const dest = path.join(o.stageDir, `${conv.id}.db`);
    if (!fs.existsSync(dest)) {
      let db;
      try {
        fs.mkdirSync(o.stageDir, { recursive: true, mode: 0o700 });
        const sqlite = require('node:sqlite');
        db = new sqlite.DatabaseSync(src, { readOnly: true });
        await sqlite.backup(db, dest);
      } catch {
        try { fs.rmSync(dest, { force: true }); } catch { /* left for clearStage */ }
        continue;
      } finally { try { if (db) db.close(); } catch { /* closed */ } }
    }
    for (const a of owners) mine.get(a.seg).push(`${conv.id}.db`);
  }
  let real;
  try { real = fs.realpathSync(o.stageDir); } catch { return []; }
  const roots = [];
  for (const [seg, files] of mine) if (files.length) roots.push({ name: `sessions/${seg}/agy`, path: real, optional: true, only: files.sort() });
  return roots;
}

function clearStage(stageDir) {
  if (typeof stageDir !== 'string' || !path.isAbsolute(stageDir)) return;
  try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* the next run clears it */ }
}

module.exports = { stageAgy, clearStage };
