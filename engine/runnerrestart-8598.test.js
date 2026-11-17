'use strict';

/**
 * kosmos#8598: after the runner upgrade swaps the managed Codex tree, a running older Codex that has not started its
 * code-mode host yet is restarted at its next idle point; one whose host already runs, one started after the swap, and
 * anything not running the managed Codex are left alone (a restart starts the conversation over).
 *
 * Pins: the at-risk agent is restarted once, only after two idle passes and a fresh idle read; a host under it, a start
 * after the swap, a background job under it, a stale or missing tree, a person's own codex, live execution off, a card gone busy and the per-pass
 * and per-pin caps each hold the restart; ps etime and the process table parse.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const rr = require('./runnerrestart');

const DIR = path.join(path.sep, 'k', 'runners', 'openai');
const LINK = path.join(DIR, 'codex');
const HOST = path.join(DIR, 'pkg', 'vendor', 'aarch64-apple-darwin', 'bin', 'codex-code-mode-host');
const NOW = 1_800_000_000_000;
const SWAP = NOW - 10 * 60 * 1000;   // swapped in ten minutes ago

/* Real cards from the real producers (test-support/fleet), never hand-built: a Codex agent idle and working, a Claude
   agent, and a Codex pane that is not ours. Strict, so the sweep reading a field the board does not emit throws. */
const fleet = require('../test-support/fleet');
const codex = (name, state, extra) => fleet.agent(name, Object.assign({ state, runner: 'codex', command: 'node', screen: state === 'idle' ? '\u203a Ask Codex to do anything' : undefined }, extra));
function cards(specs) {
  const f = fleet.install(specs);
  try { return f.agents; } finally { fleet.restore(); }
}
const pick = (list, n) => { const c = list.find((a) => String(a.sessionName).startsWith(n)); assert.ok(c, `the fleet has no card for ${n}`); return c; };
const IDLE = cards([codex('alpha', 'idle'), codex('beta', 'idle'), fleet.agent('claudia', { state: 'idle' }), codex('other', 'unknown', { ours: false })]);
const ALPHA = pick(IDLE, 'alpha'); const BETA = pick(IDLE, 'beta'); const CLAUDIA = pick(IDLE, 'claudia'); const OTHER = pick(IDLE, 'other');
const ALPHA_BUSY = pick(cards([codex('alpha', 'working')]), 'alpha');   // the same agent, gone back to work
const idle = (c) => require('./agentnudge').nudgeableCard(c);

/** A world: panes for each session, and a process table where each pane leader is the managed Codex. */
function world(agents) {
  const panes = new Map();
  const procs = new Map();
  let pid = 1000;
  for (const a of agents) {
    const lead = pid++;
    panes.set(a.session, lead);
    procs.set(lead, { ppid: 1, ageSec: a.ageSec, command: `${a.bin || LINK} --dangerously-bypass-approvals-and-sandbox` });
    if (a.host) procs.set(pid++, { ppid: lead, ageSec: 5, command: `${HOST} --stdio` });
    if (a.shell) procs.set(pid++, { ppid: lead, ageSec: 5, command: '/bin/zsh -c make test' });
  }
  return { panes, procs };
}

function opts(over) {
  const restarted = [];
  const o = Object.assign({
    roster: () => [ALPHA],
    isIdle: idle,
    seenIdle: new Set(),
    tried: new Map(),
    allowed: () => true,
    managed: () => ({ dir: DIR, ready: true, swappedAt: SWAP, pin: '0.169.0' }),
    restart: async (s) => { restarted.push(s); return { outcome: 'restarted' }; },
    RESTARTED: 'restarted',
    now: NOW,
  }, over);
  if (!o.panes || !o.procs) {
    const w = world(over && over.agents ? over.agents : [{ session: ALPHA.sessionName, ageSec: 3600 }]);
    o.panes = o.panes || (() => w.panes);
    o.procs = o.procs || (() => w.procs);
  }
  return { o, restarted };
}

async function twice(o) { await rr.passOnce(o); return rr.passOnce(o); }

test('an old Codex with no code-mode host is restarted at its second idle pass, once', async () => {
  const { o, restarted } = opts();
  const first = await rr.passOnce(o);
  assert.deepEqual(first, [{ session: ALPHA.sessionName, act: 'not-idle' }]);   // idle once is not enough
  assert.deepEqual(restarted, []);
  const second = await rr.passOnce(o);
  assert.deepEqual(second.map((d) => d.act), ['restarted']);
  assert.deepEqual(restarted, [ALPHA.sessionName]);
  const third = await rr.passOnce(o);   // the same (stale) table again: never a second restart for this pin
  assert.deepEqual(third.map((d) => d.act), ['tried']);
  assert.deepEqual(restarted, [ALPHA.sessionName]);
});

test('a code-mode host already running under it is the safe case: left alone', async () => {
  const { o, restarted } = opts({ agents: [{ session: ALPHA.sessionName, ageSec: 3600, host: true }] });
  const out = await twice(o);
  assert.deepEqual(out.map((d) => d.act), ['has-host']);
  assert.deepEqual(restarted, []);
});

