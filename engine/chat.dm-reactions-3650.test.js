'use strict';
/**
 * kosmos#3650: the person reacts to an agent's messages in a Direct Message.
 * engine/chat.js keeps the reaction ON the message (`reactions`), tells the agent on the
 * person's next message (`dmReactionNote`), and records that it was told
 * (`markDmReactionsTold`, into `reactionsTold`).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dm-rx-test-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');

const chat = require('./chat');
chat.resetForTests();
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

let seq = 0;
/* A fresh thread for one agent: the person, then the agent twice, then the person. */
function thread() {
  const agent = 'rx' + (++seq);
  const t = (n) => new Date(Date.UTC(2026, 8, 24, 12, 0, n)).toISOString();
  chat.appendMessage(chat.DIRECT, agent, { text: 'hi', at: t(1), delivery: { state: 'placed' } });
  chat.appendMessage(chat.DIRECT, agent, { text: 'I shipped the fix for the login page', from: agent, at: t(2) });
  chat.appendMessage(chat.DIRECT, agent, { text: 'Also the tests are green now', from: agent, at: t(3) });
  chat.appendMessage(chat.DIRECT, agent, { text: 'thanks', at: t(4), delivery: { state: 'placed' } });
  return { agent, at: t };
}
const read = (agent) => chat.readThread(chat.DIRECT, agent).messages;

test('#3650: reacting toggles the emoji on the agent\'s message and returns its pills', () => {
  const { agent, at } = thread();
  const on = chat.reactDirect(agent, at(2), '👍');
  assert.deepEqual(on, { ok: true, op: 'add', emoji: '👍', at: at(2), reactions: [{ emoji: '👍', count: 1, who: ['you'], mine: true }] });
  assert.deepEqual(read(agent)[1].reactions, ['👍']);
  const off = chat.reactDirect(agent, at(2), '👍');
  assert.equal(off.op, 'remove');
  assert.deepEqual(off.reactions, []);
  assert.deepEqual(read(agent)[1].reactions, []);
});

test('#3650: only the agent\'s own messages can be reacted to, and bad input is refused', () => {
  const { agent, at } = thread();
  assert.equal(chat.reactDirect(agent, at(1), '👍').ok, false, 'the person\'s own message');
  assert.equal(chat.reactDirect(agent, at(9), '👍').ok, false, 'no message at that time');
  assert.equal(chat.reactDirect(agent, at(2), 'x').ok, false, 'not an emoji');
  assert.equal(chat.reactDirect(agent, '', '👍').ok, false, 'no time');
  assert.equal(chat.reactDirect('', at(2), '👍').ok, false, 'no agent');
  assert.deepEqual(read(agent).map((m) => m.reactions), [undefined, undefined, undefined, undefined], 'nothing was written');
});

test('#3650: two agent messages sharing one time are refused rather than guessed', () => {
  const agent = 'rxdup';
  const same = '2026-09-24T12:00:00.000Z';
  chat.appendMessage(chat.DIRECT, agent, { text: 'one', from: agent, at: same });
  chat.appendMessage(chat.DIRECT, agent, { text: 'two', from: agent, at: same });
  const out = chat.reactDirect(agent, same, '👍');
  assert.equal(out.ok, false);
  assert.match(out.because, /share that time/);
});

test('#3650: a reaction survives later messages being appended', () => {
  const { agent, at } = thread();
  chat.reactDirect(agent, at(2), '🔥');
  chat.appendMessage(chat.DIRECT, agent, { text: 'more', from: agent, at: at(5) });
  assert.deepEqual(read(agent)[1].reactions, ['🔥']);
});

test('#3650: the note names new reactions once, then nothing after they are told', () => {
  const { agent, at } = thread();
  assert.equal(chat.dmReactionNote(agent), '', 'nothing to tell yet');
  chat.reactDirect(agent, at(2), '👍');
  chat.reactDirect(agent, at(3), '🎉');
  const note = chat.dmReactionNote(agent);
  assert.match(note, /^ \[kosmos\] reactions from the person since your last message here: /);
  assert.ok(note.includes('👍 on your message "I shipped the fix for the login page"'), note);
  assert.ok(note.includes('🎉 on your message "Also the tests are green now"'), note);
  assert.ok(note.indexOf('👍') < note.indexOf('🎉'), 'oldest message first');
  assert.match(note, /it needs no reply\.$/);
  assert.equal(/[\r\n\u0000-\u0008\u000b-\u001f\u007f]/.test(note), false, 'one line, safe to type into a pane');
  assert.equal(chat.markDmReactionsTold(agent), true);
  assert.equal(chat.dmReactionNote(agent), '', 'told reactions are not told again');
  chat.reactDirect(agent, at(2), '❤️');
  assert.ok(chat.dmReactionNote(agent).includes('❤️ on your message "I shipped'), 'a newer reaction is told');
  assert.equal(chat.dmReactionNote(agent).includes('👍'), false, 'an older one is not repeated');
});

test('#3650: a reaction taken back before the next message is never told', () => {
  const { agent, at } = thread();
  chat.reactDirect(agent, at(2), '👍');
  chat.reactDirect(agent, at(2), '👍');
  assert.equal(chat.dmReactionNote(agent), '');
});

test('#3650: a long message is quoted by its start, and quotes and newlines cannot break the line', () => {
  const agent = 'rxlong';
  const at = '2026-09-24T12:00:05.000Z';
  chat.appendMessage(chat.DIRECT, agent, { text: 'He said "go"\nand then ' + 'x'.repeat(200), from: agent, at });
  chat.reactDirect(agent, at, '👀');
  const note = chat.dmReactionNote(agent);
  assert.equal(/[\r\n]/.test(note), false);
  assert.ok(note.includes('"He said \'go\' and then xxx'), note);
  assert.ok(note.includes('…"'), 'the start is marked as cut');
});

test('#3650: a stray non-array or non-emoji value in the file is skipped, not treated as damage', () => {
  const { agent, at } = thread();
  const file = path.join(require('./store').ROOT, 'chats', 'direct..' + agent + '.json');
  assert.ok(fs.existsSync(file), 'the control must edit the real thread file: ' + file);
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  rec.messages[1].reactions = 'oops';
  rec.messages[2].reactions = ['ok', '👍'];
  fs.writeFileSync(file, JSON.stringify(rec));
  assert.deepEqual(chat.dmReactions(read(agent)[1]), []);
  assert.deepEqual(chat.dmReactions(read(agent)[2]), ['👍']);
  assert.equal(chat.reactDirect(agent, at(2), '👍').ok, true);
});
