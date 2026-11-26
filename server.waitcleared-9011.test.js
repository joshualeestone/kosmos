'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9011 part 1, over the real /api/report route on a sandboxed board: `kosmos report clear` (a working report
 * with clear: true) is kept as the agent closing its question, and any other report of its own as the question being
 * dropped, so the card can tell the two apart.
 *
 *   node --test server.waitcleared-9011.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-9011-'));
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
const messages = require('./engine/messages');
const selfreport = require('./engine/selfreport');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

function withAgent(name, fn) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: `${name}-discord` }));
  return Promise.resolve().then(fn).finally(() => { messages.setRunner(null); board.restore(); });
}
async function post(body) {
  const res = await fetch(base + '/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from_pane: 'x', ...body }) });
  assert.equal(res.status, 200, await res.clone().text());
  return res.json();
}

test('#9011 a clear closes the question; any other report of the agent\'s drops it; the hook\'s report ends nothing', async () => {
  await withAgent('wc-route', async () => {
    await post({ state: 'needs_you', text: 'Which logo?', held: true });
    await post({ state: 'working', text: 'the brand file says', clear: true });
    assert.deepEqual({ ...selfreport.read('wc-route').waitCleared, at: 'x' }, { at: 'x', by: 'agent', state: 'needs_you', held: true });

    await post({ state: 'needs_you', text: 'Which font?' });
    assert.equal(selfreport.read('wc-route').waitCleared, null, 'a new question starts over');
    await post({ state: 'working', text: 'on the next item' });
    assert.equal(selfreport.read('wc-route').waitCleared.by, 'replaced', 'a plain report is not a clear');

    /* CONTROL: the hook's automatic working is refused over the agent's question, so nothing ends it. */
    await post({ state: 'needs_you', text: 'Which colour?' });
    await post({ state: 'working', text: 'running Bash', auto: true });
    const r = selfreport.read('wc-route');
    assert.equal(r.state, 'needs_you');
    assert.equal(r.waitCleared, null);
  });
});
