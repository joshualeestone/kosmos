'use strict';

/**
 * kosmos#8934 (agent feedback, four installs): a built task says what it waits on, a fixed choice (person, review,
 * release) that a screen and a list can read, where the built note is only words. `kosmos task built ... --waiting <who>`
 * (both CLIs) sends it; the board keeps it as builtWaitingOn; an agent's later mark without one keeps it (review 2: a
 * checker's mark is the usual next one), a mark with one replaces it, and the person's mark and a clear drop it.
 * Every refusal has a control that the same command with a good value goes through.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.builtwaiting-8934.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builtwaiting-')));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const tasklist = require('./engine/tasklist');
const taskguide = require('./engine/taskguide');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const winCli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install(['mona', 'zed'].map((a) => fleet.agent(a, { state: 'idle' }))).agents;
  const p = projects.create({ name: 'Waits' });
  for (const a of ['mona', 'zed']) projects.addAgent(p.id, a, roster);
  projectId = p.id;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const post = async (p, body, headers = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const asAgent = (name) => ({ 'x-kosmos-agent-token': sendertoken.mint(name).token });
const stored = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
const newTask = (s) => tasks.create(projectId, { sentence: s, who: 'mona' }).number;

test('engine: each value is stored; an unknown one is refused and writes nothing; the person\'s mark sends none', () => {
  for (const w of tasks.WAITING_ON) {
    const n = newTask('Deliver ' + w);
    const out = tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', waitingOn: w });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(stored(n).builtWaitingOn, w);
  }
  assert.deepEqual(tasks.WAITING_ON, ['person', 'review', 'release']);
  const n = newTask('Deliver something odd');
  for (const bad of ['Person', 'agents', 'constructor', '__proto__', 1, true, {}]) {
    const out = tasks.setBuilt(projectId, n, { by: 'mona', waitingOn: bad });
    assert.equal(out.ok, false, 'accepted ' + JSON.stringify(bad));
    assert.match(out.because, /person, review or release/);
    assert.equal(stored(n).builtAt, undefined, 'a refused value still marked the task');
  }
  // CONTROL: no value is the old mark, and it goes through.
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona' }).ok, true);
  assert.equal('builtWaitingOn' in stored(n), false);
  const p = newTask('Deliver from the screen');
  assert.equal(tasks.setBuilt(projectId, p, { person: true, waitingOn: 'person' }).ok, true);
  assert.equal('builtWaitingOn' in stored(p), false, 'the person\'s own mark said it waits on the person');
});

test('engine: a change of only the value is a change; the same mark again is not; a later mark without one keeps it; the person and a clear drop it', () => {
  const n = newTask('Deliver the report');
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', waitingOn: 'review' }).changed, true);
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', waitingOn: 'review' }).changed, false, 'the same mark again was recorded');
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', waitingOn: 'person' }).changed, true, 'a new value alone was skipped as the same mark');
  assert.equal(stored(n).builtWaitingOn, 'person');
  // Review 2: the builder's own re-mark without --waiting keeps it, and is the same mark again (nothing new said).
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', note: 'done' }).changed, false, 'a re-mark that kept everything was recorded as new');
  assert.equal(stored(n).builtWaitingOn, 'person', 'the builder\'s re-mark without --waiting dropped it');
  // Review 2: a checker's mark (another agent, no --waiting) keeps the builder's "waiting on the person".
  assert.equal(tasks.setBuilt(projectId, n, { by: 'zed', note: 'checked it' }).changed, true);
  assert.equal(stored(n).builtWaitingOn, 'person', 'a checker\'s mark dropped what the builder said it waits on');
  // CONTROL: a mark that says another value replaces it.
  assert.equal(tasks.setBuilt(projectId, n, { by: 'zed', note: 'checked it', waitingOn: 'release' }).changed, true);
  assert.equal(stored(n).builtWaitingOn, 'release');
  // The person's own mark drops it: they have looked.
  assert.equal(tasks.setBuilt(projectId, n, { person: true }).ok, true);
  assert.equal('builtWaitingOn' in stored(n), false, 'the person\'s mark kept a wait on the person');
  tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', waitingOn: 'release' });
  assert.equal(tasks.clearBuilt(projectId, n, { by: 'mona' }).ok, true);
  assert.equal('builtWaitingOn' in stored(n), false, 'a clear kept what it waited on');
});

test('route: an agent\'s mark records it; a bad value answers 400 and marks nothing; the screen\'s mark ignores one', async () => {
  const n = newTask('Ship the page');
  const r = await post(`/api/project/${projectId}/task/${n}/built`, { note: 'shipped', waiting_on: 'release' }, asAgent('mona'));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.task.builtWaitingOn, 'release', 'the answer does not carry it, so a CLI cannot tell it was recorded');
  assert.equal(stored(n).builtWaitingOn, 'release');
  const list = JSON.stringify(await (await fetch(base + '/api/tasks', { headers: { origin: base } })).json());
  assert.ok(list.includes('"builtWaitingOn":"release"'), 'the Tasks page is not sent it');
  const m = newTask('Ship the other page');
  const bad = await post(`/api/project/${projectId}/task/${m}/built`, { note: 'shipped', waiting_on: 'someone' }, asAgent('mona'));
  assert.equal(bad.status, 400, JSON.stringify(bad.json));
  assert.equal(stored(m).builtAt, undefined);
  const s = newTask('Ship from the screen');
  const screen = await post(`/api/project/${projectId}/task/${s}/built`, { waiting_on: 'person' }, { origin: base });
  assert.equal(screen.status, 200, JSON.stringify(screen.json));
  assert.equal(stored(s).builtWaitingOn, undefined, 'the screen\'s mark recorded a value it never sends');
});

test('the text list: the State and Built fields and the waits-on words say it; a mark without one reads as before', () => {
  const row = (extra) => ({ number: 7, sentence: 'Ship it', builtAt: new Date().toISOString(), builtBy: 'mona', ...extra });
  const show = (x) => tasklist.showLines({ tasks: [x] }, 7, projectId).lines.join('\n');
  assert.match(show(row({ builtWaitingOn: 'person' })), /State: +built, waiting on the person/);
  assert.match(show(row({ builtWaitingOn: 'release' })), /Built: .*by .*mona.*, waiting on a release/);
  // CONTROL: no value, the old words.
  const plain = show(row({}));
  assert.match(plain, /State: +built\b/);
  assert.equal(/waiting on/.test(plain), false, plain);
  // A stored value that is not one of the three says nothing (never "waiting on undefined" or a function's text).
  assert.equal(/waiting on/.test(show(row({ builtWaitingOn: 'constructor' }))), false);
  // Review 1: a held task that is also built says what the mark waits on, as the list's [on hold] [built, ...] tags do.
  assert.match(show(row({ onHold: true, builtWaitingOn: 'review' })), /State: +on hold.*; built, waiting on a review/);
  assert.match(show(row({ onHold: true })), /State: +on hold.*; built$/m, 'CONTROL: a held built mark without one');
});

/* Review 3: the one-line rows of kosmos task list --all --built say what each waits on next (tasklist waitsWords, reached
   through nextWords); a mark that says nothing reads as before. */
