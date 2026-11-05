'use strict';
/**
 * kosmos#8048 item 3: `kosmos agent move "<name>" "<account>" [--yes]` moves one agent through the board's own move:
 * GET /api/agents/account-plan (which account, and what the agent would lose there), then POST /api/agents/account,
 * then GET /api/agents/account-moves/<id> until it ends. Run against a stub board in a sandboxed KOSMOS_HOME, as
 * cli.agent-remove-7362.test.js does for remove. Every negative case has a control showing the same stub records a
 * POST when one is sent.
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

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-agentmv-')));
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
const CLI = path.join(__dirname, 'install', 'kosmos');

const CLEAN = [200, { ok: true, dir: '/u/.claude-spare', label: 'spare', skills: [], hooks: [], sentence: null }];
const CHANGED = [200, { ok: true, loses: false, dir: '/u/.claude-spare', label: 'spare', skills: [], changed: ['pick-up'], hooks: [],
  sentence: 'That account has a different copy of the skill pick-up.' }];
const LOSES = [200, { ok: true, loses: true, dir: '/u/.claude-spare', label: 'spare', skills: ['design-shots'], hooks: ['destructive-cmd-gate.sh'],
  sentence: 'On that account it would not have the skill design-shots, or the hook destructive-cmd-gate.sh.' }];
const CANNOT = [200, { ok: false, dir: '/u/.claude-spare', label: 'spare', because: 'we could not read the skills and hooks of the account it would move to' }];
const SAME = [200, { ok: true, same: true, dir: '/u/.claude-spare', label: 'spare', skills: [], hooks: [] }];
const UNKNOWN = [404, { ok: false, because: 'that is not one of the Claude accounts on this computer' }];
const STARTED = [202, { id: 'mv1', agents: [{ name: 'ada', outcome: 'pending' }] }];
const REFUSED = [202, { id: 'mv2', agents: [{ name: 'ada', outcome: 'refused', because: 'ada is restarting, so it cannot be moved now.' }] }];
const DONE = [200, { id: 'mv1', done: true, agents: [{ name: 'ada', outcome: 'changed', because: 'ada runs on spare now. It is starting again, and it will look idle for a moment.' }] }];
const FORGOT = [404, { error: 'this board does not know that move' }];
const HALF = [200, { id: 'mv1', done: true, agents: [{ name: 'ada', outcome: 'partial', because: 'ada is saved on spare but did not restart there.' }] }];

/* A stub board: the plan, the move and its progress answer from the given replies; every request is recorded. */
function withStub({ plan, post = STARTED, progress = DONE }, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      let reply = null;
      if (req.url.startsWith('/api/agents/account-plan')) reply = plan;
      else if (req.url === '/api/agents/account' && req.method === 'POST') reply = post;
      else if (req.url.startsWith('/api/agents/account-moves/')) reply = Array.isArray(progress[0]) ? (progress.length > 1 ? progress.shift() : progress[0]) : progress;
      if (reply) {
        seen.push({ method: req.method, url: req.url, body: raw });
        res.writeHead(reply[0], { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply[1]));
        return;
      }
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
const posts = (seen) => seen.filter((s) => s.method === 'POST');

async function cli(port, args, extra = {}) {
  // execFile's stdin is a pipe, never a terminal: the no-TTY case is what a run without --yes meets here.
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, KOSMOS_HOME: HOME, KOSMOS_PORT: String(port), TMPDIR: os.tmpdir(),
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'), KOSMOS_AGENT_TOKEN: 'abc123', ...extra };
  try { const { stdout, stderr } = await run(CLI, args, { env, timeout: 30000 }); return { code: 0, out: stdout + stderr }; }
  catch (e) { return { code: e.code, out: String(e.stdout || '') + String(e.stderr || '') }; }
}

test('kosmos#8048 Mac: --yes reads the plan by the account\'s name, moves to its folder, and says how it ended', () => withStub({ plan: CLEAN }, async (port, seen) => {
  const r = await cli(port, ['agent', 'move', 'ada', 'Spare', '--yes']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(seen.map((s) => s.method + ' ' + s.url), ['GET /api/agents/account-plan?name=ada&account=Spare', 'POST /api/agents/account', 'GET /api/agents/account-moves/mv1']);
  assert.deepEqual(JSON.parse(posts(seen)[0].body), { dir: '/u/.claude-spare', names: ['ada'] }, 'the move was not sent to the plan\'s folder');
  assert.match(r.out, /On spare it keeps every skill and hook script it has now \(skills and hooks from plugins are not checked\)\./);
  assert.match(r.out, /Moving restarts ada on spare\. Anything it has running stops\./);
  assert.match(r.out, /ada runs on spare now\. It is starting again/);
}));

test('kosmos#8048 Mac: what it would lose is said, and --yes alone does not move into it; --accept-loss does', () => withStub({ plan: LOSES }, async (port, seen) => {
  const r = await cli(port, ['agent', 'move', 'ada', 'spare', '--yes']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /On that account it would not have the skill design-shots, or the hook destructive-cmd-gate\.sh\./);
  assert.doesNotMatch(r.out, /keeps every skill/, 'a loss was also said as no loss');
  assert.match(r.out, /Nothing was moved: with --yes, a move that may lose skills or hooks also needs --accept-loss\./);
  assert.equal(posts(seen).length, 0, '--yes alone moved an agent into a known loss');
  const ok = await cli(port, ['agent', 'move', 'ada', 'spare', '--yes', '--accept-loss']);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(posts(seen).length, 1, 'CONTROL: --accept-loss did not move it');
}));

test('kosmos#8048 Mac: a plan that could not tell is said as such, never as nothing lost, and needs --accept-loss with --yes', () => withStub({ plan: CANNOT }, async (port, seen) => {
  const r = await cli(port, ['agent', 'move', 'ada', 'spare', '--yes']);
  assert.equal(r.code, 2, r.out);
  assert.equal(posts(seen).length, 0, 'an unchecked move went with --yes alone');
  assert.match(r.out, /Kosmos could not check what ada would lose on spare: we could not read the skills and hooks of the account it would move to\./);
  assert.doesNotMatch(r.out, /keeps every skill/, '"cannot tell" read as "nothing lost"');
}));

test('kosmos#8048 Mac: an unknown account is refused with the board\'s words, and nothing is moved', () => withStub({ plan: UNKNOWN }, async (port, seen) => {
  const r = await cli(port, ['agent', 'move', 'ada', 'nope', '--yes']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Kosmos will not move ada: that is not one of the Claude accounts on this computer\./);
  assert.equal(posts(seen).length, 0, 'a refused plan still moved');
}));

test('kosmos#8048 Mac: already there moves nothing; a refusal and a partial move exit non-zero in the board\'s words', async () => {
  await withStub({ plan: SAME }, async (port, seen) => {
    const r = await cli(port, ['agent', 'move', 'ada', 'spare', '--yes']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ada is already on spare\. Nothing was moved\./);
    assert.equal(posts(seen).length, 0);
  });
  await withStub({ plan: CLEAN, post: REFUSED }, async (port) => {
    const r = await cli(port, ['agent', 'move', 'ada', 'spare', '--yes']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Kosmos did not move ada: ada is restarting, so it cannot be moved now\./);
  });
  await withStub({ plan: CLEAN, progress: HALF }, async (port) => {
    const r = await cli(port, ['agent', 'move', 'ada', 'spare', '--yes']);
    assert.equal(r.code, 1, 'exit ' + r.code + '; the CLI said: ' + r.out);
    assert.match(r.out, /Not fully moved: ada is saved on spare but did not restart there\. Settings, AI Models shows/);
  });
  await withStub({ plan: CLEAN, progress: FORGOT }, async (port) => {
    const r = await cli(port, ['agent', 'move', 'ada', 'spare', '--yes']);
    assert.equal(r.code, 3, 'a move the board forgot did not exit 3 ("may"); it said: ' + r.out);
    assert.match(r.out, /Kosmos restarted during the move and no longer knows how it ended\. Settings, AI Models shows which account ada is on/);
  });
});

test('kosmos#8048 Mac: no --yes and no terminal, an option-shaped word, a missing account or an extra word: nothing is sent', () => withStub({ plan: CLEAN }, async (port, seen) => {
  const r = await cli(port, ['agent', 'move', 'ada', 'spare']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /Nothing was moved: there is no terminal here to confirm on\. To move ada without being asked, add --yes\./);
  assert.equal((await cli(port, ['agent', 'move', '--foo', 'spare', '--yes'])).code, 2);
  assert.equal((await cli(port, ['agent', 'move', 'ada', '--yes'])).code, 2);
  assert.equal((await cli(port, ['agent', 'move', 'ada', 'spare', 'extra', '--yes'])).code, 2);
  assert.equal(seen.length, 0, 'a refused usage still reached the board');
  // CONTROL: the same stub records a move when one is sent.
  assert.equal((await cli(port, ['agent', 'move', 'ada', 'spare', '--yes'])).code, 0);
  assert.equal(posts(seen).length, 1);
}));

/* ── tools/windows/kosmos-cli.js, in process, against the same stub ─────────────── */

const wincli = require('./tools/windows/kosmos-cli');
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARDTOKEN_test_8048', agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };
async function winRun(port, argv, seams) {
  const out = []; const err = []; const asked = []; const slept = [];
  const s = seams || {};
  let clock = 0;   // advanced by each wait, so a pending move meets the time bound without real waiting
  const code = await wincli.main(argv, { env: { KOSMOS_AGENT_TOKEN: 'abc123' }, hook: hookStub, url: 'http://127.0.0.1:' + port,
    out: (x) => out.push(x), err: (x) => err.push(x), canAsk: () => s.tty === true,
    ask: (q) => { asked.push(q); return Promise.resolve(s.answer || ''); },
    sleep: (ms) => { slept.push(ms); clock += ms; return Promise.resolve(); }, now: () => clock });
  return { code, out: out.join('\n'), err: err.join('\n'), asked, slept };
}

test('kosmos#8048 Windows: --yes reads the plan, moves to its folder, waits on the move, and says how it ended', () => withStub({ plan: CLEAN }, async (port, seen) => {
  const r = await winRun(port, ['agent', 'move', 'ada', 'Spare', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(seen.map((s) => s.method + ' ' + s.url), ['GET /api/agents/account-plan?name=ada&account=Spare', 'POST /api/agents/account', 'GET /api/agents/account-moves/mv1']);
  assert.deepEqual(JSON.parse(posts(seen)[0].body), { dir: '/u/.claude-spare', names: ['ada'] });
  assert.deepEqual(r.slept, [3000], 'the progress was not waited for between reads');
  assert.equal(r.asked.length, 0, '--yes still asked');
  assert.match(r.out, /On spare it keeps every skill and hook script it has now \(skills and hooks from plugins are not checked\)\./);
  assert.match(r.out, /ada runs on spare now\. It is starting again/);
}));

test('kosmos#8048 Windows: a loss and a "cannot tell" are said before the confirm; anything but y cancels with nothing moved', async () => {
  await withStub({ plan: LOSES }, async (port, seen) => {
    const no = await winRun(port, ['agent', 'move', 'ada', 'spare'], { tty: true, answer: 'n' });
    assert.equal(no.code, 1, no.err);
    assert.match(no.out, /On that account it would not have the skill design-shots, or the hook destructive-cmd-gate\.sh\./);
    assert.deepEqual(no.asked, ['Move ada to spare? [y/N] ']);
    assert.match(no.err, /Cancelled\. Nothing was moved\./);
    assert.equal(posts(seen).length, 0, 'a cancelled move was sent');
    const yes = await winRun(port, ['agent', 'move', 'ada', 'spare'], { tty: true, answer: 'y' });
    assert.equal(yes.code, 0, yes.err);
    assert.equal(posts(seen).length, 1, 'control: a confirmed move was not sent');
  });
  await withStub({ plan: CANNOT }, async (port, seen) => {
    const r = await winRun(port, ['agent', 'move', 'ada', 'spare', '--yes']);
    assert.match(r.out, /Kosmos could not check what ada would lose on spare: we could not read the skills and hooks of the account it would move to\./);
    assert.doesNotMatch(r.out, /keeps every skill/, '"cannot tell" read as "nothing lost"');
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /also needs --accept-loss/);
    assert.equal(posts(seen).length, 0, 'an unchecked move went with --yes alone');
    const ok = await winRun(port, ['agent', 'move', 'ada', 'spare', '--yes', '--accept-loss']);
    assert.equal(ok.code, 0, ok.err);
    assert.equal(posts(seen).length, 1, 'CONTROL: --accept-loss did not move it');
  });
  await withStub({ plan: CLEAN, progress: FORGOT }, async (port) => {
    const r = await winRun(port, ['agent', 'move', 'ada', 'spare', '--yes']);
    assert.equal(r.code, 3, r.err);
    assert.deepEqual(r.slept, [3000], 'it kept polling a board that forgot the move');
    assert.match(r.err, /Kosmos restarted during the move and no longer knows how it ended/);
  });
});

test('kosmos#8048 Windows: an unknown account, a refusal and a partial move exit non-zero; no terminal and no --yes sends nothing', async () => {
  await withStub({ plan: UNKNOWN }, async (port, seen) => {
    const r = await winRun(port, ['agent', 'move', 'ada', 'nope', '--yes']);
    assert.equal(r.code, 1);
    assert.match(r.err, /Kosmos will not move ada: that is not one of the Claude accounts on this computer\./);
    assert.equal(posts(seen).length, 0);
  });
  await withStub({ plan: CLEAN, post: REFUSED }, async (port) => {
    const r = await winRun(port, ['agent', 'move', 'ada', 'spare', '--yes']);
    assert.equal(r.code, 1);
    assert.match(r.err, /Kosmos did not move ada: ada is restarting, so it cannot be moved now\./);
  });
  await withStub({ plan: CLEAN, progress: HALF }, async (port) => {
    const r = await winRun(port, ['agent', 'move', 'ada', 'spare', '--yes']);
    assert.equal(r.code, 1);
    assert.match(r.err, /Not fully moved: ada is saved on spare but did not restart there\. Settings, AI Models shows/);
  });
  await withStub({ plan: CLEAN }, async (port, seen) => {
    const r = await winRun(port, ['agent', 'move', 'ada', 'spare']);
    assert.equal(r.code, 2);
    assert.match(r.err, /Nothing was moved: there is no terminal here to confirm on\. To move ada without being asked, add --yes\./);
    assert.equal(seen.length, 0);
  });
});

test('kosmos#8048 review 2 Mac: a poll that meets a restarting board (503) waits through it; only a 404 is "forgotten"', () => withStub({ plan: CLEAN, progress: [[503, { error: 'Kosmos is restarting' }], DONE] }, async (port, seen) => {
  const r = await cli(port, ['agent', 'move', ' ada ', 'spare', '--yes']);
  assert.equal(r.code, 0, 'a 503 mid-move was read as forgotten: ' + r.out);
  assert.match(r.out, /ada runs on spare now/);
  assert.equal(seen.filter((x) => x.url.startsWith('/api/agents/account-moves/')).length, 2);
  assert.deepEqual(JSON.parse(posts(seen)[0].body).names, ['ada'], 'the name was not trimmed before the move');
  assert.match(seen[0].url, /name=ada&/, 'the name was not trimmed before the plan');
}));

test('kosmos#8048 review 2 Windows: a 503 is waited through; a move still pending at five minutes stops waiting and says so', async () => {
  await withStub({ plan: CLEAN, progress: [[503, { error: 'Kosmos is restarting' }], DONE] }, async (port) => {
    const r = await winRun(port, ['agent', 'move', 'ada', 'spare', '--yes']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.slept, [3000, 3000]);
  });
  await withStub({ plan: CLEAN, progress: [200, { id: 'mv1', done: false, agents: [{ name: 'ada', outcome: 'pending' }] }] }, async (port) => {
    const r = await winRun(port, ['agent', 'move', 'ada', 'spare', '--yes']);
    assert.equal(r.code, 3, r.err);
    assert.equal(r.slept.length, 100, 'the wait was not bounded by time (100 waits of 3 s is 300 s)');
    assert.match(r.err, /still moving after five minutes/);
  });
});

test('kosmos#8048 review 3: a different copy of a skill is said, but --yes still moves (it is not a loss)', async () => {
  await withStub({ plan: CHANGED }, async (port, seen) => {
    const r = await cli(port, ['agent', 'move', 'ada', 'spare', '--yes']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /That account has a different copy of the skill pick-up\./);
    assert.equal(posts(seen).length, 1, 'a different copy was treated as a loss');
  });
  await withStub({ plan: CHANGED }, async (port, seen) => {
    const r = await winRun(port, ['agent', 'move', 'ada', 'spare', '--yes']);
    assert.equal(r.code, 0, r.err);
    assert.equal(posts(seen).length, 1, 'Windows treated a different copy as a loss');
  });
});

test('kosmos#8048 review 3 Mac: a move still pending at the time bound stops waiting and says so (exit 3)', () => withStub({ plan: CLEAN, progress: [200, { id: 'mv1', done: false, agents: [{ name: 'ada', outcome: 'pending' }] }] }, async (port) => {
  const r = await cli(port, ['agent', 'move', 'ada', 'spare', '--yes'], { KOSMOS_MOVE_WAIT_S: '4' });
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /ada is still moving after five minutes/);
}));

test('kosmos#8048 review 3 Windows: a plan answer that is not JSON is said as unreadable, not as a refusal', () => withStub({ plan: [503, null] }, async (port) => {
  const r = await winRun(port, ['agent', 'move', 'ada', 'spare', '--yes']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Kosmos gave an answer we could not read when asked about moving ada\./);
  assert.doesNotMatch(r.err, /will not move/);
}));
