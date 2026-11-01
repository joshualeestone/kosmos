'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const st = require('./status');

const { line } = require('../test-support/fleet');
const pane = (session) => line({ session });
const PANES = [pane('one-discord'), pane('two-discord')].join('\n');
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

test('#7693: old text is used and marked remembered: it is never re-read, so a slow gather costs no blocking round', async () => {
  const real = Date.now;
  await withSeams(() => { Date.now = () => real() + 3001; return Promise.resolve(ASKING); }, async () => {
    try {
      const board = await st.snapshotUnheld();
      const one = board.agents.find((a) => a.sessionName === 'one');
      assert.equal(one.state, 'needs_you', 'the gathered text, not a live read of a pane that does not exist');
      assert.equal(one.screenRead, 'remembered');
    } finally { Date.now = real; }
  });
});

test('CONTROL: young text is not marked remembered', async () => {
  await withSeams(() => Promise.resolve(ASKING), async () => {
    const board = await st.snapshotUnheld();
    assert.equal(board.agents.find((a) => a.sessionName === 'one').screenRead, undefined);
  });
});

test('#7693: live reads are capped: past the cap a pane with no text is marked remembered, and the snapshot answers', async () => {
  const many = Array.from({ length: 6 }, (_, i) => pane(`p${i}-discord`)).join('\n');
  st.setPaneSource(() => many);
  st.setCaptureAsync(() => Promise.resolve(null));
  try {
    const board = await st.snapshotUnheld();
    assert.equal(board.agents.length, 6);
    assert.equal(board.agents.filter((a) => a.screenRead === 'remembered').length, 3, 'three live reads, then none');
  } finally { st.setPaneSource(null); st.setCaptureAsync(undefined); }
});

test('#7693: a hung pane cannot hold the answer past the wait', async () => {
  await withSeams((target) => (target.startsWith('one') ? new Promise(() => {}) : Promise.resolve(ASKING)), async () => {
    const t0 = Date.now();
    const board = await st.snapshotUnheld();
    assert.ok(Date.now() - t0 < 2700 + 1500, 'answered near the 2.5 s wait');
    assert.equal(stateOf(board, 'two'), 'needs_you');
  });
});

test('#7693: a pane mid-restart is read live, not from the gather', async () => {
  const disruption = require('./disruption');
  disruption.begin('one', 'restart');
  try {
    await withSeams(() => Promise.resolve(ASKING), async () => {
      const board = await st.snapshotUnheld();
      assert.notEqual(stateOf(board, 'one'), 'needs_you');
      assert.equal(stateOf(board, 'two'), 'needs_you', 'CONTROL: the other pane used the gather');
    });
  } finally { disruption.clear('one'); }
});

test('#7693: the gather lists the panes: no second, blocking list', async () => {
  let lists = 0;
  st.setPaneSource(() => { lists += 1; return PANES; });
  st.setCaptureAsync(() => Promise.resolve(ASKING));
  try {
    await st.snapshotUnheld();
    assert.equal(lists, 1);
  } finally { st.setPaneSource(null); st.setCaptureAsync(undefined); }
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
  const at = src.indexOf("if ((pathname === '/api/status' && (req.method === 'GET' || req.method === 'HEAD'))");
  assert.ok(at > 0, 'the route was not found');
  assert.match(src.slice(at, at + 700), /const snap = await snapshotUnheld\(\);/);
});

test('#7693: the budget of live reads is shared by requests on one gather', async () => {
  const many = Array.from({ length: 6 }, (_, i) => pane(`p${i}-discord`)).join('\n');
  let open;
  const gate = new Promise((r) => { open = r; });
  st.setPaneSource(() => many);
  st.setCaptureAsync(() => gate.then(() => null));
  try {
    const both = [st.snapshotUnheld(), st.snapshotUnheld()];
    await new Promise((r) => setImmediate(r));
    open();
    const [a, b] = await Promise.all(both);
    const remembered = (x) => x.agents.filter((c) => c.screenRead === 'remembered').length;
    assert.equal(remembered(a) + remembered(b), 12 - 3, 'three live reads between the two');
  } finally { st.setPaneSource(null); st.setCaptureAsync(undefined); }
});

test('#7693: a pane that has not answered gets no live read', async () => {
  await withSeams((target) => (target.startsWith('one') ? new Promise(() => {}) : Promise.resolve(ASKING)), async () => {
    const board = await st.snapshotUnheld();
    assert.equal(board.agents.find((a) => a.sessionName === 'one').screenRead, 'remembered');
  });
});