test('the list rows: --all --built says what each built task waits on, and a plain mark reads as before', () => {
  const now = Date.now();
  const row = (n, extra) => ({ number: n, projectId: 'p1', sentence: 'Ship ' + n, builtAt: new Date(now).toISOString(), builtBy: 'mona', lastActivityAt: new Date(now).toISOString(), ...extra });
  const out = tasklist.acrossLines({ all: true, listState: 'built', tasks: [row(1, { builtWaitingOn: 'person' }), row(2, { builtWaitingOn: 'release' }), row(3, { builtWaitingOn: 'review' }), row(4, {})] }, 'built', { now });
  assert.equal(out.rc, 0, JSON.stringify(out));
  const at = (n) => out.lines.find((l) => l.includes('#' + n + ' ')) || '';
  assert.match(at(1), /waits on the person\)/, at(1));
  assert.match(at(2), /waits on a release\)/, at(2));
  assert.match(at(3), /waits on a review and close\)/, at(3));
  assert.match(at(4), /waits on a review and close\)/, 'CONTROL: a plain mark lost its words: ' + at(4));
});

test('the board page: the row helper says "waiting on you" for the person, and nothing for a mark without one', () => {
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const m = html.match(/function tskBuiltWaitsWords\(t\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'tskBuiltWaitsWords is not in web/index.html');
  const fn = new Function(m[0] + '\nreturn tskBuiltWaitsWords;')();
  assert.equal(fn({ builtWaitingOn: 'person' }), ', waiting on you');
  assert.equal(fn({ builtWaitingOn: 'review' }), ', waiting on a review');
  assert.equal(fn({ builtWaitingOn: 'release' }), ', waiting on a release');
  assert.equal(fn({}), '');
  assert.equal(fn({ builtWaitingOn: 'toString' }), '');
  // Both places a built mark is said call it: the Tasks row and the task's own page.
  assert.equal((html.match(/tskBuiltWaitsWords\(t\)/g) || []).length, 3, 'the row or the task page does not use it');
});

test('kosmos task --how says when to use each value', () => {
  const g = taskguide.guideText();
  for (const w of ['--waiting person', '--waiting review', '--waiting release']) assert.ok(g.includes(w), w);
});

const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(MAC_HOME, 'engine'));
function mac(args, extra = {}) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: sendertoken.mint('mona').token, ...extra };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000, cwd: SANDBOX }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}
async function win(argv) {
  const out = [];
  const err = [];
  const code = await winCli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: sendertoken.mint('mona').token, KOSMOS_PORT: String(server.address().port) },
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      const u = new URL(url);
      const res = await fetch(base + u.pathname + u.search, { method: init.method, headers: init.headers, body: init.body });
      return { status: res.status, text: async () => res.text() };
    },
  });
  return { code, out: out.join('\n') + '\n' + err.join('\n') };
}

