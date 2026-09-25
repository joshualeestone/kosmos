'use strict';

/* #3410 PR 2b: the auto-recovery sweep. Rosters come from test-support/fleet and the REAL
   status snapshot (fixture discipline: no hand-built cards), fed the captured wedged frame.
   deliver and probe are injected, so no real agent is ever typed into. */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'connlost-heal-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const heal = require('./connlost-heal');

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const EV = 'API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)';
const RULE = '─'.repeat(60);
// Captured (trimmed): Claude Code 2.1.281 after its retries against a closed port ran out.
const WEDGED = ['❯ reply with exactly the word PINEAPPLE',
  '⏺ API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)',
  '✻ Cogitated for 3m 6s · done 5:17 PM', RULE, '❯ ', RULE, '  work · Opus 5.5'].join('\n');
const rosterFor = (screen, state) => fleet.install([fleet.agent('mara', { screen, state })]).agents;
const lost = () => rosterFor(WEDGED, 'connection_lost');
const other = (n) => rosterFor(WEDGED.replace('ECONNREFUSED', 'ECONNREFUSED_' + n), 'connection_lost');
const working = () => rosterFor(fleet.SCREEN.working, 'working');

test('#3410 fixture: the captured wedged screen yields a real connection_lost card with evidence', () => {
  const card = lost()[0];
  assert.equal(card.state, 'connection_lost');
  assert.match(card.stateEvidence, /ECONNREFUSED/);
});

function harness({ probeOk = true } = {}) {
  const sent = [];
  let probes = 0;
  return {
    sent, get probes() { return probes; }, book: new Map(),
    probe: async () => { probes += 1; return probeOk; },
    deliver: (session, text) => { sent.push({ session, text }); return { state: DELIVERY.PLACED }; },
  };
}
const sweep = (h, roster, now) => heal.sweepOnce({ roster, book: h.book, now, probe: h.probe, deliver: h.deliver, DELIVERY });

test('#3410: one sweep of connection_lost does not nudge (needs MIN_SWEEPS with the same line)', async () => {
  const h = harness();
  const { results } = await sweep(h, lost(), 1000);
  assert.equal(results[0].act, 'wait');
  assert.equal(h.sent.length, 0);
});

test('#3410: the same error line on consecutive sweeps, network back -> one nudge with the retry text', async () => {
  const h = harness();
  await sweep(h, lost(), 1000);
  const { results } = await sweep(h, lost(), 61000);
  assert.equal(results[0].act, 'nudge');
  assert.equal(results[0].delivered, true);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].text, heal.NUDGE_TEXT);
});

test('#3410: a changing evidence line (a live retry countdown misread) never reaches a nudge', async () => {
  const h = harness();
  for (let i = 0; i < 6; i += 1) await sweep(h, other(i), 1000 + i * 60000);
  assert.equal(h.sent.length, 0);
});

test('#3410: network still down -> wait, no nudge', async () => {
  const h = harness({ probeOk: false });
  await sweep(h, lost(), 1000);
  const { results } = await sweep(h, lost(), 61000);
  assert.equal(results[0].act, 'wait');
  assert.equal(h.sent.length, 0);
  assert.equal(h.probes, 1, 'the probe runs only when an agent is ready to be nudged');
});

test('#3410: a new loss after a SHORT recovery needs two unchanged sweeps again before a nudge', async () => {
  const h = harness();
  await sweep(h, lost(), 1000);
  await sweep(h, rosterFor(fleet.SCREEN.idle, 'idle'), 61000);
  const { results } = await sweep(h, lost(), 121000);
  assert.equal(results[0].act, 'wait', 'one sweep after coming back is not yet two unchanged sweeps');
  assert.equal(h.sent.length, 0);
});

test('#3410: the nudge-triggered retry (reads WORKING) does not reset the loop guard', async () => {
  // Found in review: a nudge makes Claude Code retry, the retry reads WORKING, and wiping the
  // history then allowed unbounded nudges. Interleave lost, lost, working for 36 minutes (past the 30-minute window).
  const h = harness();
  let t = 1000;
  for (let round = 0; round < 12; round += 1) {
    await sweep(h, lost(), t); t += 60000;
    await sweep(h, lost(), t); t += 60000;
    await sweep(h, working(), t); t += 60000;
  }
  assert.equal(h.sent.length, heal.MAX_NUDGES, `nudged ${h.sent.length} times across short WORKING retries`);
});