test('#7693: a list that cannot be read is the honest error, with no capture run', async () => {
  let asked = 0;
  st.setPaneSource(() => null);
  st.setCaptureAsync(() => { asked += 1; return Promise.resolve(ASKING); });
  try {
    await assert.rejects(st.snapshotUnheld(), /could not see/);
    assert.equal(asked, 0);
  } finally { st.setPaneSource(null); st.setCaptureAsync(undefined); }
});

test('#7693: a pane the gather has no text for keeps its unsent record: only the live-read panes lose theirs', async () => {
  const many = Array.from({ length: 5 }, (_, i) => pane(`p${i}-discord`)).join('\n');
  const SCREEN = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'test-support', 'composer-6249', 'typed-long.ansi'), 'utf8');
  const BOX = SCREEN.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  let ansi = 0;
  st.setAnsiCapture(() => { ansi += 1; return SCREEN; });
  st.setPaneSource(() => many);
  st.setPaneCapture(() => BOX);
  try {
    st.snapshot();
    assert.equal(ansi, 5, 'each box read once to start');
    st.snapshot();
    assert.equal(ansi, 5, 'CONTROL: the same box is not read again');
    st.setPaneCapture(null);
    st.setCaptureAsync(() => Promise.resolve(null));
    await st.snapshotUnheld();   // three live reads (no such panes, so no text), two held
    st.setPaneCapture(() => BOX);
    st.snapshot();
    assert.equal(ansi, 8, 'the three that read nothing start again; the two held ones did not');
  } finally {
    st.setPaneSource(null); st.setPaneCapture(null); st.setCaptureAsync(undefined); st.setAnsiCapture(null); st.resetUnsentForTests();
  }
});

test('#7693: the board\'s thread turns while a real (fake, slow) tmux answers, and the board is built from its text', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unheld-7693-'));
  const bin = path.join(dir, 'tmux');
  fs.writeFileSync(bin, `#!/bin/sh
for a in "$@"; do
  case "$a" in
    list-panes) printf '%s\\n' '${pane('one-discord')}'; exit 0 ;;
    capture-pane) sleep 2; printf 'Do you want to proceed?\\n\\342\\235\\257 1. Yes\\n  2. No\\n'; exit 0 ;;
  esac
done
exit 0
`, { mode: 0o755 });
  const saved = process.env.AGENT_WORKFORCE_TMUX_BIN;
  process.env.AGENT_WORKFORCE_TMUX_BIN = bin;
  let longest = 0, last = 0, running = true;
  const spin = () => { const t = Date.now(); if (last) longest = Math.max(longest, t - last); last = t; if (running) setImmediate(spin); };
  try {
    setImmediate(spin);
    const board = await st.snapshotUnheld();
    running = false;
    assert.ok(longest < 1000, `the board's thread was held for ${longest} ms`);
    assert.equal(stateOf(board, 'one'), 'needs_you');
  } finally {
    running = false;
    if (saved === undefined) delete process.env.AGENT_WORKFORCE_TMUX_BIN; else process.env.AGENT_WORKFORCE_TMUX_BIN = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#7693: a slow list does not make fresh captures read as old', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unheld-7693-'));
  const bin = path.join(dir, 'tmux');
  fs.writeFileSync(bin, `#!/bin/sh
for a in "$@"; do
  case "$a" in
    list-panes) sleep 3.2; printf '%s\\n' '${pane('one-discord')}'; exit 0 ;;
    capture-pane) printf 'Do you want to proceed?\\n\\342\\235\\257 1. Yes\\n  2. No\\n'; exit 0 ;;
  esac
done
exit 0
`, { mode: 0o755 });
  const saved = process.env.AGENT_WORKFORCE_TMUX_BIN;
  process.env.AGENT_WORKFORCE_TMUX_BIN = bin;
  try {
    const board = await st.snapshotUnheld();
    const one = board.agents.find((a) => a.sessionName === 'one');
    assert.equal(one.state, 'needs_you');
    assert.equal(one.screenRead, undefined);
  } finally {
    if (saved === undefined) delete process.env.AGENT_WORKFORCE_TMUX_BIN; else process.env.AGENT_WORKFORCE_TMUX_BIN = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#7693: colour reads of the box spend the budget of live reads', async () => {
  const many = Array.from({ length: 5 }, (_, i) => pane(`q${i}-discord`)).join('\n');
  const SCREEN = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'test-support', 'composer-6249', 'typed-long.ansi'), 'utf8');
  const BOX = SCREEN.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  let ansi = 0;
  st.setAnsiCapture(() => { ansi += 1; return SCREEN; });
  st.setPaneSource(() => many);
  st.setCaptureAsync(() => Promise.resolve(BOX));
  try {
    await st.snapshotUnheld();
    assert.equal(ansi, 3);
  } finally { st.setPaneSource(null); st.setCaptureAsync(undefined); st.setAnsiCapture(null); st.resetUnsentForTests(); }
});
