'use strict';
/* kosmos#8952 slice (d): the command a Claude Code permission prompt is waiting on, read from the agent's own transcript.

   A permission prompt whose box is too tall for the pane has its top scrolled away, so the screen cannot show the whole
   request and nobody may approve it from the board or a phone (#6054 review 3). Measured 2026-11-24 (card comment
   7129385550): while such a prompt waits, the session's transcript already holds the pending call, one `tool_use` with no
   `tool_result`, whose input is the whole command. This module reads that call; chat.permissionCutCard decides whether
   the screen agrees with it. Anything this module cannot read for certain is null, and a null keeps the prompt's
   deny-only card (slice c): it can only ever refuse an approval, never grant one.

   Bash only. Other tools (file edits, fetches, MCP calls) draw other boxes, none of them measured cut. */
const fsp = require('node:fs/promises');
const path = require('node:path');

// The end of each transcript is read, not the whole file (a long session is hundreds of MB, receipt.js review 1).
const TAIL_BYTES = 2 * 1024 * 1024;
// A prompt can wait for hours; a transcript untouched for a day is not the one asking.
const RECENT_MS = 24 * 60 * 60 * 1000;

/* The single pending Bash call in one transcript's text, or null. Pending: a tool_use whose id no tool_result names.
   Null unless EXACTLY ONE call is pending and it is the LAST tool_use written: two pending calls (a parallel batch) could
   each be the one asking, so neither is claimed. A person's typed message after a call means the turn moved on, so every
   call before it counts as settled (an interrupted call that wrote no result reads as settled, never as pending).
   `partial` is true when the text starts mid-file: its first line may be cut and is skipped. */
function pendingIn(text, partial) {
  const lines = String(text == null ? '' : text).split('\n');
  if (partial) lines.shift();
  const uses = new Map();   // id -> tool_use block, in written order
  const settled = new Set();
  let lastId = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object' || !o.message || typeof o.message !== 'object') continue;
    const content = o.message.content;
    if (o.type === 'assistant' && Array.isArray(content)) {
      for (const c of content) {
        if (c && c.type === 'tool_use' && typeof c.id === 'string') { uses.set(c.id, c); lastId = c.id; }
      }
    } else if (o.type === 'user') {
      const parts = Array.isArray(content) ? content : [{ type: 'text', text: content }];
      for (const c of parts) {
        if (c && c.type === 'tool_result' && typeof c.tool_use_id === 'string') settled.add(c.tool_use_id);
        else if (c && c.type === 'text' && typeof c.text === 'string' && c.text.trim()) for (const id of uses.keys()) settled.add(id);
      }
    }
  }
  const pending = [...uses.keys()].filter((id) => !settled.has(id));
  if (pending.length !== 1 || pending[0] !== lastId) return null;
  const use = uses.get(lastId);
  const input = use && use.input && typeof use.input === 'object' ? use.input : null;
  if (!use || use.name !== 'Bash' || !input || typeof input.command !== 'string' || !input.command.trim()) return null;
  return { id: lastId, command: input.command, description: typeof input.description === 'string' ? input.description : '' };
}

async function tailOf(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    let got = 0;
    while (got < buf.length) {
      const { bytesRead } = await fh.read(buf, got, buf.length - got, start + got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }
    return { text: buf.subarray(0, got).toString('utf8'), partial: start > 0 };
  } finally { await fh.close(); }
}

/* The session a pane's Claude Code is running: Claude Code writes <config>/sessions/<pid>.json for each live process
   (measured on 2.1.331: pid, sessionId, cwd, the tmux pane). The pane's own pid (tmux #{pane_pid}, which IS the claude
   process, status.paneCcdRead) names it, so only that session's transcript is read: never another session in the same
   folder, a killed one still holding an unanswered call, or another account's. Null unless exactly one session is found. */
async function sessionOfPid(pid, roots) {
  if (!/^\d+$/.test(String(pid || ''))) return null;
  const found = new Map();
  for (const root of roots) {
    let o;
    try { o = JSON.parse(await fsp.readFile(path.join(root, 'sessions', `${pid}.json`), 'utf8')); } catch { continue; }
    if (!o || o.pid !== Number(pid) || typeof o.sessionId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(o.sessionId)
      || typeof o.cwd !== 'string' || !path.isAbsolute(o.cwd)) continue;
    found.set(o.sessionId, o.cwd);
  }
  if (found.size !== 1) return null;
  const [[sessionId, cwd]] = [...found];
  return { sessionId, cwd };
}

async function jsonlUnder(dir, out) {
  let es;
  try { es = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await jsonlUnder(p, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
}

// Each file's reading, kept while its size and time are unchanged (a prompt can wait for hours on a 5-second poll).
const READ_CACHE = new Map();
const READ_CACHE_MAX = 64;
async function pendingInFile(file, st) {
  const hit = READ_CACHE.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.pending;
  const { text, partial } = await tailOf(file);
  const pending = pendingIn(text, partial);
  if (READ_CACHE.size >= READ_CACHE_MAX) READ_CACHE.delete(READ_CACHE.keys().next().value);
  READ_CACHE.set(file, { size: st.size, mtimeMs: st.mtimeMs, pending });
  return pending;
}

/* The pending Bash call of the session running in the pane whose Claude Code process is `pid`. That session's own
   transcript and its subagents' (a subagent's prompt is drawn in the same pane); of those, only the one written LAST
   (the call that just asked), and only when it holds exactly one pending call (pendingIn). An older file's pending call
   (a subagent stopped mid-prompt) is never a candidate. Resolves { ok: true, pending: [] or [call] }, or { ok: false }
   when anything could not be read, which the caller treats exactly like "nothing pending". Never throws.
   `deps` is for tests: { roots, transcriptDirs, now }. */
async function pendingCommands(pid, deps) {
  const d = deps || {};
  try {
    const roots = d.roots || require('./status').configRoots();
    const dirsOf = d.transcriptDirs || require('./receipt').transcriptDirs;
    const now = typeof d.now === 'function' ? d.now() : Date.now();
    const session = await sessionOfPid(pid, roots);
    if (!session) return { ok: false };
    const files = [];
    for (const dir of dirsOf(session.cwd)) {
      files.push(path.join(dir, `${session.sessionId}.jsonl`));
      await jsonlUnder(path.join(dir, session.sessionId, 'subagents'), files);
    }
    let newest = null;
    for (const f of new Set(files)) {
      let st;
      try { st = await fsp.stat(f); } catch { continue; }
      if (!st.isFile()) continue;
      if (!newest || st.mtimeMs > newest.st.mtimeMs) newest = { f, st };
    }
    if (!newest || now - newest.st.mtimeMs > RECENT_MS) return { ok: true, pending: [] };
    const p = await pendingInFile(newest.f, newest.st);
    return { ok: true, pending: p ? [{ ...p, file: newest.f }] : [] };
  } catch { return { ok: false }; }
}

function resetForTests() { READ_CACHE.clear(); }

module.exports = { pendingIn, pendingCommands, sessionOfPid, resetForTests, TAIL_BYTES, RECENT_MS };
