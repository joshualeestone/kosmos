'use strict';
/**
 * #4771 (Josh's 0.7.15 report): a pause the person asked for in the room never reached the Prompter, because only the
 * screen could set one, so an agent held every task by hand. `kosmos project pause <project-id>` is the agent's way
 * to do what it was asked. The Mac CLI against a stub board that records every request (the Windows twin is
 * tools.windows-kosmos-cli-project-pause-4771.test.js; the board's half is server.project-pause-4771.test.js).
 *
 *   node --test cli.project-pause-4771.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
/* #4796: a fresh data root, so the live board's token never travels to this test's stub board. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-project-pause-'));
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));
const AGENT = 'cd'.repeat(16);

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function withBoard(answer, fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Kosmos</title>Agent Workforce'); return; }
      hits.push({ method: req.method, url: req.url, body: raw, agentToken: req.headers['x-kosmos-agent-token'] || null });
      const [status, body] = answer(req);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: AGENT };
  try { return await fn(env, hits); } finally { await new Promise((r) => server.close(r)); }
}

test('#4771 Mac CLI: project pause PUTs {paused:true} with the agent\'s token, and says who resumes it', () =>
  withBoard(() => [200, { project: { id: 'p1', paused: true } }], async (env, hits) => {
    const r = await runCli(['project', 'pause', 'p1'], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Paused p1\. Kosmos will not nudge anyone about its tasks or hand them out until it is resumed on the screen\. Do not resume it yourself\./);
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.equal(hits[0].method, 'PUT');
    assert.equal(hits[0].url, '/api/project/p1');
    assert.deepEqual(JSON.parse(hits[0].body), { paused: true });
    // The agent token is what makes it an agent's pause on the board, never the person's (isViaScreen).
    assert.equal(hits[0].agentToken, AGENT);
  }));

test('#4771 Mac CLI: a refusal says the board\'s reason and exits 1', () =>
  withBoard(() => [404, { error: 'there is no project by that name' }], async (env) => {
    const r = await runCli(['project', 'pause', 'nosuch'], env);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /could not pause that project: there is no project by that name/);
  }));

test('#4771 Mac CLI: no id, two ids, a bad id and resume are refused before any request; there is no resume verb', () =>
  withBoard(() => [200, { project: { id: 'p1', paused: true } }], async (env, hits) => {
    for (const [args, code] of [[['project', 'pause'], 2], [['project', 'pause', 'a', 'b'], 2], [['project', 'pause', 'bad id!'], 1],
      [['project', 'pause', '..'], 1], [['project', 'resume', 'p1'], 2], [['project', 'unpause', 'p1'], 2]]) {
      const r = await runCli(args, env);
      assert.equal(r.code, code, args.join(' ') + ': ' + r.stdout + r.stderr);
    }
    assert.equal(hits.length, 0, 'a refused call reached the board: ' + JSON.stringify(hits));
    // The usage names pause and says resuming is the person's.
    const usage = await runCli(['project'], env);
    assert.match(usage.stdout + usage.stderr, /kosmos project pause <project-id>.*it is resumed on the screen/);
    // CONTROL: a valid pause still reaches the board.
    await runCli(['project', 'pause', 'p1'], env);
    assert.equal(hits.length, 1);
  }));
