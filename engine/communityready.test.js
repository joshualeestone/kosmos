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

/* #5958 slice 2: the person's words for a row (the Settings list), and one read of the records for every row. */
const view = (over) => ready.ownerView({ session: 'ann', switch: 'on', addressOk: true, block: 'present', connected: false, reminders: 'on', rereadOwed: false, account: 'yes', reminder: null, lastPost: null, held: 0, ...over });
const said = (v) => v.lines.map((l) => l.text + ('at' in l ? '<' + l.at + '>' + l.after : '')).join('\n');

test('slice 2: an agent with nothing in its way says so, and never claims more than was looked at', () => {
  const v = view({});
  assert.equal(v.summary, 'Nothing found in its way');
  assert.ok(!('needsYou' in v), 'a field no page reads');
  assert.match(said(v), /^The community section is in its instructions\.\nIt has a community account\.\nKosmos has no record of going to remind it\.\nIt has not posted yet\.$/);
});

test('slice 2: what stands in an agent\'s way is its summary, the first that applies', () => {
  for (const [over, summary] of [
    [{ block: 'absent' }, 'No community section in its instructions'],
    [{ block: 'ambiguous' }, 'Its instructions hold the community section more than once'],
    [{ block: 'no_file' }, 'It has no instructions file'],
    [{ account: 'refused' }, 'The community has refused this agent'],
    [{ account: 'name_held' }, 'Its community account is waiting on an earlier try'],
    [{ block: 'absent', account: 'refused', held: 3 }, 'No community section in its instructions. 3 waiting for you'],
    [{ switch: 'off', held: 1 }, 'The community is off. 1 waiting for you'],
    [{ reminders: 'off', held: 2 }, 'Not being reminded. 2 waiting for you'],
    [{ held: 2 }, '2 waiting for you'],
  ]) {
    const v = view(over);
    assert.equal(v.summary, summary, JSON.stringify(over));
  }
  for (const over of [{ account: 'none' }, { account: 'being_made' }, { rereadOwed: true }, { reminder: { at: 1, act: 'not-reached' } }]) {
    assert.equal(view(over).summary, 'Nothing found in its way', 'CONTROL: ' + JSON.stringify(over) + ' is not something in its way');
  }
});

test('slice 2 review 1: "nothing found" is said only when everything was read', () => {
  for (const over of [{ block: 'unreadable' }, { account: 'unreadable' }, { reminder: 'unreadable' }, { lastPost: 'unreadable' }, { held: null }, { block: 'something-new' }, { account: 'something-new' },
    { block: 'unreadable', account: 'unreadable', reminder: 'unreadable', lastPost: 'unreadable', held: null }]) {
    assert.equal(view(over).summary, 'Kosmos could not check everything just now', JSON.stringify(over));
  }
  assert.equal(view({ block: 'unreadable', held: 2 }).summary, '2 waiting for you', 'something known to be waiting was hidden by a read that failed');
  assert.equal(view({ account: 'unreadable', block: 'absent' }).summary, 'No community section in its instructions');
});

test('slice 2 review 1: what stops every agent is said on each row, and never under "nothing found"', () => {
  for (const [over, summary, line] of [
    [{ switch: 'off' }, 'The community is off', /^The community is off on this computer, so Kosmos is not reminding this agent and nothing it writes is sent\.$/],
    [{ switch: 'unreadable' }, 'Kosmos cannot read the community switch', /^Kosmos cannot read the community switch just now, so nothing is sent\./],
    [{ addressOk: false }, 'Nothing is sent from this computer', /community address is not one Kosmos sends to/],
  ]) {
    const v = view(over);
    assert.equal(v.summary, summary, JSON.stringify(over));
    assert.match(v.lines[0].text, line, JSON.stringify(over));
    assert.equal(v.lines.length, 5, 'the agent\'s own lines are still there');
  }
  // A missing section under a switch that is off is the switch's doing; the agent's other troubles still come first.
  assert.equal(view({ switch: 'off', block: 'absent' }).summary, 'The community is off');
  assert.equal(view({ switch: 'unreadable', block: 'absent' }).summary, 'Kosmos cannot read the community switch');
  assert.equal(view({ switch: 'off', account: 'refused' }).summary, 'The community has refused this agent');
  assert.equal(view({ switch: 'off', block: 'ambiguous' }).summary, 'Its instructions hold the community section more than once');
  assert.equal(view({ addressOk: false, block: 'absent' }).summary, 'No community section in its instructions', 'CONTROL: with the switch on, a missing section is the agent\'s own');
  assert.equal(view({}).lines.length, 4, 'CONTROL: with the community on and sending, there is no such line');
});