for (const [name, run, skip] of [['Mac', mac, process.platform === 'win32' && 'the Mac CLI'], ['Windows', win, false]]) {
  test(`${name} \`kosmos task built --waiting\`: recorded and said; without it the option is named; the list tag says it`, { skip }, async () => {
    const n = newTask(name + ' report');
    const r = await run(['task', 'built', projectId, String(n), 'the report is done', '--waiting', 'person']);
    assert.equal(r.code, 0, r.out);
    assert.equal(stored(n).builtWaitingOn, 'person');
    assert.equal(stored(n).builtNote, 'the report is done', 'the value leaked into the note');
    assert.match(r.out, /built, waiting on the person\. Closing it clears the mark\./);
    assert.equal(/--waiting person, review or release/.test(r.out), false, 'the hint was given to a mark that said it');
    // CONTROL: the same command without --waiting goes through, reads as before, and names the option.
    const m = newTask(name + ' notes');
    const p = await run(['task', 'built', projectId, String(m), 'the notes are done']);
    assert.equal(p.code, 0, p.out);
    assert.equal('builtWaitingOn' in stored(m), false);
    assert.match(p.out, /built, waiting to be released or checked\./);
    assert.match(p.out, /mark it with --waiting person, review or release \(kosmos task --how\)/);
    // Review 3: the same plain mark again changes nothing, so it is not given the hint either.
    const repeat = await run(['task', 'built', projectId, String(m), 'the notes are done']);
    assert.equal(repeat.code, 0, repeat.out);
    assert.equal(/--waiting person, review or release/.test(repeat.out), false, 'the hint was given to a repeat of the same mark: ' + repeat.out);
    // Review 2: the same task marked again without --waiting keeps it, says it, and is not given the hint.
    const again = await run(['task', 'built', projectId, String(n), 'the report is checked']);
    assert.equal(again.code, 0, again.out);
    assert.equal(stored(n).builtWaitingOn, 'person');
    assert.match(again.out, /built, waiting on the person\. Closing it clears the mark\./, again.out);
    assert.equal(/--waiting person, review or release/.test(again.out), false, 'the hint was given to a task that waits on the person: ' + again.out);
    const l = await run(['task', 'list', projectId]);
    assert.equal(l.code, 0, l.out);
    assert.match(l.out, new RegExp('\\[' + n + '\\] \\[built, waiting on the person\\] '), l.out);
    assert.match(l.out, new RegExp('\\[' + m + '\\] \\[built\\] '), 'a mark without one lost its plain tag: ' + l.out);
  });

  test(`${name}: an unknown value, --waiting with nothing, and --waiting with --clear are refused before the board`, { skip }, async () => {
    const n = newTask(name + ' slides');
    const bad = await run(['task', 'built', projectId, String(n), 'done', '--waiting', 'agents']);
    assert.equal(bad.code, 2, bad.out);
    assert.match(bad.out, /--waiting says what the task waits on: person, review or release \(got agents\)/);
    // Review 1: the same refusal first in both CLIs, an unknown value before a --file with no path.
    const first = await run(['task', 'built', projectId, String(n), 'done', '--waiting', 'bogus', '--file']);
    assert.equal(first.code, 2, first.out);
    assert.match(first.out, /\(got bogus\)/, 'refused for another reason first: ' + first.out);
    const empty = await run(['task', 'built', projectId, String(n), 'done', '--waiting']);
    assert.equal(empty.code, 2, empty.out);
    assert.match(empty.out, /--waiting says what the task waits on: person, review or release/);
    assert.equal(stored(n).builtAt, undefined, 'a refused --waiting still marked the task');
    // Review 1: marked first, so the clear's refusal is what keeps the mark (a clear of an unmarked task sets nothing either way).
    assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', note: 'first' }).ok, true);
    const both = await run(['task', 'built', projectId, String(n), '--clear', '--waiting', 'review']);
    assert.equal(both.code, 2, both.out);
    assert.match(both.out, /takes no --waiting/);
    assert.equal(typeof stored(n).builtAt, 'string', 'a refused --clear --waiting still took the mark off');
    // CONTROL: a good value on the same task goes through.
    const ok = await run(['task', 'built', projectId, String(n), 'done', '--waiting', 'review']);
    assert.equal(ok.code, 0, ok.out);
    assert.equal(stored(n).builtWaitingOn, 'review');
  });
}

