'use strict';
require('../test-support/tmpscope');
/**
 * kosmos#9011 part 1: an agent's own wait (needs_you or blocked, held or not) no longer vanishes from its card
 * unexplained. The record keeps what ended it (selfreport.latestOf's waitCleared), the card carries it for 12 hours
 * (status.waitClearedOf), and the pill says it in plain words (web/index.html stateReason).
 *
 * What resets a wait, measured with selfreport.record (the finding behind this card): the hook's automatic working,
 * idle and needs_you are REFUSED over an agent's own wait; an automatic `started` (a new session) and `stopped` (the
 * session ended) land over it. A new session retiring the old wait is Josh's #5943 design, so it stays; it is now said.
 *
 *   node --test engine/waitcleared-9011.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-waitcleared-9011-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const sr = require('./selfreport');
const status = require('./status');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

let n = 0;
const fresh = () => 'wc' + (n++);
const ASK = { state: 'needs_you', by: 'agent', because: 'May I merge the pull request?' };

test('#9011 what ends an agent\'s own wait is kept, by kind; what cannot end it leaves none', () => {
  const cases = [
    ['a new session', { state: 'started', auto: true }, 'restart'],
    ['the session ending', { state: 'stopped', auto: true }, 'ended'],
    ['its own report', { state: 'working', by: 'agent' }, 'agent'],
    ['a person\'s clear', { state: 'idle', by: 'operator', because: 'operator dismissed a stale needs_you' }, 'person'],
    ['leaving the project', { state: 'idle', by: 'operator', because: 'it left', left: 'p1', project: undefined }, 'left'],
  ];
  for (const [label, entry, kind] of cases) {
    const s = fresh();
    assert.equal(sr.record(s, { ...ASK, held: true }).recorded, true);
    assert.equal(sr.record(s, entry).recorded, true, label + ' was not recorded');
    const r = sr.read(s);
    assert.equal(r.waitCleared && r.waitCleared.by, kind, label + ': ' + JSON.stringify(r.waitCleared));
    assert.equal(r.waitCleared.state, 'needs_you');
    assert.equal(r.waitCleared.held, true, label + ': the wait was a held question');
    assert.ok(Number.isFinite(Date.parse(r.waitCleared.at)));
  }
  /* CONTROLS: the hook's automatic working, idle and needs_you are refused over the wait, so it stands, uncleared. */
  for (const entry of [{ state: 'working', auto: true }, { state: 'idle', auto: true }, { state: 'needs_you', auto: true, because: 'asking permission to use Bash' }]) {
    const s = fresh();
    sr.record(s, ASK);
    assert.equal(sr.record(s, entry).recorded, false);
    const r = sr.read(s);
    assert.equal(r.state, 'needs_you');
    assert.equal(r.waitCleared, null, 'a refused ' + entry.state + ' ended nothing');
  }
});

test('#9011 a new wait starts over; a blocked wait is named as one; a provider block and an unknown author end nothing', () => {
  const a = fresh();
  sr.record(a, ASK); sr.record(a, { state: 'started', auto: true }); sr.record(a, ASK);
  assert.equal(sr.read(a).waitCleared, null, 'asking again: nothing has ended the new question');
  sr.record(a, { state: 'idle', by: 'agent' });
  assert.equal(sr.read(a).waitCleared.by, 'agent', 'the second question\'s own end');

  const b = fresh();
  sr.record(b, { state: 'blocked', by: 'agent', on: 'the lawyer' }); sr.record(b, { state: 'stopped', auto: true });
  assert.deepEqual({ ...sr.read(b).waitCleared, at: 'x' }, { at: 'x', by: 'ended', state: 'blocked', held: false });

  const c = fresh();
  sr.record(c, ASK);
  sr.record(c, { state: 'blocked', auto: true, on: 'provider api (rate_limit)', owner: 'provider' });
  assert.equal(sr.read(c).waitCleared, null, 'a provider outage (#6209) is not an end of the question');

  const d = fresh();
  sr.record(d, ASK);
  sr.record(d, { state: 'working' });   // no auto, no operator: the route records this as the agent's own (by: 'agent')
  assert.equal(sr.read(d).waitCleared && sr.read(d).waitCleared.by, 'agent');
  /* A plain report of a wait by the hook (a permission prompt) is not the agent's own wait, so nothing is kept for it. */
  const e = fresh();
  sr.record(e, { state: 'needs_you', auto: true, because: 'asking permission to use Bash: ls' });
  sr.record(e, { state: 'idle', auto: true });
  assert.equal(sr.read(e).waitCleared, null, 'the hook\'s own permission wait is not said');
});

