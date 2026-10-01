'use strict';

/**
 * #4887: `kosmos task add ... --who <agent>` from both commands (Mac install/kosmos, Windows
 * tools/windows/kosmos-cli.js) against a real board and the real task engine: the flag reaches the task's owner,
 * is never folded into the detail, bad forms stop before the board, the answer says who it went to, and
 * `task list` says who added a task when that is not its owner. The board's `me` and name matching are proven in
 * server.task-who-4887.test.js.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-who-4887.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskwho-cli-'));
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
const cli = require('./tools/windows/kosmos-cli');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

let base;
let projectId;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Diagnostics' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const rows = async () => (await (await fetch(`${base}/api/tasks?project=${encodeURIComponent(projectId)}`)).json()).tasks;
const bySentence = async (s) => (await rows()).find((t) => t.sentence === s);

// ── Windows: tools/windows/kosmos-cli.js ────────────────────────────────────
async function win(argv, agentToken = null) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('Windows `task add ... --who <agent>` gives it to that agent and says so; the flag is not in the detail', async () => {
  const r = await win(['task', 'add', projectId, 'Win: diagnostic', 'some', '--who', 'Otto', 'words']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /, for otto\. See it with/);
  const made = await bySentence('Win: diagnostic');
  assert.deepEqual(made.whoNames, ['otto']);
  assert.equal(made.detail, 'some words', 'the flag leaked into the detail, or the detail lost a word');
});

test('Windows `task add` without --who is unassigned and the answer names nobody (control)', async () => {
  const r = await win(['task', 'add', projectId, 'Win: loose']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /, for /);
  assert.deepEqual((await bySentence('Win: loose')).whoNames, []);
});

test('Windows `task add` refuses a bad --who before the board; a non-member and an unnamed `me` exit 1', async () => {
  const before = (await rows()).length;
  assert.equal((await win(['task', 'add', projectId, 'x', '--who'])).code, 2);
  assert.equal((await win(['task', 'add', projectId, 'x', '--who', '--parent', '1'])).code, 2, 'a flag was taken as the name');
  assert.equal((await win(['task', 'add', projectId, 'x', '--who=otto'])).code, 2);
  assert.equal((await win(['task', 'add', projectId, 'x', '--who', '   '])).code, 2, 'a name of only spaces went to the board');
  assert.equal((await win(['task', 'add', projectId, '--who', 'otto'])).code, 2);
  const zed = await win(['task', 'add', projectId, 'x', '--who', 'zed']);
  assert.equal(zed.code, 1);
  assert.match(zed.err, /not on this project/);
  const me = await win(['task', 'add', projectId, 'x', '--who', 'me']);
  assert.equal(me.code, 1);
  assert.match(me.err, /could not tell which agent you are/);
  assert.equal((await rows()).length, before, 'a refused add still made a task');
});

// ── Mac: install/kosmos (bash 3.2) ─────────────────────────────────────────
/* A KOSMOS_HOME whose runtime/bin/node is this node, as on an installed Mac: without it
   `task list` prints its raw-JSON fallback and the rendering under test never runs. */
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, agentToken = '') {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: agentToken };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}

test('Mac `task add ... --who <agent>` gives it to that agent and says so; the flag is not in the detail', async () => {
  const r = await mac(['task', 'add', projectId, 'Mac: diagnostic', 'some', '--who', 'mara', 'detail']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /, for mara\. See it with/);
  const made = await bySentence('Mac: diagnostic');
  assert.ok(made, 'the task was not made: ' + r.out);
  assert.deepEqual(made.whoNames, ['mara']);
  assert.equal(made.detail, 'some detail');
});

test('Mac `task add` with --who and --parent together sends both', async () => {
  const top = (await bySentence('Mac: diagnostic')).number;
  const r = await mac(['task', 'add', projectId, 'Mac: part', '--who', 'otto', '--parent', String(top)]);
  assert.equal(r.code, 0, r.out);
  const made = await bySentence('Mac: part');
  assert.deepEqual(made.whoNames, ['otto']);
  assert.equal(made.parent, top);
});

test('Mac `task add` without --who is unassigned and the answer names nobody (control)', async () => {
  const r = await mac(['task', 'add', projectId, 'Mac: loose']);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /, for /);
  assert.deepEqual((await bySentence('Mac: loose')).whoNames, []);
});

test('Mac `task add` refuses a bad --who before the board; a non-member and an unnamed `me` exit 1', async () => {
  const before = (await rows()).length;
  assert.equal((await mac(['task', 'add', projectId, 'x', '--who'])).code, 2);
  assert.equal((await mac(['task', 'add', projectId, 'x', '--who', '--parent', '1'])).code, 2, 'a flag was taken as the name');
  assert.equal((await mac(['task', 'add', projectId, 'x', '--who=otto'])).code, 2);
  assert.equal((await mac(['task', 'add', projectId, 'x', '--who', '   '])).code, 2, 'a name of only spaces went to the board');
  assert.equal((await mac(['task', 'add', projectId, '--who', 'otto'])).code, 2);
  const ctl = await mac(['task', 'add', projectId, 'x', '--who', 'zed\u0001']);
  assert.equal(ctl.code, 1, ctl.out);
  assert.match(ctl.out, /not on this project/, 'a control byte in the name broke the request instead of reaching the board: ' + ctl.out);
  const zed = await mac(['task', 'add', projectId, 'x', '--who', 'zed']);
  assert.equal(zed.code, 1);
  assert.match(zed.out, /not on this project/);
  const me = await mac(['task', 'add', projectId, 'x', '--who', 'me']);
  assert.equal(me.code, 1);
  assert.match(me.out, /could not tell which agent you are/);
  assert.equal((await rows()).length, before, 'a refused add still made a task');
});

