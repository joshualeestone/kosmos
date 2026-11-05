'use strict';
/**
 * kosmos#7756 part 2: a question taken back with a reason stays on record in the agent's chat with the person.
 * Over real reports on a sandboxed board.
 *
 *   node --test server.report-withdrawn-7756.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-7756-'));
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
const chat = require('./engine/chat');
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
const rows = (name) => chat.readThread(chat.DIRECT, name).messages;

test('a question cleared with a reason stays on record, in Kosmos\'s words in the agent\'s name', async () => {
  await withAgent('wd-why', async () => {
    await post({ state: 'needs_you', text: 'Should the invoice go to the old address?' });
    assert.equal(rows('wd-why').length, 0, 'control: asking writes no line');
    await post({ state: 'working', text: 'I found the new address on the order', clear: true });
    const got = rows('wd-why');
    assert.equal(got.length, 1);
    assert.equal(got[0].text, 'No longer asking: Should the invoice go to the old address?\nWhy: I found the new address on the order');
    assert.equal(got[0].kosmos, true, 'not an answer the person owes');
    assert.equal(selfreport.read('wd-why').state, 'working', 'and the card cleared');
  });
});

test('a held question is on record too', async () => {
  await withAgent('wd-held', async () => {
    await post({ state: 'needs_you', text: 'Which logo?', held: true });
    await post({ state: 'working', text: 'the brand file says', clear: true });
    assert.match(rows('wd-held')[0].text, /^No longer asking: Which logo\?/);
  });
});

test('nothing is written where there was no question to take back, or no reason', async () => {
  await withAgent('wd-none', async () => {
    await post({ state: 'needs_you', text: 'Which one?' });
    await post({ state: 'working', text: '', clear: true });
    assert.equal(rows('wd-none').length, 0, 'a bare clear');
    await post({ state: 'working', text: 'back at it', clear: true });
    assert.equal(rows('wd-none').length, 0, 'the question was already gone');
    await post({ state: 'blocked', text: 'waiting on the deploy', owner: 'the deploy' });
    await post({ state: 'working', text: 'it landed', clear: true });
    assert.equal(rows('wd-none').length, 0, 'blocked is not a question to the person');
    await post({ state: 'needs_you', text: 'Which two?' });
    await post({ state: 'working', text: 'an ordinary report, not a clear' });
    assert.equal(rows('wd-none').length, 0, 'only clear says it was withdrawn');
  });
});

test('a permission wait raised by a hook is not copied into the chat', async () => {
  await withAgent('wd-auto', async () => {
    await post({ state: 'needs_you', text: 'run rm /Users/someone/secret-folder', auto: true });
    assert.equal(selfreport.read('wd-auto').state, 'needs_you', 'control: the wait stands');
    assert.equal(selfreport.isAutoPermissionWait(selfreport.read('wd-auto')), true, 'control: and is the hook kind');
    await post({ state: 'working', text: 'approved', clear: true });
    assert.equal(selfreport.read('wd-auto').state, 'working', 'the card cleared');
    assert.equal(rows('wd-auto').length, 0);
  });
});

test('a clear that does not say working writes no line', async () => {
  await withAgent('wd-state', async () => {
    await post({ state: 'needs_you', text: 'Which one?' });
    await post({ state: 'needs_you', text: 'Which one, again?', clear: true });
    assert.equal(rows('wd-state').length, 0);
  });
});

test('words only: nothing here is built from the reason unmasked or empty', () => {
  assert.equal(selfreport.withdrawnLine('Q?', '   '), null);
  assert.equal(selfreport.withdrawnLine('Q?', undefined), null);
  assert.equal(selfreport.withdrawnLine('', 'why'), 'No longer asking my last question.\nWhy: why');
});
