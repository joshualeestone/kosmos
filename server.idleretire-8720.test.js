'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#8720 through the real server (in-process, every root sandboxed, dry run): the idle-retire route. It reads
 * off and 30 days when never set; its PUT takes only a screen (an Origin the board serves), only true or false for
 * on and only a listed number of days, and answers with the same view GET gives (setting, verdicts, recent).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-idleretire-route-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
require('./test-support/faketmux-win').serveOnWindows();   // kosmos#8378: fake tmux's reads on Windows, where its script cannot run
const { start, server, _clearSweepRosterForTest, _idleRetireSweepDepsForTest, _idleRetireActiveForTest } = require('./server');
const store = require('./engine/store');

let port = 0;
test.before(async () => { await start(0); port = server.address().port; });
test.after(() => {
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* node:http, so the Origin header is sent as written (fetch controls some request headers itself). */
function call(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch { j = null; } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const screen = () => ({ origin: `http://127.0.0.1:${port}` });
const settingOf = (r) => r.json && r.json.setting;

test('#8720: the setting reads off and 30 days when never set, with the verdict list and the recent retirements', async () => {
  const first = await call('GET', '/api/idle-retire');
  assert.equal(first.status, 200);
  assert.deepEqual(settingOf(first), { on: false, days: 30, ok: true }, 'a person who never set it did not get it off');
  assert.deepEqual(first.json.choices, [14, 30, 60, 90]);
  assert.ok(Array.isArray(first.json.verdicts), 'Settings was not given the verdicts');
  assert.ok(Array.isArray(first.json.recent), 'Settings was not given the recent retirements');
});

test('#8720: only a screen may change it, and only to a real value; a refused change is not saved', async () => {
  const noScreen = await call('PUT', '/api/idle-retire', { on: true });
  assert.equal(noScreen.status, 403, 'a caller that is not the screen turned it on');
  const notBool = await call('PUT', '/api/idle-retire', { on: 'yes' }, screen());
  assert.equal(notBool.status, 400, 'a value that is not true or false was taken');
  const badDays = await call('PUT', '/api/idle-retire', { days: 7 }, screen());
  assert.equal(badDays.status, 400, 'a number of days that is not offered was taken');
  const nothing = await call('PUT', '/api/idle-retire', {}, screen());
  assert.equal(nothing.status, 400, 'an empty change answered as if it saved something');
  assert.deepEqual(settingOf(await call('GET', '/api/idle-retire')), { on: false, days: 30, ok: true }, 'a refused change was saved anyway');
  assert.equal(fs.existsSync(path.join(store.ROOT, 'idleretire.json')), false, 'a refused change wrote the setting file');

  const on = await call('PUT', '/api/idle-retire', { on: true }, screen());
  assert.equal(on.status, 200, 'CONTROL: the screen can turn it on');
  assert.deepEqual(settingOf(on), { on: true, days: 30, ok: true });
  const days = await call('PUT', '/api/idle-retire', { days: 60 }, screen());
  assert.equal(days.status, 200);
  assert.deepEqual(settingOf(days), { on: true, days: 60, ok: true }, 'changing the days turned it off or lost the days');
  assert.deepEqual(settingOf(await call('GET', '/api/idle-retire')), { on: true, days: 60, ok: true }, 'the change did not stick');
  const off = await call('PUT', '/api/idle-retire', { on: false }, screen());
  assert.deepEqual(settingOf(off), { on: false, days: 60, ok: true }, 'turning it off lost the chosen days');
});

test('#8720: the setup guide is kept on the live path (its row is marked from its folder); a plain agent idle as long is not (control)', async () => {
  const fleet = require('./test-support/fleet');
  const liveness = require('./engine/liveness');
  const instructions = require('./engine/instructions');
  const ir = require('./engine/idleretire');
  const board = fleet.install([fleet.agent('guidey'), fleet.agent('plainy', { displayName: 'Plain Person' })]);
  try {
    const guide = board.card('guidey').sessionName;
    const plain = board.card('plainy').sessionName;
    const dir = path.dirname(instructions.fileFor(guide));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.kosmos-setup-guide'), guide + '\n');
    const at = new Date(Date.now() - 40 * 86400000).toISOString();
    liveness.seen(guide, at);
    liveness.seen(plain, at);
    const up = Array.from({ length: 41 }, (_, i) => ir.dayOf(Date.now() - (40 - i) * 86400000));
    fs.writeFileSync(path.join(store.ROOT, 'idleretire-log.json'), JSON.stringify({ up }));
    assert.equal(ir.writeSetting({ days: 30 }).ok, true);
    _clearSweepRosterForTest();   // the view reads the sweeps' 20 s roster, filled by an earlier test with no fleet
    const r = await call('GET', '/api/idle-retire');
    assert.equal(r.status, 200);
    const v = (n) => r.json.verdicts.find((x) => x.name === n);
    assert.equal(v(plain) && v(plain).verdict, 'retire', 'CONTROL: a plain agent idle 40 running days is not retired, so this proves nothing about the guide: ' + JSON.stringify(r.json.verdicts));
    assert.equal(v(plain).shownAs, 'Plain Person', 'the list names the agent by its machine name, not the one the person knows');
    assert.equal(v(guide).verdict, 'keep', 'the setup guide would be retired');
    assert.match(v(guide).why, /setup guide/);
  } finally {
    board.restore();
  }
});

test('#9228: the operator brake stops the sweep; live execution off stops it; with both clear it acts (control)', () => {
  assert.equal(_idleRetireActiveForTest(true, {}), true, 'CONTROL: live execution on and no brake did not act');
  assert.equal(_idleRetireActiveForTest(true, { AGENT_WORKFORCE_IDLE_RETIRE_OFF: '1' }), false, 'the brake did not stop it');
  assert.equal(_idleRetireActiveForTest(true, { AGENT_WORKFORCE_IDLE_RETIRE_OFF: '0' }), true, 'a brake set to 0 stopped it');
  assert.equal(_idleRetireActiveForTest(false, {}), false, 'it acts with live execution off');
  assert.equal(_idleRetireSweepDepsForTest().allowed(), false, 'the real wiring acts in a test process, where live execution is off');
  /* The sweep's own allowed, with live execution read as on: it acts, and the brake stops it. */
  assert.equal(_idleRetireSweepDepsForTest({ liveAllowed: () => true, env: {} }).allowed(), true, 'CONTROL: the sweep did not act with live execution on');
  assert.equal(_idleRetireSweepDepsForTest({ liveAllowed: () => true, env: { AGENT_WORKFORCE_IDLE_RETIRE_OFF: '1' } }).allowed(), false, 'the brake did not stop the sweep itself');
  /* And start() hands makeTick exactly these deps, so the tests above are about the sweep that runs. */
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(src, /const idleretireTick = require\('\.\/engine\/idleretire'\)\.makeTick\(idleRetireSweepDeps\(\)\);/, 'start() no longer hands the sweep idleRetireSweepDeps()');
});

test('#9228: the sweep deps are wired to the real roster and the real Remove (dry run, so it is refused, never retired)', () => {
  const fleet = require('./test-support/fleet');
  const liveness = require('./engine/liveness');
  const ir = require('./engine/idleretire');
  const board = fleet.install([fleet.agent('wired', { displayName: 'Wired One' })]);
  const name = board.card('wired').sessionName;
  let r;
  const lines = [];
  try {
    liveness.seen(name, new Date(Date.now() - 40 * 86400000).toISOString());
    const up = Array.from({ length: 41 }, (_, i) => ir.dayOf(Date.now() - (40 - i) * 86400000));
    fs.writeFileSync(path.join(store.ROOT, 'idleretire-log.json'), JSON.stringify({ up }));
    assert.equal(ir.writeSetting({ on: true, days: 30 }).ok, true);
    const deps = _idleRetireSweepDepsForTest();
    /* Everything but `allowed` and `log` is the real wiring; log is collected, and allowed is opened here because a test process never has live
       execution, and the remove below runs under AGENT_WORKFORCE_DRY_RUN=1 (set at the top of this file). */
    r = ir.makeTick({ ...deps, allowed: () => true, log: (l) => lines.push(l) })();
    assert.equal(r.act, 'ran', JSON.stringify(r));
    const did = r.did.find((d) => d.name === name);
    assert.ok(did, 'the real roster did not reach the sweep: ' + JSON.stringify(r.did));
    assert.equal(did.shownAs, 'Wired One', 'the real rows were not the ones judged');
    assert.equal(did.outcome, 'refused', 'a dry-run removal was recorded as something other than refused');
    assert.match(did.because, /Nothing actually happened/, 'the removal was not the real engine/remove.js: ' + did.because);
    assert.ok(lines.some((l) => l.includes(name)), 'the sweep logged nothing about it');
  } finally {
    board.restore();
    ir.writeSetting({ on: false });
    fs.rmSync(path.join(store.ROOT, 'idleretire-log.json'), { force: true });
    liveness.forget(name);
  }
});
