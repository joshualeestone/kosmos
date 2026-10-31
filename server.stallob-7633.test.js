'use strict';

/**
 * kosmos#7633: the stall push skips an agent only when the own-bounds sweep TOLD the person, within a day, that its idle
 * nudge gave up (server.js ownBoundTold). A give-up whose push did not go out, another helper's give-up, or one told
 * more than a day ago leaves the stall push to go.
 *
 *   node --test server.stallob-7633.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-7633ob-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
fs.writeFileSync(path.join(SANDBOX, 'panes.txt'), '');

const server = require('./server');
const store = require('./engine/store');
const ds = require('./engine/deliverystreak');
const fleet = require('./test-support/fleet');

test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('kosmos#7633: only an idle-nudge give-up the person was told about within a day, and still standing, holds the stall push', () => {
  const ownbounds = require('./engine/ownbounds');
  const told = server._ownBoundToldForTest;
  const pushed = server._ownboundsPushedForTest;
  const pushKey = server._ownboundsPushKeyForTest;
  const card = { ...fleet.install([fleet.agent('s-ob', { state: 'idle' })]).card('s-ob'), state: 'idle' };
  const s = card.sessionName;
  const now = Date.now();
  pushed.clear();
  ownbounds.forget(s);
  ownbounds.note(s, 'nudge', 'gave up after 3 nudges', now - 5 * 60000);   // stood past its grace
  assert.equal(ownbounds.peek(s, 'idle', now).raised, true, 'CONTROL: the real record says the nudge gave up');
  assert.equal(told(card, now), null, 'a give-up whose push never went out held the stall push');
  pushed.set(pushKey(s, 'nudge'), { at: now - 60000 });
  assert.deepEqual(told(card, now), { raised: true }, 'CONTROL: a nudge give-up told a minute ago, still standing, holds it');
  assert.equal(pushKey(s.toUpperCase(), 'nudge'), pushKey(s, 'nudge'), 'the write and the read do not share one key for a capitalised name');
  pushed.set(pushKey(s, 'quota'), { at: now - 30000 });
  assert.deepEqual(told(card, now), { raised: true }, 'a later quota push overwrote the nudge record');
  pushed.delete(pushKey(s, 'nudge'));
  assert.equal(told(card, now), null, 'a quota give-up (not the same problem) held the stall push');
  pushed.clear();
  pushed.set(pushKey(s, 'quota'), { at: now - 30000 });   // ONLY a quota push, with the nudge still raised
  assert.equal(told(card, now), null, 'a quota push alone counted as the nudge being told');
  pushed.set(pushKey(s, 'nudge'), { at: now - ds.PUSH_GAP_MS - 1000 });
  assert.equal(told(card, now), null, 'a nudge told more than a day ago held the daily stall reminder');
  pushed.set(pushKey(s, 'nudge'), { at: now + 60 * 60000 });
  assert.equal(told(card, now), null, 'a record from the future held it');
  pushed.set(pushKey(s, 'nudge'), { at: now - 60000 });
  ownbounds.recovered(s, 'nudge');
  assert.equal(ownbounds.peek(s, 'idle', now).raised, false, 'CONTROL: the nudge recovered');
  assert.equal(told(card, now), null, 'a nudge that recovered held a new stall push for the rest of the day');
  pushed.clear();
  ownbounds.forget(s);
});

test('kosmos#7633: the own-bounds push is counted only when it went out, taken back when it did not arrive, and not sent for a stall told today', () => {
  const tell = server._tellOwnBoundForTest;
  const pushed = server._ownboundsPushedForTest;
  const pushKey = server._ownboundsPushKeyForTest;
  const it = { cls: 'nudge', sinceAt: 1, forMs: 300000, evidence: 'x' };
  const stallFile = path.join(SANDBOX, 'no-stall-pushes.json');
  const now = Date.now();
  const k = pushKey('s-t', 'nudge');
  pushed.clear();
  assert.equal(tell('s-t', it, 'T', { happened: () => true, now, stallFile }), true);
  assert.deepEqual(pushed.get(k), { at: now }, 'a push that went out was not counted');
  pushed.clear();
  tell('s-t', it, 'T', { happened: () => false, now, stallFile });
  assert.equal(pushed.has(k), false, 'a push that did not go out was counted');
  tell('s-t', it, 'T', { happened: (ev) => { ev.onResult(false); return true; }, now, stallFile });
  assert.equal(pushed.has(k), false, 'a push its sender at once said did not arrive stayed counted');
  let late = null;
  tell('s-t', it, 'T', { happened: (ev) => { late = ev.onResult; return true; }, now, stallFile });
  tell('s-t', it, 'T', { happened: () => true, now: now + 1000, stallFile });   // a newer push to the same agent
  late(false);   // the older one's answer comes after
  assert.deepEqual(pushed.get(k), { at: now + 1000 }, 'an older push\'s failure dropped a newer push');
  assert.equal(tell('s-t', it, 'T', { happened: () => { throw new Error('x'); }, now: now + 2000, stallFile }), false, 'a sender that threw counted as sent');
  /* The stall push went first today: an idle-nudge give-up for that agent is not pushed again; another helper's is. */
  const told = path.join(SANDBOX, 'stall-pushes.json');
  fs.writeFileSync(told, JSON.stringify({ 's-t': now - 60000 }));
  let calls = 0;
  const standing = () => true;
  assert.equal(tell('s-t', it, 'T', { happened: () => { calls += 1; return true; }, now, stallFile: told, stallStands: standing }), false);
  assert.equal(calls, 0, 'a nudge give-up was pushed for a stall already told today and still standing');
  tell('s-t', it, 'T', { happened: () => { calls += 1; return true; }, now, stallFile: told, stallStands: () => false });
  assert.equal(calls, 1, 'review 4: a give-up after the stall cleared was swallowed by the stall told this morning');
  tell('s-t', it, 'T', { happened: () => { calls += 1; return true; }, now: now + 1000, stallFile: told });
  assert.equal(calls, 2, 'a sweep that cannot say whether the stall stands did not push');
  calls = 0;
  tell('s-t', { ...it, cls: 'quota' }, 'T', { happened: () => { calls += 1; return true; }, now, stallFile: told, stallStands: standing });
  assert.equal(calls, 1, 'CONTROL: a quota give-up (another problem) is still pushed');
  fs.writeFileSync(told, JSON.stringify({ 's-t': now - ds.PUSH_GAP_MS - 1000 }));
  tell('s-t', it, 'T', { happened: () => { calls += 1; return true; }, now, stallFile: told, stallStands: standing });
  assert.equal(calls, 2, 'a stall told more than a day ago held the nudge push');
  pushed.clear();
});