test('#3410: history is dropped only after a sustained recovery', async () => {
  const h = harness();
  await sweep(h, lost(), 1000);
  await sweep(h, lost(), 61000); // nudge 1
  assert.equal(h.sent.length, 1);
  let t = 121000;
  for (let i = 0; i < 5; i += 1) { await sweep(h, rosterFor(fleet.SCREEN.idle, 'idle'), t); t += 60000; }
  assert.equal(h.book.size, 1, 'five idle minutes is not yet a recovery: the history is kept');
  for (let i = 0; i < 20; i += 1) { await sweep(h, rosterFor(fleet.SCREEN.idle, 'idle'), t); t += 60000; }
  assert.equal(h.book.size, 1, 'kept until the last nudge is WINDOW_MS old, even after RECOVERED_MS idle');
  for (let i = 0; i < 6; i += 1) { await sweep(h, rosterFor(fleet.SCREEN.idle, 'idle'), t); t += 60000; }
  assert.equal(h.book.size, 0, 'a sustained recovery must clear the history');
});

test('#3410: after MAX_NUDGES within the window it escalates instead of nudging again', async () => {
  const h = harness();
  const logs = [];
  let t = 1000;
  // 70 minutes of continuous loss: well past the 30-minute window, so a non-sticky escalation
  // would start nudging again.
  for (let i = 0; i < 70; i += 1) {
    await heal.sweepOnce({ roster: lost(), book: h.book, now: t, probe: h.probe, deliver: h.deliver, DELIVERY, log: (r) => logs.push(r.act) });
    t += 60000;
  }
  assert.equal(h.sent.length, heal.MAX_NUDGES);
  assert.equal(logs.filter((a) => a === 'escalate').length, 1, 'escalation is logged once, not every sweep');
});

test('#3410 planner: corrupt nudge history escalates rather than nudging', () => {
  assert.equal(heal.planHeal({ evidence: EV, sweeps: 5, nudges: 'garbage' }, 1000, true).act, 'escalate');
});

test('#3410: a nudge whose delivery could not land is not reported as delivered', async () => {
  const h = harness();
  h.deliver = () => ({ state: DELIVERY.COULD_NOT });
  await sweep(h, lost(), 1000);
  const { results } = await sweep(h, lost(), 61000);
  assert.equal(results[0].act, 'nudge');
  assert.equal(results[0].delivered, false);
});

test('#3410 probeApi: true for a listening port, false for a closed one (real sockets, localhost only)', async () => {
  const net = require('node:net');
  const server = net.createServer((s) => s.end());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const open = server.address().port;
  try {
    assert.equal(await heal.probeApi({ host: '127.0.0.1', port: open, timeoutMs: 2000 }), true);
  } finally { await new Promise((r) => server.close(r)); }
  assert.equal(await heal.probeApi({ host: '127.0.0.1', port: open, timeoutMs: 2000 }), false, 'the same port after close must read unreachable');
});

test('#3410: an unreadable roster (null) skips the sweep and keeps the history', async () => {
  const h = harness();
  await sweep(h, lost(), 1000);
  assert.equal(h.book.size, 1);
  const out = await heal.sweepOnce({ roster: null, book: h.book, now: 61000, probe: h.probe, deliver: h.deliver, DELIVERY });
  assert.equal(out.skipped, 'roster unreadable');
  assert.equal(h.book.size, 1, 'a failed snapshot must not wipe the loop guard');
});

test('#3410 makeTick: inert unless allowed, braked by env, never overlapping, skips an unreadable roster', async () => {
  let rosterReads = 0;
  const deps = (over) => ({ allowed: () => true, env: {}, book: new Map(), probe: async () => true,
    deliver: () => ({ state: DELIVERY.PLACED }), DELIVERY, roster: () => { rosterReads += 1; return lost(); }, ...over });
  assert.equal(heal.makeTick(deps({ allowed: () => false }))(), null);
  assert.equal(heal.makeTick(deps({ env: { AGENT_WORKFORCE_CONNLOST_HEAL_OFF: '1' } }))(), null);
  assert.equal(rosterReads, 0, 'a gated tick must not even read the roster');
  assert.equal(heal.makeTick(deps({ roster: () => { rosterReads += 1; return null; } }))(), null);
  // One shared book, primed with one lost sweep, so the tick reaches the (slow) probe.
  let release;
  let probing = false;
  const slow = new Promise((r) => { release = r; });
  const book = new Map();
  await heal.sweepOnce({ roster: lost(), book, now: 1000, probe: async () => true, deliver: () => ({ state: DELIVERY.PLACED }), DELIVERY });
  const tick = heal.makeTick(deps({ book, now: () => 61000, probe: async () => { probing = true; await slow; return true; } }));
  const first = tick();
  assert.ok(first, 'an allowed tick runs');
  await new Promise((r) => setImmediate(r));
  assert.equal(probing, true, 'the first tick is blocked on the probe');
  assert.equal(tick(), null, 'a second tick while the first is in flight must not start');
  release();
  await first;
  assert.ok(tick(), 'after the first finishes, the next tick runs');
});

test('#3410 makeTick: a throwing gate is a no-op tick, not an uncaught timer error', () => {
  const tick = heal.makeTick({ allowed: () => { throw new Error('boom'); }, env: {}, book: new Map(), roster: () => [] });
  assert.equal(tick(), null);
});

