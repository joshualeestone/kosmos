'use strict';
/**
 * kosmos#8286: one tool call running for minutes, for the agent's card ("One step running for 12 min: Bash").
 *
 * On 11-08 an agent waited 40 minutes on one tool call (three hook processes that never finished, #8249) and nothing on
 * the board showed it. The report hook cannot say: it sends PreToolUse at most once a minute and nothing when a tool
 * ends, so a hung tool and a model writing a long answer look the same from the reports.
 *
 * THE SIGNAL IS THE TRANSCRIPT. Claude Code appends the assistant's `tool_use` row when a tool call starts and the user
 * `tool_result` row (same `tool_use_id`) when it ends. Measured on Claude Code (2026-11-09): during a Bash call the
 * transcript held that call's `tool_use` with no result after it. Other rows ARE written mid-call (review 1, measured
 * across real sessions: api-request and api-request-blob rows, queue-operation rows when a message is pasted in,
 * metadata rows, pr-link), so the file's time says nothing about the step; only the open call's own row does. So a
 * `tool_use` whose result has not been written is a step in flight since that row's timestamp, for any tool.
 *
 * Only Claude Code agents (their transcripts are found by status.transcriptFor). Not on a card that already says it
 * waits on the person: a permission prompt is a `tool_use` with no result too, and the card says so in its own words.
 *
 * Cost: a stat, then the last TAIL_BYTES only when the file changed since the last read (a per-file cache keyed on size
 * and time). The caller computes it only for a working card (status.oneStepOf).
 * A long subagent (`Agent`, `Task`) or MCP call shows too: it is one step, and the sentence says a long job is fine.
 * Sidechain rows (a subagent written into the main file by older builds) are skipped.
 */
const fs = require('fs');

const SHOW_MS = 5 * 60 * 1000;   // shown once one step has run this long (Josh can change it)
const TAIL_BYTES = 256 * 1024;   // review 1: one api-request-blob row measured at up to 190 KB

/* A tool's name as the sentence says it: an MCP tool (mcp__<server>__<tool>) by its own last part. */
function toolName(name) {
  if (typeof name !== 'string' || !name) return 'a tool';
  const parts = name.split('__');
  return name.startsWith('mcp__') && parts.length >= 3 && parts[parts.length - 1] ? parts[parts.length - 1] : name;
}

/**
 * The step in flight in transcript text (JSONL, possibly starting mid-line), or null: { tool, since } with `since` an ISO
 * time, the OLDEST open call when several run at once. Pure. A `tool_use` whose result is in the text is closed; a person's
 * new prompt (a user row that is not a tool result) closes anything before it (an interrupted call leaves no result
 * row on some builds). A row that does not parse is skipped, so a cut first line costs nothing.
 */
function openStep(text) {
  const open = new Map();   // tool_use id -> { tool, at }
  for (const line of String(text == null ? '' : text).split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object' || row.isSidechain === true) continue;
    const content = row.message && Array.isArray(row.message.content) ? row.message.content : null;
    if (row.type === 'assistant' && content) {
      const at = Date.parse(row.timestamp);
      for (const block of content) {
        if (block && block.type === 'tool_use' && typeof block.id === 'string' && Number.isFinite(at)) {
          open.set(block.id, { tool: toolName(block.name), at });
        }
      }
    } else if (row.type === 'user') {
      const results = content ? content.filter((b) => b && b.type === 'tool_result') : [];
      if (results.length) { for (const b of results) open.delete(b.tool_use_id); }
      else if (row.isMeta !== true) open.clear();   // a new prompt: nothing before it still runs
    }
  }
  let oldest = null;
  for (const v of open.values()) if (!oldest || v.at < oldest.at) oldest = v;
  return oldest ? { tool: oldest.tool, since: new Date(oldest.at).toISOString() } : null;
}

/* The last TAIL_BYTES of a file, as text, or null. */
function tailOf(file, bytes = TAIL_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

/* The open step last read from each file, keyed on its size and time, so an unchanged file is not read again. */
const seen = new Map();   // file -> { size, mtimeMs, step }
const SEEN_MAX = 256;

/**
 * The card's `oneStep` field for a transcript file: { tool, since } once one step has run SHOW_MS, else null. A step that
 * began before `o.notBefore` (ms: the agent's session start) belongs to an earlier, dead session and is not shown.
 * Never throws. `o.now`, `o.showMs` for tests.
 */
function oneStepIn(file, o = {}) {
  try {
    if (typeof file !== 'string' || !file) return null;
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const showMs = Number.isFinite(o.showMs) ? o.showMs : SHOW_MS;
    const st = fs.statSync(file);
    let hit = seen.get(file);
    if (!hit || hit.size !== st.size || hit.mtimeMs !== st.mtimeMs) {
      hit = { size: st.size, mtimeMs: st.mtimeMs, step: openStep(tailOf(file)) };
      if (seen.size >= SEEN_MAX && !seen.has(file)) seen.delete(seen.keys().next().value);
      seen.set(file, hit);
    }
    const step = hit.step;
    if (!step) return null;
    const since = Date.parse(step.since);
    if (now - since < showMs) return null;
    if (Number.isFinite(o.notBefore) && since < o.notBefore) return null;   // review 1: a call left open by a killed session
    return step;
  } catch { return null; }
}

module.exports = { SHOW_MS, TAIL_BYTES, toolName, openStep, tailOf, oneStepIn };
