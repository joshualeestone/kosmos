'use strict';
/**
 * kosmos#5293: `kosmos agent instructions-add "<name>" --from <file>` only PROPOSES. It sends the file's text and the
 * caller's pane (and its token when it has one) to the board, which holds it; the person applies it on the page. Run
 * against a stub board in a sandboxed KOSMOS_HOME, as cli.agent-newrole-4474.test.js does.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const run = promisify(execFile);

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-instradd-')));
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
const CLI = path.join(__dirname, 'install', 'kosmos');
const ADD = 'When a lead goes quiet for two days, write to them once.\nDo not chase twice; tell me "instead".\n';

function withStub(answer, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.includes('/instruction-add')) {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        seen.push({ url: req.url, token: req.headers['x-kosmos-agent-token'], body: JSON.parse(body || '{}') });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer()));
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
async function cli(port, args, extra) {
  const env = Object.assign({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, KOSMOS_HOME: HOME, KOSMOS_PORT: String(port), TMPDIR: os.tmpdir(),
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh') }, extra || {});
  try { const { stdout, stderr } = await run(CLI, args, { env, timeout: 20000 }); return { code: 0, out: stdout + stderr }; }
  catch (e) { return { code: e.code, out: String(e.stdout || '') + String(e.stderr || '') }; }
}
function addFile() { const f = path.join(HOME, 'add.md'); fs.writeFileSync(f, ADD); return f; }
const HELD = () => ({ ok: true, pending: { text: ADD, askedBy: 'Leo', askedAt: '2026-10-05T14:14:00.000Z' } });

test('#5293 instructions-add sends the file verbatim with the pane and token, to that agent, and says it is held', () => withStub(HELD, async (port, seen) => {
  const r = await cli(port, ['agent', 'instructions-add', 'Sally Sales', '--from', addFile()], { TMUX_PANE: '%7', KOSMOS_AGENT_TOKEN: 'abc123' });
  assert.equal(r.code, 0, r.out);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/api/agent/Sally%20Sales/instruction-add', 'the name was not sent URL-encoded to its route');
  assert.equal(seen[0].body.text, ADD, 'the text was not sent verbatim (newlines, quotes)');
  assert.equal(seen[0].body.from_pane, '%7');
  assert.equal(seen[0].token, 'abc123');
  assert.equal(Object.keys(seen[0].body).sort().join(','), 'from_pane,text', 'the CLI sent an asker of its own; the board must decide who asked');
  assert.match(r.out, /Held\. The person applies it on Sally Sales's page in Kosmos; nothing changes until they do\./);
}));

test('#5293 one already waiting: refused, naming who asked and when, and how the person clears it', () => withStub(
  () => ({ ok: false, code: 'pending', pending: { askedBy: 'Ops lead', askedAt: '2026-10-05T14:14:00.000Z' }, because: 'an addition is already waiting' }),
  async (port) => {
    const r = await cli(port, ['agent', 'instructions-add', 'sally', '--from', addFile()], { TMUX_PANE: '%7' });
    assert.equal(r.code, 1);
    assert.match(r.out, /Not sent: sally already has an addition waiting, asked by Ops lead on Oct \d+\. The person can apply or dismiss it on sally's page first\./);
  }));

test('#5293 a board refusal is said with its reason', () => withStub(() => ({ ok: false, because: 'we could not tell which agent is asking.' }), async (port) => {
  const r = await cli(port, ['agent', 'instructions-add', 'sally', '--from', addFile()]);
  assert.equal(r.code, 1);
  assert.match(r.out, /Kosmos did not hold that addition: we could not tell which agent is asking\.$/m, 'a doubled full stop, or the reason was lost');
}));

test('#5293 usage: a missing --from, a missing file, or an extra word is refused before anything is sent', () => withStub(HELD, async (port, seen) => {
  assert.equal((await cli(port, ['agent', 'instructions-add', 'sally'])).code, 2);
  assert.equal((await cli(port, ['agent', 'instructions-add', 'sally', '--from', path.join(HOME, 'nope.md')])).code, 2);
  assert.equal((await cli(port, ['agent', 'instructions-add', 'sally', '--from', addFile(), 'extra'])).code, 2);
  assert.equal(seen.length, 0, 'a refused usage still reached the board');
}));

/* The Windows CLI, the same verb and the same sentences (tools/windows/kosmos-cli.js, in process, against a real server). */
const wincli = require('./tools/windows/kosmos-cli');
// The same hook shape tools.windows-kosmos-cli-570.test.js stubs: a fixed board token, the agent token only when hex.
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARDTOKEN_test_5293', agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };
async function winRun(argv, answer, env) {
  let seen = null; const out = []; const err = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => { seen = { url: req.url, headers: req.headers, body: JSON.parse(b || '{}') }; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(answer())); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const code = await wincli.main(argv, { env: env || {}, hook: hookStub, url: 'http://127.0.0.1:' + srv.address().port,
      out: (s) => out.push(s), err: (s) => err.push(s),
      readFile: (f) => { if (f === 'add.md') return ADD; const e = new Error('ENOENT: ' + f); e.code = 'ENOENT'; throw e; } });
    return { code, seen, out: out.join('\n'), err: err.join('\n') };
  } finally { await new Promise((r) => srv.close(r)); }
}

test('#5293 Windows: instructions-add sends the text with the agent token to that agent and says it is held', async () => {
  const r = await winRun(['agent', 'instructions-add', 'Sally Sales', '--from', 'add.md'], HELD, { KOSMOS_AGENT_TOKEN: 'abc123' });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.seen.url, '/api/agent/Sally%20Sales/instruction-add');
  assert.equal(r.seen.body.text, ADD);
  assert.equal(r.seen.headers['x-kosmos-agent-token'], 'abc123');
  assert.equal(Object.keys(r.seen.body).sort().join(','), 'from_pane,text', 'the CLI sent an asker of its own');
  assert.match(r.out, /Held\. The person applies it on Sally Sales's page in Kosmos; nothing changes until they do\./);
});

test('#5293 Windows: one already waiting is refused with who asked, the same sentence as the Mac', async () => {
  const r = await winRun(['agent', 'instructions-add', 'sally', '--from', 'add.md'],
    () => ({ ok: false, code: 'pending', pending: { askedBy: 'Ops lead', askedAt: '2026-10-05T14:14:00.000Z' } }), { KOSMOS_AGENT_TOKEN: 'abc123' });
  assert.equal(r.code, 1);
  assert.match(r.err, /Not sent: sally already has an addition waiting, asked by Ops lead on Oct \d+\. The person can apply or dismiss it on sally's page first\./);
});

test('#5293 Windows: usage errors are refused before anything is sent', async () => {
  for (const argv of [['agent', 'instructions-add', 'sally'], ['agent', 'instructions-add', 'sally', '--from', 'a.md', 'extra']]) {
    const r = await winRun(argv, HELD, { KOSMOS_AGENT_TOKEN: 'abc123' });
    assert.equal(r.code, 2, argv.join(' ')); assert.equal(r.seen, null, 'a refused usage reached the board');
  }
});