test('#3410 makeTick: a throwing clock does not leave the tick stuck busy', async () => {
  let n = 0;
  const tick = heal.makeTick({ allowed: () => true, env: {}, book: new Map(), roster: () => [],
    probe: async () => true, deliver: () => ({}), DELIVERY, now: () => { n += 1; if (n === 1) throw new Error('clock'); return 1000; } });
  assert.equal(tick(), null);
  assert.ok(tick(), 'the next tick still runs');
});

test('#3410: a retry cycle longer than RECOVERED_MS does not reset the nudge budget', async () => {
  // Each nudge starts an 11-minute retry that reads WORKING and then fails again; without a
  // nudge the pane stays wedged. Over three hours: exactly MAX_NUDGES nudges, then escalation.
  const h = harness();
  let t = 1000;
  let retrying = 0;
  for (let i = 0; i < 195; i += 1) {
    const before = h.sent.length;
    await sweep(h, retrying > 0 ? working() : lost(), t); t += 60000;
    if (retrying > 0) retrying -= 1;
    if (h.sent.length > before) retrying = 11;
  }
  assert.equal(h.sent.length, heal.MAX_NUDGES, `nudged ${h.sent.length} times across long retry cycles`);
  assert.equal(h.book.get(lost()[0].sessionName).escalated, true);
});

/* #3410 copy: reconnectPhase names where the self-heal stands, for the board to say in words. */
test('reconnectPhase: null when the self-heal is not running, so the page promises no retry', () => {
  const heal = require('./connlost-heal');
  assert.equal(heal.reconnectPhase({ evidence: 'x', sweeps: 5, nudges: [] }, false), null);
  assert.equal(heal.reconnectPhase(undefined, undefined), null);
});
test('reconnectPhase: waiting before any retry, retried under the cap, gave_up at the cap or escalated', () => {
  const heal = require('./connlost-heal');
  assert.deepEqual(heal.reconnectPhase(undefined, true), { phase: 'waiting', tries: 0 });
  assert.deepEqual(heal.reconnectPhase({ evidence: 'x', sweeps: 1, nudges: [] }, true), { phase: 'waiting', tries: 0 });
  assert.deepEqual(heal.reconnectPhase({ evidence: 'x', sweeps: 3, nudges: [1] }, true), { phase: 'retried', tries: 1 });
  assert.deepEqual(heal.reconnectPhase({ evidence: 'x', sweeps: 3, nudges: [1, 2, 3] }, true), { phase: 'gave_up', tries: heal.MAX_NUDGES });
  assert.equal(heal.reconnectPhase({ evidence: 'x', sweeps: 3, nudges: [1], escalated: true }, true).phase, 'gave_up');
  // Corrupt history counts as used up, the same way planHeal treats it.
  assert.equal(heal.reconnectPhase({ evidence: 'x', sweeps: 3, nudges: 'bad' }, true).phase, 'gave_up');
});

test('healEnabled: the one rule the sweep and the route share (live execution AND no operator brake)', () => {
  const heal = require('./connlost-heal');
  assert.equal(heal.healEnabled(true, {}), true);
  assert.equal(heal.healEnabled(false, {}), false);
  assert.equal(heal.healEnabled(true, { AGENT_WORKFORCE_CONNLOST_HEAL_OFF: '1' }), false);
  assert.equal(heal.healEnabled(undefined, {}), false);
});

test('reconnectPhase: a retry kept from an EARLIER drop is not reported as a retry in this one', () => {
  const heal = require('./connlost-heal');
  // A new drop that began at t=100, with one retry sent at t=50 in the earlier drop: waiting.
  assert.equal(heal.reconnectPhase({ evidence: 'x', sweeps: 1, nudges: [50], lostSince: 100 }, true).phase, 'waiting');
  // A retry sent in this drop: retried.
  assert.equal(heal.reconnectPhase({ evidence: 'x', sweeps: 3, nudges: [50, 120], lostSince: 100 }, true).phase, 'retried');
  // The planner's cap still spans drops: three retries in the window is gave_up whatever the drop.
  assert.equal(heal.reconnectPhase({ evidence: 'x', sweeps: 1, nudges: [10, 20, 30], lostSince: 100 }, true).phase, 'gave_up');
});
test('observe: lostSince is set when a drop begins and kept while it lasts', () => {
  const heal = require('./connlost-heal');
  const first = heal.observe(undefined, 'e1', 1000);
  assert.equal(first.lostSince, 1000);
  assert.equal(heal.observe(first, 'e1', 2000).lostSince, 1000, 'a continuing drop keeps its start');
  assert.equal(heal.observe(first, 'e2', 3000).lostSince, 1000, 'a changed error line in the same drop keeps its start');
  const recovered = { ...first, evidence: null, sweeps: 0 };
  assert.equal(heal.observe(recovered, 'e1', 5000).lostSince, 5000, 'a new drop after a recovery starts fresh');
});