test('#9011 the card carries it for 12 hours, and never a time from the future', () => {
  const now = Date.parse('2026-11-24T20:00:00Z');
  const rep = (at, extra) => ({ found: true, waitCleared: { at, by: 'restart', state: 'needs_you', held: true, ...extra } });
  assert.deepEqual(status.waitClearedOf(rep('2026-11-24T19:00:00Z'), now), { at: '2026-11-24T19:00:00Z', by: 'restart', state: 'needs_you', held: true });
  assert.equal(status.waitClearedOf(rep(new Date(now - status.WAIT_CLEARED_SHOW_MS - 1000).toISOString()), now), null, 'past 12 hours');
  assert.ok(status.waitClearedOf(rep(new Date(now - status.WAIT_CLEARED_SHOW_MS + 1000).toISOString()), now), 'CONTROL: just inside');
  assert.equal(status.waitClearedOf(rep('2026-11-24T21:00:00Z'), now), null, 'an hour ahead of the clock');
  assert.equal(status.waitClearedOf(rep('nope'), now), null);
  assert.equal(status.waitClearedOf({ found: true, waitCleared: null }, now), null);
  assert.equal(status.waitClearedOf({ found: false }, now), null);
  assert.equal(status.waitClearedOf(rep('2026-11-24T19:00:00Z', { state: 'blocked' }), now).state, 'blocked');
});

test('#9011 the pill says what ended the wait, after #8979\'s restart line, on an idle or working card only', () => {
  const page = require('../test-support/page');
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const stateReason = new Function(page.lift(SCRIPT, 'stateReason') + '\nreturn stateReason;')();
  /* Inside today, so the page says the bare clock at any hour (review round 1: 20 minutes back is yesterday before 00:20). */
  const today = new Date(); today.setHours(0, 1, 0, 0);
  const at = new Date(Math.max(Date.now() - 20 * 60e3, today.getTime()));
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const wc = (by, state) => ({ at: at.toISOString(), by, state: state || 'needs_you', held: false });
  const say = (by, extra) => stateReason({ name: 'Ada', state: 'idle', waitCleared: wc(by), ...extra });
  assert.equal(say('agent'), 'Its question for you was closed at ' + clock + ' by the agent itself.');
  assert.equal(say('person'), 'Its question for you was closed at ' + clock + ' by you.');
  assert.equal(say('left'), 'Its question for you was closed at ' + clock + ' when it left the project.');
  assert.equal(say('restart'), 'Its question for you was set aside at ' + clock + ' when it started again.');
  assert.equal(say('ended'), 'Its question for you was set aside at ' + clock + ' when its session ended.');
  assert.equal(stateReason({ state: 'working', waitCleared: wc('agent', 'blocked') }), 'What it was waiting on was closed at ' + clock + ' by the agent itself.');
  /* Every sentence that asks the person to act, or says more, leads (review round 2); each with a control that the same
     card says this one without it. */
  const since = (mins) => new Date(Date.now() - mins * 60e3).toISOString();
  const leaders = [
    ['#8979 restart', { restarted: { at: at.toISOString(), why: 'Claude stopped unexpectedly (exit code 1).' } }, /^Restarted at /],
    ['#5154 crash loop', { crashLoop: { looping: true, count: 3 } }, /^Kosmos has restarted it 3 times/],
    ['#7212 no message reached it', { deliveryStall: { since: since(40), words: 'Nothing it was sent reached it', next: 'Open it', count: 1, lastWhy: 'send' } }, /^No message has reached Ada/],
    ['#6249 unsent text', { unsentInput: { since: since(5) } }, /^Text has been sitting unsent/],
    ['#5154 give-up', { ownBound: { raised: true, items: [{ cls: 'nudge', forMs: 5 * 60e3 }] } }, /^It sat idle with an open task/],
    ['#8719 untied window', { isNamedOurs: false }, /^Kosmos cannot confirm it started this window/],
  ];
  for (const [label, extra, re] of leaders) {
    assert.match(stateReason({ name: 'Ada', state: 'idle', waitCleared: wc('agent'), ...extra }), re, label + ' leads');
  }
  assert.match(stateReason({ name: 'Ada', state: 'working', waitCleared: wc('agent'), oneStep: { tool: 'Bash', since: since(20) } }),
    /^Ada has been on one step/, '#8286 one long step leads');
  assert.match(stateReason({ name: 'Ada', state: 'idle', waitCleared: wc('agent') }), /was closed at/, 'CONTROL: the same card without them says this one');
  /* CONTROLS: only on an idle or working card, only for a known kind, never on the tile. */
  for (const state of ['needs_you', 'stopped', 'rate_limited', 'auth_failed']) {
    assert.doesNotMatch(String(stateReason({ state, waitCleared: wc('agent') })), /was (closed|set aside) at/, state);
  }
  assert.equal(String(say('mystery')), '', 'an unknown kind says nothing');
  assert.equal(String(stateReason({ state: 'idle', waitCleared: null })), '');
  assert.equal(stateReason({ state: 'idle', waitCleared: wc('agent') }, { card: true }), '', '#6716: no sentence on the tile');
  /* The old question's words never come back. */
  assert.doesNotMatch(say('agent', { because: 'May I merge the pull request?' }), /merge/);
});