test('kosmos#7633: the board asks both ways (server.js wiring)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(src, /tell: \(key, it, shown\) => tellOwnBound\(key, it, shown, \{ stallStands: /, 'the own-bounds sweep does not use tellOwnBound with the card\'s stall');
  assert.match(src, /ownBound: \(c\) => ownBoundTold\(c\) \}\);/, 'the stall push does not ask ownBoundTold');
});

test('kosmos#7633 review 5: through the real own-bounds sweep, a nudge held while its stall stands is told once the stall clears', () => {
  const ownbounds = require('./engine/ownbounds');
  const tell = server._tellOwnBoundForTest;
  const now = Date.now();
  const s = 's-sweep';
  ownbounds.forget(s);
  ownbounds.note(s, 'nudge', 'gave up after 3 nudges', now - 5 * 60000);
  const told = new Set();
  const stallFile = path.join(SANDBOX, 'sweep-stall-pushes.json');
  fs.writeFileSync(stallFile, JSON.stringify({ [s]: now - 60 * 60000 }));   // the stall was pushed an hour ago
  let stuck = true;
  let sends = 0;
  const roster = () => [Object.assign(fleet.install([fleet.agent(s, { state: 'idle' })]).card(s), { name: 'Sweep', state: 'idle', isNamedOurs: true, deliveryStall: stuck ? { since: 'x' } : null })];
  const sweep = (t) => {
    const r = roster();
    ownbounds.sweepRoster({ roster: r, told, now: t, tell: (key, it, shown) => tell(key, it, shown, {
      now: t, stallFile, happened: () => { sends += 1; return true; },
      stallStands: (k) => !!(r.find((a) => a.sessionName === k) || {}).deliveryStall,
    }) });
  };
  sweep(now);
  assert.equal(sends, 0, 'CONTROL: held while the stall stands');
  sweep(now + 60000);
  assert.equal(sends, 0, 'held again the next minute while the stall stands');
  stuck = false;   // one message lands; the nudge still fails
  sweep(now + 120000);
  assert.equal(sends, 1, 'a nudge held for a stall was never told once the stall cleared');
  sweep(now + 180000);
  assert.equal(sends, 1, 'told again every minute once sent');
  ownbounds.forget(s);
});

test('kosmos#7633 review 5: ownbounds keeps an episode unmarked only when tell answers false', () => {
  const ownbounds = require('./engine/ownbounds');
  const now = Date.now();
  const s = 's-mark';
  ownbounds.forget(s);
  ownbounds.note(s, 'nudge', 'x', now - 5 * 60000);
  const rows = [{ key: s, shown: s, state: 'idle', ownNeedsYou: false }];
  for (const [answer, want] of [[false, false], [undefined, true], [true, true]]) {
    const told = new Set();
    ownbounds.tellBounds({ rows, told, now, tell: () => answer });
    assert.equal(told.size > 0, want, 'tell answered ' + answer + ' and the episode was ' + (want ? 'not ' : '') + 'left unmarked');
  }
  ownbounds.forget(s);
});
