'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#8735 slice 2: `kosmos task --how` prints engine/taskguide.js guideText on both CLIs, as `kosmos community --how`
 * does (engine/communityguide.test.js, which this mirrors). The working rules point at it for the task commands that
 * each serve one situation.
 *
 *   node --test engine/taskguide.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { skipOnWin32 } = require('../test-support/skip-on-win32');
const guide = require('./taskguide');

test('kosmos#8735 slice 2: install/kosmos prints the task guide with task --how', { skip: skipOnWin32('install/kosmos is the Mac and Linux CLI, a bash script run by its shebang') }, () => {
  const root = path.join(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-how-'));
  const env = { PATH: process.env.PATH, HOME: tmp, TMPDIR: tmp, KOSMOS_HOME: root, AGENT_WORKFORCE_DATA: path.join(tmp, 'data'), KOSMOS_PORT: '9' };
  const run = (args) => spawnSync(path.join(root, 'install', 'kosmos'), args, { env, encoding: 'utf8', timeout: 30000 });
  try {
    const how = run(['task', '--how']);
    assert.equal(how.status, 0, how.stderr + how.stdout.slice(0, 300));
    assert.equal(how.stdout, guide.guideText() + '\n');
    assert.equal(run(['task', '--how', 'more']).status, 2);
    assert.match(run(['task', '--help']).stderr + run(['task', '--help']).stdout, /kosmos task --how +\(how the task commands work/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('kosmos#8735 slice 2: the Windows CLI prints the same task guide, and the same refusal', async () => {
  const cli = require('../tools/windows/kosmos-cli');
  const out = []; const err = [];
  assert.equal(await cli.main(['task', '--how'], { env: {}, out: (x) => out.push(x), err: (x) => err.push(x) }), 0, err.join(' '));
  assert.equal(out.join('\n'), guide.guideText());
  assert.equal(await cli.main(['task', '--how', 'more'], { env: {}, out: () => {}, err: () => {} }), 2);
  assert.ok(!cli.SUBCOMMANDS.task.includes('--how'), 'a flag, not a subcommand, as community --how is');
  const usage = [];
  await cli.main(['task'], { env: {}, out: (x) => usage.push(x), err: (x) => usage.push(x) });
  assert.match(usage.join('\n'), /kosmos task --how/);
});

test('kosmos#8735 slice 2: the task guide requires nothing, and carries what moved and only that (the pointer is pinned in defaults.test.js #5152)', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'taskguide.js'), 'utf8'), /require\(/);
  const g = guide.guideText();
  for (const line of ['`kosmos task repeat <project-id> <task-number> daily --at 09:00`', '`kosmos task ran <project-id> <task-number> --unchanged "what it checked"`',
    '`kosmos task edit <project-id> <task-number> --title "<new title>"`', 'If the work is a code fix, commit it, then mark it built with `--commit HEAD` (or the',
    'If the work is a file, add `--file <path>`: the next agents are sent its fingerprint', '**To see what is still open across every project,** run `kosmos task list --all`']) {
    assert.ok(g.includes(line), 'the task guide lost: ' + line);
    for (const p of require('./defaults').PLATFORMS) assert.ok(!require('./defaults').blockFor(p).includes(line), p + ': back in the working rules: ' + line);
  }
  assert.doesNotMatch(g, /\u2014|&mdash;|&#8212;|&#x2014;/i, 'an em dash in the guide');
  // The two "as above" pointers that pointed at the working rules now say so (the fingerprint paragraph's own "as above"
  // points inside the guide, and stays).
  assert.doesNotMatch(g, /Add it as above|`needs_you` as above/, 'the guide points "above" at text that is not in it');
  assert.match(g, /Add it as your working rules say/);
});

test('kosmos#8735 slice 5: --moved-to moved word for word from the working rules to the task guide', () => {
  const d = require('./defaults');
  const g = require('./taskguide').guideText();
  for (const line of ["When an unmet check's part goes to another task, add `--moved-to <that task's number>`",
    'after the words, so both tasks show where it went.']) {
    assert.ok(g.split('\n').includes(line), 'the task guide lost, or reworded, the moved line: ' + line);
    for (const p of d.PLATFORMS) assert.ok(!d.blockFor(p).includes(line), p + ': back in the working rules: ' + line);
  }
  for (const p of d.PLATFORMS) {
    assert.match(d.blockFor(p).replace(/\s+/g, ' '), /move an unmet check to another task, or list open tasks across projects, run `kosmos task --how`/, p + ': the pointer does not name the case');
  }
});
