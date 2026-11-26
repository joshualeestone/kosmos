'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#8865: after a crash restart the board checks its own data files first (#7248), and the page says what it
 * found (#8287), but an agent could not read it, so it scanned the data folder by hand. GET /api/board/start-check
 * answers with the scan's counts and the page's list, and `kosmos start-check` prints them on both CLIs.
 *
 * The card's "done when": after a start that found a planted damaged file, an agent's read names it; after a clean
 * start it says checked, nothing damaged (the control). Runs the REAL server as a child process, as
 * server.storecheck-7248 does, and the REAL Mac CLI against it; the Windows CLI reads the same answer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const store = require('./engine/store');
const { stopBoard } = require('./test-support/board-child');
const cli = require('./tools/windows/kosmos-cli');

const REPO = __dirname;
const NO_MAC_CLI = process.platform === 'win32' ? 'the Mac CLI is a bash script' : false;

function sandbox({ damaged }) {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-startcheck-8865-'));
  const root = path.join(sb, 'data', store.APP);
  fs.mkdirSync(path.join(root, 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(sb, 'workers'), { recursive: true });
  fs.writeFileSync(path.join(sb, 'panes.txt'), '');
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ timezone: 'America/Chicago' }));   // good in both arms
  if (damaged) {
    fs.writeFileSync(path.join(root, 'projects.json'), Buffer.alloc(64));   // all NUL, as a crash leaves it
    fs.writeFileSync(path.join(root, 'projects.json.kosmos-4242-1793000000000-1.tmp'), JSON.stringify({ projects: [] }));   // its good copy
    fs.writeFileSync(path.join(root, 'removed.json'), '');                  // empty, no copy
  }
  return sb;
}

/* Boot the board, then run `ask(url)` while it is up. */
async function withBoard(sb, ask) {
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    env: {
      ...process.env,
      PORT: '0',
      AGENT_WORKFORCE_DATA: path.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: path.join(sb, 'projects'),
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: path.join(sb, 'panes.txt'),
      AGENT_WORKFORCE_DRY_RUN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  try {
    const url = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('the board did not start in 60 s:\n' + out + '\n' + err)), 60000);
      const look = () => {
        const m = /Kosmos on (http:\/\/[^\s]+)/.exec(out);
        if (m) { clearTimeout(t); resolve(m[1].replace(/\/$/, '')); }
      };
      child.stdout.on('data', look);
      child.on('exit', () => { clearTimeout(t); reject(new Error('the board exited before it started:\n' + out + '\n' + err)); });
    });
    return await ask(url);
  } finally {
    await stopBoard(child);
  }
}

/* The Mac CLI, with this checkout's engine, against the board at `url`. */
function macCli(sb, url) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-startcheck-8865-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(REPO, 'engine'), path.join(home, 'app', 'engine'));
  const port = new URL(url).port;
  return new Promise((resolve, reject) => {
    const env = { ...process.env, KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: path.join(sb, 'data'), KOSMOS_PORT: port,
      KOSMOS_AGENT_TOKEN: '', TMUX: '', TMUX_PANE: '' };
    execFile('bash', [path.join(REPO, 'install', 'kosmos'), 'start-check'], { env, timeout: 30000 }, (e, stdout, stderr) => {
      fs.rmSync(home, { recursive: true, force: true });
      if (e && typeof e.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (e.signal || e.code) + ')')); return; }
      resolve({ code: e ? e.code : 0, both: `${stdout}${stderr}` });
    });
  });
}

/* The Windows CLI's verb, given the board's own answer. */
async function windowsCli(answer) {
  const out = [];
  const err = [];
  const code = await cli.main(['start-check'], { env: {}, out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (u) => {
      if (!/\/api\/board\/start-check$/.test(String(u))) throw new Error('unexpected request ' + u);
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
  return { code, both: out.concat(err).join('\n') };
}

test('kosmos#8865: after a start that found damaged files, the route and both CLIs name them, with what each holds', { skip: NO_MAC_CLI }, async () => {
  const sb = sandbox({ damaged: true });
  try {
    const got = await withBoard(sb, async (url) => {
      const res = await fetch(url + '/api/board/start-check');
      return { status: res.status, body: await res.json(), mac: await macCli(sb, url) };
    });
    assert.equal(got.status, 200);
    const b = got.body;
    assert.equal(b.ran, true, JSON.stringify(b));
    assert.equal(b.checked, true);
    assert.equal(b.damaged, 2);
    assert.ok(Number.isInteger(b.looked) && b.looked >= 3, 'it did not count the files it looked at: ' + JSON.stringify(b));
    assert.deepEqual(b.files.map((f) => f.file).sort(), ['projects.json', 'removed.json']);

    assert.equal(got.mac.code, 0, got.mac.both);
    assert.match(got.mac.both, new RegExp('Kosmos checked its own files at this start \\(' + b.looked + ' files read\\) and found 2 damaged\\.'));
    assert.match(got.mac.both, /- projects\.json is blank, as a crash can leave a file \(it holds your projects, their tasks and who is on them\)\. Kosmos left it as it is\. A good copy saved [^ ]+ is at projects\.json\.recovered-/);
    assert.match(got.mac.both, /- removed\.json is empty \(it holds the agents you removed\)\. Kosmos left it as it is\. No good copy of it was found\./);
    assert.ok(!got.mac.both.includes(sb), 'a path reached what the agent reads');

    const win = await windowsCli(b);
    assert.equal(win.code, 0, win.both);
    assert.equal(win.both, got.mac.both.trim(), 'the two CLIs do not print the same words');
  } finally {
    fs.rmSync(sb, { recursive: true, force: true });
  }
});

test('kosmos#8865: CONTROL, after a clean start the read says checked, nothing damaged', { skip: NO_MAC_CLI }, async () => {
  const sb = sandbox({ damaged: false });
  try {
    const got = await withBoard(sb, async (url) => {
      const res = await fetch(url + '/api/board/start-check');
      return { body: await res.json(), mac: await macCli(sb, url) };
    });
    assert.equal(got.body.ran, true);
    assert.equal(got.body.damaged, 0);
    assert.deepEqual(got.body.files, []);
    assert.equal(got.mac.code, 0, got.mac.both);
    assert.match(got.mac.both, new RegExp('^Kosmos checked its own files at this start \\(' + got.body.looked + ' files? read\\): none is damaged\\.$', 'm'));
    assert.doesNotMatch(got.mac.both, /found \d+ damaged/);
  } finally {
    fs.rmSync(sb, { recursive: true, force: true });
  }
});
