'use strict';
/**
 * #5382 x #4588 ask 3: failover through the Gemini subscription cap (written in the merge-resolution review of
 * failover-5382 after main gained the cap). A failover move is one more give, so it must take and give back a cap slot
 * exactly as an ordinary give does: held when the cap is full, kept when the move reached its agent, freed when it did
 * not, whether the part goes back to the agent it came from or (that agent having left) to nobody, and freed even when
 * taking the part back fails.
 *
 *   node --test server.assigner-failover-cap-5382.test.js
 */
const R = __dirname;
require(R + '/test-support/tmpscope');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-focap-'));
process.env.HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(R, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
const test = require('node:test'); const assert = require('node:assert/strict');
const store = require(R + '/engine/store');
const fleet = require(R + '/test-support/fleet');
const projects = require(R + '/engine/projects');
const tasks = require(R + '/engine/tasks');
const chat = require(R + '/engine/chat');
const q = require(R + '/engine/agyquota');
const capSetting = require(R + '/engine/agycap-setting');
const { givePart } = require(R + '/server');
require(R + '/test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [store.ROOT]);
test.after(() => { try { fleet.restore(); } catch { /* restored already */ } try { fs.rmSync(capSetting.FILE, { force: true }); } catch { /* not written */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });
let seq = 0;
/* The holder on Claude (rate limited), the receiver on a Gemini subscription (antigravity, idle), and optionally a
   Gemini colleague already working. Real cards from test-support/fleet, never hand-built rows (fixture-discipline). */
/* An Antigravity agent's state comes from its reports, not its screen, so fleet reads it as unknown; its state is set on
   a copy of the REAL card, as engine/agycap-gate-4588.test.js does. */
const AGY = { state: 'unknown', runner: 'antigravity', command: 'agy', screen: '' };
function setup(holder, receiver, { busy } = {}) {
  const board = fleet.install([fleet.agent(holder, { state: 'rate_limited' }), fleet.agent(receiver, AGY),
    ...(busy ? [fleet.agent(busy, AGY)] : [])]);
  const want = { [receiver]: 'idle', ...(busy ? { [busy]: 'working' } : {}) };
  const roster = board.agents.map((c) => (c.sessionName in want ? { ...c, state: want[c.sessionName], quotaUntil: null } : c));
  const p = projects.create({ name: 'FoCap ' + (++seq) });
  for (const n of [holder, receiver]) projects.addAgent(p.id, n, board.agents);
  const t = tasks.create(p.id, { sentence: 'write the notes', made: { via: 'screen' } });
  const n = t.task ? t.task.number : t.number;
  assert.ok(tasks.assignPart(p.id, n, 1, holder, { via: 'screen' }).ok);
  const partOf = () => tasks.partsOf(tasks.byNumber(projects.readAll().find((x) => x.id === p.id), n))[0];
  return { board, roster, pid: p.id, n, partOf };
}
function withDeliver(state, fn) { const real = chat.deliver; chat.deliver = () => ({ state, because: null }); try { return fn(); } finally { chat.deliver = real; } }
test.beforeEach(() => { q.CAP_STARTS.clear(); q.POOL_MEMO.bySession.clear(); q.POOL_MEMO.seen.clear(); assert.deepEqual(capSetting.set({ maxWorking: 1 }), { ok: true }); });

test('#5382: a failover to a Gemini agent while the cap is full is held, and the part stays where it was', () => {
  const s = setup('fch1', 'fcr1', { busy: 'fcbusy1' });
  try {
    const roster = s.roster;
    const g = withDeliver(chat.DELIVERY.PLACED, () => givePart(s.pid, s.n, 1, 'fcr1', { assigner: true, roster, from: 'fch1' }));
    assert.equal(g.ok, false); assert.equal(g.held, true);
    assert.equal(s.partOf().who, 'fch1');
    assert.equal(q.CAP_STARTS.has('fcr1'), false);
  } finally { s.board.restore(); }
});
test('#5382: a failover that reached its Gemini agent keeps that agent\'s cap slot', () => {
  const s = setup('fch2', 'fcr2');
  try {
    const roster = s.roster;
    const g = withDeliver(chat.DELIVERY.PLACED, () => givePart(s.pid, s.n, 1, 'fcr2', { assigner: true, roster, from: 'fch2' }));
    assert.equal(g.ok, true, g.because); assert.equal(q.CAP_STARTS.has('fcr2'), true);
  } finally { s.board.restore(); }
});
test('#5382: a failover that did not reach its agent goes back where it came from and frees the slot', () => {
  const s = setup('fch3', 'fcr3');
  try {
    const roster = s.roster;
    const g = withDeliver(chat.DELIVERY.COULD_NOT, () => givePart(s.pid, s.n, 1, 'fcr3', { assigner: true, roster, from: 'fch3' }));
    assert.equal(g.ok, false); assert.equal(s.partOf().who, 'fch3'); assert.equal(q.CAP_STARTS.has('fcr3'), false);
  } finally { s.board.restore(); }
});
test('#5382: with the agent it came from gone, an unreached failover goes to nobody and frees the slot', () => {
  const s = setup('fch4', 'fcr4');
  try {
    projects.removeAgent(s.pid, 'fch4', { via: 'screen' });
    const roster = s.roster;
    const g = withDeliver(chat.DELIVERY.COULD_NOT, () => givePart(s.pid, s.n, 1, 'fcr4', { assigner: true, roster, from: 'fch4' }));
    assert.equal(g.ok, false); assert.equal(s.partOf().who, null); assert.equal(q.CAP_STARTS.has('fcr4'), false);
  } finally { s.board.restore(); }
});
test('#5382: taking the part back failing outright still frees the slot, and says so', () => {
  const s = setup('fch5', 'fcr5');
  const real = tasks.assignPart;
  try {
    const roster = s.roster;
    let g = null;
    withDeliver(chat.DELIVERY.COULD_NOT, () => {
      // Back to the agent it came from is refused; back to nobody throws (a store that cannot be written).
      tasks.assignPart = (pid, n, part, who, made) => { if (made && made.onlyIfWho === 'fcr5') { if (who === null) throw new Error('disk'); return { ok: false, because: 'refused' }; } return real(pid, n, part, who, made); };
      g = givePart(s.pid, s.n, 1, 'fcr5', { assigner: true, roster, from: 'fch5' });
    });
    assert.equal(g.ok, false);
    assert.equal(g.status, 409);
    assert.match(g.because, /taking it back failed: disk/);
    assert.equal(q.CAP_STARTS.has('fcr5'), false, 'the slot is still held after the take-back failed');
  } finally { tasks.assignPart = real; s.board.restore(); }
});

test('#5382: a failover the task refuses (its part finished since it was picked) frees the slot it took', () => {
  const s = setup('fch6', 'fcr6');
  try {
    assert.ok(tasks.setPartClosed(s.pid, s.n, 1, new Date().toISOString()).ok !== false);
    const roster = s.roster;
    const g = withDeliver(chat.DELIVERY.PLACED, () => givePart(s.pid, s.n, 1, 'fcr6', { assigner: true, roster, from: 'fch6' }));
    assert.equal(g.ok, false, 'a finished part was moved');
    assert.equal(s.partOf().who, 'fch6');
    assert.equal(q.CAP_STARTS.has('fcr6'), false, 'the slot is still held although nothing was moved');
  } finally { s.board.restore(); }
});

test('#5382: a task marked built while an unreached failover was in flight stays built; the part goes to nobody', () => {
  const s = setup('fch7', 'fcr7');
  const real = chat.deliver;
  try {
    const roster = s.roster;
    // The person marks the task built while the line to the receiver is being typed, and the line does not land.
    chat.deliver = () => { tasks.setBuilt(s.pid, s.n, { person: true, note: 'done by hand' }); return { state: chat.DELIVERY.COULD_NOT, because: null }; };
    const g = givePart(s.pid, s.n, 1, 'fcr7', { assigner: true, roster, from: 'fch7' });
    assert.equal(g.ok, false);
    const t = tasks.byNumber(projects.readAll().find((x) => x.id === s.pid), s.n);
    assert.ok(t.builtAt, 'taking the part back un-built the task');
    assert.equal(s.partOf().who, null, 'the part should go to nobody rather than back onto a built task');
    assert.equal(q.CAP_STARTS.has('fcr7'), false);
  } finally { chat.deliver = real; s.board.restore(); }
});

test('#5382: a give whose write throws frees the cap slot it took (post-merge review 3; the same on main)', () => {
  const s = setup('fch8', 'fcr8');
  const real = tasks.assignPart;
  try {
    const roster = s.roster;
    tasks.assignPart = (pid, n, part, who, made) => { if (who === 'fcr8' && made && made.failover === true) throw new Error('disk'); return real(pid, n, part, who, made); };
    assert.throws(() => givePart(s.pid, s.n, 1, 'fcr8', { assigner: true, roster, from: 'fch8' }), /disk/);
    assert.equal(q.CAP_STARTS.has('fcr8'), false, 'the slot is still held after the write threw');
  } finally { tasks.assignPart = real; s.board.restore(); }
});
