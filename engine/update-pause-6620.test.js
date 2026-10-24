'use strict';

/**
 * kosmos#6620 (O04-5): the fleet's update pause, on the board (engine/update.js) and over real HTTP. A local server
 * stands in for the coordinator's /v1/meta, named with KOSMOS_UPDATE_PAUSE_URL, so nothing here reaches a real
 * server. The run-setup and Windows paths are covered in install.update-pause-6620.test.js and
 * engine/win32connectupdate.test.js.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const update = require('./update');
const mv = require('./manifest-verify');

let server; let base; let answer = { updates_paused: false }; let asked = 0;
test.before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/redirect/v1/meta') { res.writeHead(302, { location: '/v1/meta' }); res.end(); return; }
    if (req.url === '/slow/v1/meta') { setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer)); }, 300); return; }
    asked += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

/** The Mac form (sync curl) run in a child, so this process can keep serving while it waits. */
function pausedSyncInChild(url) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e', 'process.stdout.write(String(require(process.argv[1]).pausedSync({ env: { KOSMOS_UPDATE_PAUSE_URL: process.argv[2] } })))',
      path.join(__dirname, 'manifest-verify.js'), url], (err, out) => (err ? reject(err) : resolve(out)));
  });
}

function withPauseUrl(url, fn) {
  const before = process.env.KOSMOS_UPDATE_PAUSE_URL;
  process.env.KOSMOS_UPDATE_PAUSE_URL = url;
  return Promise.resolve(fn()).finally(() => {
    if (before === undefined) delete process.env.KOSMOS_UPDATE_PAUSE_URL; else process.env.KOSMOS_UPDATE_PAUSE_URL = before;
  });
}

function board(version) {
  update.resetCache();
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version }) }));
  update.setInstalledRoot(() => '/nonexistent/kosmos-install-root');
  update.setAutoPref(() => ({ on: true, ok: true }));
  let started = 0;
  update.setInstallRunner(() => { started += 1; return { on() {}, unref() {} }; });
  return () => started;
}
function clear() {
  update.setFetcher(null); update.setInstalledRoot(null); update.setAutoPref(null); update.setInstallRunner(null); update.resetCache();
}

test('board: paused, a newer version is not installed automatically and paused() says so; CONTROL: not paused, it is', async () => {
  await withPauseUrl(base + '/v1/meta', async () => {
    answer = { updates_paused: true };
    let started = board('99.0.0');
    await update.refresh();
    assert.equal(update.paused(), true);
    assert.equal(started(), 0, 'an automatic install started during a pause');
    clear();
    answer = { updates_paused: false };
    started = board('99.0.0');
    await update.refresh();
    assert.equal(update.paused(), false);
    assert.equal(started(), 1, 'CONTROL: not paused, the same look installs');
    clear();
  });
});

test('board: with nothing newer on offer, the pause is not asked at all', async () => {
  await withPauseUrl(base + '/v1/meta', async () => {
    answer = { updates_paused: true };
    const before = asked;
    board('0.0.1');
    await update.refresh();
    assert.equal(asked, before, 'an up-to-date board asked the coordinator');
    assert.equal(update.paused(), false);
    clear();
  });
});

test('board: with automatic updates off, the coordinator is not asked (a manual press is held by run-setup)', async () => {
  await withPauseUrl(base + '/v1/meta', async () => {
    answer = { updates_paused: true };
    const before = asked;
    board('99.0.0');
    update.setAutoPref(() => ({ on: false, ok: true }));
    await update.refresh();
    assert.equal(asked, before, 'a board with automatic updates off asked the coordinator');
    clear();
  });
});

test('board: an automatic install held back for another reason (an account move) does not ask the coordinator either (review 7)', async () => {
  await withPauseUrl(base + '/v1/meta', async () => {
    answer = { updates_paused: true };
    const before = asked;
    const started = board('99.0.0');
    update.setAutoDefer(() => true);
    try { await update.refresh(); } finally { update.setAutoDefer(null); }
    assert.equal(asked, before, 'a deferred board asked the coordinator');
    assert.equal(started(), 0);
    clear();
    answer = { updates_paused: false };
  });
});

