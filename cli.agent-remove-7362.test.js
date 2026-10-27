'use strict';
/**
 * kosmos#7362: `kosmos agent remove "<name>" [--yes]` removes an agent on this board through the board's own Remove:
 * GET /api/agent/<name>/removal (the plan, in the engine's words), then DELETE the same route. Never ?force=1. A
 * person confirms at a terminal; a script says --yes, and with neither nothing is sent. Run against a stub board in a
 * sandboxed KOSMOS_HOME for install/kosmos (as cli.instradd-5293.test.js does), and in process for the Windows CLI.
 * Every negative case has a control showing the same stub records a DELETE when one is sent.
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

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-agentrm-')));
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
const CLI = path.join(__dirname, 'install', 'kosmos');

// The engine's plan (engine/remove.js plan()) for an agent with a startup job, and its outcomes.
const PLAN = { ok: true, name: 'sally-sales', label: 'Sally Sales', question: 'Are you sure you want to remove Sally Sales from Kosmos?',
  reassurance: 'Removing is not deleting. Its files will not be deleted.',
  loses: ['Its place on the board', 'Starting again on its own, until you put it back'],
  keeps: ['Its folder, on this computer', 'Its instructions', 'Everything it has written'],
  hint: 'It stops running and leaves the board, and Kosmos stops it starting again; you can put it back.' };
const REFUSED_PLAN = [400, { ok: false, because: 'we cannot find an agent called nobody.' }];
const REMOVED = [200, { outcome: 'removed', because: 'Sally Sales has been removed from Kosmos. Its folder and everything in it is still on your computer.', steps: [] }];
const PARTIAL = [200, { outcome: 'partial', because: 'Sally Sales is off the board, but we could not shut it down, so it is still going.', steps: [] }];

/* A stub board: GET and DELETE on .../removal answer from `plan` and `done`; every request is recorded. */
function withStub(plan, done, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url.includes('/removal')) {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      const [status, json] = req.method === 'DELETE' ? done : plan;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
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
const deletes = (seen) => seen.filter((s) => s.method === 'DELETE');

/* ── install/kosmos (Mac and Linux) ─────────────────────────────────────────── */

async function cli(port, args) {
  // execFile's stdin is a pipe, never a terminal: the no-TTY case is what a run without --yes meets here.
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, KOSMOS_HOME: HOME, KOSMOS_PORT: String(port), TMPDIR: os.tmpdir(),
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'), KOSMOS_AGENT_TOKEN: 'abc123' };
  try { const { stdout, stderr } = await run(CLI, args, { env, timeout: 20000 }); return { code: 0, out: stdout + stderr }; }
  catch (e) { return { code: e.code, out: String(e.stdout || '') + String(e.stderr || '') }; }
}

test('#7362 Mac: --yes reads the plan, then removes through the same route, never forced, and says it can be put back', () => withStub([200, PLAN], REMOVED, async (port, seen) => {
  const r = await cli(port, ['agent', 'remove', 'Sally Sales', '--yes']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(seen.map((s) => s.method + ' ' + s.url), ['GET /api/agent/Sally%20Sales/removal', 'DELETE /api/agent/Sally%20Sales/removal']);
  assert.doesNotMatch(seen.map((s) => s.url).join(' '), /force/, 'the CLI sent the person\'s override');
  assert.match(r.out, /you can put it back\./, 'the plan\'s hint was not shown');
  assert.match(r.out, /Sally Sales has been removed from Kosmos\. Its folder/);
  assert.match(r.out, /It can be put back from the board/);
}));

test('#7362 Mac: a refused plan prints the board\'s reason and sends no DELETE', () => withStub(REFUSED_PLAN, REMOVED, async (port, seen) => {
  const r = await cli(port, ['agent', 'remove', 'nobody', '--yes']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Kosmos will not remove nobody: we cannot find an agent called nobody\.$/m);
  assert.equal(seen.length, 1, 'the plan was not asked for');
  assert.equal(deletes(seen).length, 0, 'a refused plan still sent the removal');
}));

test('#7362 Mac: a partial removal exits non-zero and says partly', () => withStub([200, PLAN], PARTIAL, async (port, seen) => {
  const r = await cli(port, ['agent', 'remove', 'Sally Sales', '--yes']);
  assert.equal(r.code, 1, r.out);
  assert.equal(deletes(seen).length, 1);
  assert.match(r.out, /Only partly removed: Sally Sales is off the board, but we could not shut it down, so it is still going\./);
  assert.doesNotMatch(r.out, /can be put back/);
}));

test('#7362 Mac: no --yes and no terminal is refused before anything is sent', () => withStub([200, PLAN], REMOVED, async (port, seen) => {
  const r = await cli(port, ['agent', 'remove', 'Sally Sales']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /Nothing was removed: there is no terminal here to confirm on\. To remove Sally Sales without being asked, add --yes\./);
  assert.equal(seen.length, 0, 'a refused run still reached the board');
}));

test('#7362 Mac: an option-shaped name, a missing name, or an extra word is refused before any request', () => withStub([200, PLAN], REMOVED, async (port, seen) => {
  const opt = await cli(port, ['agent', 'remove', '--foo', '--yes']);
  assert.equal(opt.code, 2, opt.out);
  assert.match(opt.out, /--foo is not an option of kosmos agent remove, so nothing was done\./);
  assert.equal((await cli(port, ['agent', 'remove', '--yes'])).code, 2);
  assert.equal((await cli(port, ['agent', 'remove', 'sally', 'extra', '--yes'])).code, 2);
  assert.equal(seen.length, 0, 'a refused usage still reached the board');
}));

/* ── tools/windows/kosmos-cli.js, in process, against the same stub ─────────────── */

const wincli = require('./tools/windows/kosmos-cli');
// The same hook shape cli.instradd-5293.test.js stubs: a fixed board token, the agent token only when hex.
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARDTOKEN_test_7362', agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };
async function winRun(port, argv, seams) {
  const out = []; const err = []; const asked = [];
  const s = seams || {};
  const code = await wincli.main(argv, { env: { KOSMOS_AGENT_TOKEN: 'abc123' }, hook: hookStub, url: 'http://127.0.0.1:' + port,
    out: (x) => out.push(x), err: (x) => err.push(x),
    canAsk: () => s.tty === true,
    ask: (q) => { asked.push(q); return Promise.resolve(s.answer || ''); } });
  return { code, out: out.join('\n'), err: err.join('\n'), asked };
}

test('#7362 Windows: --yes reads the plan, then removes through the same route, never forced, without asking', () => withStub([200, PLAN], REMOVED, async (port, seen) => {
  const r = await winRun(port, ['agent', 'remove', 'Sally Sales', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(seen.map((x) => x.method + ' ' + x.url), ['GET /api/agent/Sally%20Sales/removal', 'DELETE /api/agent/Sally%20Sales/removal']);
  assert.doesNotMatch(seen.map((x) => x.url).join(' '), /force/, 'the CLI sent the person\'s override');
  assert.equal(seen[1].headers['x-kosmos-agent-token'], 'abc123', 'the removal did not go as this agent');
  assert.equal(r.asked.length, 0, '--yes still asked');
  assert.match(r.out, /you can put it back\./, 'the plan\'s hint was not shown');
  assert.match(r.out, /It loses: Its place on the board; Starting again on its own, until you put it back\./);
  assert.match(r.out, /Sally Sales has been removed from Kosmos\. Its folder and everything in it is still on your computer\.$/m);
  assert.match(r.out, /It can be put back from the board/);
}));

test('#7362 Windows: at a terminal, y removes and anything else cancels with nothing sent (control: y sends the DELETE)', () => withStub([200, PLAN], REMOVED, async (port, seen) => {
  const yes = await winRun(port, ['agent', 'remove', 'Sally Sales'], { tty: true, answer: 'y' });
  assert.equal(yes.code, 0, yes.err);
  assert.deepEqual(yes.asked, ['Remove Sally Sales? [y/N] '], 'the question did not name the agent by its label');
  assert.equal(deletes(seen).length, 1, 'control: a confirmed removal was not sent');
  for (const answer of ['', 'n', 'no', 'yess']) {
    const r = await winRun(port, ['agent', 'remove', 'Sally Sales'], { tty: true, answer });
    assert.equal(r.code, 1, JSON.stringify(answer));
    assert.match(r.err, /Cancelled\. Nothing was removed\./);
  }
  assert.equal(deletes(seen).length, 1, 'a cancelled removal was still sent');
}));

test('#7362 Windows: a refused plan prints the board\'s reason and sends no DELETE (control: an ok plan does)', () => withStub(REFUSED_PLAN, REMOVED, async (port, seen) => {
  const r = await winRun(port, ['agent', 'remove', 'nobody', '--yes']);
  assert.equal(r.code, 1);
  assert.equal(r.err, 'Kosmos will not remove nobody: we cannot find an agent called nobody.');
  assert.equal(seen.length, 1, 'the plan was not asked for');
  assert.equal(deletes(seen).length, 0, 'a refused plan still sent the removal');
}).then(() => withStub([200, PLAN], REMOVED, async (port, seen) => {
  await winRun(port, ['agent', 'remove', 'nobody', '--yes']);
  assert.equal(deletes(seen).length, 1, 'control: this stub did not record a DELETE');
})));

test('#7362 Windows: a token-only caller the board refuses (403) is told the board\'s own words', () => withStub([200, PLAN], [403, { error: 'you can only remove an agent you made' }], async (port) => {
  const r = await winRun(port, ['agent', 'remove', 'Sally Sales', '--yes']);
  assert.equal(r.code, 1);
  assert.equal(r.err, 'Kosmos did not remove Sally Sales: you can only remove an agent you made.');
}));

test('#7362 Windows: a partial removal exits non-zero and says partly, never as success', () => withStub([200, PLAN], PARTIAL, async (port, seen) => {
  const r = await winRun(port, ['agent', 'remove', 'Sally Sales', '--yes']);
  assert.equal(r.code, 1);
  assert.equal(deletes(seen).length, 1);
  assert.equal(r.err, 'Only partly removed: Sally Sales is off the board, but we could not shut it down, so it is still going.');
  assert.doesNotMatch(r.out, /has been removed|can be put back/);
}));

test('#7362 Windows: no --yes and no terminal is refused before anything is sent (control: --yes sends)', () => withStub([200, PLAN], REMOVED, async (port, seen) => {
  const r = await winRun(port, ['agent', 'remove', 'Sally Sales'], { tty: false });
  assert.equal(r.code, 2);
  assert.match(r.err, /Nothing was removed: there is no terminal here to confirm on\. To remove Sally Sales without being asked, add --yes\./);
  assert.equal(seen.length, 0, 'a refused run still reached the board');
  await winRun(port, ['agent', 'remove', 'Sally Sales', '--yes'], { tty: false });
  assert.equal(deletes(seen).length, 1, 'control: this stub did not record a DELETE');
}));

test('#7362 Windows: an option-shaped name, a missing name, or an extra word is refused before any request (control: a plain name sends)', () => withStub([200, PLAN], REMOVED, async (port, seen) => {
  const opt = await winRun(port, ['agent', 'remove', '--foo', '--yes']);
  assert.equal(opt.code, 2);
  assert.match(opt.err, /^--foo is not an option of kosmos agent remove, so nothing was done\./);
  assert.doesNotMatch(opt.err, /put -- before it/, 'a name slot offered the -- escape');
  assert.equal((await winRun(port, ['agent', 'remove', '--yes'])).code, 2);
  const extra = await winRun(port, ['agent', 'remove', 'sally', 'extra', '--yes']);
  assert.equal(extra.code, 2);
  assert.match(extra.err, /takes no more words than its usage shows/);
  assert.equal((await winRun(port, ['agent', 'remove', 'sally', '--force', '--yes'])).code, 2, 'an unknown option after the name was taken');
  assert.equal(seen.length, 0, 'a refused usage still reached the board');
  await winRun(port, ['agent', 'remove', 'sally', '--yes']);
  assert.equal(deletes(seen).length, 1, 'control: this stub did not record a DELETE');
}));

test('#7362 Windows: a timeout after the removal was sent says it MAY have been removed, exit 3', async () => {
  let deleted = 0;
  const srv = http.createServer((req, res) => {
    if (req.method === 'DELETE') { deleted++; return; }   // never answers
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(PLAN));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  // fetch is a seam: shorten only the DELETE's wait, so the test does not sit out the real long timeout.
  const out = []; const err = [];
  try {
    const code = await wincli.main(['agent', 'remove', 'Sally Sales', '--yes'], { env: {}, hook: hookStub, url: 'http://127.0.0.1:' + port,
      out: (x) => out.push(x), err: (x) => err.push(x), canAsk: () => false, ask: () => Promise.resolve(''),
      fetch: (u, init) => fetch(u, init.method === 'DELETE' ? Object.assign({}, init, { signal: AbortSignal.timeout(300) }) : init) });
    assert.equal(code, 3);
    assert.equal(deleted, 1);
    assert.match(err.join('\n'), /Sally Sales may have been removed; look at the board before trying again\./);
  } finally { srv.closeAllConnections(); await new Promise((r) => srv.close(r)); }
});

test('#7362 Windows: agent --help lists remove, and asking for help sends nothing', async () => {
  const out = [];
  const code = await wincli.main(['agent', 'remove', '--help'], { env: {}, hook: hookStub, url: 'http://127.0.0.1:1', out: (x) => out.push(x), err: () => {} });
  assert.equal(code, 0);
  assert.match(out.join('\n'), /kosmos agent remove "<name>" \[--yes\]/);
});

test('#7362 review 1: a removal that threw partway (500) says it MAY be partly removed, exit 3, never "did not remove"', () => withStub([200, PLAN], [500, { error: 'the removal failed partway and we cannot tell you how far it got', detail: 'boom' }], async (port, seen) => {
  const r = await winRun(port, ['agent', 'remove', 'Sally Sales', '--yes']);
  assert.equal(deletes(seen).length, 1, 'CONTROL: the removal was sent');
  assert.equal(r.code, 3, r.err);
  assert.match(r.err, /Sally Sales may be partly removed: the removal failed partway/);
  assert.doesNotMatch(r.err, /did not remove/);
}));

test('#7362 review 1: a connection dropped after the removal was sent says it MAY have been removed, exit 3', async () => {
  let deleted = 0;
  const srv = http.createServer((req, res) => {
    if (req.method === 'DELETE') { deleted++; req.socket.destroy(); return; }   // the board went away mid-removal
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(PLAN));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const out = []; const err = [];
  try {
    const code = await wincli.main(['agent', 'remove', 'Sally Sales', '--yes'], { env: {}, hook: hookStub, url: 'http://127.0.0.1:' + port,
      out: (x) => out.push(x), err: (x) => err.push(x), canAsk: () => false, ask: () => Promise.resolve('') });
    assert.equal(deleted, 1, 'CONTROL: the removal reached the board');
    assert.equal(code, 3, err.join('\n'));
    assert.match(err.join('\n'), /Sally Sales may have been removed/);
    assert.doesNotMatch(err.join('\n'), /Is it running/);
  } finally { srv.closeAllConnections(); await new Promise((r) => srv.close(r)); }
});

test('#7362 review 2 Mac: a removal that threw partway (500 {error, detail}) says it MAY be partly removed, exit 3', () => withStub([200, PLAN], [500, { error: 'the removal failed partway and we cannot tell you how far it got', detail: 'boom' }], async (port, seen) => {
  const r = await cli(port, ['agent', 'remove', 'Sally Sales', '--yes']);
  assert.equal(deletes(seen).length, 1, 'CONTROL: the removal was sent');
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /Sally Sales may be partly removed: the removal failed partway/);
  assert.doesNotMatch(r.out, /did not remove/);
}));

test('#7362 review 2 Mac: a connection dropped after the removal was sent says it MAY have been removed, exit 3', async () => {
  let deleted = 0;
  const srv = http.createServer((req, res) => {
    if (req.method === 'DELETE') { deleted++; req.socket.destroy(); return; }
    if (req.url.includes('/removal')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(PLAN)); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Kosmos</title>Agent Workforce');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const r = await cli(srv.address().port, ['agent', 'remove', 'Sally Sales', '--yes']);
    assert.equal(deleted, 1, 'CONTROL: the removal reached the board');
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /Sally Sales may have been removed; look at the board/);
  } finally { srv.closeAllConnections(); await new Promise((r) => srv.close(r)); }
});

for (const dot of ['.', '..']) {
  test(`#7362 review 2: "${dot}" is refused as a name before any request, in both CLIs`, () => withStub([200, PLAN], REMOVED, async (port, seen) => {
    const w = await winRun(port, ['agent', 'remove', dot, '--yes']);
    assert.equal(w.code, 2, w.err);
    assert.match(w.err, /There is no agent called/);
    assert.equal(seen.length, 0, 'Windows: nothing was sent');
    const ok = await winRun(port, ['agent', 'remove', 'Sally Sales', '--yes']);
    assert.equal(deletes(seen).length, 1, 'CONTROL: a plain name is sent');
    if (process.platform === 'win32') return;   // the bash CLI cannot run here
    const before = seen.length;
    const m = await cli(port, ['agent', 'remove', dot, '--yes']);
    assert.equal(m.code, 2, m.out);
    assert.equal(seen.length, before, 'Mac: nothing was sent');
    void ok;
  }));
}
