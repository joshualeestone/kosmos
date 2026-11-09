'use strict';
/**
 * kosmos#8286: one tool call running for minutes, for the agent's card ("One step running for 12 min: Bash").
 *
 * On 11-08 an agent waited 40 minutes on one tool call (three hook processes that never finished, #8249) and nothing on
 * the board showed it. The report hook cannot say: it sends PreToolUse at most once a minute and nothing when a tool
 * ends, so a hung tool and a model writing a long answer look the same from the reports.
 *
 * THE SIGNAL IS THE TRANSCRIPT. Claude Code appends the assistant's `tool_use` row when a tool call starts and the user
 * `tool_result` row (same `tool_use_id`) when it ends. Measured on Claude Code (2026-11-09, renettilley's own session):
 * during a 25 s Bash call the transcript's last row was that call's `tool_use`, with no row written under it until the
 * result; thinking blocks are their own assistant rows, and other row types (pr-link, system) come and go. So a
 * `tool_use` whose result has not been written is a step in flight since that row's timestamp, for any tool.
 *
 * Only Claude Code agents (their transcripts are found by status.transcriptFor). Not on a card that already says it
 * waits on the person: a permission prompt is a `tool_use` with no result too, and the card says so in its own words.
 *
 * Cost: a stat first. A transcript written in the last SHOW_MS cannot hold a step that has run for SHOW_MS, so most cards
 * never read it; otherwise only its last TAIL_BYTES.
 */
const fs = require('fs');

const SHOW_MS = 5 * 60 * 1000;   // shown once one step has run this long (Josh can change it)
const TAIL_BYTES = 64 * 1024;

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
    if (!row || typeof row !== 'object') continue;
    const content = row.message && Array.isArray(row.message.content) ? row.message.content : null;
    if (row.type === 'assistant' && content) {
      const at = Date.parse(row.timestamp);
      for (const block of content) {
        if (block && block.type === 'tool_use' && typeof block.id === 'string' && Number.isFinite(at)) {
          open.set(block.id, { tool: typeof block.name === 'string' && block.name ? block.name : 'a tool', at });
        }
      }
    } else if (row.type === 'user') {
      const results = content ? content.filter((b) => b && b.type === 'tool_result') : [];
      if (results.length) { for (const b of results) open.delete(b.tool_use_id); }
      else if (row.isMeta !== true && row.isSidechain !== true) open.clear();   // a new prompt: nothing before it still runs
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

/**
 * The card's `oneStep` field for a transcript file: { tool, since } once one step has run SHOW_MS, else null. Never throws.
 * `o.now`, `o.showMs` for tests.
 */
function oneStepIn(file, o = {}) {
  try {
    if (typeof file !== 'string' || !file) return null;
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const showMs = Number.isFinite(o.showMs) ? o.showMs : SHOW_MS;
    const st = fs.statSync(file);
    if (now - st.mtimeMs < showMs) return null;   // written since: no step can have run this long
    const step = openStep(tailOf(file));
    if (!step || now - Date.parse(step.since) < showMs) return null;
    return step;
  } catch { return null; }
}

module.exports = { SHOW_MS, TAIL_BYTES, openStep, tailOf, oneStepIn };