test('over HTTP: both forms read a real answer, and neither follows a redirect', async () => {
  answer = { updates_paused: true };
  const env = { KOSMOS_UPDATE_PAUSE_URL: base + '/v1/meta' };
  assert.equal(await mv.pausedAsync({ env }), true);
  assert.equal(await pausedSyncInChild(base + '/v1/meta'), 'true', 'the Mac form (curl) over http');
  const redirected = { KOSMOS_UPDATE_PAUSE_URL: base + '/redirect/v1/meta' };
  assert.equal(await mv.pausedAsync({ env: redirected }), false, 'a redirect is not followed (fetch)');
  assert.equal(await pausedSyncInChild(base + '/redirect/v1/meta'), 'false', 'a redirect is not followed (curl)');
  answer = { updates_paused: false };
});

test('the request shape: curl is called with -q first and a time limit, on the named address', () => {
  const calls = [];
  mv.pausedSync({ env: { KOSMOS_UPDATE_PAUSE_URL: 'http://127.0.0.1:9/v1/meta' }, spawnSync: (cmd, args) => { calls.push([cmd, ...args]); return { status: 7, stdout: '' }; } });
  assert.deepEqual(calls, [['curl', '-q', '-fsS', '--max-time', '5', 'http://127.0.0.1:9/v1/meta']]);
});

test('an Install press asks NOW: a pause lifted since the last look does not refuse, a live pause does, no answer does not', async () => {
  await withPauseUrl(base + '/v1/meta', async () => {
    answer = { updates_paused: true };
    board('99.0.0');
    await update.refresh();
    assert.equal(update.paused(), true, 'the last look saw the pause');
    answer = { updates_paused: false };
    assert.equal(await update.pauseRefusalNow(), null, 'the pause was lifted after the look; the press must not be refused');
    assert.equal(update.paused(), false, 'and the status follows the live answer');
    answer = { updates_paused: true };
    assert.equal(await update.pauseRefusalNow(), update.PAUSED_SENTENCE.charAt(0).toUpperCase() + update.PAUSED_SENTENCE.slice(1) + '.');
    answer = { updates_paused: false };
    clear();
  });
  await withPauseUrl('http://127.0.0.1:9/v1/meta', async () => {
    assert.equal(await update.pauseRefusalNow(), null, 'an unreachable coordinator is not a pause');
  });
});

test('the /api/update route refuses from the live ask (a source pin: deleting the refusal turns this red)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = src.indexOf("pathname === '/api/update' && req.method === 'POST'");
  assert.ok(start > 0, 'the /api/update route moved; re-pin this test');
  const route = src.slice(start, src.indexOf('if (updates.alreadyInstalling()) {', start));
  const ask = route.indexOf('await updates.pauseRefusalNow()');
  const refuse = route.indexOf('if (pauseRefusal && !updates.alreadyInstalling()) { say(409, { error: pauseRefusal }); return; }');
  assert.ok(ask > 0 && refuse > 0, 'the live ask or its refusal is gone from the route');
  // Review 5: the ask (an await) comes before every check, so none of them is read before a pause of seconds.
  for (const check of ['const avail = updates.available()', 'moveHoldsBoard()', 'updates.installedRoot()', 'updates.selfInstallRefusal()']) {
    assert.ok(route.indexOf(check) > ask, check + ' is read before the pause ask');
  }
  assert.ok(refuse > route.indexOf('windowsLocationRefusal'), 'the platform and location refusals still answer first');
});

test('during the ask, paused() keeps the previous look\'s answer rather than dropping to not paused', async () => {
  await withPauseUrl(base + '/slow/v1/meta', async () => {
    answer = { updates_paused: true };
    board('99.0.0');
    await update.refresh();
    assert.equal(update.paused(), true);
    const again = update.refresh();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(update.paused(), true, 'mid-ask, the status read not paused');
    await again;
    answer = { updates_paused: false };
    clear();
  });
});
