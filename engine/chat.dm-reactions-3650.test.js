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
  assert.match(note, /^ \[kosmos\] reactions from the person you have not been told about yet: /);
  assert.ok(note.includes('👍 on your message "I shipped the fix for the login page"'), note);
  assert.ok(note.includes('🎉 on your message "Also the tests are green now"'), note);
  assert.ok(note.indexOf('👍') < note.indexOf('🎉'), 'oldest message first');
  assert.match(note, /it needs no reply\.$/);
  assert.equal(/[\r\n\u0000-\u0008\u000b-\u001f\u007f]/.test(note), false, 'one line, safe to type into a pane');
  assert.equal(chat.markDmReactionsTold(agent, chat.dmReactionNews(agent).named), true);
  assert.equal(chat.dmReactionNote(agent), '', 'told reactions are not told again');
  chat.reactDirect(agent, at(2), '❤️');
  assert.ok(chat.dmReactionNote(agent).includes('❤️ on your message "I shipped'), 'a newer reaction is told');
  assert.equal(chat.dmReactionNote(agent).includes('👍'), false, 'an older one is not repeated');
});

test('#3650: only what the note named is marked told, so a reaction added mid-send is still told', () => {
  const { agent, at } = thread();
  chat.reactDirect(agent, at(2), '👍');
  const news = chat.dmReactionNews(agent);
  assert.deepEqual(news.named, { [at(2)]: ['👍'] });
  chat.reactDirect(agent, at(2), '🎉');   // lands after the note was built, before the mark
  chat.reactDirect(agent, at(3), '🔥');
  assert.equal(chat.markDmReactionsTold(agent, news.named), true);
  const next = chat.dmReactionNote(agent);
  assert.ok(next.includes('🎉 on your message "I shipped'), next);
  assert.ok(next.includes('🔥 on your message "Also the tests'), next);
  assert.equal(next.includes('👍'), false, 'the named one is not told twice');
});

test('#3650: marking without what was named marks nothing', () => {
  const { agent, at } = thread();
  chat.reactDirect(agent, at(2), '👍');
  assert.equal(chat.markDmReactionsTold(agent), false);
  assert.ok(chat.dmReactionNote(agent).includes('👍'), 'still pending');
});

