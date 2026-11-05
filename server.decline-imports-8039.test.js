/**
 * kosmos#8039: "Continue without them" over HTTP. POST /api/agent/:name/decline-imports.
 *
 * Own file for the reason server.trust-restart-fallback-2129.test.js gives: the write targets the account's real config,
 * so this seals every root first. What must hold: only the person's page can answer; the screen is read again, so a press
 * after the question has gone changes nothing; the write lands on the account the agent runs on; and the thread route
 * offers the box only while the real dialog is on the screen.
 */
'use strict';

const test = require('node:test');
const jobfix = require('./test-support/jobfixture');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-decline-imports-8039-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
delete process.env.CLAUDE_CONFIG_DIR;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;

const PANES = nodePath.join(SANDBOX, 'panes.txt');
const SCREEN = nodePath.join(SANDBOX, 'screen.txt');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = PANES;
process.env.AGENT_WORKFORCE_FAKE_SCREEN = SCREEN;

const fleet = require('./test-support/fleet');
const create = require('./engine/create');
const trust = require('./engine/trust');
const store = require('./engine/store');

const DIALOG = [
  '────────────────────────────────',
  '  Allow external CLAUDE.md file imports?',
  '',
  '  External imports:',
  '    /Users/someone/.claude/NOTES.md',
  '',
  '  ❯ No, disable external imports',
  '    Yes, allow external imports',
  '',
  '  Enter to confirm · Esc to cancel',
].join('\n');

let restarts = 0;
const systemd = jobfix.systemdStub();
const fakeRun = (file, args) => {
  if (Array.isArray(args) && args[0] === 'kill-session') restarts += 1;
  return systemd(file, args) || (Array.isArray(args) && args[0] === 'has-session' ? { ok: false, code: 1 } : { ok: true, stdout: '' });
};
create.setRunner(fakeRun);
require('./engine/remove').setRunner(fakeRun);

function born(name, configDir) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, CLAUDE_BIN, TMUX_BIN, null, configDir, 'claude'), 'utf8');
  store.writeProfile(name, { provider: 'anthropic' });
  fs.writeFileSync(PANES, fleet.line({ session: name + '-discord', title: 'working' }) + '\n');
  return fs.realpathSync.native(create.workerDir(name)).split(nodePath.sep).join('/');
}
function account(label) {
  const dir = nodePath.join(SANDBOX, label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, '.claude.json'), JSON.stringify({ projects: {} }), 'utf8');
  return dir;
}
const entry = (dir, key) => (JSON.parse(fs.readFileSync(nodePath.join(dir, '.claude.json'), 'utf8')).projects || {})[key];

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => {
  try { server.close(); } catch { /* the port is going away anyway */ }
  create.setRunner(null);
  require('./engine/remove').setRunner(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function press(name, { person = true } = {}) {
  const res = await fetch(base + '/api/agent/' + encodeURIComponent(name) + '/decline-imports', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(person ? { 'sec-fetch-site': 'same-origin' } : {}) },
    body: '{}',
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('with the dialog on the screen, the press writes the No on the agent\'s own account and restarts', async () => {
  const dir = account('acct-a');
  const other = account('acct-other');
  const folder = born('di-yes', dir);
  fs.writeFileSync(SCREEN, DIALOG);
  const before = restarts;
  const r = await press('di-yes');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.because, 'It is starting without those files.', JSON.stringify(r.body));
  const e = entry(dir, folder);
  assert.ok(e, 'nothing written on the account the agent runs on');
  assert.equal(e[trust.IMPORTS_KEY], false, 'it must never write a Yes');
  assert.equal(e[trust.IMPORTS_SHOWN_KEY], true);
  assert.equal(entry(other, folder), undefined, 'another account was written');
  assert.ok(restarts > before, 'it wrote and did not restart, so the agent stays at the dialog');
});

test('a typed message is refused at the dialog, and nothing reaches the pane', async () => {
  born('di-typed', account('acct-e'));
  fs.writeFileSync(SCREEN, DIALOG);
  const res = await fetch(base + '/api/agent/di-typed/thread', {
    method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ text: 'wait, what files?' }),
  });
  const body = await res.json().catch(() => ({}));
  assert.match(JSON.stringify(body), /a message typed now would answer No/, 'a line typed here would answer the dialog: ' + JSON.stringify(body));
  fs.writeFileSync(SCREEN, '❯ \n');
  const res2 = await fetch(base + '/api/agent/di-typed/thread', {
    method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ text: 'hello' }),
  });
  assert.doesNotMatch(JSON.stringify(await res2.json().catch(() => ({}))), /a message typed now would answer No/, 'CONTROL: refused with no dialog up');
});

test('an answer already on file while it still asks: nothing restarts, and it says the answer is not being read', async () => {
  const dir = account('acct-f');
  const folder = born('di-already', dir);
  fs.writeFileSync(nodePath.join(dir, '.claude.json'), JSON.stringify({ projects: { [folder]: { [trust.IMPORTS_KEY]: false, [trust.IMPORTS_SHOWN_KEY]: true } } }), 'utf8');
  fs.writeFileSync(SCREEN, DIALOG);
  const before = restarts;
  const r = await press('di-already');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.because, /not being read/);
  assert.equal(restarts, before, 'it restarted, which only brings the question back');
});

test('the question has gone: nothing is written and nothing restarts', async () => {
  const dir = account('acct-b');
  const folder = born('di-gone', dir);
  fs.writeFileSync(SCREEN, '❯ \n');
  const before = restarts;
  const r = await press('di-gone');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(entry(dir, folder), undefined, 'a press after the question went wrote an answer');
  assert.equal(restarts, before);
});

test('only the person\'s page can answer: no screen header, no answer', async () => {
  const dir = account('acct-c');
  const folder = born('di-agent', dir);
  fs.writeFileSync(SCREEN, DIALOG);
  const before = restarts;
  const r = await press('di-agent', { person: false });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(entry(dir, folder), undefined);
  assert.equal(restarts, before);
});

test('the thread offers the box only while the real dialog is on the screen', async () => {
  born('di-thread', account('acct-d'));
  fs.writeFileSync(SCREEN, DIALOG);
  const on = await (await fetch(base + '/api/agent/di-thread/thread')).json();
  assert.equal(on.asking, true, 'premise: it reads as asking: ' + JSON.stringify({ asking: on.asking, because: on.questionBecause }));
  assert.equal(on.importsAsk, true);
  fs.writeFileSync(SCREEN, '❯ \n');
  const off = await (await fetch(base + '/api/agent/di-thread/thread')).json();
  assert.equal(off.importsAsk, false, 'CONTROL: no dialog, no box');
});
