'use strict';
/**
 * kosmos#2146: the /api/report route writes a WORK-ACTIVITY marker (activity.js
 * key 'working') ONLY for a `working` report -- never for idle/needs_you/etc.
 *
 * 🛑 THE DANGEROUS-ANSWER CONTROL (a review caught this). activeWhileWaiting's
 * heartbeat leg must read WORK, not mere life. If the route wrote the marker on
 * every report, the Stop hook's end-of-turn `report idle` would mark a
 * just-asked needs_you agent as "still working" one tick later. So the load-
 * bearing assertion here is that an IDLE report writes NO marker, and it is
 * checked with a control (a working report DOES) so the negative means something.
 *
 * Same sandbox posture as server.report-reply-loopback-1968.test.js: boot fully
 * sandboxed, then POST real reports over loopback.
 *
 *   node --test server.work-marker-2146.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-2146-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const activity = require('./engine/activity');
const messages = require('./engine/messages');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

// Resolve any from_pane to the given session, the seam the sibling report tests
// use (messages.setRunner), so a bare from_pane maps to the fixture agent.
function withAgent(name, fn) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: `${name}-discord` }));
  return Promise.resolve().then(fn).finally(() => { messages.setRunner(null); board.restore(); });
}

async function post(p, body) {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text().catch(() => '');
  let json = {}; try { json = JSON.parse(text); } catch { /* {} */ }
  return { code: res.status, json, text };
}

test('a WORKING report writes the work-activity marker', async () => {
  await withAgent('wm-working', async () => {
    assert.equal(activity.read('wm-working', 'working').found, false, 'no marker before');
    const rep = await post('/api/report', { state: 'working', text: 'running a tool', from_pane: 'x', auto: true });
    assert.equal(rep.json.recorded, true, 'the working report recorded: ' + rep.text);
    assert.equal(activity.read('wm-working', 'working').found, true, 'a working report writes the marker');
  });
});

test('CONTROL: an IDLE report writes NO work-activity marker (the false-positive fix)', async () => {
  await withAgent('wm-idle', async () => {
    const rep = await post('/api/report', { state: 'idle', text: 'finished the turn', from_pane: 'x', auto: true });
    assert.equal(rep.json.recorded, true, 'the idle report recorded: ' + rep.text);
    assert.equal(activity.read('wm-idle', 'working').found, false, 'an idle report must NOT write a work marker -- else a finished-turn needs_you reads active');
  });
});

test('a needs_you report writes NO work-activity marker (so filing the ask cannot self-mark)', async () => {
  await withAgent('wm-ask', async () => {
    const rep = await post('/api/report', { state: 'needs_you', text: 'May I merge?', from_pane: 'x' });
    assert.equal(rep.json.recorded, true, 'the needs_you report recorded: ' + rep.text);
    assert.equal(activity.read('wm-ask', 'working').found, false, 'needs_you is not work');
  });
});

test.after(() => { try { server.close(); } catch { /* best effort */ } });
