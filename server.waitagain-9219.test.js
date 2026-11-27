'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9219, over the real /api/report route on a sandboxed board: after a restart retires an agent's own wait
 * (Josh's #5943), `kosmos report <needs_you|blocked> --again` brings it back from the board's own copy, exactly as it
 * was said (its words, --on, --owner, --until and --held), without the agent retyping it. Refused, with a sentence,
 * when there is no such wait (the agent reported something else since) or the state does not match.
 *
 *   node --test server.waitagain-9219.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-9219-'));
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
async function post(body, status = 200) {
  const res = await fetch(base + '/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from_pane: 'x', ...body }) });
  assert.equal(res.status, status, await res.clone().text());
  return res.json();
}
/* A restart, as the hooks report it: SessionEnd's automatic stopped, then the new session's automatic started. */
async function restart() {
  await post({ state: 'stopped', text: 'session ended', auto: true });
  await post({ state: 'started', text: 'session started', auto: true });
}

test('#9219 after a restart, --again brings back the agent\'s own held wait exactly as it said it', async () => {
  await withAgent('wa-held', async () => {
    await post({ state: 'needs_you', text: 'Which logo goes on the cover?', on: 'the cover', owner: 'the person', until: 'the owner says', held: true });
    await restart();
    assert.notEqual(selfreport.read('wa-held').state, 'needs_you', 'the restart retired the wait (#5943), so there is something to bring back');

    const r = await post({ state: 'needs_you', again: true });
    assert.equal(r.recorded, true, JSON.stringify(r));
    const now = selfreport.read('wa-held');
    assert.equal(now.state, 'needs_you');
    assert.equal(now.because, 'Which logo goes on the cover?', 'its own words, not retyped');
    assert.equal(now.on, 'the cover');
    assert.equal(now.owner, 'the person');
    assert.equal(now.until, 'the owner says');
    assert.equal(now.held, true, 'held as before, so nothing buzzes the person');

    // A second --again in the same session brings back the same wait again (harmless: the same words, still held).
    assert.equal((await post({ state: 'needs_you', again: true })).recorded, true);
    assert.equal(selfreport.read('wa-held').because, 'Which logo goes on the cover?');
  });
});

test('#9219 --again is refused when the agent has reported something else since, or names another state', async () => {
  await withAgent('wa-refused', async () => {
    const projectId = require('./engine/projects').create({ name: 'Deploy' }).id;
    await post({ state: 'blocked', text: 'waiting on the deploy key', on: 'the deploy', owner: 'Splinter', project: projectId });
    await restart();

    const wrong = await post({ state: 'needs_you', again: true });
    assert.equal(wrong.recorded, false);
    assert.match(wrong.because, /the wait you reported before was blocked, not needs_you: run kosmos report blocked --again/);

    // CONTROL for the refusal below: the matching state brings it back.
    assert.equal((await post({ state: 'blocked', again: true })).recorded, true);
    assert.equal(selfreport.read('wa-refused').on, 'the deploy');
    assert.equal(selfreport.read('wa-refused').project, projectId, 'the project the wait was about comes back too (review 1)');

    // The agent's own report ends the wait, so there is nothing to bring back after it.
    await post({ state: 'working', text: 'the key arrived' });
    await restart();
    const none = await post({ state: 'blocked', again: true });
    assert.equal(none.recorded, false);
    assert.match(none.because, /there is no wait of yours from before to bring back/);
    assert.notEqual(selfreport.read('wa-refused').state, 'blocked', 'nothing was recorded');
  });
});

test('#9219 --again takes no words or options, and goes only with needs_you or blocked (400)', async () => {
  await withAgent('wa-shape', async () => {
    for (const body of [{ state: 'needs_you', again: true, text: 'new words' }, { state: 'needs_you', again: true, on: 'x' },
      { state: 'needs_you', again: true, held: true }, { state: 'blocked', again: true, auto: true }]) {
      const res = await fetch(base + '/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from_pane: 'x', ...body }) });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(await res.text(), /takes no words or other options/, JSON.stringify(body));
    }
    const res = await fetch(base + '/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from_pane: 'x', state: 'working', again: true }) });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /goes only with needs_you or blocked/);
    const bad = await fetch(base + '/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from_pane: 'x', state: 'needs_you', again: 'yes' }) });
    assert.equal(bad.status, 400);
  });
});

test('#9219 an agent with no wait at all is refused, and nothing is recorded', async () => {
  await withAgent('wa-never', async () => {
    const r = await post({ state: 'needs_you', again: true });
    assert.equal(r.recorded, false);
    assert.match(r.because, /there is no wait of yours from before to bring back/);
    assert.equal(selfreport.read('wa-never').found, false);
  });
});
