'use strict';

/**
 * kosmos#9004: an agent avatar asked for at its CURRENT version (?v=, the file's mtime, which status cards carry as
 * avatarVer) may be kept by the browser, so a card the board rebuilds draws its picture from cache instead of fetching
 * it again (#8990 left that refetch for any card whose markup changed). Every other answer stays no-store: no version,
 * an old or malformed version, and every refusal. The rendered side is docs/browser-checks/render-avatar-steady-8990.js.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-avatar-cache-9004-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const store = require('./engine/store');
require('./test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5d5b1b40000000049454e44ae426082', 'hex');
const KEEP = 'private, max-age=31536000, immutable';
let base;

test.before(async () => {
  store.saveAvatar('alpha', 'image/png', PNG);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const ask = async (q) => {
  const res = await fetch(`${base}/api/agent/alpha/avatar${q}`);
  await res.arrayBuffer();
  return { status: res.status, cache: res.headers.get('cache-control') };
};

test('the picture asked for at its current version may be kept by the browser', async () => {
  const v = store.avatarVersion('alpha');
  assert.ok(v > 0, 'the fixture picture has no version, so nothing below means anything');
  assert.deepEqual(await ask(`?v=${v}`), { status: 200, cache: KEEP });
  // #8990's retry adds retry=N to the same versioned address: still the current picture.
  assert.deepEqual(await ask(`?v=${v}&retry=2`), { status: 200, cache: KEEP });
});

test('anything else stays no-store: no version, an old version, a malformed one', async () => {
  const v = store.avatarVersion('alpha');
  assert.deepEqual(await ask(''), { status: 200, cache: 'no-store' });
  assert.deepEqual(await ask(`?v=${v - 1}`), { status: 200, cache: 'no-store' }, 'an old version may name a picture that has since changed');
  assert.deepEqual(await ask('?v=0'), { status: 200, cache: 'no-store' });
  assert.deepEqual(await ask('?v=abc'), { status: 200, cache: 'no-store' });
  assert.deepEqual(await ask(`?v=${v}.0`), { status: 200, cache: 'no-store' }, 'only the exact version string counts');
});

test('a picture that is not there is never cacheable', async () => {
  const res = await fetch(`${base}/api/agent/nobody-here/avatar?v=1`);
  await res.arrayBuffer();
  assert.equal(res.status, 404);
  assert.notEqual(res.headers.get('cache-control'), KEEP);
});

test('a new picture gets a new version, and the old version stops being cacheable', async () => {
  const before = store.avatarVersion('alpha');
  // mtime resolution: make sure the replacement lands on a later millisecond.
  const until = Date.now() + 5; while (Date.now() < until) { /* spin a few ms */ }
  store.saveAvatar('alpha', 'image/png', PNG);
  const after = store.avatarVersion('alpha');
  assert.notEqual(after, before, 'saving a picture did not change its version, so the URL would not change with it');
  assert.deepEqual(await ask(`?v=${before}`), { status: 200, cache: 'no-store' });
  assert.deepEqual(await ask(`?v=${after}`), { status: 200, cache: KEEP });
});
