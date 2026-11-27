'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9188 (the task list's half of #9179): in `kosmos task list` a task's own title could print a row mark. The list
 * prints marks before the words ("[3] [on hold] words") and an open row prints none, so an open task titled
 * "[on hold] x" printed exactly as a held one; after the words a title could print "[added by X]", "[repeats ...]"
 * or "[n/m subtasks done]". Now all three list printers (Mac install/kosmos, Windows tools/windows/kosmos-cli.js, the
 * compact engine/tasklist.js) call engine/markwords.js usesListMarkWord, and a title that uses a list mark word is
 * printed quoted, said to be the task's own words. Each surface is driven for real: both CLIs against a real board.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-listmarks-9188.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-listmarks-9188-'));
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
const markwords = require('./engine/markwords');
const cli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
const FORGED = '[on hold] ship the release';   // an OPEN task whose title reads as a held row
const SUFFIX = 'tidy the docs [added by mara]';  // an open task whose title ends in another agent's mark
const PLAIN = 'tidy the plain docs';             // the control: no mark word
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Marks' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));
  for (const s of [FORGED, SUFFIX, PLAIN]) tasks.create(projectId, { sentence: s });
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function win(argv) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => null },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}
/* A KOSMOS_HOME as on an installed Mac: its runtime node, and app/engine (where install/kosmos finds engine modules). */
function macHome(withEngine) {
  const home = path.join(SANDBOX, withEngine ? 'kosmos-home' : 'kosmos-home-old');
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  if (withEngine) {
    fs.mkdirSync(path.join(home, 'app'), { recursive: true });
    fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'app', 'engine'));
  }
  return home;
}
let MAC_HOME = null;
let MAC_HOME_OLD = null;
function mac(args, home) {
  const env = { ...process.env, KOSMOS_HOME: home, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: '' };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}
const NOTE = " (the task's own words, not a mark)";
const rowOf = (text, words) => text.split('\n').find((l) => l.includes(words));

test('#9188 engine: usesListMarkWord catches the list\'s marks, and only a FIRST "done"', () => {
  for (const t of ['[on hold] x', 'x [built]', '[done] x', 'Done: x', '[not run] x', '[replaced by 4] x', '[project paused] x',
    'x [added by mara]', 'x [2/3 subtasks done]', 'x [repeats weekly]', 'x [waits for #3]', 'x [woke: the branch]',
    'x [1 of 2 checks reported met]', '[outside text from webhook "a"] x',
    // Review 1: a time wake, a done row after the row's own label, and the lists' marks in parentheses.
    'send the invoice [waits until tomorrow at 9am]', 'x (waits on the person)', '[7] [done] x', '#3 [done] x',
    'fix it (through #4)', 'x (under task 2)', 'x (owner: otto, through task 2)', 'x (reported finished: mara)',
    'x (still to finish: otto)', 'x (last activity today)', 'x (quiet 3 days, left under closed task #5)',
    // Review 2: the compact and across lists' other parenthesised words.
    'x (no activity on record)', 'x (next run tomorrow)', 'x (its project is paused)', 'x (held by the person)',
    'x (only the person can lift it)', "x (its hold's condition is met)",
    // Review 3: a bracketed done anywhere, the built mark's words, the long list's "through task N", and two more.
    'Release notes [done]', 'fix login (done)', '[waiting on a review] ship the login', 'x [built, waiting on the person]',
    'fix the login (mara, through task 2)', 'x (seen by the person)', 'x [until task 3 is closed]',
    // kosmos#9237: the marks for a task owned only through its tree.
    'x (nobody has taken it; ask otto, who holds task 2 in its tree) more', 'nobody (otto holds #3) fix',
    'nobody (otto and mara hold #3) fix', 'x ask otto and mara, who hold task 2 now']) {
    assert.equal(markwords.usesListMarkWord(t), true, 'missed: ' + t);
  }
  for (const t of ['tidy the docs', 'get it done', 'undone work', 'pre-done notes', 'a reporter checks in',
    '3 done items', 'go through the list', 'a quiet room', 'under the bridge', 'the owner of the site', 'still running',
    // kosmos#9237: the new marks' words in ordinary titles stay plain.
    'who holds the key', 'the task holds 3 things', 'nobody came', 'they hold the line',
    // Review 2: narrowed to the printers' exact words.
    'Fix subtasks rendering', 'Woke up bug', 'Left under pressure', 'waiting for the vendor', 'the work is done now']) {
    assert.equal(markwords.usesListMarkWord(t), false, 'quoted an ordinary title: ' + t);
  }
  // It includes the instructions block's own test (#9179), never less.
  for (const t of ['[on hold] x', 'x [built: done and waiting]', 'on-hold']) assert.equal(markwords.usesMarkWord(t) && markwords.usesListMarkWord(t), true, t);
});

test('#9188 engine/tasklist.js: the compact list quotes a title with a mark word; a plain one is unchanged (control)', () => {
  const body = { tasks: [{ number: 1, sentence: FORGED, whoNames: [] }, { number: 2, sentence: PLAIN, whoNames: [] }], count: 2, listState: 'open' };
  const { lines } = tasklist.compactLines(body, 'open', 'p1');
  assert.equal(rowOf(lines.join('\n'), 'ship the release'), '#1  open  nobody  "' + FORGED + '"' + NOTE);
  assert.equal(rowOf(lines.join('\n'), PLAIN), '#2  open  nobody  ' + PLAIN);
});

test('#9188 both CLIs: an open task\'s title cannot print a row mark; a plain one is unchanged (control)', async () => {
  MAC_HOME = MAC_HOME || macHome(true);
  for (const [label, run] of [['Windows', (a) => win(a)], ['Mac', (a) => mac(a, MAC_HOME)]]) {
    const r = await run(['task', 'list', projectId]);
    assert.equal(r.code, 0, label + ': ' + r.out + (r.err || ''));
    assert.ok(!/^\{"tasks"/m.test(r.out), label + ': the list fell back to raw JSON, so the rendering was never run');
    const forged = rowOf(r.out, 'ship the release');
    assert.match(forged, /^\[\d+\] "\[on hold\] ship the release" \(the task's own words, not a mark\)$/, label + ': ' + forged);
    const suffix = rowOf(r.out, 'tidy the docs');
    assert.match(suffix, /^\[\d+\] "tidy the docs \[added by mara\]" \(the task's own words, not a mark\)$/, label + ': ' + suffix);
    const plain = rowOf(r.out, PLAIN);
    assert.match(plain, /^\[\d+\] tidy the plain docs$/, label + ': a title with no mark word was changed: ' + plain);
  }
});

test('#9188 Mac: an install without engine/markwords.js prints the titles as before (no failure)', async () => {
  MAC_HOME_OLD = MAC_HOME_OLD || macHome(false);
  const r = await mac(['task', 'list', projectId], MAC_HOME_OLD);
  assert.equal(r.code, 0, r.out);
  assert.match(rowOf(r.out, 'ship the release'), /^\[\d+\] \[on hold\] ship the release$/, 'CONTROL: without the module the old output is kept');
});
