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
const other = (n) => rosterFor(WEDGED.replace('ECONNREFUSED', 'ECONNREFUSED ' + n), 'connection_lost');
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
  // history then allowed unbounded nudges. Interleave lost, lost, working... for an hour.
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
  for (let i = 0; i < 12; i += 1) { await sweep(h, rosterFor(fleet.SCREEN.idle, 'idle'), t); t += 60000; }
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
  let release;
  const slow = new Promise((r) => { release = r; });
  const tick = heal.makeTick(deps({ probe: async () => { await slow; return true; } }));
  const first = tick();
  assert.ok(first, 'an allowed tick runs');
  assert.equal(tick(), null, 'a second tick while the first is in flight must not start');
  release();
  await first;
  assert.ok(tick(), 'after the first finishes, the next tick runs');
});

test('#3410 makeTick: a throwing gate is a no-op tick, not an uncaught timer error', () => {
  const tick = heal.makeTick({ allowed: () => { throw new Error('boom'); }, env: {}, book: new Map(), roster: () => [] });
  assert.equal(tick(), null);
});
