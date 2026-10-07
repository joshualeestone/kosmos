'use strict';

/**
 * #5187: a message to a busy Antigravity agent queues in its CLI buffer while
 * the sender sees Placed.
 *
 * This test suite pins CLI feedback for queued delivery states:
 * 1. kosmos msg reports "Queued with <to> (they are mid-task, so they will not read this until it finishes)."
 *    when delivery is queued.
 * 2. kosmos msg reports "Queued with <to> (it had arrived the first time; it was not sent twice)."
 *    when a queued delivery was folded as a duplicate.
 * 3. kosmos msg reports "Placed with <to>." when delivery is placed normally.
 * 4. Windows CLI verbMsg mirrors the same output sentences.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const os = require('node:os');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-msgqueue-5187-'));
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

const envFor = (port) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' });

test('#5187: kosmos msg tells the sender when a message is queued with a busy agent', () => withStubBoard(async (port) => {
  const out = await runCli(['msg', 'johnnycage', 'hello there'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Queued with johnnycage \(they are mid-task, so they will not read this until it finishes\)\./);
}, '{"delivery":{"state":"placed","queued":true}}'));

test('#5187: kosmos msg reports duplicate queued delivery honestly', () => withStubBoard(async (port) => {
  const out = await runCli(['msg', 'johnnycage', 'hello again'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Queued with johnnycage \(it had arrived the first time; it was not sent twice\)\./);
}, '{"delivery":{"state":"placed","queued":true,"duplicate":true}}'));

test('#5187: kosmos msg reports standard Placed when not queued', () => withStubBoard(async (port) => {
  const out = await runCli(['msg', 'johnnycage', 'hello calm'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Placed with johnnycage\./);
}, '{"delivery":{"state":"placed","queued":false}}'));

test('#5187: Windows kosmos-cli msg tells the sender when a message is queued with a busy agent', () => withStubBoard(async (port) => {
  const out = await runWinCli(['msg', 'johnnycage', 'hello there'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Queued with johnnycage \(they are mid-task, so they will not read this until it finishes\)\./);
}, '{"delivery":{"state":"placed","queued":true}}'));

test('#5187: Windows kosmos-cli msg reports duplicate queued delivery honestly', () => withStubBoard(async (port) => {
  const out = await runWinCli(['msg', 'johnnycage', 'hello again'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Queued with johnnycage \(it had arrived the first time; it was not sent twice\)\./);
}, '{"delivery":{"state":"placed","queued":true,"duplicate":true}}'));

test('#5187: Windows kosmos-cli msg reports standard Placed when not queued', () => withStubBoard(async (port) => {
  const out = await runWinCli(['msg', 'johnnycage', 'hello calm'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /Placed with johnnycage\./);
}, '{"delivery":{"state":"placed","queued":false}}'));
