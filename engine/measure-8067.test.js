'use strict';
/* #4544: the Prompter's nudge to the AGENT. Real inputs throughout: board cards from
 * test-support/fleet + status.snapshot(), projects and tasks made by engine/projects + engine/tasks,
 * and toAsk produced by the real heartbeat.step. deliver is injected, so no real agent is typed into.
 * Every rule is tested with the arm that must fire AND the arm that must not.
 *
 *   node --test engine/agentnudge.test.js
 */

require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Sandbox every root BEFORE requiring status/fleet/projects (they resolve roots at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'agentnudge-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');

const fleet = require('../test-support/fleet');
const status = require('./status');
const projects = require('./projects');
const tasks = require('./tasks');
const heartbeat = require('./heartbeat');
const nudge = require('./agentnudge');
const { DELIVERY } = require('./chat');
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const INTERVAL = 15 * 60 * 1000;
let seq = 0;

/* A board of agents (idle unless paneState says otherwise) and a fresh project they all belong to. */
function world(specs) {
  const board = fleet.install(specs.map((s) => fleet.agent(s.name, { state: s.paneState || 'idle' })));
  const key = {};
  for (const s of specs) {
    const card = board.agents.find((c) => c.sessionName === s.name) || board.agents.find((c) => (c.sessionName || '').startsWith(s.name));
    key[s.name] = card ? card.sessionName : s.name;
  }
  const p = projects.create({ name: 'Nudge Test ' + (++seq) });
  for (const s of specs) projects.addAgent(p.id, key[s.name], board.agents);
  const cards = status.snapshot().agents;
  return { cards, key, pid: p.id, restore: board.restore };
}

/* A task in the project with its one part on `who`. */
function taskOn(w, who, sentence) {
  const t = tasks.create(w.pid, { sentence, made: { via: 'screen' } });
  const r = tasks.assignPart(w.pid, t.number, 1, who, { via: 'screen' });
  assert.ok(r && r.ok, 'fixture: assignPart refused: ' + JSON.stringify(r));
  return t.number;
}

/* The Prompter's own record after enough ticks for a never-worked idle agent to open a stall. */
function stalled(cards) {
  let prev = new Map();
  let out;
  for (let i = 0; i < heartbeat.STARTUP_STALL_TICKS; i += 1) { out = heartbeat.step(prev, cards, true); prev = out.next; }
  return out;
}

/* One pass with a delivery spy. Past the interval by default, so a part given at fixture time is not fresh. */
function pass(w, o = {}) {
  const calls = [];
  const hb = o.hb || stalled(w.cards);
  const res = nudge.sweepOnce({
    toAsk: hb.toAsk, next: hb.next, roster: w.cards, projects: projects.readAll(),
    book: o.book || new Map(), sent: o.sent || [], now: o.now || (Date.now() + INTERVAL + 1000), intervalMs: INTERVAL,
    limit: o.limit || { on: false },
    deliver: (session, text) => { calls.push({ session, text }); return { state: o.state || DELIVERY.PLACED }; },
    DELIVERY,
  });
  return { calls, res, hb };
}



/* Measurement for kosmos#8067, not a test to keep: one row per way a task can look finished to the agent. */
const row = (name, w, who, extra = {}) => {
  const out = pass(w);
  const calls = out.calls.filter((c) => JSON.stringify(c).includes(who));
  console.log('ROW ' + JSON.stringify({ name, nudged: calls.length, open: nudge.openParts(who, projects.readAll()).length, text: calls[0] ? JSON.stringify(calls[0]).slice(0, 170) : '', ...extra }));
};
const arm = (name, specs, fn) => test(name, () => { const w = world(specs); try { fn(w); } finally { w.restore(); } });

arm('open', [{ name: 'a1' }], (w) => { taskOn(w, w.key.a1, 'open'); row('CONTROL open', w, w.key.a1); });
arm('self built', [{ name: 'a2' }], (w) => { const n = taskOn(w, w.key.a2, 'x'); tasks.setBuilt(w.pid, n, { by: w.key.a2, note: 'done' }); row('self marked built', w, w.key.a2); });
arm('closed', [{ name: 'a3' }], (w) => { const n = taskOn(w, w.key.a3, 'x'); tasks.close(w.pid, n); row('task closed', w, w.key.a3); });
arm('person built', [{ name: 'a4' }], (w) => { const n = taskOn(w, w.key.a4, 'x'); tasks.setBuilt(w.pid, n, { person: true }); row('person marked built', w, w.key.a4); });
arm('teammate built', [{ name: 'a5' }, { name: 'b5' }], (w) => { const n = taskOn(w, w.key.a5, 'x'); const r = tasks.setBuilt(w.pid, n, { by: w.key.b5, note: 'finished it for you' }); row('a TEAMMATE marked my task built', w, w.key.a5, { ok: r && r.ok !== false }); });
arm('unnamed built', [{ name: 'a6' }], (w) => { const n = taskOn(w, w.key.a6, 'x'); const r = tasks.setBuilt(w.pid, n, { note: 'an unnamed caller' }); row('an unnamed caller marked it built', w, w.key.a6, { ok: r && r.ok !== false }); });
arm('case differs', [{ name: 'a7' }], (w) => { const n = taskOn(w, w.key.a7, 'x'); const r = tasks.setBuilt(w.pid, n, { by: w.key.a7.toUpperCase(), note: 'n' }); row('marked built under the name in another case', w, w.key.a7, { ok: r && r.ok !== false }); });
arm('part closed', [{ name: 'a8' }], (w) => { const n = taskOn(w, w.key.a8, 'x'); const t = projects.readAll().find((p) => p.id === w.pid).tasks.find((y) => y.number === n); row('CONTROL shape', w, w.key.a8, { partsField: Object.keys(t).filter((k) => /part|who/i.test(k)).join(',') }); });
