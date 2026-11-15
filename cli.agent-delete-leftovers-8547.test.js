'use strict';
/**
 * kosmos#8547: `kosmos agent delete-leftovers [--yes]` (the Windows CLI) deletes what is left of every removed agent through
 * the board's own routes: GET /api/removed for the names, GET .../leftover for each plan, DELETE .../leftover with that
 * plan's `confirm`. A plan that asks for the name to be typed is never done here; with --yes only startup-job-only plans
 * are. Run in process against a stub board, as cli.agent-remove-7362.test.js runs the Windows CLI. Every "nothing sent"
 * case has a control showing the same stub records a DELETE when one is sent.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const wincli = require('./tools/windows/kosmos-cli');
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARDTOKEN_test_8547', agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };

// Plans in the engine's shape (engine/delete-leftover.js plan()).
const TASK_ONLY = (name) => ({ ok: true, name, shown: name, taskOnly: true, typeToConfirm: null, loses: ['Its startup job, so nothing tries to start it again'], question: 'Remove ' + name + '\'s startup job?', confirm: '1.task-' + name });
const FULL = (name) => ({ ok: true, name, shown: name, taskOnly: false, toTrash: true, typeToConfirm: null, folder: { path: '/x/' + name }, loses: ['Its folder, to the Recycle Bin', 'Its community account, for good'], question: 'Delete what is left of ' + name + '?', confirm: '1.full-' + name });
const TYPED = (name) => ({ ok: true, name, shown: name, taskOnly: true, typeToConfirm: name, loses: ['Its startup job'], confirm: '1.typed-' + name });
const REFUSED = { ok: false, because: 'nothing of zed is left on this computer, so there is nothing to delete.' };

/* A stub board. `plans` maps a decoded name to its plan; `del` answers each DELETE (default: deleted). Every request recorded. */
function withStub({ removed, plans = {}, del }, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => {
      const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      if (req.url === '/api/removed') { seen.push({ method: req.method, url: req.url, headers: req.headers }); return send(200, removed); }
      const m = req.url.match(/^\/api\/agent\/([^/]+)\/leftover$/);
      if (m) {
        const name = decodeURIComponent(m[1]);
        seen.push({ method: req.method, url: req.url, headers: req.headers, body: buf ? JSON.parse(buf) : null });
        if (req.method === 'GET') return send(200, plans[name] || REFUSED);
        const [status, json] = del ? del(name) : [200, { outcome: 'deleted', because: 'Deleted what was left of ' + name + '.' }];
        if (status === 'drop') { req.socket.destroy(); return undefined; }   // the board went away mid-delete
        return send(status, json);
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
async function winRun(port, argv, seams) {
  const out = []; const err = []; const asked = [];
  const s = seams || {};
  const code = await wincli.main(argv, { env: { KOSMOS_AGENT_TOKEN: 'abc123' }, hook: hookStub, url: 'http://127.0.0.1:' + port,
    out: (x) => out.push(x), err: (x) => err.push(x),
    canAsk: () => s.tty === true,
    ask: (q) => { asked.push(q); return Promise.resolve(s.answer || ''); } });
  return { code, out: out.join('\n'), err: err.join('\n'), asked };
}
const deletes = (seen) => seen.filter((s) => s.method === 'DELETE');

const MIXED = {
  removed: { agents: [{ name: 'tasky', shownAs: 'Tasky' }, { name: 'fully', shownAs: 'Fully' }, { name: 'typey' }, { name: 'zed' }], leftovers: [{ name: 'tasky' }, { name: 'settly' }] },
  plans: { tasky: TASK_ONLY('tasky'), fully: FULL('fully'), typey: TYPED('typey'), settly: TASK_ONLY('settly') },
};

test('#8547: --yes removes only the startup-job-only leftovers, each with its own plan\'s confirm and the board token, without asking', () => withStub(MIXED, async (port, seen) => {
  const r = await winRun(port, ['agent', 'delete-leftovers', '--yes']);
  assert.equal(r.asked.length, 0, '--yes still asked');
  assert.deepEqual(deletes(seen).map((d) => d.url), ['/api/agent/tasky/leftover', '/api/agent/settly/leftover'], 'the wrong agents were deleted');
  assert.deepEqual(deletes(seen).map((d) => d.body), [{ confirmed: '1.task-tasky' }, { confirmed: '1.task-settly' }], 'a DELETE did not carry its plan\'s fingerprint');
  for (const d of deletes(seen)) assert.equal(d.headers['x-kosmos-board-token'], 'BOARDTOKEN_test_8547', 'the delete did not go as the person');
  // A name on both lists is planned once.
  assert.equal(seen.filter((s) => s.method === 'GET' && s.url === '/api/agent/tasky/leftover').length, 1, 'a name on both lists was planned twice');
  assert.match(r.out, /Left because --yes removes only startup jobs.*: fully\./);
  assert.match(r.out, /Left for the board, where each one asks for its name to be typed first: typey\./);
  assert.match(r.out, /Not offered for zed: nothing of zed is left on this computer/);
  assert.match(r.out, /2 of 2 deleted\./);
  assert.equal(r.code, 1, 'some were left, so the run is not a clean success');
}));

test('#8547: at a terminal, y deletes the full and task-only leftovers after one question; anything else sends nothing (control: y sends)', async () => {
  for (const answer of ['', 'n', 'no', 'yess']) {
    await withStub(MIXED, async (port, seen) => {
      const r = await winRun(port, ['agent', 'delete-leftovers'], { tty: true, answer });
      assert.equal(r.code, 1, JSON.stringify(answer));
      assert.match(r.err, /Cancelled\. Nothing was deleted\./);
      assert.equal(deletes(seen).length, 0, 'a cancelled run still deleted');
    });
  }
  await withStub(MIXED, async (port, seen) => {
    const r = await winRun(port, ['agent', 'delete-leftovers'], { tty: true, answer: 'y' });
    assert.deepEqual(r.asked, ['Delete all 3 (1 cannot be put back afterwards)? [y/N] '], 'the question did not say how many cannot be put back');
    assert.match(r.out, /Folders go to the Recycle Bin\./);
    assert.deepEqual(deletes(seen).map((d) => d.url), ['/api/agent/tasky/leftover', '/api/agent/fully/leftover', '/api/agent/settly/leftover'], 'control: a confirmed run did not delete');
    assert.match(r.out, /fully: Its folder, to the Recycle Bin; Its community account, for good/, 'what a full delete loses was not shown before the question');
    assert.match(r.out, /1 of these delete more than a startup job/, 'the count of full deletes was not said before the question');
    assert.ok(!deletes(seen).some((d) => /typey/.test(d.url)), 'a plan asking for its name to be typed was deleted in bulk');
    assert.equal(r.code, 1, 'typey was left, so the run is not a clean success');
  });
});

test('#8547: with no terminal and no --yes, nothing is asked of the board (control: --yes reaches it)', () => withStub(MIXED, async (port, seen) => {
  const r = await winRun(port, ['agent', 'delete-leftovers']);
  assert.equal(r.code, 2);
  assert.match(r.err, /no terminal here to confirm on/);
  assert.equal(seen.length, 0, 'the board was asked');
  await winRun(port, ['agent', 'delete-leftovers', '--yes']);
  assert.ok(deletes(seen).length > 0, 'control: this stub did not record a DELETE');
}));

test('#8547: an extra word or an unknown option is refused with nothing sent', () => withStub(MIXED, async (port, seen) => {
  for (const argv of [['agent', 'delete-leftovers', 'tasky', '--yes'], ['agent', 'delete-leftovers', '--force', '--yes']]) {
    const r = await winRun(port, argv);
    assert.equal(r.code, 2, argv.join(' '));
  }
  assert.equal(seen.length, 0, 'a refused usage reached the board');
}));

test('#8547: an empty removed list deletes nothing and exits 0', () => withStub({ removed: { agents: [], leftovers: [] } }, async (port, seen) => {
  const r = await winRun(port, ['agent', 'delete-leftovers', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Nothing is left of any removed agent on this board/);
  assert.equal(deletes(seen).length, 0);
}));

test('#8547: the delete goes to the name the plan resolved, and a clean run exits 0', () => withStub({ removed: { agents: [{ name: 'Old Name' }] }, plans: { 'Old Name': TASK_ONLY('old-name') } }, async (port, seen) => {
  const r = await winRun(port, ['agent', 'delete-leftovers', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(deletes(seen).map((d) => d.url), ['/api/agent/old-name/leftover']);
  assert.match(r.out, /Deleted: old-name\./);
}));

test('#8547: a busy board (409) stops the run and names the ones never tried', () => withStub({ ...MIXED, del: () => [409, { outcome: 'refused', because: 'The board is about to restart, so nothing was deleted.' }] }, async (port, seen) => {
  const r = await winRun(port, ['agent', 'delete-leftovers', '--yes']);
  assert.equal(r.code, 1);
  assert.equal(deletes(seen).length, 1, 'it kept going after the board said it was busy');
  assert.match(r.err, /Stopped at tasky: The board is about to restart.*0 deleted so far\. The rest were not tried: settly\./);
}));

test('#8547: one refused delete is reported and the run goes on to the next', () => withStub({ ...MIXED, del: (name) => (name === 'tasky' ? [400, { outcome: 'refused', because: 'What Kosmos would do here is different now, so nothing was deleted.' }] : [200, { outcome: 'deleted' }]) }, async (port, seen) => {
  const r = await winRun(port, ['agent', 'delete-leftovers', '--yes']);
  assert.equal(r.code, 1);
  assert.equal(deletes(seen).length, 2);
  assert.match(r.err, /Not deleted: tasky: What Kosmos would do here is different now/);
  assert.match(r.out, /1 of 2 deleted\. Not done: 1 \(above\)\./);
}));

/* ── install/kosmos (Mac and Linux), against the same stub ─────────────────────── */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile);
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-dl-8547-')));
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
const CLI = path.join(__dirname, 'install', 'kosmos');
async function cli(port, args) {
  // execFile's stdin is a pipe, never a terminal: the no-TTY case is what a run without --yes meets here.
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, KOSMOS_HOME: HOME, KOSMOS_PORT: String(port), TMPDIR: os.tmpdir(),
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'), KOSMOS_AGENT_TOKEN: 'abc123' };
  try { const { stdout, stderr } = await run(CLI, args, { env, timeout: 30000 }); return { code: 0, out: stdout + stderr }; }
  catch (e) { return { code: e.code, out: String(e.stdout || '') + String(e.stderr || '') }; }
}

test('#8547 Mac: --yes removes only the startup-job-only leftovers, each with its plan\'s confirm, and names what it left', () => withStub(MIXED, async (port, seen) => {
  const r = await cli(port, ['agent', 'delete-leftovers', '--yes']);
  assert.deepEqual(deletes(seen).map((d) => d.url), ['/api/agent/tasky/leftover', '/api/agent/settly/leftover'], r.out);
  assert.deepEqual(deletes(seen).map((d) => d.body), [{ confirmed: '1.task-tasky' }, { confirmed: '1.task-settly' }]);
  assert.equal(seen.filter((s) => s.method === 'GET' && s.url === '/api/agent/tasky/leftover').length, 1, 'a name on both lists was planned twice');
  assert.match(r.out, /Left because --yes removes only startup jobs.*: fully\./);
  assert.match(r.out, /Left for the board, where each one asks for its name to be typed first: typey\./);
  assert.match(r.out, /Not offered for zed: nothing of zed is left on this computer, so there is nothing to delete\./);
  assert.match(r.out, /Deleted: tasky\.[\s\S]*Deleted: settly\.[\s\S]*2 of 2 deleted\./);
  assert.equal(r.code, 1, 'some were left, so the run is not a clean success: ' + r.out);
}));

test('#8547 Mac: no --yes and no terminal is refused before anything is sent (control: --yes reaches the board)', () => withStub(MIXED, async (port, seen) => {
  const r = await cli(port, ['agent', 'delete-leftovers']);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /no terminal here to confirm on/);
  assert.equal(seen.length, 0, 'the board was asked');
  for (const argv of [['agent', 'delete-leftovers', 'tasky', '--yes'], ['agent', 'delete-leftovers', '--force', '--yes']]) assert.equal((await cli(port, argv)).code, 2, argv.join(' '));
  assert.equal(seen.length, 0, 'a refused usage reached the board');
  await cli(port, ['agent', 'delete-leftovers', '--yes']);
  assert.ok(deletes(seen).length > 0, 'control: this stub did not record a DELETE');
}));

test('#8547 Mac: an empty list exits 0; a resolved name is deleted under it; a busy board (409) stops the run', async () => {
  await withStub({ removed: { agents: [] } }, async (port, seen) => {
    const r = await cli(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Nothing is left of any removed agent on this board/);
    assert.equal(deletes(seen).length, 0);
  });
  await withStub({ removed: { agents: [{ name: 'Old Name' }] }, plans: { 'Old Name': TASK_ONLY('old-name') } }, async (port, seen) => {
    const r = await cli(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(deletes(seen).map((d) => d.url), ['/api/agent/old-name/leftover']);
  });
  await withStub({ ...MIXED, del: () => [409, { outcome: 'refused', because: 'The board is about to restart, so nothing was deleted.' }] }, async (port, seen) => {
    const r = await cli(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(r.code, 1, r.out);
    assert.equal(deletes(seen).length, 1, 'it kept going after the board said it was busy');
    assert.match(r.out, /Stopped at tasky: The board is about to restart, so nothing was deleted\. 0 deleted so far\. The rest were not tried: settly\./);
  });
});

/* The Mac prompt at a real terminal, as cli.project-remove-member-7405.test.js drives one: script(1) cannot read a
   terminal's settings from node's stdio, so /bin/sh feeds it through a real pipe and types the answer once the prompt
   is in the output file. */
function cliAtTerminal(port, args, answer) {
  const out = path.join(HOME, 'tty-' + process.pid + '-' + Date.now() + '.out');
  const q = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
  const sh = '{ i=0; while ! grep -q "\\[y/N\\]" ' + q(out) + ' 2>/dev/null && [ $i -lt 150 ]; do sleep 0.1; i=$((i+1)); done; printf ' + q(answer + '\n')
    + '; sleep 1; } | /usr/bin/script -q /dev/null ' + [CLI, ...args].map(q).join(' ') + ' > ' + q(out) + ' 2>&1';
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, KOSMOS_HOME: HOME, KOSMOS_PORT: String(port), TMPDIR: os.tmpdir(),
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'), KOSMOS_AGENT_TOKEN: 'abc123' };
  return run('/bin/sh', ['-c', sh], { env, timeout: 40000 }).then(() => false, (e) => Boolean(e && e.killed))
    .then((timedOut) => { let t = ''; try { t = fs.readFileSync(out, 'utf8'); } catch { /* none */ } return { out: t.replace(/\r/g, ''), timedOut }; });
}
test('#8547 Mac: at a terminal, n sends nothing and y deletes the full and task-only leftovers (control: y sends)', { skip: process.platform !== 'darwin' }, () => withStub(MIXED, async (port, seen) => {
  const no = await cliAtTerminal(port, ['agent', 'delete-leftovers'], 'n');
  assert.equal(no.timedOut, false, 'the terminal run timed out: ' + no.out);
  assert.match(no.out, /Delete all 3 \(1 cannot be put back afterwards\)\? \[y\/N\]/, 'the prompt was not shown: ' + no.out);
  assert.match(no.out, /Cancelled\. Nothing was deleted\./);
  assert.equal(deletes(seen).length, 0, 'a cancelled run still deleted');
  const yes = await cliAtTerminal(port, ['agent', 'delete-leftovers'], 'y');
  assert.equal(yes.timedOut, false, 'the terminal run timed out: ' + yes.out);
  assert.match(yes.out, /fully: Its folder, to the Recycle Bin; Its community account, for good/, 'what a full delete loses was not shown');
  assert.deepEqual(deletes(seen).map((d) => d.url), ['/api/agent/tasky/leftover', '/api/agent/fully/leftover', '/api/agent/settly/leftover'], 'control: y did not delete: ' + yes.out);
  assert.match(yes.out, /1 of these delete more than a startup job/, 'the count of full deletes was not said');
  assert.match(yes.out, /3 of 3 deleted\./);
}));

test('#8547 Mac: a refused delete is reported and the run goes on; a 5xx with no outcome stops as "may be partly deleted" (exit 3)', async () => {
  await withStub({ ...MIXED, del: (name) => (name === 'tasky' ? [400, { outcome: 'refused', because: 'What Kosmos would do here is different now, so nothing was deleted.' }] : [200, { outcome: 'deleted' }]) }, async (port, seen) => {
    const r = await cli(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(r.code, 1, r.out);
    assert.equal(deletes(seen).length, 2, 'the run did not go on after one refusal: ' + r.out);
    assert.match(r.out, /Not deleted: tasky: What Kosmos would do here is different now, so nothing was deleted\./);
    assert.match(r.out, /1 of 2 deleted\. Not done: 1 \(above\)\./);
  });
  await withStub({ ...MIXED, del: () => [502, { error: 'bad gateway' }] }, async (port, seen) => {
    const r = await cli(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(r.code, 3, r.out);
    assert.equal(deletes(seen).length, 1, 'it kept going after a delete that may be partway');
    assert.match(r.out, /tasky may be partly deleted: bad gateway\. 0 deleted before it\. The rest were not tried: settly\./);
  });
  await withStub({ ...MIXED, del: () => [200, { outcome: 'partial', because: 'its folder went, its startup job did not' }] }, async (port) => {
    const r = await cli(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Only partly deleted tasky: its folder went, its startup job did not\./);
  });
});

test('#8547 Mac: a refused list says the board\'s reason and deletes nothing', () => withStub({ removed: { error: 'that needs the board token' } }, async (port, seen) => {
  const r = await cli(port, ['agent', 'delete-leftovers', '--yes']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Kosmos could not list the removed agents: that needs the board token\./);
  assert.equal(deletes(seen).length, 0);
}));

test('#8547 Windows: a dropped connection or a 5xx with no outcome stops as "may be partly deleted" (exit 3); a partial is reported and the run goes on', async () => {
  await withStub({ ...MIXED, del: () => ['drop'] }, async (port, seen) => {
    const r = await winRun(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(r.code, 3, r.err);
    assert.equal(deletes(seen).length, 1, 'it kept going after a delete that may be partway');
    assert.match(r.err, /may be partly deleted; look at the board before trying again\. 0 deleted before it\. The rest were not tried: settly\./);
  });
  await withStub({ ...MIXED, del: () => [502, { error: 'bad gateway' }] }, async (port, seen) => {
    const r = await winRun(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(r.code, 3, r.err);
    assert.equal(deletes(seen).length, 1);
    assert.match(r.err, /tasky may be partly deleted: bad gateway\. 0 deleted before it\. The rest were not tried: settly\./);
  });
  await withStub({ ...MIXED, del: (name) => (name === 'tasky' ? [200, { outcome: 'partial', because: 'its startup job did not go' }] : [200, { outcome: 'deleted' }]) }, async (port, seen) => {
    const r = await winRun(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(r.code, 1, r.err);
    assert.equal(deletes(seen).length, 2, 'the run did not go on after a partial');
    assert.match(r.err, /Only partly deleted tasky: its startup job did not go\./);
  });
});

const TWO_SPELLINGS = { removed: { agents: [{ name: 'Leo' }], leftovers: [{ name: 'leo' }] }, plans: { Leo: TASK_ONLY('leo'), leo: TASK_ONLY('leo') } };
test('#8547: two listed spellings of one agent are deleted once, on both CLIs', async () => {
  await withStub(TWO_SPELLINGS, async (port, seen) => {
    const r = await winRun(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(deletes(seen).map((d) => d.url), ['/api/agent/leo/leftover']);
  });
  await withStub(TWO_SPELLINGS, async (port, seen) => {
    const r = await cli(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(deletes(seen).map((d) => d.url), ['/api/agent/leo/leftover']);
  });
});

test('#8547: an agent the board does not offer makes the run exit 1, on both CLIs (control: without it, 0)', async () => {
  const ONE_REFUSED = { removed: { agents: [{ name: 'tasky' }, { name: 'zed' }] }, plans: { tasky: TASK_ONLY('tasky') } };
  const CLEAN = { removed: { agents: [{ name: 'tasky' }] }, plans: { tasky: TASK_ONLY('tasky') } };
  await withStub(ONE_REFUSED, async (port, seen) => {
    const w = await winRun(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(w.code, 1, w.out);
    const m = await cli(port, ['agent', 'delete-leftovers', '--yes']);
    assert.equal(m.code, 1, m.out);
    assert.equal(deletes(seen).length, 2, 'tasky was not deleted on each run');
  });
  await withStub(CLEAN, async (port) => {
    assert.equal((await winRun(port, ['agent', 'delete-leftovers', '--yes'])).code, 0);
    assert.equal((await cli(port, ['agent', 'delete-leftovers', '--yes'])).code, 0);
  });
});
