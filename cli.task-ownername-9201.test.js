'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9201 (follow-up to #9188): the long `kosmos task list` prints a task's owner after its words as " (name)" and
 * an unowned task prints nothing there, so an unowned task titled "fix the login (otto)" printed exactly as one otto
 * holds. Now engine/markwords.js usesListMarkWord also counts a title whose last character is a closing bracket, so
 * that title prints quoted, said to be the task's own words. Both CLIs are driven for real against a real board.
 *
 * Harness copied from cli.task-listmarks-9188.test.js:
 * kosmos#9188 (the task list's half of #9179): in `kosmos task list` a task's own title could print a row mark. The list
 * prints marks before the words ("[3] [on hold] words") and an open row prints none, so an open task titled
 * "[on hold] x" printed exactly as a held one; after the words a title could print "[added by X]", "[repeats ...]"
 * or "[n/m subtasks done]". Now all three list printers (Mac install/kosmos, Windows tools/windows/kosmos-cli.js, the
 * compact engine/tasklist.js) call engine/markwords.js usesListMarkWord, and a title that uses a list mark word is
 * printed quoted, said to be the task's own words. Each surface is driven for real: both CLIs against a real board.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-ownername-9201.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ownername-9201-'));
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
const FORGED = 'fix the login (otto)';   // an UNOWNED open task whose title ends as if otto held it
const OWNED = 'tidy the owned docs';     // otto really holds this one: its owner mark must still print plainly
const PLAIN = 'tidy the plain docs';     // the control: unowned, no bracket at the end
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Owners' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));
  tasks.create(projectId, { sentence: FORGED });
  tasks.create(projectId, { sentence: OWNED, who: 'otto' });
  tasks.create(projectId, { sentence: PLAIN });
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


test('#9201 engine: a title ending in any closing bracket counts; one with a bracket elsewhere does not', () => {
  for (const t of ['fix the login (otto)', 'fix the login (otto) ', 'fix the login (a (otto))', 'fix the login [otto]',
    'fix the login \uFF08otto\uFF09', 'fix the login (otto)\u200B', 'fix the login (otto\u2769',
    // Review 1: a blank-looking character the fold keeps, a lookalike that is an OPENING bracket, a full stop.
    'fix the login (otto)\uE000', 'fix the login (otto)\u{1D159}', 'fix the login (otto\uFD3F', 'fix the login (otto).']) {
    assert.equal(markwords.usesListMarkWord(t), true, 'missed: ' + JSON.stringify(t));
  }
  for (const t of ['fix the login', 'fix (otto) the login', 'the (old) docs need work', 'tidy the docs.']) {
    assert.equal(markwords.usesListMarkWord(t), false, 'quoted an ordinary title: ' + JSON.stringify(t));
  }
});

test('#9201 both CLIs: an unowned title ending "(otto)" prints quoted; a real owner and a plain title are unchanged', async () => {
  MAC_HOME = MAC_HOME || macHome(true);
  for (const [label, run] of [['Windows', (a) => win(a)], ['Mac', (a) => mac(a, MAC_HOME)]]) {
    const r = await run(['task', 'list', projectId]);
    assert.equal(r.code, 0, label + ': ' + r.out + (r.err || ''));
    assert.ok(!/^\{"tasks"/m.test(r.out), label + ': the list fell back to raw JSON, so the rendering was never run');
    const forged = rowOf(r.out, 'fix the login');
    assert.match(forged, /^\[\d+\] "fix the login \(otto\)" \(the task's own words, not a mark\)$/, label + ': ' + forged);
    const owned = rowOf(r.out, OWNED);
    assert.match(owned, /^\[\d+\] tidy the owned docs \(otto\)$/, label + ': the real owner mark changed: ' + owned);
    const plain = rowOf(r.out, PLAIN);
    assert.match(plain, /^\[\d+\] tidy the plain docs$/, label + ': a plain title was changed: ' + plain);
  }
});
