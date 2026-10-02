'use strict';

/*
 * #4253: a browser check's fixture board never phones home, even run on its own. The runners
 * (tools/browser-checks.sh, run-tests.sh) point the install ping, the daily report and the
 * community at a dead local port; `node docs/browser-checks/x.js` is outside both, and its board
 * sent installkosmos.com a new install with a fresh id. lib-sandbox-home.js, which every check that
 * boots a board requires (tools.browser-checks-home-3675.test.js), now points the three there too,
 * unless the caller named an address. Each arm runs in a child with the three unset, as a check
 * started by hand has them.
 *
 *   node --test tools.browser-checks-quiet-4253.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LIB = path.join(__dirname, 'docs', 'browser-checks', 'lib-sandbox-home.js');
const BEACON = path.join(__dirname, 'engine', 'createdbeacon.js');
const KEYS = ['AGENT_WORKFORCE_CREATED_URL', 'AGENT_WORKFORCE_FEEDBACK_URL', 'AGENT_WORKFORCE_COMMUNITY_URL'];

/* The URL the install ping would be sent to, read off the beacon's own send (an injected sender
   receives it), plus the three variables as the board would read them. */
function child(t, { withLib, preset }) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-4253-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const code = `
    ${withLib ? `require(${JSON.stringify(LIB)});` : ''}
    const beacon = require(${JSON.stringify(BEACON)});
    beacon.setSender((url) => {
      const env = {}; for (const k of ${JSON.stringify(KEYS)}) env[k] = process.env[k] || null;
      process.stdout.write('\\nRESULT-4253 ' + JSON.stringify({ url, env, def: beacon.DEFAULT_ENDPOINT }) + '\\n');
      process.exit(0);
    });
    beacon.pingInstall();
    setTimeout(() => { console.error('no send'); process.exit(2); }, 5000);`;
  const env = { ...process.env, AGENT_WORKFORCE_DATA: data };
  for (const k of KEYS) delete env[k];
  Object.assign(env, preset || {});
  const r = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT-4253 '));
  assert.ok(line, 'the child reported no result: ' + r.stdout.slice(-300));
  return JSON.parse(line.slice('RESULT-4253 '.length));
}

test('#4253 CONTROL: without the lib, the install ping goes to installkosmos.com (the exposure is real, and the arm can see it)', (t) => {
  const r = child(t, { withLib: false });
  assert.equal(r.url, r.def);
  assert.match(r.url, /^https:\/\/installkosmos\.com\//);
});

test('#4253: with the lib, the install ping, the daily report and the community all go to a dead local port', (t) => {
  const r = child(t, { withLib: true });
  assert.equal(r.url, 'http://127.0.0.1:9/api/created');
  assert.equal(r.env.AGENT_WORKFORCE_FEEDBACK_URL, 'http://127.0.0.1:9/api/feedback');
  assert.equal(r.env.AGENT_WORKFORCE_COMMUNITY_URL, 'http://127.0.0.1:9/');
});

test('#4253: an address the caller named is kept (a check with its own sink still sees its pings)', (t) => {
  const preset = { AGENT_WORKFORCE_CREATED_URL: 'http://127.0.0.1:4253/sink', AGENT_WORKFORCE_COMMUNITY_URL: 'http://127.0.0.1:4254/' };
  const r = child(t, { withLib: true, preset });
  assert.equal(r.url, 'http://127.0.0.1:4253/sink');
  assert.equal(r.env.AGENT_WORKFORCE_COMMUNITY_URL, 'http://127.0.0.1:4254/');
  assert.equal(r.env.AGENT_WORKFORCE_FEEDBACK_URL, 'http://127.0.0.1:9/api/feedback');
});

test('#4253: the lib names the same dead addresses the runners export (one fact, four copies)', (t) => {
  const r = child(t, { withLib: true });
  const lib = { ...r.env, AGENT_WORKFORCE_CREATED_URL: r.url };
  for (const runner of ['browser-checks.sh', 'run-tests.sh']) {
    const src = fs.readFileSync(path.join(__dirname, 'tools', runner), 'utf8');
    for (const k of KEYS) {
      const m = src.match(new RegExp('^export ' + k + '=(\\S+)$', 'm'));
      assert.ok(m, runner + ' exports no ' + k);
      assert.equal(lib[k], m[1], k + ' differs between the lib and ' + runner);
    }
  }
});

test('#4253: the federation proof\'s boards (an env built from nothing) name all three dead addresses', () => {
  const src = fs.readFileSync(path.join(__dirname, 'tools', 'fed-own-e2e.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const start = src.indexOf('function boardEnv(');
  const end = src.indexOf('async function startBoard(');
  assert.ok(start >= 0 && end > start, 'boardEnv not found where expected');
  const body = src.slice(start, end);
  for (const k of KEYS) assert.match(body, new RegExp(k + ": 'http://127\\.0\\.0\\.1:9/"), k + ' is not pointed at the dead port');
});
