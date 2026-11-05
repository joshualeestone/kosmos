'use strict';
/* kosmos#7989 slice 2: `kosmos project who <file>` on the Windows CLI, the parity half of cli.project-who-7989.test.js.
   fetch is injected (tools.windows-kosmos-cli-project-4581.test.js's harness); the answer is a real filewriters.about
   answer and the renderer is the real engine/filewhoview.js. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-project-who-win-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const cli = require('./tools/windows/kosmos-cli');
const fw = require('./engine/filewriters');
const { renderWho } = require('./engine/filewhoview');
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const FOLDER = path.join(SANDBOX, 'projects', 'ff');
fs.mkdirSync(FOLDER, { recursive: true });
const LIST = [{ id: 'ff', name: 'Five Families', folder: FOLDER }];
const FILE = path.join(FOLDER, 'plan & next.md');
const T = Date.now() - 60000;
fw.noteWrite(FILE, 'mona', { now: T, projects: LIST });
fs.writeFileSync(FILE, 'x');
fs.utimesSync(FILE, new Date(T + 1000), new Date(T + 1000));
const ANSWER = fw.about(FILE, { projects: LIST });

const AGENT = 'ab'.repeat(32);
const BOARD = 'cd'.repeat(32);
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => BOARD, agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };
async function run(argv, answer, cwd = FOLDER, extra = {}) {
  const calls = []; const out = []; const err = [];
  const code = await cli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT }, hook: hookStub, cwd: () => cwd, ...extra,
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      const route = url.replace('http://127.0.0.1:1', '');
      calls.push({ route, method: init.method, headers: init.headers });
      const a = answer(route);
      return { status: a.status || 200, text: async () => (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)) };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}
const pathOf = (route) => new URL(route, 'http://x').searchParams.get('path');

test('CONTROL: the answer is a real one about a project file', () => {
  assert.equal(ANSWER.ok, true);
  assert.equal(ANSWER.lastSeen.agent, 'mona');
});

test('kosmos#7989 Windows project who: one GET with both tokens, the path whole, the same words as the Mac', async () => {
  const r = await run(['project', 'who', FILE], () => ({ body: ANSWER }));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].method, 'GET');
  assert.equal(new URL(r.calls[0].route, 'http://x').pathname, '/api/project-file/who');
  assert.equal(pathOf(r.calls[0].route), FILE, 'the path did not arrive whole (a space and & in it)');
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT);
  assert.equal(r.out, renderWho(ANSWER).join('\n'));
});

test('kosmos#7989 Windows project who: a relative path is read from where the command runs', async () => {
  const r = await run(['project', 'who', 'plan & next.md'], () => ({ body: ANSWER }));
  assert.equal(r.code, 0, r.err);
  assert.equal(pathOf(r.calls[0].route), FILE);
});

test('kosmos#7989 Windows project who: outside, a refusal and an unreadable answer exit 1', async () => {
  const o = await run(['project', 'who', '/elsewhere/x.md'], () => ({ body: { ok: false, because: 'outside' } }));
  assert.equal(o.code, 1);
  assert.equal(o.out, renderWho({ ok: false, because: 'outside' }).join('\n'));
  const x = await run(['project', 'who', FILE], () => ({ status: 403, body: { ok: false, error: 'that request came from another website, so we will not fetch for it' } }));
  assert.equal(x.code, 1);
  assert.equal(x.calls.length, 1, 'a cross-site refusal was probed as an older board');
  assert.doesNotMatch(x.out + x.err, /older than/);
  const u = await run(['project', 'who', FILE], () => ({ body: '<html>proxy</html>' }));
  assert.equal(u.code, 1);
  assert.match(u.err, /could not read/);
});

test('kosmos#7989 Windows project who: an older board is named as one, and a stale token is not', async () => {
  const gone = await run(['project', 'who', FILE], () => ({ status: 404, body: { error: 'no such endpoint' } }));
  assert.equal(gone.code, 1);
  assert.match(gone.err, /older than `kosmos project who`/);
  const gate = { error: 'this board belongs to the account that started it; open it with `kosmos open`' };
  const old = await run(['project', 'who', FILE], (route) => (route.startsWith('/api/projects/overview') ? { body: { projects: [] } } : { status: 403, body: gate }));
  assert.equal(old.code, 1);
  assert.match(old.err, /refuses an agent's own token here/);
  assert.doesNotMatch(old.out + old.err, /kosmos open/);
  const stale = await run(['project', 'who', FILE], (route) => ({ status: 403, body: gate }));
  assert.equal(stale.code, 1);
  assert.equal(stale.calls.length, 2, 'CONTROL: the overview was asked');
  assert.doesNotMatch(stale.out + stale.err, /older than/, 'a token the board does not know was blamed on its age');
});

test('kosmos#7989 review 8: Windows path rules: a relative path is made full by path.win32', async () => {
  const r = await run(['project', 'who', 'sub/plan.md'], () => ({ body: { ok: false, because: 'outside' } }), 'C:\\work\\ff', { pathRules: path.win32 });
  assert.equal(pathOf(r.calls[0].route), 'C:\\work\\ff\\sub\\plan.md');
  const unc = await run(['project', 'who', '\\\\srv\\share\\f.md'], () => ({ body: { ok: false, because: 'outside' } }), 'C:\\work', { pathRules: path.win32 });
  assert.equal(pathOf(unc.calls[0].route), '\\\\srv\\share\\f.md');
});

test('kosmos#7989 review 8: with no agent token a 403 is not probed as an older board; a lone surrogate is a sentence', async () => {
  const gate = { error: 'this board belongs to the account that started it; open it with `kosmos open`' };
  const r = await run(['project', 'who', FILE], (route) => (route.startsWith('/api/projects/overview') ? { body: { projects: [] } } : { status: 403, body: gate }), FOLDER, { env: {} });
  assert.equal(r.code, 1);
  assert.equal(r.calls.length, 1, 'probed with no agent token sent');
  assert.doesNotMatch(r.out + r.err, /older than/);
  const s = await run(['project', 'who', path.join(FOLDER, 'a\ud800.md')], () => ({ body: ANSWER }));
  assert.equal(s.code, 1);
  assert.equal(s.calls.length, 0);
  assert.match(s.err, /cannot send/);
});

test('kosmos#7989 Windows project who: no file, two, or an option is a usage error before the board is asked', async () => {
  for (const argv of [['project', 'who'], ['project', 'who', 'a', 'b'], ['project', 'who', '--json'], ['project', 'who', '-x']]) {
    const r = await run(argv, () => ({ body: ANSWER }));
    assert.equal(r.code, 2, argv.join(' ') + ': ' + r.err);
    assert.equal(r.calls.length, 0, argv.join(' ') + ' asked the board');
  }
});
