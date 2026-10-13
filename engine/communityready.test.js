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
  assert.match(text('bea'), /The community section in your instructions: not there\. For an agent Kosmos runs as its own/);
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
  assert.equal(ready.rowFor('ann').account, 'none');
  assert.match(text('ann'), /A community account: not yet\. Kosmos makes one the first time something of yours goes to the community/);
  writeJson(cs._paths.keysFile(), { ann: { apiKey: 'k', token: 't', registeredAt: new Date().toISOString() } });
  assert.equal(ready.rowFor('ann').account, 'yes');
  assert.match(text('ann'), /A community account: yes\n/);
  assert.equal(ready.rowFor('bea').account, 'none', 'one agent\'s key was read as another\'s account');
});

test('review 1: an account that cannot be used is never called an account', () => {
  agentFile('ann', withBlock());
  const say = (keys) => { writeJson(cs._paths.keysFile(), keys); return [ready.rowFor('ann').account, text('ann')]; };
  let [st, t] = say({ ann: { apiKey: 'k', refused: true } });
  assert.equal(st, 'refused');
  assert.match(t, /A community account: the community has refused this agent/);
  [st, t] = say({ ann: { registering: { at: 1 } } });
  assert.equal(st, 'being_made');
  assert.match(t, /A community account: being made/);
  [st, t] = say({ ann: { registering: { at: 1, taken: true } } });
  assert.equal(st, 'name_held');
  assert.match(t, /an earlier try made one under your name and Kosmos never received its key/);
  fs.writeFileSync(cs._paths.keysFile(), '{ not json');
  assert.equal(ready.rowFor('ann').account, 'unreadable');
  assert.match(text('ann'), /A community account: Kosmos cannot read its record of accounts just now/);
  assert.doesNotMatch(text('ann'), /A community account: yes/, 'an unreadable record was read as an account');
  // An account at another community address is not one at this board's address (communitysend.hasAccount counts it).
  fs.rmSync(cs._paths.keysFile());
  const elsewhere = path.join(path.dirname(path.dirname(cs._paths.keysFile())), 'some-other-address', 'keys.json');
  writeJson(elsewhere, { ann: { apiKey: 'k' } });
  assert.equal(cs.hasAccount('ann'), true, 'fixture: the other address\'s key is not where hasAccount looks');
  assert.equal(ready.rowFor('ann').account, 'none');
});

test('review 1: an agent named like a built-in gets its own answers, not the built-in', () => {
  for (const name of ['constructor', 'toString', '__proto__']) {
    agentFile(name, withBlock());
    writeJson(cs._paths.keysFile(), { other: { apiKey: 'k' } });
    const r = ready.readyText(name);
    assert.equal(r.ok, true, name);
    assert.equal(r.row.reminder, null, name);
    assert.equal(r.row.account, 'none', name);
    assert.equal(r.row.rereadOwed, false, name);
    assert.match(r.text, /The last time Kosmos went to remind you: none on record/, name);
  }
  assert.equal(ready.noteTurn({ session: 'constructor', act: 'prompted', delivery: 'placed' }, 7), true);
  assert.deepEqual(ready.rowFor('constructor').reminder, { at: 7, act: 'prompted', reachedAt: 7, delivery: 'placed' });
});