test('#3650: a named reaction taken back before the mark is not recorded as told', () => {
  const { agent, at } = thread();
  chat.reactDirect(agent, at(2), '👍');
  const news = chat.dmReactionNews(agent);
  chat.reactDirect(agent, at(2), '👍');   // taken back
  chat.markDmReactionsTold(agent, news.named);
  chat.reactDirect(agent, at(2), '👍');   // put back
  assert.ok(chat.dmReactionNote(agent).includes('👍'), 'putting it back is told again');
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

test('#3650: C1 controls and bidi overrides in the quoted start are not typed into the pane', () => {
  const agent = 'rxbidi';
  const at = '2026-09-24T12:00:06.000Z';
  chat.appendMessage(chat.DIRECT, agent, { text: 'ok\u0085then\u202eevil\u2066x', from: agent, at });
  chat.reactDirect(agent, at, '👀');
  const note = chat.dmReactionNote(agent);
  assert.equal(/[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/.test(note), false, note);
  assert.ok(note.includes('"ok then evil x"'), note);
});

test('#3650: an emoji carrying a bidi override or C1 control is refused, and never typed if already stored', () => {
  const { agent, at } = thread();
  for (const bad of ['\u202e', '👍\u0085', '\u2066🔥']) {
    assert.equal(chat.reactDirect(agent, at(2), bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(chat.reactDirect(agent, at(2), '👍').ok, true, 'CONTROL: a plain emoji is still accepted');
  const file = path.join(require('./store').ROOT, 'chats', 'direct..' + agent + '.json');
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const row = rec.messages.find((m) => m.at === at(3));
  row.reactions = ['🎉\u202e', '\u202e\u0085', '🔥'];
  fs.writeFileSync(file, JSON.stringify(rec));
  // One list for all three readers: the pills, the note and what gets marked told.
  assert.deepEqual(chat.dmReactions(row), ['🔥']);
  const news = chat.dmReactionNews(agent);
  assert.equal(/[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/.test(news.note), false, news.note);
  assert.ok(news.note.includes('🔥 on your message "Also the tests'), news.note);
  assert.equal(news.note.includes('🎉'), false, 'an unsafe stored value must not be shown in part either');
  assert.deepEqual(news.named[at(3)], ['🔥'], 'only what the note named may be marked told');
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

test('#3650: a message holds at most 20 reactions; removing one still works at the cap', () => {
  const { agent, at } = thread();
  const EMOJI = ['😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊', '😋', '😎', '😍', '😘', '🥰', '😗', '😙', '😚', '🙂', '🤗', '🤩'];
  for (const e of EMOJI.slice(0, 20)) assert.equal(chat.reactDirect(agent, at(2), e).ok, true, e);
  const over = chat.reactDirect(agent, at(2), EMOJI[20]);
  assert.equal(over.ok, false);
  assert.match(over.because, /as many reactions as it can hold/);
  assert.equal(chat.reactDirect(agent, at(2), EMOJI[0]).op, 'remove', 'taking one back is not blocked by the cap');
  assert.equal(read(agent)[1].reactions.length, 19);
});

test('#3650: the note names at most five messages and counts the rest', () => {
  const agent = 'rxmany';
  const ats = [];
  for (let i = 0; i < 7; i++) {
    const at = new Date(Date.UTC(2026, 8, 24, 13, 0, i)).toISOString();
    ats.push(at);
    chat.appendMessage(chat.DIRECT, agent, { text: 'message number ' + i, from: agent, at });
    chat.reactDirect(agent, at, '👍');
  }
  const note = chat.dmReactionNote(agent);
  assert.ok(note.includes('reactions on 2 earlier messages; '), note);
  assert.equal(note.includes('"message number 1"'), false, 'the oldest are counted, not quoted');
  for (let i = 2; i < 7; i++) assert.ok(note.includes('"message number ' + i + '"'), 'newest five are named: ' + i);
});

test('#3650: the quoted start never splits an emoji in half', () => {
  const agent = 'rxsplit';
  const at = '2026-09-24T14:00:00.000Z';
  chat.appendMessage(chat.DIRECT, agent, { text: 'a'.repeat(47) + '😀😀 and more text after', from: agent, at });
  chat.reactDirect(agent, at, '👍');
  const note = chat.dmReactionNote(agent);
  assert.equal(note.includes('�'), false);
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(note), false, 'no lone high surrogate');
  assert.ok(note.includes('a'.repeat(47) + '😀…"'), note);
});

test('#3650: the note never rides a menu answer, by the pressed button or by a bare digit', () => {
  assert.equal(chat.dmNoteMayRide('thanks', null), true);
  assert.equal(chat.dmNoteMayRide('Yes, go ahead', 'Yes, go ahead'), false, 'a pressed option (chose) with words');
  assert.equal(chat.dmNoteMayRide('1', null), false, 'a bare digit with no chose');
  assert.equal(chat.dmNoteMayRide(' 12 ', null), false);
  assert.equal(chat.dmNoteMayRide('1 more thing', null), true, 'a digit inside words is an ordinary message');
});

test('#3650: a duplicated emoji in a stored message draws one pill', () => {
  assert.deepEqual(chat.dmReactions({ reactions: ['👍', '👍', '🔥'] }), ['👍', '🔥']);
  assert.equal(chat.dmReactionPills({ reactions: ['👍', '👍'] }).length, 1);
});

test('#3650: a message of exactly the snippet length is quoted whole, without an ellipsis', () => {
  const agent = 'rxexact';
  const at = '2026-09-24T15:00:00.000Z';
  const text = 'b'.repeat(47) + '😀';   // 48 code points
  chat.appendMessage(chat.DIRECT, agent, { text, from: agent, at });
  chat.reactDirect(agent, at, '👍');
  const note = chat.dmReactionNote(agent);
  assert.ok(note.includes('"' + text + '"'), note);
  assert.equal(note.includes('…'), false);
});
