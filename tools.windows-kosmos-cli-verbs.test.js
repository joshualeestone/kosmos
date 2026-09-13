'use strict';
/**
 * win32-cli-verbs: the verbs the Windows agent's `kosmos` gained, end to end.
 *
 * `task message` and `room reopen` run through the real CLI against the REAL
 * server.js on a local port, in a sandboxed data root, with a stub fleet (no tmux,
 * no live agent). The one boundary replaced is chat.deliver, the call that types a
 * line into an agent's session: it records instead, so the test can read the line
 * each assignee would have received. The `feedback` verbs run the shipped CLI file
 * as a child process on its own sandboxed root, piped stdin included.
 *
 *   node --test tools.windows-kosmos-cli-verbs.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-win-cli-verbs-'));
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
const taskchat = require('./engine/taskchat');
const sendertoken = require('./engine/sendertoken');
const store = require('./engine/store');
const chat = require('./engine/chat');
const fleet = require('./test-support/fleet');
const cli = require('./tools/windows/kosmos-cli');
const win32job = require('./engine/win32job');

const CLI_FILE = path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js');

let base;
let projectId;
let taskNumber;
const tokens = {};
const typedInto = [];
let requestsSeen = 0;

test.before(async () => {
  /* On Windows the board asks Task Scheduler whether each agent has a task
     (engine/win32job presence). This fleet is a stub, and the live fleet shares this
     account, so the question never leaves the process: every agent reads as having
     no task (review round 1: the suite's schtasks guard caught `Kosmos\agent-mona`). */
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.', code: 1 }));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  server.on('request', () => { requestsSeen += 1; });
  const roster = fleet.install([fleet.agent('mona', { state: 'idle' }), fleet.agent('leo', { state: 'idle' })]).agents;
  const alpha = projects.create({ name: 'Alpha' });
  projects.addAgent(alpha.id, 'mona', roster);
  projects.addAgent(alpha.id, 'leo', roster);
  projectId = alpha.id;
  taskNumber = tasks.create(alpha.id, { sentence: 'Ship the Windows verbs', who: 'mona' }, roster).number;
  for (const name of ['mona', 'leo']) tokens[name] = sendertoken.mint(name).token;
  /* The typing boundary: record what each assignee would have been sent. */
  chat.deliver = (sessionName, line) => { typedInto.push({ sessionName, line }); return { state: 'placed' }; };
});
test.after(() => {
  win32job.setRunner(null);
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* The real CLI against the real board. The hook stub supplies only the url and the
   agent token from this test's env, so nothing reads a real board-token file. */
async function kosmos(argv, agentToken) {
  const out = [];
  const err = [];
  const code = await cli.main(argv, {
    env: agentToken ? { KOSMOS_AGENT_TOKEN: agentToken } : {},
    url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: (env) => env.KOSMOS_AGENT_TOKEN || null },
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const messagesOnTask = () => JSON.stringify(taskchat.read(projectId, taskNumber));

// ── task message ─────────────────────────────────────────────────────────────

test('task message from a Windows agent (token, no pane) is recorded, reaches the assignee NAMED as that agent, and exits 0', async () => {
  typedInto.length = 0;
  const r = await kosmos(['task', 'message', projectId, String(taskNumber), 'the', 'verbs', 'are', 'in'], tokens.leo);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'Message recorded on task ' + taskNumber + ' of ' + projectId + '; any agents assigned to it were notified.');
  assert.match(messagesOnTask(), /the verbs are in/, 'the words were not recorded on the task');
  assert.deepEqual(typedInto.map((d) => d.sessionName), ['mona']);
  assert.match(typedInto[0].line, /leo said: "the verbs are in"/, 'the assignee cannot see which colleague spoke: ' + typedInto[0].line);
  assert.match(typedInto[0].line, new RegExp('kosmos task message ' + projectId + ' ' + taskNumber + ' "\\.\\.\\."'));
});

test('review round 1: a valid agent token plus Sec-Fetch-Site is still that AGENT ("leo said"), never "The person said"', async () => {
  typedInto.length = 0;
  const r = await fetch(base + '/api/project/' + encodeURIComponent(projectId) + '/task/' + taskNumber + '/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tokens.leo, 'sec-fetch-site': 'same-origin', origin: base },
    body: JSON.stringify({ text: 'dressed as the screen' }),
  });
  assert.equal(r.status, 200);
  assert.equal(typedInto.length, 1);
  assert.match(typedInto[0].line, /leo said: "dressed as the screen"/, 'an agent token with a browser header took the screen posture: ' + typedInto[0].line);
});

test('task message from the assignee itself is not typed back to it', async () => {
  typedInto.length = 0;
  const r = await kosmos(['task', 'message', projectId, String(taskNumber), 'done on my side'], tokens.mona);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(typedInto, [], 'the sender was notified about its own message');
});

test('a presented token that does not resolve is REFUSED before anything is recorded or typed', async () => {
  typedInto.length = 0;
  const before = messagesOnTask();
  const r = await kosmos(['task', 'message', projectId, String(taskNumber), 'forged'], 'ef'.repeat(32));
  assert.equal(r.code, 1);
  assert.match(r.err, /^Kosmos refused that message: /);
  assert.equal(messagesOnTask(), before, 'a refused message was recorded');
  assert.deepEqual(typedInto, []);
});

test('with no token the route is the pane path it always was: recorded, sent as "An agent"', async () => {
  typedInto.length = 0;
  const r = await kosmos(['task', 'message', projectId, String(taskNumber), 'paneless and tokenless']);
  assert.equal(r.code, 0, r.err);
  assert.match(typedInto[0].line, /An agent said: "paneless and tokenless"/);
});

test('task message to a task that does not exist says the board\'s words and exits 1', async () => {
  const r = await kosmos(['task', 'message', projectId, '999', 'hello'], tokens.leo);
  assert.equal(r.code, 1);
  assert.match(r.err, /^Kosmos refused that message: .*no task by that number/);
});

test('review round 1: with a roster nobody can read, a presented token is told THAT, not refused as a bad token, and nothing is recorded', async () => {
  const before = messagesOnTask();
  fleet.refuses();
  try {
    const r = await kosmos(['task', 'message', projectId, String(taskNumber), 'unseen roster'], tokens.leo);
    assert.equal(r.code, 1);
    assert.equal(r.err, 'Kosmos refused that message: we could not check which agents are running, so that message was not recorded.');
    assert.equal(messagesOnTask(), before);
  } finally {
    fleet.install([fleet.agent('mona', { state: 'idle' }), fleet.agent('leo', { state: 'idle' })]);
  }
});

// ── room reopen ─────────────────────────────────────────────────────────────

test('room reopen writes the reopen marker the loop-guard honours, and exits 0 with the Mac\'s sentence', async () => {
  const r = await kosmos(['room', 'reopen', projectId]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'Reopened ' + projectId + '. The loop-guard hold is cleared; the next post to that room will land.');
  const log = fs.readFileSync(path.join(store.ROOT, 'messages.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(log.some((row) => row.kind === 'reopen' && row.project === projectId), 'no reopen marker was written');
});

test('room reopen of a project that does not exist exits 1 and says so', async () => {
  const r = await kosmos(['room', 'reopen', 'no-such-project']);
  assert.equal(r.code, 1);
  assert.equal(r.err, 'There is no project called "no-such-project", so there is no room to reopen.');
});

// ── --help against a board that is listening ────────────────────────────────

test('#1674: `kosmos reply --help` (and every verb\'s --help) reaches a LISTENING board with zero requests', async () => {
  const before = requestsSeen;
  for (const argv of [['reply', '--help'], ['reply', 'hello', '--help'], ['msg', 'mona', '-h'], ['post', projectId, 'hi', '--help'], ['report', 'blocked', '--help'], ['whoami', '--help'], ['task', 'message', projectId, '1', 'x', '--help'], ['room', 'reopen', projectId, '-h']]) {
    const r = await kosmos(argv, tokens.leo);
    assert.equal(r.code, 0, argv.join(' '));
    assert.equal(r.out, cli.USAGE[argv[0]]);
  }
  assert.equal(requestsSeen, before, '--help sent something to the board');
  const control = await kosmos(['whoami'], tokens.leo);
  assert.ok(requestsSeen > before, 'the request counter never counts, so the zero above proves nothing: ' + control.err);
});

// ── feedback: the shipped file, as a process, on its own data root ──────────

function feedbackCli(args, input) {
  const root = feedbackCli.root || (feedbackCli.root = fs.mkdtempSync(path.join(SANDBOX, 'feedback-')));
  const env = Object.assign({}, process.env, { AGENT_WORKFORCE_DATA: root });
  delete env.KOSMOS_WORLD;
  const r = cp.spawnSync(process.execPath, [CLI_FILE, ...args], { env, input: input === undefined ? '' : input, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: String(r.stdout).replace(/\r?\n$/, ''), err: String(r.stderr).replace(/\r?\n$/, ''), root };
}

test('feedback write saves today\'s report in THIS Kosmos\'s store; show reads it back; list names the day', () => {
  const w = feedbackCli(['feedback', 'write', 'The', 'task', 'verbs', 'were', 'missing.']);
  assert.equal(w.code, 0, w.err);
  assert.equal(w.out, 'Saved today\'s product-feedback report. It stays on this computer.');
  /* The store root is AGENT_WORKFORCE_DATA plus the app's own folder (store.js
     dataRootFor), so the report is looked for one level down, and only there. */
  const appDirs = fs.readdirSync(w.root);
  assert.equal(appDirs.length, 1, 'expected one app folder under the sandboxed data root: ' + appDirs.join(', '));
  const days = fs.readdirSync(path.join(w.root, appDirs[0], 'feedback'));
  assert.equal(days.length, 1, 'the report did not land in the sandboxed store');
  const day = days[0].replace(/\.md$/, '');
  const show = feedbackCli(['feedback', 'show']);
  assert.equal(show.code, 0, show.err);
  assert.equal(show.out, 'The task verbs were missing.');
  assert.equal(feedbackCli(['feedback', 'list']).out, day);
  assert.equal(feedbackCli(['feedback', 'show', '1999-01-01']).code, 1);
  assert.equal(feedbackCli(['feedback', 'show', 'yesterday']).code, 2);
});

test('feedback write with no text reads piped stdin, non-ASCII intact; with neither it writes nothing and exits 2', () => {
  const piped = feedbackCli(['feedback', 'write'], 'Piped in é ✓\nsecond line\n');
  assert.equal(piped.code, 0, piped.err);
  assert.equal(feedbackCli(['feedback', 'show']).out, 'Piped in é ✓\nsecond line');
  const empty = feedbackCli(['feedback', 'write'], '  \n');
  assert.equal(empty.code, 2);
  assert.match(empty.err, /^Nothing to write/);
});

test('feedback triage --dir prints the engine digest; a bad flag or --since exits 2; an unknown feedback subcommand exits 2', () => {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'reports-'));
  fs.writeFileSync(path.join(dir, '2026-09-01.md'), '---\ndate: 2026-09-01\n---\n- The export button label overlaps the icon.\n');
  const r = feedbackCli(['feedback', 'triage', '--dir', dir]);
  assert.equal(r.code, 0, r.err);
  const tri = require('./engine/feedback-triage');
  const fb = require('./engine/feedback');
  assert.equal(r.out, tri.digestFor(fb.reportsForTriage({ dir }).reports, ''), 'the Windows digest is not the engine\'s digest');
  assert.equal(feedbackCli(['feedback', 'triage', '--bogus']).code, 2);
  assert.equal(feedbackCli(['feedback', 'triage', '--dir', dir, '--since', 'not-a-date']).code, 2);
  const unknown = feedbackCli(['feedback', 'publish']);
  assert.equal(unknown.code, 2);
  assert.equal(unknown.err, 'Unknown: kosmos feedback publish. Try: write | show | list | pull | triage');
});
