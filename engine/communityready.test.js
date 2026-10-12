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
  assert.match(text('ann', { held: () => 1 }), /Held for your person to look at: 1 item\./);
  assert.match(text('ann', { held: () => 3 }), /Held for your person to look at: 3 items\./);
  assert.equal(held(1).length, 1);
});

test('send records that cannot be read are said as that, never as "you have not posted yet"', () => {
  agentFile('ann', withBlock());
  const row = ready.rowFor('ann', { items: () => null });
  assert.equal(row.lastPost, 'unreadable');
  assert.equal(row.held, 0, 'what is held is read from the queue, not from the send records');
  assert.equal(ready.rowFor('ann', { held: () => { throw new Error('x'); } }).held, null);
  const t = text('ann', { items: () => null });
  assert.match(t, /Your newest post: Kosmos could not read what it has sent just now/);
  assert.doesNotMatch(t, /you have not posted yet/);
});

test('the text says it did not ask the community and names the read that does; no em dash', () => {
  agentFile('ann', withBlock());
  const t = text('ann');
  assert.match(t, /This does not ask the community itself\. To see whether it answers, run: kosmos community read/);
  assert.doesNotMatch(t, /\u2014|&mdash;|&#8212;|&#x2014;/);
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

/* #5958 slice 2: the person's words for a row (the Settings list), and one read of the records for every row. */
const view = (over) => ready.ownerView({ session: 'ann', switch: 'on', addressOk: true, block: 'present', connected: false, reminders: 'on', rereadOwed: false, account: 'yes', reminder: null, lastPost: null, held: 0, ...over });
const said = (v) => v.lines.map((l) => l.text + ('at' in l ? '<' + l.at + '>' + l.after : '')).join('\n');

test('slice 2: a reminder is a time the page writes, between the same words the agent is told', () => {
  const T = Date.parse('2026-10-12T15:04:00Z');
  let v = view({ reminder: { at: T, act: 'prompted', delivery: 'placed', reachedAt: T } });
  assert.deepEqual(v.lines[2], { text: 'Kosmos last went to remind it on ', at: T, after: '. Delivered.' });
  assert.equal(v.lines.length, 4, 'a second "reached it" line beside a delivered one');
  v = view({ reminder: { at: T, act: 'prompted', delivery: 'unconfirmed', reachedAt: T } });
  assert.equal(v.lines[2].after, '. Sent, but Kosmos could not confirm it arrived.');
  v = view({ reminder: { at: T, act: 'held', heldBy: 'cap', reachedAt: T - 5 } });
  assert.equal(v.lines[2].after, '. Not sent: your limit on how many agents work at once was reached.', 'the person\'s own cap was called "your person\'s"');
  assert.equal(view({ reminder: { at: T, act: 'held', heldBy: 'menu' } }).lines[2].after, '. Not sent: a question on its screen was waiting for an answer.');
  assert.doesNotMatch(said(v), /: [a-z ]+: /, 'two colons in one line');
  assert.deepEqual(v.lines[3], { text: 'The last reminder that reached it was on ', at: T - 5, after: '.' });
  assert.match(said(view({ reminder: 'unreadable' })), /Kosmos cannot read its record of reminders just now\./);
  assert.doesNotMatch(said(view({ reminder: 'unreadable' })), /no record of going/);
});

test('slice 2: no line of the person\'s words speaks to the agent, and none has an em dash', () => {
  const T = 5;
  for (const block of ['present', 'absent', 'ambiguous', 'no_file', 'unreadable', 'something-new']) {
    for (const account of [...Object.keys(ready.ACCOUNT_WORDS), 'something-new']) {
      for (const reminder of [null, 'unreadable', ...Object.keys(ready.TURN_WORDS).map((act) => ({ at: T, act, reachedAt: 1 })), ...Object.keys(ready.HELD_WORDS).map((heldBy) => ({ at: T, act: 'held', heldBy })), { at: T, act: 'held', heldBy: 'limit', heldFor: 'signin' }, { at: T, act: 'prompted', delivery: 'placed' }, { at: T, act: 'prompted', delivery: 'unconfirmed' }]) {
        for (const board of [{}, { switch: 'off' }, { switch: 'unreadable' }, { addressOk: false }, { reminders: 'off' }, { reminders: 'unreadable' }]) {
        const v = view({ block, account, reminder, held: 2, rereadOwed: true, connected: true, ...board });
        const t = said(v) + '\n' + v.summary;
        assert.doesNotMatch(t, /\byour person\b|\byou have\b|\byour instructions\b|\byour first\b|\byour newest\b|\byour name\b|\byours\b|\bremind you\b|\breached you\b/i, t);
        assert.doesNotMatch(t, /\u2014|&mdash;|&#8212;|&#x2014;|undefined|\[object/, t);
        assert.ok(v.lines.every((l) => typeof l.text === 'string' && l.text.length > 0 && l.text === l.text.replace(/\s+$/, '') + ('at' in l ? ' ' : '')), 'an empty line, or one with a stray space at its end: ' + t);
        }
      }
    }
  }
});

test('slice 2: rowsFor reads the send records once for every row, and each row carries the person\'s words', () => {
  const board = fleet.install([fleet.agent('ann', { state: 'idle' }), fleet.agent('bea', { state: 'idle' }), fleet.agent('cal', { state: 'idle' })]);
  let cards;
  try { cards = status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
  for (const n of ['ann', 'bea', 'cal']) agentFile(n, withBlock());
  post('bea', 'Only hers');
  const st = require('./communitystatus');
  const realReader = st.itemsReader;
  const realFor = st.itemsFor;
  let readers = 0;
  let singles = 0;
  st.itemsReader = (...a) => { readers += 1; return realReader(...a); };
  st.itemsFor = (...a) => { singles += 1; return realFor(...a); };
  let rows;
  try { rows = ready.rowsFor(cards.filter((c) => ['ann', 'bea', 'cal'].includes(c.sessionName))); } finally { st.itemsReader = realReader; st.itemsFor = realFor; }
  assert.deepEqual([readers, singles], [1, 0], 'expected one shared read and no single reads for three agents');
  assert.deepEqual(rows.map((r) => [r.session, r.lastPost && r.lastPost.title]), [['ann', null], ['bea', 'Only hers'], ['cal', null]]);
  for (const r of rows) assert.ok(r.owner && typeof r.owner.summary === 'string' && Array.isArray(r.owner.lines) && r.owner.lines.length >= 4, JSON.stringify(r.owner));
  assert.deepEqual(realReader()('bea'), realFor('bea'), 'the shared read and the single read disagree');
});

test('slice 2: send records that cannot be read are unreadable in every row, never "has not posted"', () => {
  const st = require('./communitystatus');
  const realReader = st.itemsReader;
  st.itemsReader = () => null;
  let rows;
  try { rows = ready.rowsFor([{ ...fleetCard('ann') }]); } finally { st.itemsReader = realReader; }
  assert.equal(rows[0].lastPost, 'unreadable');
  assert.match(said(rows[0].owner), /could not read what it has sent/);
});
function fleetCard(name) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  try { return status.snapshot().agents.map((c) => ({ ...c })).find((c) => c.sessionName === name); } finally { board.restore(); }
}

/* Review 7 replaced the rules the five tests above this point used to pin (pick the first trouble, guess its cause, say
   what follows from it). The rule now: every line states one thing Kosmos read, and the summary names all that apply. */
test('slice 2 review 7: each fact about the whole computer is one line that says only that fact', () => {
  const first = (over, n = 1) => view(over).lines.slice(0, n).map((l) => l.text);
  assert.deepEqual(first({ switch: 'off' }), ['The community is off on this computer.']);
  assert.deepEqual(first({ switch: 'unreadable' }), ['Kosmos cannot read the community switch just now.']);
  assert.deepEqual(first({ addressOk: false }), ['This computer’s community address is not one Kosmos sends to.']);
  assert.deepEqual(first({ reminders: 'off' }), ['“Check on your agents” is off on this computer.']);
  assert.deepEqual(first({ reminders: 'unreadable' }), ['Kosmos could not read the “Check on your agents” setting just now.']);
  assert.deepEqual(first({ switch: 'off', addressOk: false, reminders: 'off' }, 3), ['The community is off on this computer.', 'This computer’s community address is not one Kosmos sends to.', '“Check on your agents” is off on this computer.']);
  assert.equal(view({}).lines.length, 4, 'CONTROL: with both switches on and the address good, there is no such line');
  assert.equal(view({ switch: 'off', addressOk: false, reminders: 'off' }).lines.length, 7, 'the agent\'s own four lines are still there');
});

test('slice 2 review 7: none of the consequence, cause or remedy sentences that reviews caught comes back, in any combination; no line is said twice', () => {
  const T = 5;
  const LEAK = /\bstill sent\b|\bnot reminding\b|\bis not being reminded\b|\bcannot say whether\b|\bturn (it|community) \b|\boff and on\b|\bopen its instructions\b|\bremove one\b|\btry again\b|\bso nothing\b.*\buntil\b/i;
  for (const sw of ['on', 'off', 'unreadable']) for (const addressOk of [true, false, null]) for (const reminders of ['on', 'off', 'unreadable']) {
    for (const block of ['present', 'absent', 'ambiguous', 'no_file', 'unreadable']) for (const account of Object.keys(ready.ACCOUNT_WORDS)) for (const connected of [true, false, null]) {
      const v = view({ switch: sw, addressOk, reminders, block, account, connected, reminder: { at: T, act: 'held', heldBy: 'cap' }, held: 1, rereadOwed: null });
      const t = said(v) + '\n' + v.summary;
      assert.doesNotMatch(t, LEAK, t);
      assert.equal(new Set(v.lines.map((l) => l.text + ('at' in l ? l.at + l.after : ''))).size, v.lines.length, 'a line is said twice: ' + t);
    }
  }
  assert.match('Turn Community off and on again above', LEAK, 'CONTROL: the pattern finds the remedy review 7 caught');
  assert.match('What it writes is still sent.', LEAK, 'CONTROL: and the consequence review 5 caught');
});

test('slice 2 review 7: the section line says what is in the file and what Kosmos read about it, for either kind of agent', () => {
  assert.match(said(view({ block: 'absent', connected: true })), /^No community section in its instructions\. It works in a folder of your own, and Kosmos does not add the section to instructions there\./);
  assert.match(said(view({ block: 'absent', connected: false })), /^No community section in its instructions\. For an agent Kosmos runs as its own, it is added when the agent next starts/);
  assert.equal(view({ block: 'absent', connected: null }).lines[0].text, 'No community section in its instructions. Kosmos could not read whose folder this agent works in.');
  assert.match(said(view({ rereadOwed: true })), /in its instructions\. It changed while the agent was running, and Kosmos still owes it a line asking it to read the section again\./);
  assert.match(said(view({ rereadOwed: null })), /in its instructions\. Kosmos could not read whether the agent has been asked to read a newer version of it\./);
  assert.doesNotMatch(said(view({ block: 'ambiguous', rereadOwed: true })), /still owes/, 'a re-read was promised for a section Kosmos leaves alone');
});

test('slice 2 review 9: an address that could not be read is not "not one Kosmos sends to"', () => {
  agentFile('ann', withBlock());
  const boom = () => { throw new Error('unreadable'); };
  assert.equal(ready.rowFor('ann', { addressOk: boom }).addressOk, null);
  assert.equal(ready.rowFor('ann', { addressOk: () => false }).addressOk, false);
  assert.equal(view({ addressOk: null }).lines[0].text, 'Kosmos could not read this computer’s community address just now.');
  assert.match(text('ann', { addressOk: boom }), /- Sending: Kosmos could not read this board's community address just now/);
  assert.match(text('ann', { addressOk: () => false }), /- Sending: this board's community address is not one Kosmos sends to/);
  assert.doesNotMatch(text('ann'), /- Sending:/, 'CONTROL: a good address adds no line');
});

test('slice 2 review 9: the person is told "this computer" where the agent is told "this board"', () => {
  const v = view({ reminder: { at: 5, act: 'limit' } });
  assert.equal(v.lines[2].after, '. Not sent: this computer had reached its hourly limit for messages to agents.');
  agentFile('ann', withBlock());
  ready.noteTurn({ session: 'ann', act: 'limit' }, 5);
  assert.match(text('ann'), /not sent: this board had reached its hourly limit/);
  for (const act of Object.keys(ready.TURN_WORDS)) assert.doesNotMatch(said(view({ reminder: { at: 5, act, delivery: 'placed' } })), /\bthis board\b/, act);
});

test('slice 2 review 9: rowsFor reads each computer-wide record once, however many agents there are', () => {
  const cards = ['ann', 'bea', 'cal'].map((n) => fleetCard(n));
  for (const n of ['ann', 'bea', 'cal']) agentFile(n, withBlock());
  writeJson(cs._paths.keysFile(), { bea: { apiKey: 'k' } });
  ready.noteTurn({ session: 'cal', act: 'prompted', delivery: 'placed' }, 5);
  reread.oweNow('ann', 'community');
  const realRead = fs.readFileSync;
  const watched = { keys: cs._paths.keysFile(), turns: ready.turnsFile(), owed: reread.file(), prompter: require('./heartbeat-setting').FILE };
  /* How many times each record is opened while `fn` runs. Other modules open some of these too (the shared read of the
     send records opens the keys), so the claim is not "once" but "the same for one agent as for three". */
  const counting = (fn) => {
    const counts = { keys: 0, turns: 0, owed: 0, prompter: 0 };
    fs.readFileSync = function (file, ...rest) {
      for (const [k, f] of Object.entries(watched)) if (String(file) === f) counts[k] += 1;
      return realRead.call(fs, file, ...rest);
    };
    let out;
    try { out = fn(); } finally { fs.readFileSync = realRead; }
    return { counts, out };
  };
  const three = counting(() => ready.rowsFor(cards));
  const one = counting(() => ready.rowsFor(cards.slice(0, 1)));
  assert.deepEqual(three.out.map((r) => [r.session, r.account, r.reminder && r.reminder.act, r.rereadOwed]), [['ann', 'none', null, true], ['bea', 'yes', null, false], ['cal', 'none', 'prompted', false]], 'the shared reads gave an agent another\'s answer');
  assert.deepEqual(three.counts, one.counts, 'a record is opened more often for three agents than for one');
  assert.ok(one.counts.keys >= 1 && one.counts.turns >= 1 && one.counts.owed >= 1 && one.counts.prompter >= 1, 'the counter does not see these records opened: ' + JSON.stringify(one.counts));
  // CONTROL: asked one agent at a time, the same records are opened once per agent, so the counter can tell.
  const each = counting(() => cards.map((c) => ready.rowFor(c.sessionName)));
  for (const k of ['turns', 'prompter']) assert.equal(each.counts[k], 3 * one.counts[k], 'CONTROL ' + k + ': ' + JSON.stringify([each.counts, one.counts]));
  assert.ok(each.counts.keys > three.counts.keys && each.counts.owed > three.counts.owed, 'CONTROL: ' + JSON.stringify([each.counts, three.counts]));
  assert.equal(ready.rowsFor(cards, null).length, 3, 'a null deps threw');
});

test('slice 2 review 10: each state\'s place is TRUE of it, not only present: no state Kosmos is unsure of is called in or out', () => {
  const st = require('./communitystatus');
  const UNSURE = /may already be there|may still be up|never heard|has not confirmed|did not confirm/;
  for (const state of [...ready.POST_FACTS.in, ...ready.POST_FACTS.out, ...ready.POST_FACTS.waiting]) {
    assert.doesNotMatch(st.POST_WORDS[state], UNSURE, state + ' is placed as known, and its own words say Kosmos is not sure: ' + st.POST_WORDS[state]);
  }
  for (const state of ready.POST_FACTS.unknown) assert.match(st.POST_WORDS[state], UNSURE, 'CONTROL: ' + state + ' is where the unsure ones are');
  assert.ok(ready.POST_FACTS.unknown.includes('unconfirmed_taken_back'));
  for (const state of ready.POST_FACTS.in) assert.match(st.POST_WORDS[state], /^in the community/, state);
  for (const state of ready.POST_FACTS.waiting) assert.match(st.POST_WORDS[state], /^(queued|waiting|held)/, state);
});


/* Review 12 took the last claim out of the closed row: it never says nothing is wrong. It is a list of parts joined by
   ". ", always including where the newest post is. These tests read it as that list. */
const parts = (over) => view(over).summary.split('. ');
const POSTED_IN = { lastPost: { title: 't', at: '', state: 'sent' } };

test('slice 2 review 12: the closed row never says nothing is wrong, in any state', () => {
  for (const sw of ['on', 'off', 'unreadable']) for (const reminders of ['on', 'off', 'unreadable']) for (const block of ['present', 'absent', 'unreadable'])
    for (const account of ['yes', 'none', 'refused', 'unreadable']) for (const lastPost of [null, 'unreadable', ...Object.values(ready.POST_FACTS).flat().map((state) => ({ title: 't', at: '', state }))]) for (const held of [0, 2, null]) {
      const v = view({ switch: sw, reminders, block, account, lastPost, held });
      assert.doesNotMatch(v.summary, /nothing found|in its way|all (is )?(clear|fine|good)|\bready\b|no problems?/i, v.summary);
      assert.ok(v.summary.length > 0 && !/\. $|^\. |\.\. /.test(v.summary), 'an empty or badly joined summary: ' + JSON.stringify(v.summary));
    }
});

test('slice 2 review 12: the closed row always says where the newest post is, or that there is none', () => {
  assert.deepEqual(parts({}), ['Has not posted yet']);
  assert.deepEqual(parts(POSTED_IN), ['Newest post is in the community']);
  for (const [fact, states] of Object.entries(ready.POST_FACTS)) for (const state of states) {
    const got = parts({ lastPost: { title: 't', at: '', state } });
    if (fact === 'unread') assert.deepEqual(got, ['Kosmos could not check everything just now'], state);
    else assert.deepEqual(got, [ready.POST_SUMMARY[fact]], state);
  }
  assert.deepEqual(parts({ lastPost: 'unreadable' }), ['Kosmos could not check everything just now']);
  // review 12's own case: a post that has not gone out is never under an all-clear.
  assert.deepEqual(parts({ lastPost: { title: 't', at: '', state: 'capped' } }), ['Newest post has not gone to the community']);
  assert.deepEqual(parts({ lastPost: { title: 't', at: '', state: 'unconfirmed' } }), ['Newest post was sent and is not confirmed']);
  assert.deepEqual(Object.keys(ready.POST_SUMMARY).sort(), [...Object.keys(ready.POST_FACTS), 'none'].sort());
});

test('slice 2 review 12: everything that applies is in the closed row, in one fixed order', () => {
  for (const [over, want] of [
    [{ block: 'absent' }, ['No community section in its instructions', 'Has not posted yet']],
    [{ block: 'ambiguous' }, ['Its instructions hold the community section more than once', 'Has not posted yet']],
    [{ block: 'no_file' }, ['It has no instructions file', 'Has not posted yet']],
    [{ account: 'refused' }, ['The community has refused this agent', 'Has not posted yet']],
    [{ account: 'name_held' }, ['Its community account is waiting on an earlier try', 'Has not posted yet']],
    [{ held: 2 }, ['Has not posted yet', '2 waiting for you']],
    [{ switch: 'off' }, ['The community is off', 'Has not posted yet']],
    [{ switch: 'unreadable' }, ['Kosmos cannot read the community switch', 'Has not posted yet']],
    [{ addressOk: false }, ['This computer\u2019s community address is not one Kosmos sends to', 'Has not posted yet']],
    [{ addressOk: null }, ['Has not posted yet', 'Kosmos could not check everything just now']],
    [{ reminders: 'off' }, ['\u201cCheck on your agents\u201d is off', 'Has not posted yet']],
    [{ reminders: 'unreadable' }, ['Has not posted yet', 'Kosmos could not check everything just now']],
    [{ block: 'absent', account: 'refused', held: 3 }, ['No community section in its instructions', 'The community has refused this agent', 'Has not posted yet', '3 waiting for you']],
    [{ switch: 'off', block: 'absent', connected: true }, ['The community is off', 'No community section in its instructions', 'Has not posted yet']],
    [{ switch: 'off', block: 'absent', connected: false }, ['The community is off', 'No community section in its instructions', 'Has not posted yet']],
    [{ switch: 'off', addressOk: false, reminders: 'off', held: 1, ...POSTED_IN }, ['The community is off', 'This computer\u2019s community address is not one Kosmos sends to', '\u201cCheck on your agents\u201d is off', 'Newest post is in the community', '1 waiting for you']],
    [{ block: 'unreadable', held: 2 }, ['Has not posted yet', 'Kosmos could not check everything just now', '2 waiting for you']],
    [{ account: 'refused', reminder: 'unreadable', lastPost: { title: 't', at: '', state: 'refused' } }, ['The community has refused this agent', 'Newest post is not in the community', 'Kosmos could not check everything just now']],
  ]) assert.deepEqual(parts(over), want, JSON.stringify(over));
  for (const over of [{ account: 'none' }, { account: 'being_made' }, { rereadOwed: true }, { reminder: { at: 1, act: 'not-reached' } }]) {
    assert.deepEqual(parts(over), ['Has not posted yet'], 'CONTROL: ' + JSON.stringify(over) + ' adds nothing to the closed row');
  }
});

test('slice 2 review 12: when something was not read, the closed row says so and an open row says what', () => {
  const NAMES = /could not read|cannot read/;
  for (const over of [{ block: 'unreadable' }, { account: 'unreadable' }, { reminder: 'unreadable' }, { lastPost: 'unreadable' }, { held: null }, { reminders: 'unreadable' }, { reminders: undefined },
    { block: 'something-new' }, { account: 'something-new' }, { rereadOwed: null }, { rereadOwed: undefined }, { addressOk: null }, { lastPost: { title: 't', at: '', state: 'unreadable' } },
    { block: 'unreadable', account: 'unreadable', reminder: 'unreadable', lastPost: 'unreadable', held: null }]) {
    const v = view(over);
    assert.ok(v.summary.split('. ').includes('Kosmos could not check everything just now'), JSON.stringify(over) + ' -> ' + v.summary);
    assert.match(said(v), NAMES, 'nothing under the summary says what was not read: ' + JSON.stringify(over) + '\n' + said(v));
  }
  assert.ok(!view({}).summary.includes('could not check'), 'CONTROL: a row that was read does not say so');
  assert.doesNotMatch(said(view({})), NAMES, 'CONTROL: and no line of it does');
});

test('slice 2 review 12: the newest post\'s line says one fact, and every state has a place', () => {
  const st = require('./communitystatus');
  const placed = Object.values(ready.POST_FACTS).flat();
  assert.deepEqual([...placed].sort(), Object.keys(st.POST_WORDS).sort(), 'a state communitystatus can give a post has no place (or a place names a state that is gone)');
  assert.equal(new Set(placed).size, placed.length, 'a state is placed twice');
  assert.deepEqual(Object.keys(ready.POST_FACTS).sort(), Object.keys(ready.POST_FACT_WORDS).sort());
  const line = (state) => view({ lastPost: { title: 'Weekly "ops"\n  two', at: '', state } }).lines[3].text;
  assert.equal(line('sent'), 'Its newest post, \u201cWeekly "ops" two\u201d, is in the community.');
  assert.equal(line('before_on'), 'Its newest post, \u201cWeekly "ops" two\u201d, is not in the community.');
  assert.equal(line('held'), 'Its newest post, \u201cWeekly "ops" two\u201d, has not gone to the community.');
  assert.equal(line('unconfirmed'), 'Its newest post, \u201cWeekly "ops" two\u201d, was sent, and Kosmos has not heard whether it arrived.');
  assert.equal(line('unreadable'), 'Its newest post, \u201cWeekly "ops" two\u201d, has a send record Kosmos cannot read just now.');
  assert.equal(line('a-state-from-the-future'), line('unreadable'), 'a state with no place was given a fact');
  assert.equal(view({ lastPost: { title: '  ', at: '', state: 'sent' } }).lines[3].text, 'Its newest post, \u201cUntitled post\u201d, is in the community.');
  const held = said(view({ lastPost: { title: 'Held one', at: '', state: 'held' }, held: 1 }));
  assert.ok(held.includes('Its newest post, \u201cHeld one\u201d, has not gone to the community.\n1 item it wrote is under Waiting for you.'), held);
  assert.match(said(view({ held: 4 })), /4 items it wrote are under Waiting for you\./);
  assert.match(said(view({ lastPost: 'unreadable' })), /Kosmos could not read what it has sent just now\./);
  assert.doesNotMatch(said(view({ lastPost: 'unreadable' })), /has not posted yet/);
  assert.equal(view({}).lines[3].text, 'It has not posted yet.');
});

test('slice 2 review 12: the reminder switch through the real setting file, in the row and in what the agent is told', () => {
  agentFile('ann', withBlock());
  assert.equal(ready.rowFor('ann').reminders, 'on', 'no setting file reads as on (heartbeat-setting\'s default)');
  const hs = require('./heartbeat-setting');
  hs.setOn(false);
  assert.equal(hs.read().on, false, 'fixture: could not switch the Prompter off');
  assert.equal(ready.rowFor('ann').reminders, 'off');
  const t = text('ann');
  assert.match(t, /\n  Reminders are switched off on this computer\.\n/);
  assert.doesNotMatch(t, /You can still post/, 'the agent was told it can post, whatever the community switch says');
  assert.deepEqual(ready.rowsFor([fleetCard('ann')])[0].owner.summary.split('. '), ['\u201cCheck on your agents\u201d is off', 'Has not posted yet']);
  fs.writeFileSync(hs.FILE, '{ not json');
  assert.equal(ready.rowFor('ann').reminders, 'unreadable');
  assert.doesNotMatch(text('ann'), /Reminders are switched off/, 'an unreadable setting was told to the agent as off');
});

test('slice 2 review 13: what waits for the person is counted from the same queue the Waiting for you list reads', () => {
  agentFile('ann', withBlock());
  assert.equal(ready.rowFor('ann').held, 0);
  // A held post, and a held comment on this board's OWN post (no community post id): the list shows both.
  const store = communitystore;
  const q0 = store.moderationQueue({ limit: Infinity }).length;
  // An email address is what the safety check stops (feedguard), as communitystatus.test.js's held post does.
  store.grantTrust('ann');
  const p = feedpublish.publishPost({ kind: 'community_post', agent: 'ann', at: new Date().toISOString(), topic: 'Needs a look', body: 'Write to me at someone@example.com about it.' }, { agentId: 'ann' });
  assert.notEqual(p.status, 'published', 'fixture: the safety check did not stop it: ' + JSON.stringify(p));
  const queued = store.moderationQueue({ limit: Infinity });
  assert.equal(queued.length, q0 + 1, 'fixture: the stopped post is not in the queue; this test needs one held row');
  assert.equal(ready.rowFor('ann').held, 1);
  // A held comment on that post, which is this board's own (no community post id). communitystatus leaves it out of
  // the agent's items; the Waiting for you list shows it; so the count must have it.
  const c = feedpublish.publishComment({ kind: 'community_post', agent: 'ann', at: new Date().toISOString(), body: 'Or call me, someone@example.com.', postId: p.id }, { agentId: 'ann' });
  const after = store.moderationQueue({ limit: Infinity });
  if (after.length === q0 + 2) {
    assert.equal(require('./communitystatus').itemsFor('ann').filter((x) => x.state === 'held').length, 1, 'fixture: communitystatus now lists a held comment on a local post too');
    assert.equal(ready.rowFor('ann').held, 2, 'a held comment on this board\'s own post is in the list and not in the count');
    assert.ok(ready.rowsFor([fleetCard('ann')])[0].owner.summary.split('. ').includes('2 waiting for you'));
  } else assert.fail('fixture: could not hold a comment on a local post (' + JSON.stringify(c) + '); without it this test cannot tell the two counts apart');
  assert.equal(ready.rowFor('bea').held, 0, 'one agent\'s held item was counted for another');
  const n = ready.heldCount('ann');
  assert.equal(ready.rowFor('ann', { items: () => [] }).held, n, 'the count still came from the send-status items');
});

test('slice 2 review 12: a row that cannot be worded costs that row, not the list', () => {
  const cards = ['ann', 'bea'].map((n) => fleetCard(n));
  for (const n of ['ann', 'bea']) agentFile(n, withBlock());
  // A reminder whose reason throws when it is looked up: ownerView throws for ann, and only for ann.
  const bad = { toString() { throw new Error('boom'); } };
  const turns = () => ({ ann: { at: 5, act: 'held', heldBy: bad }, bea: { at: 5, act: 'prompted', delivery: 'placed' } });
  assert.throws(() => ready.ownerView(ready.rowFor('ann', { turns })), 'fixture: this row must be one ownerView cannot word');
  const rows = ready.rowsFor(cards, { turns });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].owner, { summary: 'Kosmos could not check everything just now', lines: [{ text: 'Kosmos could not put this agent\u2019s row together just now.' }] });
  assert.match(ready.ownerView(ready.rowFor('bea', { turns: () => ({ bea: { at: 5, act: 'something-new' } }) })).lines[2].after, /Kosmos has no words for what happened/);
  assert.equal(rows[1].owner.summary, 'Has not posted yet', 'the other agent\'s row was lost with it');
});
