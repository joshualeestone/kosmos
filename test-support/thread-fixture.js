'use strict';
/**
 * Seed a long conversation for a server test without holding the event loop (kosmos#6059).
 *
 * WHY: every `chat.appendMessage` reads and rewrites the whole thread file, so a loop of 205 appends took 4 to 8.5 s
 * on this Mac (the three tests this replaced). When a test does that BETWEEN two requests to its in-process server,
 * the next request on a pooled socket has come back `fetch failed` / `ECONNRESET` on CI (runs 38158076792 and
 * 38184258270; PR #5751; #6059; PR #6079). What closes the socket is not settled: it recurred with the server's
 * keep-alive at 120 s (server.dm-rollover-5841.test.js, which now uses a new connection per request instead). This
 * removes the gap; it does not claim to remove the cause.
 *
 * HOW: the FIRST message goes through `chat.appendMessage`, so the row on disk is the engine's own shape. The rest are
 * that row with only `text` and `at` changed, written in one go. It falls back to real appends whenever the shortcut
 * could change what the test means: entries that differ in any field other than text and at, a text that is not
 * already what appendMessage would store (it normalises stored text, and a copy would skip that), a thread that would reach
 * chat.MAX_MESSAGES (where appendMessage rolls over), or a first append that was not recorded. An entry with no `at`
 * gets the first row's time plus its index in milliseconds, since a row's time is its identity for replies.
 */
const fs = require('node:fs');

function appendMany(chat, projectId, agent, entries, bornAt) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return { recorded: 0, via: 'none' };
  const rest = (e) => { const { text, at, ...other } = e || {}; return JSON.stringify(other); };
  // Review 1: the copy stores the text as given, so it must already be what appendMessage would store (storedWithin).
  const sameShape = list.every((e) => rest(e) === rest(list[0]) && typeof e.text === 'string' && chat.storedWithin(e.text, chat.MAX_TEXT) === e.text);
  const slow = () => {
    for (const e of list) {
      const r = chat.appendMessage(projectId, agent, e, bornAt);
      if (!r || r.recorded === false) throw new Error('fixture: appendMessage refused: ' + JSON.stringify(r));
    }
    return { recorded: list.length, via: 'appendMessage' };
  };
  if (!sameShape) return slow();
  const file = chat.threadFile(projectId, agent);
  let before = 0;
  try { before = (JSON.parse(fs.readFileSync(file, 'utf8')).messages || []).length; } catch { before = 0; }
  if (before + list.length >= chat.MAX_MESSAGES) return slow();
  const first = chat.appendMessage(projectId, agent, list[0], bornAt);
  if (!first || first.recorded === false) throw new Error('fixture: appendMessage refused: ' + JSON.stringify(first));
  const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
  const row = kept.messages[kept.messages.length - 1];
  if (!row || kept.messages.length !== before + 1) throw new Error('fixture: appendMessage did not add exactly one row');
  const t0 = Date.parse(row.at);
  // Review 2: a first row whose time does not parse cannot seed the made-up times, so the rest go the slow way.
  if (!Number.isFinite(t0) && list.slice(1).some((e) => !e.at)) {
    for (const e of list.slice(1)) {
      const r = chat.appendMessage(projectId, agent, e, bornAt);
      if (!r || r.recorded === false) throw new Error('fixture: appendMessage refused: ' + JSON.stringify(r));
    }
    return { recorded: list.length, via: 'appendMessage' };
  }
  list.slice(1).forEach((e, i) => {
    kept.messages.push({ ...row, text: e.text, at: e.at || new Date(t0 + i + 1).toISOString() });
  });
  fs.writeFileSync(file, JSON.stringify(kept, null, 2));
  return { recorded: list.length, via: 'one write' };
}

module.exports = { appendMany };
