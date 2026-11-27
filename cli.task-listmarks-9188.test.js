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
    'x [1 of 2 checks reported met]', '[outside text from webhook "a"] x']) {
    assert.equal(markwords.usesListMarkWord(t), true, 'missed: ' + t);
  }
  for (const t of ['tidy the docs', 'get it done', 'undone work', 'pre-done notes', 'a reporter checks in']) {
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
