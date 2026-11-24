'use strict';
/* kosmos#8948 part 2: an unknown command says which real one was probably meant (engine/didyoumean.js), on both CLIs.
   node --test engine/didyoumean-8948.test.js */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dym = require('./didyoumean');
const wincli = require('../tools/windows/kosmos-cli');

const ROOT = path.join(__dirname, '..');
const VERBS = ['task', 'project', 'agent', 'feedback', 'post', 'reply', 'status', 'start', 'stop', 'agents'];

test('kosmos#8948: a plural of a command that lists suggests its list', () => {
  assert.equal(dym.suggest('tasks', VERBS), 'kosmos task list');
  assert.equal(dym.suggest('projects', VERBS), 'kosmos project list');
  assert.equal(dym.suggest('Tasks', VERBS), 'kosmos task list', 'case was not ignored');
  assert.equal(dym.suggest('posts', VERBS), 'kosmos post', 'CONTROL: a plural of a command with no list gets no " list"');
});

test('kosmos#8948: otherwise the one nearest command, close enough; nothing when far, tied or not a word', () => {
  assert.equal(dym.suggest('projcet', VERBS), 'kosmos project', 'two edits on a long word');
  assert.equal(dym.suggest('feedbak', VERBS), 'kosmos feedback');
  assert.equal(dym.suggest('stauts', VERBS), null, 'CONTROL: two edits from both status and start is a tie');
  assert.equal(dym.suggest('zzzz', VERBS), null, 'CONTROL: nothing close');
  assert.equal(dym.suggest('agentz', VERBS), null, 'CONTROL: a tie (agent, agents) suggests nothing');
  assert.equal(dym.suggest('taks', VERBS), null, 'CONTROL: a short word allows one edit only');
  assert.equal(dym.suggest('task', VERBS), null, 'CONTROL: a real command is not unknown');
  assert.equal(dym.suggest('--tasks', VERBS), null, 'CONTROL: an option is not a command');
  assert.equal(dym.suggest('', VERBS), null);
  assert.equal(dym.line('tasks', VERBS), 'Did you mean: kosmos task list');
  assert.equal(dym.line('zzzz', VERBS), '');
});

test('kosmos#8948: LISTABLE is exactly the commands that take `list` on BOTH CLIs', () => {
  const win = Object.entries(wincli.SUBCOMMANDS || {})
    .filter(([, subs]) => (Array.isArray(subs) ? subs : Object.keys(subs || {})).includes('list')).map(([v]) => v).sort();
  assert.deepEqual([...dym.LISTABLE].sort(), win, 'the Windows CLI\'s commands with a list differ from LISTABLE');
  const mac = fs.readFileSync(path.join(ROOT, 'install', 'kosmos'), 'utf8');
  for (const v of dym.LISTABLE) {
    const fn = mac.indexOf('\ncmd_' + v + '() {');
    assert.ok(fn >= 0, 'install/kosmos has no cmd_' + v);
    const body = mac.slice(fn, mac.indexOf('\n}\n', fn));
    assert.match(body, /(^|\s|\|)list(\)|\|)/m, 'install/kosmos cmd_' + v + ' does not take list');
  }
});

test('kosmos#8948: the Mac CLI names the command meant after "Unknown", and nothing when none is close', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dym-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(ROOT, 'engine'), path.join(home, 'app', 'engine'));
  const run = (w) => spawnSync('bash', [path.join(ROOT, 'install', 'kosmos'), w], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, KOSMOS_HOME: home, KOSMOS_PORT: '9', TMUX: '', TMUX_PANE: '' } });
  const a = run('tasks');
  assert.equal(a.status, 2, a.stdout + a.stderr);
  assert.match(a.stdout, /Unknown: kosmos tasks\n  Did you mean: kosmos task list\n/, 'the suggestion is not right after the Unknown line');
  const b = run('zzzz');
  assert.equal(b.status, 2);
  assert.match(b.stdout, /Unknown: kosmos zzzz/, 'CONTROL: the Unknown line went missing');
  assert.doesNotMatch(b.stdout + b.stderr, /Did you mean/, 'CONTROL: a suggestion for a word nothing is close to');
});

test('kosmos#8948: the Windows CLI does the same from its own VERBS', async () => {
  const run = async (w) => {
    const out = []; const err = [];
    const code = await wincli.main([w], { env: {}, out: (x) => out.push(x), err: (x) => err.push(x) });
    return { code, err: err.join('\n') };
  };
  const a = await run('tasks');
  assert.equal(a.code, 2);
  assert.match(a.err, /Unknown: kosmos tasks\n  Did you mean: kosmos task list\n/, 'the Windows CLI gave no suggestion after Unknown');
  const b = await run('zzzz');
  assert.match(b.err, /Unknown: kosmos zzzz/, 'CONTROL');
  assert.doesNotMatch(b.err, /Did you mean/, 'CONTROL: a suggestion for a word nothing is close to');
});
