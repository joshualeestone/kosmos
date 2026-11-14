'use strict';
/**
 * kosmos#8519: `kosmos connections found` and `kosmos connections --found`, on both CLIs, against a stub board.
 * Records as the agent (its token in the header), prints what was found in engine/connfound.js renderLines' words,
 * and the plain `kosmos connections` adds one line when agents found actions that do not work. Like #4451, the
 * metered sweep (`/api/connections`) is never asked.
 * Harness as cli.connections-4451.test.js: an in-process stub and ASYNC child processes.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { scaleBudget } = require('./test-support/eventually');
const cf = require('./engine/connfound');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-connfound-8519-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });
const CLI = path.join(__dirname, 'install', 'kosmos');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');
const AGENT_TOKEN = 'a1'.repeat(32);

const NOW = Date.now();
const FOUND = [{ key: 'hubspot', name: 'hubspot', kind: 'other', notWorking: 1, actions: [
  { action: 'merge_contacts', outcome: 'not-offered', at: NOW - 3 * 86400e3, by: 'leo', note: '', how: 'auto', n: 2, words: cf.OUTCOME_WORDS['not-offered'] },
  { action: 'search', outcome: 'works', at: NOW - 5 * 86400e3, by: 'mara', note: 'contacts only', how: 'agent', n: 1, words: cf.OUTCOME_WORDS.works }] }];
const HELD = [{ name: 'GitHub', route: '/api/github', how: 'sign-in', held: true }];

function withStub(answers, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body, agentToken: req.headers['x-kosmos-agent-token'] || '' });
      const a = answers[req.method + ' ' + req.url];
      if (a) { res.writeHead(a.status || 200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(a.json)); }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Kosmos</title>Agent Workforce');
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

function sh(port, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), KOSMOS_AGENT_TOKEN: AGENT_TOKEN };
    const child = spawn(CLI, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const killMs = scaleBudget(20000);
    const t = setTimeout(() => child.kill('SIGKILL'), killMs);
    child.on('close', (code, sig) => {
      clearTimeout(t);
      if (typeof code !== 'number') { reject(new Error('the CLI gave no exit code (' + sig + '): ' + out)); return; }
      resolve({ code, out });
    });
  });
}

const swept = (seen) => seen.filter((s) => s.url === '/api/connections').length;

test('Mac: found records as the agent, with its token, and says so', { skip: SKIP_POSIX_SHELL }, async () => {
  await withStub({ 'POST /api/connections/found': { json: { recorded: true } } }, async (port, seen) => {
    const r = await sh(port, ['connections', 'found', 'hubspot', 'merge_contacts', 'not-offered', 'it said "unknown tool"']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^Recorded\. kosmos connections --found lists what agents found\.$/m);
    const post = seen.find((s) => s.method === 'POST' && s.url === '/api/connections/found');
    assert.ok(post, 'the finding was sent');
    assert.equal(post.agentToken, AGENT_TOKEN, 'as the agent');
    const b = JSON.parse(post.body);
    assert.deepEqual([b.service, b.action, b.outcome, b.note, b.outside], ['hubspot', 'merge_contacts', 'not-offered', 'it said "unknown tool"', false], 'a quote in the note stays readable JSON');
    const o = await sh(port, ['connections', 'found', '--outside', 'GitHub', 'create_release', 'needs-scope']);
    assert.equal(o.code, 0, o.out);
    const ob = JSON.parse(seen.filter((s) => s.method === 'POST').pop().body);
    assert.deepEqual([ob.service, ob.action, ob.outcome, ob.outside], ['GitHub', 'create_release', 'needs-scope', true], '--outside is sent');
    assert.equal(swept(seen), 0);
  });
});

test('Mac: a refusal is said in the board\'s words and exits 1; a wrong word count is usage (2)', { skip: SKIP_POSIX_SHELL }, async () => {
  await withStub({ 'POST /api/connections/found': { status: 400, json: { recorded: false, because: 'the outcome is one of: works' } } }, async (port, seen) => {
    const r = await sh(port, ['connections', 'found', 'hubspot', 'x', 'maybe']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Not recorded: the outcome is one of: works\./);
    const u = await sh(port, ['connections', 'found', 'hubspot', 'x']);
    assert.equal(u.code, 2, u.out);
    assert.match(u.out, /Usage: kosmos connections found \[--outside\] <service> <action>/);
    assert.equal(seen.filter((s) => s.method === 'POST').length, 1, 'the usage error sent nothing');
  });
});

test('Mac: --found prints renderLines, and --found <service> asks for that one', { skip: SKIP_POSIX_SHELL }, async () => {
  await withStub({
    'GET /api/connections/found': { json: { services: FOUND } },
    'GET /api/connections/found?service=Acme%20CRM': { json: { services: [] } },
  }, async (port, seen) => {
    const r = await sh(port, ['connections', '--found']);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out.trim(), cf.renderLines(FOUND, Date.now()).join('\n'));
    const one = await sh(port, ['connections', '--found', 'Acme CRM']);
    assert.equal(one.code, 0, one.out);
    assert.match(one.out, /^No agent has recorded anything about Acme CRM in the last 30 days\.$/m);
    assert.ok(seen.some((s) => s.url === '/api/connections/found?service=Acme%20CRM'), 'the service was asked for, encoded');
    assert.equal(swept(seen), 0);
  });
});

test('Mac: plain connections adds one line when agents found actions that do not work, and none otherwise', { skip: SKIP_POSIX_SHELL }, async () => {
  await withStub({ 'GET /api/connections/held': { json: { services: HELD } }, 'GET /api/connections/found': { json: { services: FOUND } } }, async (port, seen) => {
    const r = await sh(port, ['connections']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^GitHub: connected/m);
    assert.match(r.out, /^Agents found 1 action that does not work on hubspot \(outside Kosmos\): kosmos connections --found$/m);
    assert.equal(swept(seen), 0);
  });
  await withStub({ 'GET /api/connections/held': { json: { services: HELD } }, 'GET /api/connections/found': { json: { services: [] } } }, async (port) => {
    const r = await sh(port, ['connections']);
    assert.equal(r.code, 0, r.out);
    assert.ok(!/Agents found/.test(r.out), 'CONTROL: nothing found, no line');
  });
});

test('Mac: a board refusal (403 { error }) is said as the Windows CLI says it, for found and --found', { skip: SKIP_POSIX_SHELL }, async () => {
  const refusal = { status: 403, json: { error: 'this request came from another site' } };
  await withStub({ 'POST /api/connections/found': refusal, 'GET /api/connections/found': refusal }, async (port) => {
    const f = await sh(port, ['connections', 'found', 'hubspot', 'x', 'works']);
    assert.equal(f.code, 1, f.out);
    assert.equal(f.out.trim(), 'Kosmos refused that request: this request came from another site.');
    const l = await sh(port, ['connections', '--found']);
    assert.equal(l.code, 1, l.out);
    assert.equal(l.out.trim(), 'Kosmos refused that request: this request came from another site.');
  });
});

/* The Windows CLI, in process, against the same stub. */
async function win(port, args) {
  const cli = require('./tools/windows/kosmos-cli');
  const out = []; const err = [];
  const code = await cli.main(args, { env: { AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), KOSMOS_AGENT_TOKEN: AGENT_TOKEN }, out: (x) => out.push(x), err: (x) => err.push(x),
    proveBoard: async () => true });   // #1765's seam: this stub stands in for a board that proved itself
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('Windows: found, --found and the plain line, in the same words', async () => {
  await withStub({
    'POST /api/connections/found': { json: { recorded: true } },
    'GET /api/connections/found': { json: { services: FOUND } },
    'GET /api/connections/held': { json: { services: HELD } },
  }, async (port, seen) => {
    const f = await win(port, ['connections', 'found', 'hubspot', 'merge_contacts', 'not-offered']);
    assert.equal(f.code, 0, f.err + f.out);
    assert.equal(f.out, 'Recorded. kosmos connections --found lists what agents found.');
    const post = seen.find((s) => s.method === 'POST' && s.url === '/api/connections/found');
    assert.deepEqual(JSON.parse(post.body), { service: 'hubspot', action: 'merge_contacts', outcome: 'not-offered', note: '', outside: false });
    const o = await win(port, ['connections', 'found', '--outside', 'GitHub', 'create_release', 'needs-scope']);
    assert.equal(o.code, 0, o.err);
    assert.equal(JSON.parse(seen.filter((s) => s.method === 'POST').pop().body).outside, true, '--outside is sent');
    const l = await win(port, ['connections', '--found']);
    assert.equal(l.code, 0, l.err);
    assert.equal(l.out, cf.renderLines(FOUND, Date.now()).join('\n'));
    const p = await win(port, ['connections']);
    assert.equal(p.code, 0, p.err);
    assert.match(p.out, /Agents found 1 action that does not work on hubspot \(outside Kosmos\): kosmos connections --found$/);
    const u = await win(port, ['connections', 'found', 'x']);
    assert.equal(u.code, 2);
    assert.equal(swept(seen), 0);
  });
});

test('Windows: a board refusal is said in the same words', async () => {
  const refusal = { status: 403, json: { error: 'this request came from another site' } };
  await withStub({ 'POST /api/connections/found': refusal, 'GET /api/connections/found': refusal }, async (port) => {
    const f = await win(port, ['connections', 'found', 'hubspot', 'x', 'works']);
    assert.equal(f.code, 1);
    assert.equal(f.err, 'Kosmos refused that request: this request came from another site.');
    const l = await win(port, ['connections', '--found']);
    assert.equal(l.code, 1);
    assert.equal(l.err, 'Kosmos refused that request: this request came from another site.');
  });
});
