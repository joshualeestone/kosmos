'use strict';
/**
 * kosmos#9085: on a Windows box `claude agents --json` crashed about once a minute for five hours. Past win32roster's
 * hold the roster refused, the send gate (server.js knownAgent, which asks status.paneRoster through claimantFor)
 * read "no agent by that name", and every message to a running agent was answered 404 until the crashes stopped.
 *
 * These drive the REAL status.js roster with a reader that fails. The fixed behaviour: a Kosmos-owned Claude agent
 * whose supervisor is up is still on the roster, as ours. Controls: the same failure with no supervisor up still
 * refuses, an unrecorded or per-turn name is never listed this way, and a good read is used as before.
 *
 *   node --test engine/win32roster.listfail-9085.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32roster-listfail-9085-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const status = require('./status');
const win32roster = require('./win32roster');

const RAPH = { pid: 100, cwd: 'w', kind: 'interactive', startedAt: 1, sessionId: 'aaaa-1111', name: 'raph-9a', status: 'idle' };
const OWNED = {
  'aaaa-1111': { name: 'raph-9a', runner: '', at: '2026-11-25T08:00:00.000Z' },
  'aaaa-2222': { name: 'raph-9a', runner: '', at: '2026-11-25T09:00:00.000Z' },   // a resume: the same agent, a newer row
  'cccc-3333': { name: 'cody', runner: 'codex', at: '2026-11-25T09:00:00.000Z' },
};

/* One clock, a reader whose answers are set per step, and every seam make() takes, so nothing reads this machine. */
function rig({ supervised = new Set(['raph-9a']), owned = OWNED } = {}) {
  const st = { t: 1000, answer: [RAPH], asked: 0, logs: [] };
  const run = () => st.answer;
  run.problem = () => (st.answer === null ? 'the status read exited with code 3' : null);
  const src = win32roster.make({
    run, now: () => st.t, holdMs: 15000,
    record: { read: () => owned },
    codexLive: () => [],
    supervised: () => { st.asked += 1; return supervised; },
    log: (name, event, because) => st.logs.push({ name, event, because }),
  });
  return { st, src };
}

function roster(src) {
  status.setPaneSource(src);
  try { return status.paneRoster(); } finally { status.setPaneSource(null); }
}

test('#9085: a failed read past the hold keeps a supervised Kosmos agent on the roster, as ours, and says why in its log', () => {
  const { st, src } = rig();
  assert.deepEqual(roster(src).map((a) => a.sessionName), ['raph-9a'], 'CONTROL: a good read lists the agent');
  st.answer = null; st.t += 60000;   // the read fails, and it has failed for longer than the hold
  const cards = roster(src);
  assert.deepEqual(cards.map((a) => a.sessionName), ['raph-9a'], 'the agent is still listed, once for its two record rows');
  assert.equal(cards[0].isNamedOurs, true, 'and it is ours, so the send gate (knownAgent) lets a message through');
  assert.equal(st.logs.length, 1, 'one log line for the switch');
  assert.equal(st.logs[0].name, 'raph-9a');
  assert.equal(st.logs[0].event, 'listed by its supervisor');
  assert.match(st.logs[0].because, /could not be read \(the status read exited with code 3\)/, 'the log carries why the read failed');
  roster(src);
  assert.equal(st.logs.length, 1, 'a second failed read writes nothing more');
  st.answer = [RAPH];
  assert.deepEqual(roster(src).map((a) => a.sessionName), ['raph-9a']);
  assert.deepEqual(st.logs.map((l) => l.event), ['listed by its supervisor', 'listed normally again'], 'the way back is logged');
});

test('#9085 control: the same failure with no supervisor up still refuses, as before', () => {
  const { st, src } = rig({ supervised: new Set() });
  roster(src);
  st.answer = null; st.t += 60000;
  assert.throws(() => roster(src), 'a failed look with nothing up is still "we could not look", never an empty machine');
  assert.equal(st.logs.length, 0);
});

test('#9085 control: inside the hold the last good list is used and the supervisors are not asked', () => {
  const { st, src } = rig();
  roster(src);
  st.answer = null; st.t += 5000;
  assert.deepEqual(roster(src).map((a) => a.sessionName), ['raph-9a']);
  assert.equal(st.asked, 0, 'the fallback is only for a failure past the hold');
  assert.equal(st.logs.length, 0);
});

test('#9085: only a RECORDED, non-per-turn name is listed by its supervisor', () => {
  const { st, src } = rig({ supervised: new Set(['raph-9a', 'cody', 'stranger']) });
  st.answer = null;   // never a good read, so there is no hold to use
  assert.deepEqual(roster(src).map((a) => a.sessionName), ['raph-9a'],
    'a stranger is not in the record, and a codex agent comes from codexLive, not from here');
});

test('#9085: a supervisor reader that throws or answers nothing usable is a failed look, not a crash', () => {
  for (const bad of [() => { throw new Error('x'); }, () => null, () => ['raph-9a']]) {
    const src = win32roster.make({ run: () => null, now: () => 0, record: { read: () => OWNED }, codexLive: () => [], supervised: bad, log: () => {} });
    assert.equal(src(), null);
  }
});
