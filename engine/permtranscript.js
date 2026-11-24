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
const TAIL_BYTES = 4 * 1024 * 1024;
// A prompt can wait for hours; a transcript untouched for a day is not the one asking.
const RECENT_MS = 24 * 60 * 60 * 1000;
// More files than this in an agent's folders is not a shape we read; null (deny-only) rather than a slow board.
const MAX_FILES = 200;

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

/* Every pending Bash call across an agent's recent transcripts (its sessions and their subagents': a subagent's prompt is
   drawn in the same pane). Resolves { ok: true, pending: [...] }, or { ok: false } when the folders could not be read
   through, which the caller treats exactly like "nothing pending". Never throws. `deps` is for tests. */
async function pendingCommands(workerDir, deps) {
  const d = deps || {};
  try {
    const receipt = d.receipt || require('./receipt');
    const now = typeof d.now === 'function' ? d.now() : Date.now();
    if (typeof workerDir !== 'string' || !path.isAbsolute(workerDir)) return { ok: false };
    const files = [];
    for (const dir of receipt.transcriptDirs(workerDir)) files.push(...await receipt.transcriptsIn(dir));
    const unique = [...new Set(files)];
    if (unique.length > MAX_FILES) return { ok: false };
    const pending = [];
    for (const f of unique) {
      let st;
      try { st = await fsp.stat(f); } catch { continue; }   // gone since the listing: not asking
      if (now - st.mtimeMs > RECENT_MS) continue;
      const { text, partial } = await tailOf(f);
      const p = pendingIn(text, partial);
      if (p) pending.push({ ...p, file: f });
    }
    return { ok: true, pending };
  } catch { return { ok: false }; }
}

module.exports = { pendingIn, pendingCommands, TAIL_BYTES, RECENT_MS };
