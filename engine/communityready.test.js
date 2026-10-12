'use strict';
/**
 * #5958 items 4 and 5: one agent's community readiness from the board's records (`kosmos community ready`).
 * Sandboxed roots before any require. Instructions are real files in the sandboxed workers folder; posts go through
 * the real publish path; the turn pass is the real communityturn.tickOnce, which keeps each result itself.
 *
 *   node --test engine/communityready.test.js
 */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communityready-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const ready = require('./communityready');
const cb = require('./communityblock');
const cs = require('./communitysend');
const ct = require('./communityturn');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const reread = require('./instructionreread');
const fleet = require('../test-support/fleet');
const status = require('./status');

let switchValue = { ok: true, on: true };
cs.setSwitch(() => switchValue);
test.after(() => { cs.setSwitch(null); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
test.beforeEach(() => {
  switchValue = { ok: true, on: true };
  fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true });
  writeJson(cs._paths.stateFile(), { since: '2000-01-01T00:00:00Z' });
});

function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj)); }
function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text);
}
const withBlock = (n = 1) => '# Agent\n\n' + Array.from({ length: n }, () => cb.START + '\n' + cb.blockBody() + '\n' + cb.END).join('\n\n') + '\n';
function post(agent, topic) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), topic, body: topic + ' body.' }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
const text = (s, deps) => { const r = ready.readyText(s, deps); assert.equal(r.ok, true, JSON.stringify(r)); return r.text; };

test('the block: there, not there, there twice, and no file each read as what they are', () => {
  agentFile('ann', withBlock());
  agentFile('bea', '# Agent\n\nNo community section here.\n');
  agentFile('cal', withBlock(2));
  assert.equal(ready.blockState('ann'), 'present');
  assert.equal(ready.blockState('bea'), 'absent');
  assert.equal(ready.blockState('cal'), 'ambiguous');
  assert.equal(ready.blockState('nobody-here'), 'no_file');
  assert.match(text('ann'), /The community section in your instructions: there\n/);
  assert.match(text('bea'), /The community section in your instructions: not there\. Kosmos adds it when you next start/);
  assert.match(text('cal'), /there more than once, so Kosmos cannot tell which is its own/);
  assert.match(text('nobody-here'), /you have no instructions file/);
});

test('a re-read Kosmos still owes is said, for that agent only and for the community section only', () => {
  agentFile('ann', withBlock());
  agentFile('bea', withBlock());
  assert.equal(ready.rereadOwed('ann'), false);
  assert.equal(reread.oweNow('ann', 'community'), true);
  assert.equal(reread.oweNow('bea', 'you'), true);
  assert.equal(ready.rereadOwed('ann'), true);
  assert.equal(ready.rereadOwed('bea'), false, 'a debt for another section was read as a community one');
  assert.match(text('ann'), /it changed while you were running, and Kosmos still owes you a line asking you to read it again/);
  assert.doesNotMatch(text('bea'), /still owes you/);
});

test('a debt file that cannot be read is "cannot tell", never "nothing owed"', () => {
  fs.mkdirSync(path.dirname(reread.file()), { recursive: true });
  fs.writeFileSync(reread.file(), '{ not json');
  assert.equal(ready.rereadOwed('ann'), null);
});

test('the switch: on, off and unreadable are three different lines', () => {
  agentFile('ann', withBlock());
  assert.match(text('ann'), /The community on this computer: on\n/);
  switchValue = { ok: true, on: false };
  assert.match(text('ann'), /The community on this computer: off, so nothing is sent until your person turns it on/);
  switchValue = { ok: false };
  assert.match(text('ann'), /Kosmos cannot read its switch just now, so nothing is sent/);
});

test('an account: none before anything is sent, yes once a key is kept', () => {
  agentFile('ann', withBlock());
  assert.equal(ready.rowFor('ann').account, false);
  assert.match(text('ann'), /A community account: not yet\. Kosmos makes one when your first post or comment goes out/);
  writeJson(cs._paths.keysFile(), { ann: { apiKey: 'k', token: 't', registeredAt: new Date().toISOString() } });
  assert.equal(ready.rowFor('ann').account, true);
  assert.equal(ready.rowFor('bea').account, false, 'one agent\'s key was read as another\'s account');
});

test('noteTurn keeps the newest result per agent, and each result has its own words', () => {
  agentFile('ann', withBlock());
  assert.match(text('ann'), /The last reminder from Kosmos: none on record/);
  const at = Date.parse('2026-10-12T15:04:00Z');
  for (const [act, words] of Object.entries(ready.TURN_WORDS)) {
    assert.equal(ready.noteTurn({ session: 'ann', name: 'Ann', act }, at), true, act);
    assert.deepEqual(ready.rowFor('ann').reminder, { at, act });
    assert.ok(text('ann').includes('The last reminder from Kosmos: 2026-10-12 15:04 UTC, ' + words), act + ': ' + text('ann'));
  }
  assert.equal(ready.rowFor('bea').reminder, null, 'one agent\'s reminder was shown to another');
  assert.ok(text('ann').includes(ready.REMINDER_NOTE), 'the line that says a reminder only asks is missing');
});

test('noteTurn refuses a result it has no words for, and a result with no agent', () => {
  assert.equal(ready.noteTurn({ session: 'ann', act: 'something-new' }), false);
  assert.equal(ready.noteTurn({ act: 'prompted' }), false);
  assert.equal(ready.noteTurn(null), false);
  assert.deepEqual(ready.readTurns(), {});
});

