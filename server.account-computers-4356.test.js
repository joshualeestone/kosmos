'use strict';

/** #4356: board route to the coordinator's Mac-signed computer list. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-computers-4356-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
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
const remote = require('./engine/remote');

const calls = [];
let answer;
remote.macRequest = async (...args) => { calls.push(args); return answer; };
remote.coordinator = () => 'https://login.kosmosplus.com';

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  try { server.close(); } catch { /* closed */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function read() {
  const res = await fetch(base + '/api/account-computers');
  return { status: res.status, body: await res.json() };
}

test('the route signs only the Mac list read and returns short-handoff intents for online peers', async () => {
  answer = { ok: true, data: { computers: [
    { address: 'mine.kosmosplus.com', name: 'Laptop', online: true, this_computer: true },
    { address: 'other.kosmosplus.com', name: 'Studio', online: true, this_computer: false },
    { address: 'off.kosmosplus.com', name: 'Office', online: false, this_computer: false },
  ] } };
  const got = await read();
  assert.equal(got.status, 200);
  assert.deepEqual(calls.at(-1), ['GET', '/v1/mac/account-computers', {}]);
  assert.equal(got.body.ok, true);
  assert.equal(got.body.computers.find((row) => row.name === 'Laptop').openUrl, null);
  assert.equal(got.body.computers.find((row) => row.name === 'Studio').openUrl, 'https://login.kosmosplus.com/signin?open=other.kosmosplus.com');
  assert.equal(got.body.computers.find((row) => row.name === 'Office').openUrl, null);
  assert.doesNotMatch(JSON.stringify(got.body), /kst=|token=/);
});

test('a coordinator refusal or malformed result returns no remote destination', async () => {
  for (const value of [
    { ok: false, because: 'not enrolled' },
    { ok: true, data: { computers: [{ address: 'evil.example/x', name: 'Bad', online: true, this_computer: true }] } },
  ]) {
    answer = value;
    const got = await read();
    assert.equal(got.status, 200);
    assert.deepEqual(got.body, { ok: false, computers: [] });
  }
});