/* Review 1: a board from before kosmos#8934 keeps no builtWaitingOn and answers without it. A proxy in front of this board
   takes the field out of every answer, so each CLI is shown an older board; the CONTROL is the same command against the
   board itself, above, which says what it waits on. */
const http = require('node:http');
/* Started inside the test, not in a before hook: a hook registered after the run began never ran (measured: the CLI
   was pointed at port "undefined"). */
async function startOlder() {
  const older = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const headers = { ...req.headers };
      // The hop-by-hop headers curl sends are refused by fetch, so they are not passed on.
      for (const h of ['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'expect', 'upgrade', 'proxy-connection']) delete headers[h];
      try {
        const r = await fetch(base + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
        let text = await r.text();
        try { const j = JSON.parse(text); if (j && j.task) delete j.task.builtWaitingOn; text = JSON.stringify(j); } catch { /* not JSON: as sent */ }
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
        res.end(text);
      } catch (e) { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('proxy: ' + e.message); }
    });
  });
  await new Promise((resolve) => older.listen(0, '127.0.0.1', resolve));
  return older;
}

test('review 1: against an older board, both CLIs say it was not recorded, and the sentence does not claim it', async () => {
  const olderServer = await startOlder();
  const olderPort = olderServer.address().port;
  try {
  const older = [
    ['Mac', (args) => mac(args, { KOSMOS_PORT: String(olderPort) }), process.platform === 'win32'],
    ['Windows', async (args) => {
      const out = [];
      const code = await winCli.main(args, {
        env: { KOSMOS_AGENT_TOKEN: sendertoken.mint('mona').token, KOSMOS_PORT: String(olderPort) },
        out: (x) => out.push(x), err: (x) => out.push(x),
        fetch: async (url, init) => { const u = new URL(url); const res = await fetch('http://127.0.0.1:' + olderPort + u.pathname + u.search, { method: init.method, headers: init.headers, body: init.body }); return { status: res.status, text: async () => res.text() }; },
      });
      return { code, out: out.join('\n') };
    }, false],
  ];
  for (const [name, run, skip] of older) {
    if (skip) continue;
    const n = newTask(name + ' older board');
    const r = await run(['task', 'built', projectId, String(n), 'done', '--waiting', 'release']);
    assert.equal(r.code, 0, name + ': ' + r.out);
    assert.equal(stored(n).builtWaitingOn, 'release', name + ': PRE-CONTROL: the board behind the proxy did record it');
    assert.match(r.out, /built, waiting to be released or checked./, name + ': ' + r.out);
    assert.doesNotMatch(r.out, /waiting on a release/, name + ': it claimed what the board did not say: ' + r.out);
    assert.match(r.out, /This Kosmos did not record what it waits on: it may be older than --waiting/, name + ': ' + r.out);
    assert.doesNotMatch(r.out, /--waiting person, review or release \(kosmos task --how\)/, name + ': the hint was given to a mark that sent --waiting: ' + r.out);
  }
  } finally { olderServer.close(); }
});
