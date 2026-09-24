'use strict';

/* #3410 PR 2b: the auto-recovery sweep. Pure planner and an injected deliver/probe, so no real agent. */

const test = require('node:test');
const assert = require('node:assert/strict');
const heal = require('./connlost-heal');

const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const EV = 'API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)';
const lost = (ev = EV) => ({ sessionName: 's1', name: 'Mara', state: 'connection_lost', stateEvidence: ev });

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
  const { results } = await sweep(h, [lost()], 1000);
  assert.equal(results[0].act, 'wait');
  assert.equal(h.sent.length, 0);
});

test('#3410: the same error line on consecutive sweeps, network back -> one nudge with the retry text', async () => {
  const h = harness();
  await sweep(h, [lost()], 1000);
  const { results } = await sweep(h, [lost()], 61000);
  assert.equal(results[0].act, 'nudge');
  assert.equal(results[0].delivered, true);
  assert.deepEqual(h.sent, [{ session: 's1', text: heal.NUDGE_TEXT }]);
});

test('#3410: a changing evidence line (a live retry countdown misread) never reaches a nudge', async () => {
  const h = harness();
  for (let i = 0; i < 6; i += 1) await sweep(h, [lost(`x · Retrying in ${i}s · attempt ${i}/10`)], 1000 + i * 60000);
  assert.equal(h.sent.length, 0);
});

test('#3410: network still down -> wait, no nudge', async () => {
  const h = harness({ probeOk: false });
  await sweep(h, [lost()], 1000);
  const { results } = await sweep(h, [lost()], 61000);
  assert.equal(results[0].act, 'wait');
  assert.equal(h.sent.length, 0);
  assert.equal(h.probes, 1, 'the probe runs only when an agent is ready to be nudged');
});

test('#3410: a recovered agent (state leaves connection_lost) is forgotten, so a later loss starts the count again', async () => {
  const h = harness();
  await sweep(h, [lost()], 1000);
  await sweep(h, [{ sessionName: 's1', name: 'Mara', state: 'idle', stateEvidence: null }], 61000);
  const { results } = await sweep(h, [lost()], 121000);
  assert.equal(results[0].act, 'wait');
  assert.equal(h.sent.length, 0);
});

test('#3410: after MAX_NUDGES within the window it escalates instead of nudging again', async () => {
  const h = harness();
  const logs = [];
  let t = 1000;
  for (let i = 0; i < 20; i += 1) {
    await heal.sweepOnce({ roster: [lost()], book: h.book, now: t, probe: h.probe, deliver: h.deliver, DELIVERY, log: (r) => logs.push(r.act) });
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
  await sweep(h, [lost()], 1000);
  const { results } = await sweep(h, [lost()], 61000);
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
