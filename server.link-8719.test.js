'use strict';
/**
 * kosmos#8719 part 2: POST /api/agent/:name/link, the board's "Link this window to Kosmos". A person's confirmed act
 * (the body says { confirm: true }); the engine (engine/linkwindow.js) sets Kosmos's own mark on that one session and
 * reads it back. tmux is a stand-in (linkwindow.setRunner); the roster is status.setPaneSource.
 *
 *   node --test server.link-8719.test.js
 */
require('./test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-link-8719-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const status = require('./engine/status');
const linkwindow = require('./engine/linkwindow');
const fleet = require('./test-support/fleet');

let lines = [];
let calls = [];
const marks = {};
let base;
test.before(async () => {
  status.setPaneSource(() => lines.map((l) => fleet.line(l)).join('\n') + (lines.length ? '\n' : ''));
  linkwindow.setRunner((bin, args) => {
    calls.push(args);
    if (args[0] === 'set-option') { marks[args[2]] = args[4]; return { ok: true, code: 0, stdout: '' }; }
    if (args[0] === 'show-options') { const v = marks[args[3]]; return v ? { ok: true, code: 0, stdout: v + '\n' } : { ok: false, code: 1, stdout: '' }; }
    if (args[0] === 'display-message') return { ok: true, code: 0, stdout: '$0\t' + fleet.CLAUDE_COMMAND + '\t' + (marks['=zara:'] || '') + '\n' };
    return { ok: false, code: 1, stdout: '' };
  });
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => { lines = []; calls = []; for (const k of Object.keys(marks)) delete marks[k]; });
test.after(() => {
  linkwindow.setRunner(null);
  status.setPaneSource(null);
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function link(name, body, headers) {
  const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/link`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(headers || {}) }, body: body === undefined ? '' : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('#8719 a confirmed link of a hand-started Claude window marks that session and says linked', async () => {
  lines = [{ session: 'zara', claim: '' }];
  const r = await link('zara', { confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { outcome: 'linked', session: 'zara', name: 'zara' });
  assert.deepEqual(calls[1], ['set-option', '-t', '=zara:', '@kosmos_agent', 'zara']);
});

test('#8719 without the confirmation nothing is linked; CONTROL: the same window links with it (above)', async () => {
  lines = [{ session: 'zara', claim: '' }];
  for (const body of [undefined, {}, { confirm: 'yes' }, { confirm: 1 }]) {
    const r = await link('zara', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.json.because, /needs your confirmation/);
  }
  assert.equal(calls.length, 0, 'tmux was never touched');
});

test('#8719 a window that is not plainly that agent is refused 409 with the reason, and tmux is not touched', async () => {
  lines = [{ session: 'zara', claim: 'zara' }];
  let r = await link('zara', { confirm: true });
  assert.equal(r.status, 409);
  assert.match(r.json.because, /already linked/);
  lines = [{ session: 'zara', claim: '', command: 'codex' }];
  r = await link('zara', { confirm: true });
  assert.equal(r.status, 409);
  assert.match(r.json.because, /not Claude/);
  assert.equal(calls.length, 0);
});

test('#8719 a cross-site request cannot link a window (the board-wide write guard)', async () => {
  lines = [{ session: 'zara', claim: '' }];
  const r = await link('zara', { confirm: true }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
  assert.equal(r.status, 403, JSON.stringify(r.json));
  assert.equal(calls.length, 0);
});

test('#8719 when tmux cannot be asked the route says so (500), never "there is no window"', async () => {
  status.setPaneSource(() => null);
  try {
    const r = await link('zara', { confirm: true });
    assert.equal(r.status, 500, JSON.stringify(r.json));
    assert.match(r.json.because, /could not see what is running on this computer, so nothing was changed/);
  } finally {
    status.setPaneSource(() => lines.map((l) => fleet.line(l)).join('\n') + (lines.length ? '\n' : ''));
  }
  assert.equal(calls.length, 0);
});