test('a reminder record that cannot be read is said as that, and is not replaced', () => {
  agentFile('ann', withBlock());
  fs.mkdirSync(path.dirname(ready.turnsFile()), { recursive: true });
  fs.writeFileSync(ready.turnsFile(), '{ not json');
  assert.equal(ready.readTurns(), null);
  assert.equal(ready.rowFor('ann').reminder, 'unreadable');
  assert.match(text('ann'), /Kosmos cannot read its record of reminders just now/);
  assert.doesNotMatch(text('ann'), /none on record/, 'an unreadable record was read as "never reminded"');
  assert.equal(ready.noteTurn({ session: 'ann', act: 'prompted' }), false);
  assert.equal(fs.readFileSync(ready.turnsFile(), 'utf8'), '{ not json', 'the unreadable record was overwritten');
});

test('the real turn pass records what each reminder did, with no help from its caller', () => {
  const board = fleet.install([fleet.agent('ann', { state: 'idle' }), fleet.agent('bea', { state: 'idle' })]);
  let cards;
  try { cards = status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
  const NOW = Date.parse('2026-10-02T19:30:00Z');
  const H = 3600e3;
  const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
  const done = ct.tickOnce({
    allowed: () => true, env: {}, switchOn: () => true, prompterOn: () => true,
    roster: () => cards.filter((c) => c.sessionName === 'ann' || c.sessionName === 'bea'), readProjects: () => [], now: NOW, book: new Map(), sent: [],
    readLimit: () => ({ on: true, perHour: 20 }),
    inCommunity: () => true, postTimes: () => [new Date(NOW - 6 * H).toISOString()], idleSince: () => NOW - H, idleSeen: new Set(['ann', 'bea']),
    history: () => [{ state: 'idle', at: NOW - 30 * H }, { state: 'idle', at: NOW - 2 * H }, { state: 'working', at: NOW - 0.5 * H }, { state: 'idle', at: NOW - 0.4 * H }],
    deliver: (s) => ({ state: s === 'ann' ? D.PLACED : D.COULD_NOT }), DELIVERY: D,
  });
  assert.deepEqual(done.map((r) => [r.session, r.act]).sort(), [['ann', 'prompted'], ['bea', 'not-reached']], 'fixture: the pass did not try both agents');
  assert.deepEqual(ready.readTurns(), { ann: { at: NOW, act: 'prompted' }, bea: { at: NOW, act: 'not-reached' } });
});

test('the newest post and its state, in communitystatus\'s own words; a comment is not a post', () => {
  agentFile('ann', withBlock());
  assert.match(text('ann'), /Your newest post: you have not posted yet/);
  post('ann', 'First one');
  const row = ready.rowFor('ann');
  assert.equal(row.lastPost.title, 'First one');
  assert.equal(row.lastPost.state, 'queued');
  assert.ok(text('ann').includes('Your newest post: "First one": ' + require('./communitystatus').POST_WORDS.queued));
  assert.equal(ready.rowFor('bea').lastPost, null, 'one agent\'s post was shown to another');
  const onlyComment = [{ kind: 'comment', id: 'c1', title: 'a comment', at: '2026-10-12T00:00:00Z', state: 'sent' }];
  assert.equal(ready.rowFor('ann', { items: () => onlyComment }).lastPost, null, 'a comment was shown as the newest post');
});

test('held items are counted and said; none is not mentioned', () => {
  agentFile('ann', withBlock());
  assert.doesNotMatch(text('ann'), /Held for your person/);
  const held = (n) => Array.from({ length: n }, (_, i) => ({ kind: i ? 'comment' : 'post', id: 'h' + i, title: 't', at: '2026-10-12T00:00:0' + i + 'Z', state: 'held' }));
  assert.match(text('ann', { items: () => held(1) }), /Held for your person to look at: 1 item\./);
  assert.match(text('ann', { items: () => held(3) }), /Held for your person to look at: 3 items\./);
});

test('send records that cannot be read are said as that, never as "you have not posted yet"', () => {
  agentFile('ann', withBlock());
  const row = ready.rowFor('ann', { items: () => null });
  assert.equal(row.lastPost, 'unreadable');
  assert.equal(row.held, null);
  const t = text('ann', { items: () => null });
  assert.match(t, /Your newest post: Kosmos could not read what it has sent just now/);
  assert.doesNotMatch(t, /you have not posted yet/);
});

test('the text says it did not ask the community and names the read that does; no em dash', () => {
  agentFile('ann', withBlock());
  const t = text('ann');
  assert.match(t, /This does not ask the community itself\. To see whether it answers, run: kosmos community read/);
  assert.doesNotMatch(t, /—|&mdash;|&#8212;|&#x2014;/);
});

test('readyText refuses an empty name; rowsFor gives one row per agent with its own data', () => {
  assert.equal(ready.readyText('').ok, false);
  assert.equal(ready.readyText(undefined).ok, false);
  agentFile('ann', withBlock());
  agentFile('bea', '# Agent\n');
  ready.noteTurn({ session: 'ann', act: 'prompted' }, 5);
  const rows = ready.rowsFor([{ sessionName: 'ann', name: 'Ann' }, { sessionName: 'bea' }, { sessionName: 'ann', name: 'Ann again' }, { name: 'no session' }, null]);
  assert.deepEqual(rows.map((r) => [r.session, r.name, r.block, r.reminder && r.reminder.act]), [['ann', 'Ann', 'present', 'prompted'], ['bea', 'bea', 'absent', null]]);
});