// ── --who me, from an agent the board can name ──────────────────────────────
/* The agent's own token, as an installed agent sends it. A brace and a quoted "who":"zed" in the words: the
   Mac CLI reads the owner out of the board's answer with shell string cuts, and the sentence comes first. */
test('both CLIs: `--who me` from an agent with its token gives the task to that agent, and the answer names it', async (t) => {
  /* The board names a token's agent from the roster; mara has to be running for her token to be hers. */
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  const mara = sendertoken.mint('mara').token;
  const tricky = (label) => label + ': fix {x} where "who":"zed" was said';
  for (const [label, run, text] of [['Windows', (a) => win(a, mara), (r) => r.out + r.err], ['Mac', (a) => mac(a, mara), (r) => r.out]]) {
    const r = await run(['task', 'add', projectId, tricky(label), '--who', 'me']);
    assert.equal(r.code, 0, label + ': ' + text(r));
    assert.match(text(r), /, for mara\. See it with/, label + ': the answer did not say who it went to: ' + text(r));
    const made = await bySentence(tricky(label));
    assert.ok(made, label + ': the task was not made');
    assert.deepEqual(made.whoNames, ['mara'], label + ': `me` did not become the calling agent');
  }
});

// ── task list: who added it, when that is not the owner ─────────────────────
test('both lists say who added a task when an agent did and it is not the owner, and only then', async () => {
  /* An agent's add, as the board records one: addedVia process with its name. Written straight to the store
     because the CLIs in this file have no agent identity to send. */
  projects.mutate(projectId, (p) => ({
    ...p,
    tasks: (p.tasks || []).map((t) => {
      if (t.sentence === 'Win: diagnostic') return { ...t, addedVia: 'process', addedBy: 'mara' };   // added by mara, owned by otto
      if (t.sentence === 'Mac: diagnostic') return { ...t, addedVia: 'process', addedBy: 'Mara' };   // added by mara (another spelling), owned by mara
      if (t.sentence === 'Mac: loose') return { ...t, who: 'Mona Lisa', addedVia: 'screen', addedBy: 'operator' };
      if (t.sentence === 'Win: loose') return { ...t, who: 'Mona Lisa', addedVia: 'process', addedBy: 'monalisa' };   // the token store's key for "Mona Lisa"
      return t;
    }),
  }));
  for (const [label, run, text] of [['Windows', win, (r) => r.out], ['Mac', mac, (r) => r.out]]) {
    const r = await run(['task', 'list', projectId]);
    assert.equal(r.code, 0, label + ': ' + text(r));
    const lines = text(r).split('\n');
    assert.ok(!lines.some((l) => /^\{"tasks"/.test(l)), label + ': the list fell back to raw JSON, so the rendering was never run');
    const other = lines.find((l) => l.includes('Win: diagnostic'));
    const own = lines.find((l) => l.includes('Mac: diagnostic'));
    const screen = lines.find((l) => l.includes('Mac: loose'));
    assert.match(other, /Win: diagnostic \(otto\) \[added by mara\]/, label + ': ' + other);
    assert.doesNotMatch(own, /added by/, label + ': the owner adding its own task was called out: ' + own);
    assert.doesNotMatch(screen, /added by/, label + ': a task nobody identified added was called out: ' + screen);
    const keyed = lines.find((l) => l.includes('Win: loose'));
    assert.match(keyed, /\(Mona Lisa\)/, label + ': the keyed row lost its owner, so the next check proves nothing: ' + keyed);
    assert.doesNotMatch(keyed, /added by/, label + ': an owner whose added-by is its store key was called out: ' + keyed);
  }
});

test('the instructions each agent reads on a project teach --who me', () => {
  const body = projects.blockBody([projects.get(projectId)], 'mara');
  assert.match(body, /A task for yourself: `[^`]* task add [^`]* "what needs doing" --who me` \(or `--who <name>` for another agent on it\)$/m);
});

test('the board answers with the task\'s who before told and heard (the Mac CLI reads the first "who":)', async () => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/tasks`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sentence: 'Order check', who: 'otto' }),
  });
  const raw = await res.text();
  assert.equal(res.status, 200, raw.slice(0, 160));
  const at = raw.indexOf('"who":');
  assert.ok(raw.startsWith('{"task":{'), 'the answer no longer starts with the task: ' + raw.slice(0, 80));
  assert.ok(at > 0 && raw.startsWith('"who":"otto"', at), 'the first "who": is not the task\'s own: ' + raw.slice(0, 200));
  for (const k of ['"told":', '"heard":']) {
    const k_at = raw.indexOf(k);
    assert.ok(k_at > at, k + ' comes before the task\'s who (or is missing), so the Mac read would pick it up: ' + raw.slice(0, 240));
  }
});
