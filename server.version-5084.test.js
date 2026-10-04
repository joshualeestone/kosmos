'use strict';
/* #5084: GET /api/version says which release this board runs, and does nothing else. The promote gate reads it
   to say which version it checked. Round 1 of #5084 measured that POST /api/update/check, the only other route
   that answers `running`, can START an install (checkNow -> refresh -> maybeAutoInstall), so this pins that the
   version read cannot: with a newer build published, an installed copy and auto-update on, GET /api/version runs
   the installer 0 times, and the control (POST /api/update/check, same setup) runs it, so the setup is armed. */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-version-5084-'));
for (const d of ['home', 'data', 'workers', 'launch', 'projects']) fs.mkdirSync(nodePath.join(SANDBOX, d), { recursive: true });
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const update = require('./engine/update');
const { version: PKG_VERSION } = require('./package.json');

let installs = 0;
update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0', artifact: 'kosmos-99.0.0-arm64.tar.gz',
  sha256: 'a'.repeat(64), versioned: 'kosmos-99.0.0-arm64.tar.gz', manifest: 'kosmos-99.0.0-arm64.manifest.json' }) }));
update.setInstalledRoot(() => nodePath.join(SANDBOX, 'installed-root'));
update.setAutoPref(() => ({ on: true, ok: true }));
update.setInstallRunner(() => { installs += 1; return null; });
update.setPlatform('darwin');

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => {
  try { server.close(); } catch { /* the port is going away anyway */ }
  update.setInstallRunner(null); update.setFetcher(null); update.setAutoPref(null); update.setInstalledRoot(null); update.setPlatform(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('#5084: GET /api/version answers the running release, and only that', async () => {
  const res = await fetch(base + '/api/version');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { running: PKG_VERSION });
});

test('#5084: reading the version never starts an install; POST /api/update/check (the control) does, so the setup is armed', async () => {
  installs = 0;
  for (let i = 0; i < 3; i += 1) assert.equal((await fetch(base + '/api/version')).status, 200);
  assert.equal(installs, 0, 'GET /api/version started an install');
  const c = await fetch(base + '/api/update/check', { method: 'POST' });
  assert.equal(c.status, 200);
  assert.ok(installs >= 1, `the control did not install (installs=${installs}), so the 0 above proves nothing`);
});
