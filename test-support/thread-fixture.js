'use strict';
/**
 * Seed a long conversation for a server test without holding the event loop (kosmos#6059).
 *
 * WHY: every `chat.appendMessage` reads and rewrites the whole thread file, so a loop of 200 appends takes 2 to 3 s
 * here and about 6 s on CI. A test that does that BETWEEN two requests to its in-process server holds the loop past
 * the server's 5 s keep-alive, and the next fetch reuses the socket the server is closing: `fetch failed`,
 * `ECONNRESET`. Diagnosed on CI run 38158076792 (server.dm-older-5841.test.js), and seen again in
 * server.dm-owes-4340.test.js and server.projects.test.js.
 *
 * HOW: the FIRST message goes through `chat.appendMessage`, so the row on disk is the engine's own shape. The rest are
 * that row with only `text` and `at` changed, written in one go. It falls back to real appends whenever the shortcut
 * could change what the test means: entries that differ in any field other than text and at, a text that is not plain
 * printable ASCII (appendMessage normalises stored text, and a copy would skip that), a thread that would reach
 * chat.MAX_MESSAGES (where appendMessage rolls over), or a first append that was not recorded. An entry with no `at`
 * gets the first row's time plus its index in milliseconds, since a row's time is its identity for replies.
 */
const fs = require('node:fs');

function appendMany(chat, projectId, agent, entries, bornAt) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return { recorded: 0, via: 'none' };
  const rest = (e) => { const { text, at, ...other } = e || {}; return JSON.stringify(other); };
  const sameShape = list.every((e) => rest(e) === rest(list[0]) && typeof e.text === 'string' && /^[\x20-\x7e]*$/.test(e.text));
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
  list.slice(1).forEach((e, i) => {
    kept.messages.push({ ...row, text: e.text, at: e.at || new Date(t0 + i + 1).toISOString() });
  });
  fs.writeFileSync(file, JSON.stringify(kept, null, 2));
  return { recorded: list.length, via: 'one write' };
}

module.exports = { appendMany };