test('a background shell job under an idle Codex holds the restart (it would kill the job)', async () => {
  const { o, restarted } = opts({ agents: [{ session: ALPHA.sessionName, ageSec: 3600, shell: true }] });
  const out = await twice(o);
  assert.deepEqual(out.map((d) => d.act), ['has-job']);
  assert.deepEqual(restarted, []);
});

test('a Codex started after the swap already runs the new version', async () => {
  const { o, restarted } = opts({ agents: [{ session: ALPHA.sessionName, ageSec: 60 }] });
  const out = await twice(o);
  assert.deepEqual(out.map((d) => d.act), ['already-new']);
  assert.deepEqual(restarted, []);
});

test('no finished upgrade (stale, installing or unreadable): nothing at all', async () => {
  for (const managed of [() => ({ dir: DIR, ready: false, swappedAt: SWAP }), () => null, () => { throw new Error('x'); }, () => ({ dir: DIR, ready: true, swappedAt: NaN })]) {
    const { o, restarted } = opts({ managed });
    assert.deepEqual(await twice(o), []);
    assert.deepEqual(restarted, []);
  }
});

test('a codex that is not the managed one (a person\'s own) is not ours to restart', async () => {
  const { o, restarted } = opts({ agents: [{ session: ALPHA.sessionName, ageSec: 3600, bin: '/opt/homebrew/bin/codex' }] });
  assert.deepEqual(await twice(o), []);
  assert.deepEqual(restarted, []);
});

test('a card that is not a Codex card of ours is skipped', async () => {
  for (const c of [CLAUDIA, OTHER]) {
    const { o, restarted } = opts({ roster: () => [c], agents: [{ session: c.sessionName, ageSec: 3600 }] });
    assert.deepEqual(await twice(o), []);
    assert.deepEqual(restarted, []);
  }
});

test('live execution off: no restart', async () => {
  const { o, restarted } = opts({ allowed: () => false });
  await twice(o);
  assert.deepEqual(restarted, []);
});

test('a card that went busy on the fresh read just before the restart is held', async () => {
  let reads = 0;
  // passes 1 and 2 read idle; the fresh read inside pass 2 (the third roster call) reads working
  const { o, restarted } = opts({ roster: () => { reads += 1; return [reads === 3 ? ALPHA_BUSY : ALPHA]; } });
  const out = await twice(o);
  assert.deepEqual(out.map((d) => d.act), ['not-idle']);
  assert.deepEqual(restarted, []);
});

test('one restart per pass, so a fleet is spread out', async () => {
  const roster = () => [ALPHA, BETA];
  const { o, restarted } = opts({ roster, agents: [{ session: ALPHA.sessionName, ageSec: 3600 }, { session: BETA.sessionName, ageSec: 3600 }] });
  await twice(o);
  assert.deepEqual(restarted, [ALPHA.sessionName]);
  await rr.passOnce(o);
  assert.deepEqual(restarted, [ALPHA.sessionName, BETA.sessionName]);
});

test('a refused restart is tried again, at most MAX_TRIES times per pin', async () => {
  const calls = [];
  const { o } = opts({ restart: async (s) => { calls.push(s); return { outcome: 'refused', because: 'an account move holds it' }; } });
  const acts = [];
  for (let i = 0; i < rr.MAX_TRIES + 3; i += 1) acts.push(...(await rr.passOnce(o)).map((d) => d.act));
  assert.equal(calls.length, rr.MAX_TRIES);
  assert.equal(acts.filter((a) => a === 'refused').length, rr.MAX_TRIES);
  assert.equal(acts.at(-1), 'tried');
});

test('a throwing restart counts as refused and the pass does not throw', async () => {
  const { o } = opts({ restart: async () => { throw new Error('boom'); } });
  const out = await twice(o);
  assert.deepEqual(out.map((d) => d.act), ['refused']);
});

test('ps etime and the process table parse', () => {
  assert.equal(rr.etimeSeconds('05:07'), 307);
  assert.equal(rr.etimeSeconds('02:05:07'), 2 * 3600 + 307);
  assert.equal(rr.etimeSeconds('3-02:05:07'), 3 * 86400 + 2 * 3600 + 307);
  assert.equal(rr.etimeSeconds('5:7'), 307);
  assert.equal(rr.etimeSeconds('99:99'), null);
  assert.equal(rr.etimeSeconds('abc'), null);
  const t = rr.parseProcs(`  101     1   01:00 ${LINK} --x\n  102   101   00:05 ${HOST}\nnot a row\n`);
  assert.deepEqual([...t.keys()], [101, 102]);
  assert.deepEqual(t.get(102), { ppid: 101, ageSec: 5, command: HOST });
  const found = rr.codexUnderPane(101, t, rr.childrenOf(t), DIR, NOW);
  assert.deepEqual(found, { pid: 101, startedAt: NOW - 60000, host: true, job: false });
});

test('a recycled pid that points back into the walk does not loop', () => {
  const t = new Map([[10, { ppid: 11, ageSec: 9, command: '/bin/zsh' }], [11, { ppid: 10, ageSec: 9, command: `${LINK}` }]]);
  const found = rr.codexUnderPane(10, t, rr.childrenOf(t), DIR, NOW);
  assert.equal(found.pid, 11);
  assert.equal(found.host, false);
});
