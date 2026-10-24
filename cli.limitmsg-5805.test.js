'use strict';

/**
 * #5805 slice 2a: `kosmos msg` to an agent out of usage is held by the board. Both CLIs say so, with the time, tell
 * the sender not to re-send, and exit 0 (accepted, as Queued is); a plain could_not still exits 1.
 *
 *   node --test cli.limitmsg-5805.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const os = require('node:os');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-limitmsg-5805-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');
const WIN_CLI = path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js');

function runCli(args, env, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 20000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') {
        reject(new Error('the CLI gave no exit code: ' + (stderr || '')));
        return;
      }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end(input === undefined ? '' : input);
  });
}

function runWinCli(args, env, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [WIN_CLI, ...args], { env, timeout: 20000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') {
        reject(new Error('the Windows CLI gave no exit code: ' + (stderr || '')));
        return;
      }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end(input === undefined ? '' : input);
  });
}

function withStubBoard(fn, reply) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/msg')) {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(typeof reply === 'function' ? reply() : reply);
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

const { withoutAgentIdentity } = require('./test-support/agent-env');   // kosmos#6740: never run the CLI as the agent running the test
const envFor = (port) => ({ ...withoutAgentIdentity(process.env), AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' });

const HELD = '{"delivery":{"state":"could_not","held":true,"heldBy":"limit","heldUntil":"2026-10-13T20:00:00.000Z","id":"m77","because":"held: casey is out of usage"}}';
const BEHIND = '{"delivery":{"state":"could_not","held":true,"heldBy":"limit","heldUntil":null,"id":"m78","at":"x","because":"held: casey still has messages","behind":true}}';
const NOT = '{"delivery":{"state":"could_not","because":"nobody by that name"}}';

for (const [label, run] of [['bash', runCli], ['Windows', runWinCli]]) {
  test(`#5805 2a: ${label} kosmos msg says a held message is held, until when, not to re-send, and exits 0`, () => withStubBoard(async (port) => {
    const out = await run(['msg', 'casey', 'go ahead'], envFor(port));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /Held for casey: it is out of usage until 2026-10-13T20:00:00\.000Z\. Kosmos types it after the reset; do not re-send\./);
    assert.doesNotMatch(out.stdout + out.stderr, /Not delivered/);
  }, HELD));
  test(`#5805 2a review 5: ${label} kosmos msg words a message queued behind a backlog as that, not as out of usage`, () => withStubBoard(async (port) => {
    const out = await run(['msg', 'casey', 'and another'], envFor(port));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /Held for casey: it still has messages kept from while it was out of usage, and Kosmos types this one after them\. Do not re-send\./);
    assert.doesNotMatch(out.stdout, /it is out of usage/);
  }, BEHIND));
  test(`#5805 2a CONTROL: ${label} kosmos msg still says Not delivered and exits 1 for a plain could_not`, () => withStubBoard(async (port) => {
    const out = await run(['msg', 'casey', 'go ahead'], envFor(port));
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stdout + out.stderr, /Not delivered: nobody by that name\./);
  }, NOT));
}

test('#5805 2a: the outbox drain counts a held send as accepted, never retried; a plain could_not or another hold is not', () => {
  process.env.AGENT_WORKFORCE_DATA = DATA;
  const { heldAccepted } = require('./engine/messages');
  assert.equal(heldAccepted({ state: 'could_not', held: true, heldBy: 'limit', id: 'm77' }), true);
  assert.equal(heldAccepted({ state: 'could_not', because: 'gone' }), false, 'CONTROL');
  assert.equal(heldAccepted({ state: 'could_not', held: true, heldBy: 'quota', id: 'm78' }), false, 'another hold is not this one');
  assert.equal(heldAccepted({ state: 'could_not', held: true, heldBy: 'limit' }), false, 'no id: nothing was kept');
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const at = src.indexOf('function outboxOutcomeOf(');
  assert.match(src.slice(at, at + 600), /if \(messages\.heldAccepted\(delivery\)\) return \{ outcome: 'delivered' \};/);
});
