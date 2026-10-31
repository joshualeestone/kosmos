'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const st = require('./status');

const PANES = ['one-discord\t0.0\t2.1.212\t0\t\t\t', 'two-discord\t0.0\t2.1.212\t0\t\t\t'].join('\n');
const ASKING = 'Do you want to proceed?\n❯ 1. Yes\n  2. No\n';

function withSeams(capture, fn) {
  st.setPaneSource(() => PANES);
  st.setCaptureAsync(capture);
  return Promise.resolve().then(fn).finally(() => { st.setPaneSource(null); st.setCaptureAsync(undefined); });
}
const stateOf = (board, name) => board.agents.find((a) => a.sessionName === name).state;

test('#7693: the snapshot is built from the gathered text, with every pane asked for once', async () => {
  const asked = [];
  await withSeams((target, lines) => { asked.push([target, lines]); return Promise.resolve(ASKING); }, async () => {
    const board = await st.snapshotUnheld();
    assert.equal(stateOf(board, 'one'), 'needs_you');
    assert.equal(stateOf(board, 'two'), 'needs_you');
    assert.deepEqual(asked.map((a) => a[1]), [40, 40]);
    assert.equal(new Set(asked.map((a) => a[0])).size, 2);
  });
});

test('CONTROL: a plain snapshot() never uses the gathered path, so every other caller stays a live read', async () => {
  let asked = 0;
  await withSeams(() => { asked += 1; return Promise.resolve(ASKING); }, async () => {
    const board = st.snapshot();
    assert.equal(asked, 0);
    assert.notEqual(stateOf(board, 'one'), 'needs_you');
  });
});

test('#7693: no text outlives its snapshot: the next plain snapshot does not see it', async () => {
  await withSeams(() => Promise.resolve(ASKING), async () => {
    await st.snapshotUnheld();
    assert.notEqual(stateOf(st.snapshot(), 'one'), 'needs_you');
  });
});

test('#7693: text whose capture was asked for too long ago is not used', async () => {
  const real = Date.now;
  await withSeams(() => { Date.now = () => real() + 3001; return Promise.resolve(ASKING); }, async () => {
    try {
      const board = await st.snapshotUnheld();
      assert.notEqual(stateOf(board, 'one'), 'needs_you');
    } finally { Date.now = real; }
  });
});

test('#7693: a capture that fails or throws falls back, and the snapshot still answers', async () => {
  let n = 0;
  await withSeams(() => { n += 1; if (n === 1) throw new Error('no tmux'); return Promise.resolve(null); }, async () => {
    const board = await st.snapshotUnheld();
    assert.equal(board.agents.length, 2);
  });
});

test('#7693: requests during a gather share it', async () => {
  let asked = 0, open;
  const gate = new Promise((r) => { open = r; });
  await withSeams(() => { asked += 1; return gate.then(() => ASKING); }, async () => {
    const both = [st.snapshotUnheld(), st.snapshotUnheld()];
    await new Promise((r) => setImmediate(r));
    open();
    await Promise.all(both);
    assert.equal(asked, 2, 'two panes once each, not four');
    await st.snapshotUnheld();
    assert.equal(asked, 4, 'the next request gathers again: nothing is kept between requests');
  });
});

test('#7693: with a capture seam set (a Windows board, a fixture) the gather is not used', async () => {
  let asked = 0;
  st.setPaneCapture(() => ASKING);
  try {
    await withSeams(() => { asked += 1; return Promise.resolve('x'); }, async () => {
      const board = await st.snapshotUnheld();
      assert.equal(asked, 0);
      assert.equal(stateOf(board, 'one'), 'needs_you');
    });
  } finally { st.setPaneCapture(null); }
});

test('#7693: GET /api/status is the route that uses it', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf("if (pathname === '/api/status' && (req.method === 'GET' || req.method === 'HEAD')) {");
  assert.ok(at > 0, 'the route was not found');
  assert.match(src.slice(at, at + 200), /const snap = await snapshotUnheld\(\);/);
});
