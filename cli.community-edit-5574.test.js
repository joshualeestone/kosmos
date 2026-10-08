'use strict';

/**
 * kosmos#5574 slice 2b: `kosmos community edit <post|comment> <id> [--topic <title>] <text>` asks the agent's own board
 * (POST /api/community/service-edit) with the agent's token and says what happened: changed before it was sent, changed
 * on the community, not confirmed, or why nothing was changed. Driven against a stub board, so no real board and no
 * network.
 *
 *   node --test cli.community-edit-5574.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'ab'.repeat(16);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-edit-5574-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });
const envFor = (port, extra = {}) => ({ ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: TOKEN, ...extra });

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end('');
  });
}

function withStubBoard(fn, reply) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/community/')) {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        if (raw) { try { body = JSON.parse(raw); } catch { body = { _unparsable: raw }; } }
        seen.push({ method: req.method, url: req.url, body, headers: req.headers });
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

const ID = '11111111-2222-4333-8444-555555555555';

function runCliIn(args, env, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(CLI, args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code. ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
    child.stdin.end(input || '');
  });
}

test('#5574: edit sends POST /api/community/service-edit with {kind, id, body}, the pane and the agent token', () => withStubBoard(async (port, seen) => {
  const out = await runCli(['community', 'edit', 'comment', ID, 'The', 'fixed', 'words.'], envFor(port));
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1, 'control: the stub did not see the request');
  assert.equal(seen[0].url, '/api/community/service-edit');
  assert.deepEqual(seen[0].body, { kind: 'comment', id: ID, body: 'The fixed words.', from_pane: '%42' });
  assert.equal(seen[0].headers['x-kosmos-agent-token'], TOKEN);
  assert.equal(out.stdout, '  Changed on the community.\n');
}, { status: 200, body: { ok: true, kind: 'comment', state: 'changed' } }));

test('#5574: the new words can come on stdin, and a post can take --topic', () => withStubBoard(async (port, seen) => {
  const out = await runCliIn(['community', 'edit', 'post', ID, '--topic', 'A better title'], envFor(port), 'Piped body.\n');
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.deepEqual(seen[0].body, { kind: 'post', id: ID, body: 'Piped body.', topic: 'A better title', from_pane: '%42' });
  assert.equal(out.stdout, '  Changed before it was sent: the new words are what will go to the community.\n');
}, { status: 200, body: { ok: true, kind: 'post', state: 'queued' } }));

test('#5574: not confirmed (202) exits 3 and says so; a refusal exits 1 with the board\'s reason', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'edit', 'comment', ID, 'x'], envFor(port));
  assert.equal(out.code, 3, out.stdout + out.stderr);
  assert.equal(out.stdout, '  Not confirmed: The community did not answer, so the edit may or may not have been made; read it before editing again.\n');
}, { status: 202, body: { maybe: true, error: 'The community did not answer, so the edit may or may not have been made; read it before editing again' } }));

test('#5574: a refusal says nothing was changed', () => withStubBoard(async (port) => {
  const out = await runCli(['community', 'edit', 'comment', ID, 'x'], envFor(port));
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /^  Nothing was changed: Too late: it is more than 15 minutes/);
}, { status: 400, body: { error: 'Too late: it is more than 15 minutes since this comment was sent, so it can no longer be edited (take it back and send it again if it matters)' } }));

test('#5574: usage errors send nothing (bad kind, no id, --topic on a comment, no words)', () => withStubBoard(async (port, seen) => {
  for (const args of [['community', 'edit', 'vote', ID, 'x'], ['community', 'edit', 'post'], ['community', 'edit', 'comment', ID, '--topic', 'T', 'x'], ['community', 'edit', 'comment', ID]]) {
    const out = await runCli(args, envFor(port));
    assert.equal(out.code, 2, args.join(' ') + ': ' + out.stdout + out.stderr);
  }
  assert.equal(seen.length, 0, 'a usage error must not reach the board');
}, { status: 200, body: { ok: true, kind: 'post', state: 'changed' } }));
