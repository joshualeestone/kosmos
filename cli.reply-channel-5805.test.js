'use strict';
/**
 * kosmos#5805 part 2: `kosmos reply-channel`, on the Mac (install/kosmos, against a stub board) and on Windows
 * (tools/windows/kosmos-cli.js, its fetch captured). Setting sends the words with the agent's token, --clear sends
 * empty, bare prints the usage and exits 2 sending nothing, and --help never sends.
 *
 * The data root is a temp folder, so the Mac CLI never reads this machine's real board token.
 *   node --test cli.reply-channel-5805.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const cli = require('./tools/windows/kosmos-cli');

const CLI = path.join(__dirname, 'install', 'kosmos');
const DATA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-reply-channel-')));
const TOKEN = 'ab12cd34ef56';
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));

function withStub(answer, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/agent/reply-channel') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        seen.push({ body: raw, agent: req.headers['x-kosmos-agent-token'] });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(answer);
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

function mac(port, args) {
  const env = { ...process.env, KOSMOS_PORT: String(port), AGENT_WORKFORCE_DATA: DATA, KOSMOS_AGENT_TOKEN: TOKEN };
  return new Promise((resolve, reject) => {
    execFile('bash', [CLI, ...args], { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + ')')); return; }
      resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` });
    });
  });
}

test('kosmos#5805 Mac: set sends the words with the agent token, quotes and backslashes intact; --clear sends empty', () => withStub('{"ok":true,"channel":"x"}', async (port, seen) => {
  let r = await mac(port, ['reply-channel', 'the', '"team"', 'room\\a']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^\s*Set\./m);
  assert.equal(seen.length, 1, 'nothing was sent');
  assert.equal(JSON.parse(seen[0].body).channel, 'the "team" room\\a', 'the words did not arrive as typed');
  assert.equal(seen[0].agent, TOKEN, 'the agent token was not presented');
  r = await mac(port, ['reply-channel', '--clear']);
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(seen[1].body).channel, '', '--clear did not send an empty channel');
}));

test('kosmos#5805 Mac: bare prints the usage and exits 2; --help exits 0; neither sends', () => withStub('{"ok":true,"channel":null}', async (port, seen) => {
  let r = await mac(port, ['reply-channel']);
  assert.equal(r.code, 2);
  assert.match(r.out, /Usage: kosmos reply-channel/);
  r = await mac(port, ['reply-channel', '--help']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Usage: kosmos reply-channel/);
  r = await mac(port, ['reply-channel', 'Discord', '--help']);
  assert.equal(r.code, 0, r.out);
  assert.equal(seen.length, 0, '--help or a bare call sent something');
  // CONTROL: the same stub does receive a real call, so the zero above is not a stub that never hears anything.
  await mac(port, ['reply-channel', 'Discord']);
  assert.equal(seen.length, 1, 'CONTROL: the stub never heard the CLI, so the zero above proves nothing');
}));

test('kosmos#5805 Mac: a refusal is said and exits 1', () => withStub('{"error":"keep the channel to 60 characters"}', async (port) => {
  const r = await mac(port, ['reply-channel', 'x'.repeat(61)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /did not set your reply channel: keep the channel to 60 characters/);
}));

async function win(args, answer) {
  const calls = [];
  const out = [];
  const code = await cli.main(args, {
    env: {},
    url: 'http://127.0.0.1:1',
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => null, agentToken: () => TOKEN },
    fetch: async (url, init) => { calls.push({ url, init }); return { status: 200, text: async () => answer }; },
    readStdin: () => ({ text: '', ended: true }),
    out: (s) => out.push(s),
    err: (s) => out.push(s),
  });
  return { code, calls, out: out.join('\n') };
}

test('kosmos#5805 Windows: the same verb, the same body, the same answers', async () => {
  let r = await win(['reply-channel', 'the', 'Discord', 'room'], '{"ok":true,"channel":"the Discord room"}');
  assert.equal(r.code, 0, r.out);
  assert.equal(r.calls.length, 1);
  assert.match(String(r.calls[0].url), /\/api\/agent\/reply-channel$/);
  assert.equal(JSON.parse(r.calls[0].init.body).channel, 'the Discord room');
  assert.match(r.out, /^\s*Set\./m);
  r = await win(['reply-channel', '--clear'], '{"ok":true,"channel":null}');
  assert.equal(JSON.parse(r.calls[0].init.body).channel, '');
  assert.match(r.out, /^Cleared\./m);
  r = await win(['reply-channel'], '{}');
  assert.equal(r.code, 2);
  assert.equal(r.calls.length, 0, 'a bare call sent something');
  assert.match(r.out, /Usage: kosmos reply-channel/);
  r = await win(['reply-channel', 'Discord', '--help'], '{}');
  assert.equal(r.code, 0, r.out);
  assert.equal(r.calls.length, 0, '--help sent something');
});
