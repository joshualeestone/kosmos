'use strict';
/**
 * kosmos#6487 (Josh, 2026-10-22 13:28: "use the agent avatar and put the actual text, like discord does"): the words
 * behind a phone notification, asked of THIS computer by the phone itself when the notification arrives.
 *
 * A phone notification carries only who and what happened (engine/phonenotify.js; the coordinator's push.rs words
 * it), never what was said: the words would otherwise pass through the coordinator and Apple. So the phone's
 * Notification Service Extension asks the computer, through Kosmos+ remote and its own sign-in, for the words of the
 * event it was told about, and shows them as a message from the agent. When the computer does not answer, the phone
 * shows the plain notification as before.
 *
 * The event id names its source (server.js, where phonenotify.happened is called):
 *   report:<at>:<session>   an agent's needs_you report, kept by engine/selfreport.js with `at` (its words: `because`)
 *   reply:<at>:<session>    an agent's direct reply, kept in its direct thread (chat.DIRECT) with `at` and `from`
 * Nothing new is stored: the words are found where they already are, by that exact time and agent.
 */
const fs = require('node:fs');

const TEXT_MAX = 400;   // a lock screen shows about four lines; the app shows the whole message when opened

/** `kind:<at>:<session>` -> { kind, at, session }, or null. The time holds colons, so the session is after the LAST
 *  one and the time is everything between the first and the last. */
function parseId(id) {
  if (typeof id !== 'string' || id.length > 300) return null;
  const first = id.indexOf(':');
  const last = id.lastIndexOf(':');
  if (first <= 0 || last <= first) return null;
  const kind = id.slice(0, first);
  const at = id.slice(first + 1, last);
  const session = id.slice(last + 1);
  if (kind !== 'report' && kind !== 'reply') return null;
  if (!session || !at || Number.isNaN(Date.parse(at))) return null;
  return { kind, at, session };
}

/** Words for a lock screen: trimmed, runs of blank lines folded, cut at a word near TEXT_MAX with an ellipsis. */
function shorten(text, max = TEXT_MAX) {
  const t = String(text == null ? '' : text).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length <= max) return t;
  // A hard cut can land between the two halves of an emoji; a lone half makes JSON a strict phone decoder refuses.
  const cut = t.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '');
  const sp = cut.search(/\s\S*$/);
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:!?-]+$/, '') + '…';
}

/** How far back from the end of an agent's report file to look. The hooks add a row on every tool call, so a busy
 *  agent's file runs to megabytes, while the row asked for is minutes old when the phone asks. The board's own
 *  longest look back (selfreport.HISTORY_MAX_BYTES) bounds it; an older report answers null (the plain notification). */
const REPORT_TAIL_BYTES = 4 * 1024 * 1024;

/** The reason (`because`, what `kosmos report needs_you "..."` says) of the needs_you report an agent recorded at
 *  exactly `at`, or null. Reads only the end of the agent's report file, from the last row back. */
function reportNote(session, at, { selfreport = require('./selfreport'), tailBytes = REPORT_TAIL_BYTES } = {}) {
  let text;
  let fd = null;
  try {
    fd = fs.openSync(selfreport.fileFor(session), 'r');
    const size = fs.fstatSync(fd).size;
    // One byte before the window is read too: it says whether the window starts on a whole row or partway into one.
    const start = Math.max(0, size - tailBytes - 1);
    const buf = Buffer.alloc(size - start);
    const got = fs.readSync(fd, buf, 0, buf.length, start);
    text = buf.subarray(0, got).toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);   // drop the partial first row (or the byte before a whole one)
  } catch { return null; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let row;
    try { row = JSON.parse(lines[i]); } catch { continue; }
    if (row && row.at === at && row.state === 'needs_you') return typeof row.because === 'string' && row.because.trim() ? row.because : null;
  }
  return null;
}

/** The text of the direct reply an agent sent at exactly `at`, or null. Only the agent's own message counts. */
function replyText(session, at, { chat = require('./chat') } = {}) {
  let thread;
  try { thread = chat.readThread(chat.DIRECT, session); } catch { return null; }
  const m = (thread && Array.isArray(thread.messages) ? thread.messages : []).find((x) => x && x.at === at && x.from === session);
  return m && typeof m.text === 'string' && m.text.trim() ? m.text : null;
}

/** What the phone shows for an event: { kind, session, text } with the words shortened, or null when the id is not
 *  one of ours or its words are not (or no longer) here. `deps.mask(session, text)` runs on the whole words BEFORE
 *  they are shortened (server.js passes the setup guide's secret mask: a cut first could leave half a key the mask no
 *  longer recognises). Never throws. */
function wordsFor(id, deps = {}) {
  const p = parseId(id);
  if (!p) return null;
  let raw = p.kind === 'report' ? reportNote(p.session, p.at, deps) : replyText(p.session, p.at, deps);
  if (raw === null) return null;
  if (typeof deps.mask === 'function') {
    try { raw = deps.mask(p.session, raw); } catch { return null; }   // a mask that fails must not serve the words unmasked
    if (typeof raw !== 'string') return null;
  }
  return { kind: p.kind, session: p.session, text: shorten(raw) };
}

module.exports = { TEXT_MAX, REPORT_TAIL_BYTES, parseId, shorten, reportNote, replyText, wordsFor };