test('review 1: why a line was held is said, and a reason Kosmos has no words for is not guessed at', () => {
  agentFile('ann', withBlock());
  const said = (r) => { assert.equal(ready.noteTurn({ session: 'ann', act: 'held', ...r }, 0), true); return text('ann'); };
  assert.match(said({ heldBy: 'menu' }), /not sent: a question on its screen was waiting for an answer/);
  assert.match(said({ heldBy: 'limit' }), /not sent: it had reached its provider's usage limit/);
  assert.match(said({ heldBy: 'limit', heldFor: 'signin' }), /not sent: it was signed out of its provider/);
  assert.equal(ready.noteTurn({ session: 'ann', act: 'held', heldBy: 'signin' }, 0), true);
  assert.equal(ready.rowFor('ann').reminder.heldBy, undefined, 'a heldBy chat never sends was kept');
  assert.match(said({ heldBy: 'quota' }), /not sent: the Google quota its provider shares was used up/);
  const cap = said({ heldBy: 'cap' });
  assert.match(cap, /not sent: your person's limit on how many agents work at once was reached/);
  assert.doesNotMatch(cap, /quota/, 'the cap was called a quota');
  for (const r of [{}, { heldBy: 'something-new' }]) {
    const t = said(r);
    assert.ok(t.includes(ready.TURN_WORDS.held), JSON.stringify(r));
    assert.doesNotMatch(t, /quota|usage limit|signed out|question on its screen/, JSON.stringify(r));
  }
});

test('review 1: a reminder Kosmos could not confirm is not called delivered', () => {
  agentFile('ann', withBlock());
  ready.noteTurn({ session: 'ann', act: 'prompted', delivery: 'unconfirmed' }, 0);
  assert.ok(text('ann').includes('1970-01-01 00:00 UTC, ' + ready.UNCONFIRMED_WORDS));
  ready.noteTurn({ session: 'ann', act: 'prompted' }, 0);
  assert.ok(text('ann').includes(ready.UNCONFIRMED_WORDS), 'a reminder with no delivery state was called delivered');
  ready.noteTurn({ session: 'ann', act: 'prompted', delivery: 'placed' }, 0);
  assert.ok(text('ann').includes('1970-01-01 00:00 UTC, delivered'), 'CONTROL: a placed line is delivered');
  assert.doesNotMatch(text('ann'), /could not confirm/);
});

test('review 1: a connected agent is not promised a section Kosmos never adds there', () => {
  agentFile('bea', '# Agent\n');
  assert.equal(ready.rowFor('bea').connected, false, 'fixture: an agent in the workers folder read as connected');
  assert.match(text('bea'), /not there\. For an agent Kosmos runs as its own, it is added when the agent next starts or when Kosmos itself next starts/);
  const own = text('bea', { connected: () => true });
  assert.match(own, /not there\. You work in your person's own folder, and Kosmos does not add this section to instructions there/);
  assert.doesNotMatch(own, /it is added/);
  assert.doesNotMatch(text('bea', { connected: () => null }), /it is added|own folder/);
});

test('noteTurn keeps the newest result per agent, and each result has its own words', () => {
  agentFile('ann', withBlock());
  assert.match(text('ann'), /The last time Kosmos went to remind you: none on record/);
  const at = Date.parse('2026-10-12T15:04:00Z');
  for (const [act, words] of Object.entries(ready.TURN_WORDS)) {
    const extra = act === 'prompted' ? { delivery: 'placed' } : {};
    assert.equal(ready.noteTurn({ session: 'ann', name: 'Ann', act, ...extra }, at), true, act);
    assert.deepEqual(ready.rowFor('ann').reminder, { at, act, reachedAt: at, ...extra });
    assert.ok(text('ann').includes('The last time Kosmos went to remind you: 2026-10-12 15:04 UTC, ' + words), act + ': ' + text('ann'));
  }
  assert.equal(ready.rowFor('bea').reminder, null, 'one agent\'s reminder was shown to another');
  assert.ok(text('ann').includes(ready.REMINDER_NOTE), 'the line that says a reminder only asks is missing');
});

test('noteTurn refuses a result it has no words for, and a result with no agent', () => {
  assert.equal(ready.noteTurn({ session: 'ann', act: 'something-new' }), false);
  assert.equal(ready.noteTurn({ act: 'prompted' }), false);
  assert.equal(ready.noteTurn(null), false);
  assert.deepEqual({ ...ready.readTurns() }, {});
});

test('a reminder record that cannot be read is said as that, and is not replaced', () => {
  agentFile('ann', withBlock());
  fs.mkdirSync(path.dirname(ready.turnsFile()), { recursive: true });
  fs.writeFileSync(ready.turnsFile(), '{ not json');
  assert.equal(ready.readTurns(), null);
  assert.equal(ready.rowFor('ann').reminder, 'unreadable');
  assert.match(text('ann'), /Kosmos cannot read its record of reminders just now/);
  assert.doesNotMatch(text('ann'), /none on record/, 'an unreadable record was read as "never reminded"');
});

test('review 2: a reminder record that is not a record is replaced by the next result; one that cannot be opened is left alone', () => {
  fs.mkdirSync(path.dirname(ready.turnsFile()), { recursive: true });
  for (const junk of ['{ not json', '[1,2]', '"text"', 'null']) {
    fs.writeFileSync(ready.turnsFile(), junk);
    assert.equal(ready.readTurns(), null, junk);
    assert.equal(ready.noteTurn({ session: 'ann', act: 'prompted', delivery: 'placed' }, 9), true, junk);
    assert.deepEqual({ ...ready.readTurns() }, { ann: { at: 9, act: 'prompted', reachedAt: 9, delivery: 'placed' } }, junk);
  }
  // A directory where the file should be: it cannot be opened, and it is not a file to replace.
  fs.rmSync(ready.turnsFile());
  fs.mkdirSync(ready.turnsFile());
  assert.equal(ready.readTurns(), null);
  assert.equal(ready.noteTurn({ session: 'ann', act: 'prompted', delivery: 'placed' }, 9), false);
  assert.equal(fs.statSync(ready.turnsFile()).isDirectory(), true, 'what could not be opened was replaced');
  // A file this process may not read (a directory would refuse the write whatever the rule said, so it proves less).
  fs.rmdirSync(ready.turnsFile());
  fs.writeFileSync(ready.turnsFile(), 'SOMEONE ELSE\'S BYTES');
  fs.chmodSync(ready.turnsFile(), 0o000);
  try {
    let readable = true;
    try { fs.readFileSync(ready.turnsFile()); } catch { readable = false; }
    if (readable) return;   // running as root: every file opens, so this arm has nothing to show
    assert.equal(ready.noteTurn({ session: 'ann', act: 'prompted', delivery: 'placed' }, 9), false);
    fs.chmodSync(ready.turnsFile(), 0o600);
    assert.equal(fs.readFileSync(ready.turnsFile(), 'utf8'), 'SOMEONE ELSE\'S BYTES', 'a file that could not be opened was replaced');
  } finally { try { fs.chmodSync(ready.turnsFile(), 0o600); } catch { /* already gone */ } }
});

test('review 2: every reason chat can hold a line for has its own words here', () => {
  const src = fs.readFileSync(path.join(__dirname, 'chat.js'), 'utf8');
  const by = [...src.matchAll(/heldBy(?::| =) '([a-z]+)'/g)].map((m) => m[1]);
  const forWhat = [...src.matchAll(/heldFor(?::| =) '([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(by.includes('menu') && by.includes('limit') && by.includes('cap') && by.includes('quota'), 'the scan no longer finds chat\'s hold reasons: ' + by);
  for (const r of new Set(by)) assert.ok(Object.prototype.hasOwnProperty.call(ready.HELD_WORDS, r), 'chat holds a line for "' + r + '" and the ready line has no words for it');
  assert.deepEqual([...new Set(forWhat)], ['signin'], 'chat has a heldFor the ready line does not word');
});

test('review 2: at the hourly limit, every due agent left unsent is recorded as that, not left with an older result', () => {
  const board = fleet.install([fleet.agent('ann', { state: 'idle' }), fleet.agent('bea', { state: 'idle' })]);
  let cards;
  try { cards = status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
  const NOW = Date.parse('2026-10-02T19:30:00Z');
  const H = 3600e3;
  const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
  ready.noteTurn({ session: 'bea', act: 'prompted', delivery: 'placed' }, NOW - 5 * H);
  const sentTo = [];
  const done = ct.tickOnce({
    allowed: () => true, env: {}, switchOn: () => true, prompterOn: () => true,
    roster: () => cards.filter((c) => c.sessionName === 'ann' || c.sessionName === 'bea'), readProjects: () => [], now: NOW, book: new Map(),
    sent: [NOW - 1000], readLimit: () => ({ on: true, perHour: 1 }),
    inCommunity: () => true, postTimes: () => [new Date(NOW - 6 * H).toISOString()], idleSince: () => NOW - H, idleSeen: new Set(['ann', 'bea']),
    history: () => [{ state: 'idle', at: NOW - 30 * H }, { state: 'idle', at: NOW - 2 * H }, { state: 'working', at: NOW - 0.5 * H }, { state: 'idle', at: NOW - 0.4 * H }],
    deliver: (s) => { sentTo.push(s); return { state: D.PLACED }; }, DELIVERY: D,
  });
  assert.deepEqual(sentTo, [], 'fixture: the limit did not stop the pass');
  assert.equal(done.length, 1, 'the pass now returns more than its one limit result');
  const kept = { ...ready.readTurns() };
  assert.deepEqual([kept.ann && kept.ann.act, kept.bea && kept.bea.act], ['limit', 'limit'], JSON.stringify(kept));
  assert.equal(kept.bea.at, NOW, 'the agent behind the limit kept its older result');
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
    deliver: (s) => (s === 'ann' ? { state: D.PLACED } : { state: D.COULD_NOT, held: true, heldBy: 'cap' }), DELIVERY: D,
  });
  assert.deepEqual(done.map((r) => [r.session, r.act]).sort(), [['ann', 'prompted'], ['bea', 'held']], 'fixture: the pass did not try both agents');
  assert.ok(done.every((r) => !('heldBy' in r)), 'the hold\'s reason leaked into the result the pass returns');
  assert.deepEqual({ ...ready.readTurns() }, { ann: { at: NOW, act: 'prompted', reachedAt: NOW, delivery: 'placed' }, bea: { at: NOW, act: 'held', heldBy: 'cap' } });
  assert.deepEqual(D, { PLACED: require('./chat').DELIVERY.PLACED, UNCONFIRMED: require('./chat').DELIVERY.UNCONFIRMED, COULD_NOT: require('./chat').DELIVERY.COULD_NOT }, 'the states this test uses are not chat\'s own');
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
  const board = fleet.install([fleet.agent('ann', { state: 'idle' }), fleet.agent('bea', { state: 'idle' })]);
  let cards;
  try { cards = status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
  const ann = cards.find((c) => c.sessionName === 'ann');
  const bea = cards.find((c) => c.sessionName === 'bea');
  assert.ok(ann && bea, 'fixture: no real cards');
  agentFile('ann', withBlock());
  agentFile('bea', '# Agent\n');
  ready.noteTurn({ session: 'ann', act: 'prompted', delivery: 'placed' }, 5);
  assert.equal(ready.rowsFor(null), null, 'an unreadable roster read as no agents');
  const rows = ready.rowsFor([ann, bea, ann, null]);   // the same agent twice is one row
  assert.deepEqual(rows.map((r) => [r.session, r.name, r.block, r.reminder && r.reminder.act]), [['ann', ann.name, 'present', 'prompted'], ['bea', bea.name, 'absent', null]]);
});

test('review 3: "not sent" passes do not erase when a reminder last reached the agent', () => {
  agentFile('ann', withBlock());
  const T0 = Date.parse('2026-10-12T10:00:00Z');
  ready.noteTurn({ session: 'ann', act: 'prompted', delivery: 'placed' }, T0);
  assert.doesNotMatch(text('ann'), /The last reminder that reached you/, 'said twice when the newest one is the one that reached it');
  for (const [i, act] of ['limit', 'held', 'pane-busy', 'not-reached', 'limit'].entries()) ready.noteTurn({ session: 'ann', act }, T0 + (i + 1) * 3600e3);
  const t = text('ann');
  assert.match(t, /The last time Kosmos went to remind you: 2026-10-12 15:00 UTC, not sent: this board had reached its hourly limit/);
  assert.match(t, /The last reminder that reached you: 2026-10-12 10:00 UTC/);
  agentFile('bea', withBlock());
  ready.noteTurn({ session: 'bea', act: 'limit' }, T0);
  assert.doesNotMatch(text('bea'), /The last reminder that reached you/, 'an agent no reminder ever reached was told one did');
});

test('review 3: a time no date can hold costs that record, not the agent\'s whole answer', () => {
  agentFile('ann', withBlock());
  writeJson(ready.turnsFile(), { ann: { at: 1e20, act: 'prompted' }, bea: { at: 5, act: 'limit', reachedAt: -1e20 } });
  assert.equal(ready.readTurns().ann, undefined);
  assert.deepEqual(ready.readTurns().bea, { at: 5, act: 'limit' });
  assert.match(text('ann'), /The last time Kosmos went to remind you: none on record/);
  assert.equal(ready.readyText('bea').ok, true);
});

test('#5958 review 5: "reached you" is said only of a reminder Kosmos saw land', () => {
  agentFile('ann', withBlock());
  const T = (h) => Date.parse('2026-10-12T0' + h + ':00:00Z');
  // A paste Kosmos could not confirm, then a pass that sent nothing: no line claims a reminder reached the agent.
  ready.noteTurn({ session: 'ann', act: 'prompted', delivery: 'unconfirmed' }, T(1));
  assert.equal(ready.rowFor('ann').reminder.reachedAt, undefined, 'an unconfirmed paste was recorded as one that reached the agent');
  ready.noteTurn({ session: 'ann', act: 'limit' }, T(2));
  assert.doesNotMatch(text('ann'), /The last reminder that reached you/);
  // One that landed, then an unconfirmed one: the newest is not called delivered, and the older landed one is still said, with ITS time.
  ready.noteTurn({ session: 'ann', act: 'prompted', delivery: 'placed' }, T(3));
  assert.doesNotMatch(text('ann'), /The last reminder that reached you/, 'CONTROL: said twice when the newest itself landed');
  ready.noteTurn({ session: 'ann', act: 'prompted', delivery: 'unconfirmed' }, T(4));
  assert.deepEqual(ready.rowFor('ann').reminder, { at: T(4), act: 'prompted', reachedAt: T(3), delivery: 'unconfirmed' });
  assert.match(text('ann'), /The last reminder that reached you: 2026-10-12 03:00 UTC/);
  assert.equal(ready.noteTurn({ session: 'ann', act: 'pane-busy' }, T(5)), true, 'CONTROL: the later pass was not recorded');
  assert.match(text('ann'), /The last reminder that reached you: 2026-10-12 03:00 UTC/, 'a later pass lost when one last landed');
});

test('#5958 review 5: the record keeps only agents the pass still has, so a new agent under an old name starts clean', () => {
  ready.noteTurn({ session: 'gone', act: 'prompted', delivery: 'placed' }, 1);
  ready.noteTurn({ session: 'ann', act: 'prompted', delivery: 'placed' }, 2);
  // With no roster given (a caller outside the pass) nothing is pruned.
  ready.noteTurn({ session: 'bea', act: 'pane-busy' }, 3);
  assert.deepEqual(Object.keys(ready.readTurns()).sort(), ['ann', 'bea', 'gone'], 'CONTROL: a result with no roster pruned the record');
  ready.noteTurn({ session: 'bea', act: 'pane-busy' }, 4, []);
  assert.equal(Object.keys(ready.readTurns()).length, 3, 'an EMPTY roster emptied the record');
  // The pass names who is on the board: the removed agent's entry goes, the others stay, and the one being written always stays.
  ready.noteTurn({ session: 'bea', act: 'pane-busy' }, 5, ['ann', 'bea']);
  assert.deepEqual(Object.keys(ready.readTurns()).sort(), ['ann', 'bea']);
  ready.noteTurn({ session: 'cy', act: 'pane-busy' }, 6, ['ann']);
  assert.deepEqual(Object.keys(ready.readTurns()).sort(), ['ann', 'cy']);
});