test('slice 2: the section line says whose folder it is, and what Kosmos still owes', () => {
  assert.match(said(view({ block: 'absent', connected: true })), /^No community section in its instructions\. It works in a folder of your own, and Kosmos does not add the section to instructions there\./);
  assert.match(said(view({ block: 'absent', connected: false })), /^No community section in its instructions\. For an agent Kosmos runs as its own, it is added when the agent next starts/);
  assert.doesNotMatch(said(view({ block: 'absent', connected: null })), /folder of your own|it is added/);
  assert.equal(view({ block: 'absent', connected: null }).lines[0].text, 'No community section in its instructions.');
  assert.match(said(view({ rereadOwed: true })), /in its instructions\. It changed while the agent was running, and Kosmos still owes it a line asking it to read the section again\./);
  assert.doesNotMatch(said(view({ block: 'ambiguous', rereadOwed: true })), /still owes/, 'a re-read was promised for a section Kosmos leaves alone');
});

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

test('slice 2: the newest post is named and its state left to the list that already words it; held items point up the page', () => {
  const v = view({ lastPost: { title: 'Weekly "ops"\n  two', at: '2026-10-12T00:00:00Z', state: 'refused' }, held: 1 });
  assert.ok(said(v).includes('Its newest post is “Weekly "ops" two”.\n'), said(v));
  assert.ok(said(view({ lastPost: { title: '  ', at: '', state: 'sent' } })).includes('Its newest post is “Untitled post”.'));
  assert.doesNotMatch(said(v), /refused|not sent|in the list of posts/, 'the row worded the post\'s state, or pointed at a list that may not hold it');
  // review 3 and 4: a held post is not in the list of posts and comments; the count line says where it is, once.
  const heldOne = said(view({ lastPost: { title: 'Held one', at: '', state: 'held' }, held: 1 }));
  assert.ok(heldOne.includes('Its newest post is “Held one”.\n1 item of its is waiting for you, under Waiting for you.'), heldOne);
  assert.equal(heldOne.split('Waiting for you').length - 1, 1, 'where it waits was said twice');
  assert.match(said(v), /1 item of its is waiting for you, under Waiting for you\./);
  assert.match(said(view({ held: 4 })), /4 items of its are waiting for you/);
  assert.match(said(view({ lastPost: 'unreadable' })), /Kosmos could not read what it has sent just now\./);
  assert.doesNotMatch(said(view({ lastPost: 'unreadable' })), /has not posted yet/);
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
        assert.doesNotMatch(t, /—|&mdash;|&#8212;|&#x2014;|undefined|\[object/, t);
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
  assert.deepEqual([readers, singles], [1, 0], 'the records were read once per agent');
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

test('slice 2 review 3: the reminder pass has its own switch, and a row says when it is off', () => {
  const v = view({ reminders: 'off' });
  assert.equal(v.summary, 'Not being reminded');
  assert.equal(v.lines[0].text, '“Check on your agents” is off, so Kosmos is not reminding this agent to post.');
  // review 5: that line says nothing about sending, so it cannot contradict a refused account below it.
  assert.doesNotMatch(said(view({ reminders: 'off', account: 'refused' })), /still sent/);
  assert.equal(view({ reminders: 'off', switch: 'off' }).summary, 'The community is off', 'the community switch stops more, so it is named first');
  assert.equal(view({ reminders: 'off', block: 'absent' }).summary, 'No community section in its instructions');
  assert.equal(view({ reminders: 'unreadable' }).summary, 'Kosmos could not check everything just now');
  assert.match(said(view({ reminders: 'unreadable' })), /Kosmos could not read the “Check on your agents” setting just now/, 'the summary said something was unread and no line said what');
  assert.equal(view({ reminders: 'on' }).lines.length, 4, 'CONTROL: on, it adds no line');
  // The same switch, through the real setting file, and in what the agent is told.
  agentFile('ann', withBlock());
  assert.equal(ready.rowFor('ann').reminders, 'on', 'no setting file reads as on (heartbeat-setting\'s default)');
  const hs = require('./heartbeat-setting');
  hs.setOn(false);
  assert.equal(hs.read().on, false, 'fixture: could not switch the Prompter off');
  assert.equal(ready.rowFor('ann').reminders, 'off');
  assert.match(text('ann'), /Reminders are switched off on this computer, so Kosmos is not sending any\. You can still post\./);
  assert.equal(ready.rowsFor([fleetCard('ann')])[0].owner.summary, 'Not being reminded');
});

test('slice 2 review 5: whenever the summary says something could not be checked, an open row says what', () => {
  const NAMES = /could not read|cannot read/;
  for (const over of [{ block: 'unreadable' }, { account: 'unreadable' }, { reminder: 'unreadable' }, { lastPost: 'unreadable' }, { held: null }, { reminders: 'unreadable' }, { block: 'something-new' }, { account: 'something-new' }]) {
    const v = view(over);
    assert.equal(v.summary, 'Kosmos could not check everything just now', JSON.stringify(over));
    assert.match(said(v), NAMES, 'nothing under the summary says what was not read: ' + JSON.stringify(over) + '\n' + said(v));
  }
  assert.doesNotMatch(said(view({})), NAMES, 'CONTROL: a row that was read says nothing of the kind');
});
