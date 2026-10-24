'use strict';

/**
 * kosmos#6774: `kosmos msg` to an agent whose input box holds text not yet sent is held by the board. Both CLIs say
 * so and why, tell the sender not to re-send, and exit 0 (accepted, as for a usage limit); a plain could_not still
 * exits 1. Harness as cli.limitmsg-5805.test.js.
 *
 *   node --test cli.inputkeep-6774.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const os = require('node:os');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-inputkeep-6774-'));
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


const INPUT = '{"delivery":{"state":"could_not","held":true,"heldBy":"limit","heldFor":"input","heldUntil":null,"id":"m80","at":"x","because":"held: casey\'s input box holds text not yet sent"}}';
const BEHIND_INPUT = '{"delivery":{"state":"could_not","held":true,"heldBy":"limit","heldUntil":null,"id":"m81","at":"x","because":"held: casey still has messages","behind":true,"behindFor":"input"}}';
const BEHIND_LIMIT = '{"delivery":{"state":"could_not","held":true,"heldBy":"limit","heldUntil":null,"id":"m82","at":"x","because":"held: casey still has messages","behind":true}}';

for (const [label, run] of [['bash', runCli], ['Windows', runWinCli]]) {
  test(`#6774: ${label} kosmos msg says a message held for a stuck input box is held and why, not to re-send, and exits 0`, () => withStubBoard(async (port) => {
    const out = await run(['msg', 'casey', 'go ahead'], envFor(port));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /Held for casey: its input box holds text not yet sent\. Kosmos types it once the box is clear; do not re-send\./);
    assert.doesNotMatch(out.stdout + out.stderr, /out of usage|Not delivered/);
  }, INPUT));
  test(`#6774: ${label} kosmos msg words one behind messages kept for the box as that`, () => withStubBoard(async (port) => {
    const out = await run(['msg', 'casey', 'and another'], envFor(port));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /Held for casey: it still has messages kept while its input box held text not yet sent, and Kosmos types this one after them\. Do not re-send\./);
  }, BEHIND_INPUT));
  test(`#6774 CONTROL: ${label} kosmos msg still words one behind a usage-limit backlog as before`, () => withStubBoard(async (port) => {
    const out = await run(['msg', 'casey', 'and another'], envFor(port));
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /it still has messages kept from while it was out of usage/);
  }, BEHIND_LIMIT));
}
