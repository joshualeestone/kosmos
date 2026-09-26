'use strict';

/**
 * #4021: main's suite run must never be cancelled by the next merge. On 2026-09-26 every
 * main run for an hour was cancelled, so a red main showed first at a release cut's step 3.
 * A PR's superseded run is still cancelled (that is the #3499 contention fix).
 *
 * A SOURCE pin on every workflow that runs on a push to main (test.yml, android.yml, ios.yml):
 * GitHub evaluates the expression and nothing here can run it, so the test reads the text and
 * evaluates the expression for both refs. It also pins the group key, since cancel-in-progress is
 * decided by the NEW run: a group shared by main and PRs would let a PR run cancel main's.
 *
 *   node --test ci.main-runs-finish-4021.test.js
 */

const test = require('node:test');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* Every workflow that runs on a push to main: the suite, and the two app builds (#3499 keeps the
   three in lockstep). A new push-to-main workflow belongs in this list. */
const WORKFLOWS = ['test.yml', 'android.yml', 'ios.yml'];
const read = (f) => fs.readFileSync(path.join(__dirname, '.github', 'workflows', f), 'utf8');
const YML = read('test.yml');

/* The workflow's top-level concurrency block: from `concurrency:` at column 0 to the next
   top-level key. */
function concurrencyBlock(text) {
  const m = text.match(/^concurrency:\n((?:[ \t]+.*\n|[ \t]*#.*\n|\n)*)/m);
  assert.ok(m, 'no top-level concurrency block');
  return m[1];
}

/* Evaluate the only expression shape allowed here, `${{ github.ref != '<ref>' }}`, or a literal. */
function cancelsOn(block, ref) {
  const line = block.split('\n').find((l) => /^\s+cancel-in-progress:/.test(l));
  assert.ok(line, 'no cancel-in-progress line in the concurrency block');
  const v = line.replace(/^\s+cancel-in-progress:\s*/, '').replace(/\s+#.*$/, '').trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  const e = v.match(/^\$\{\{\s*github\.ref\s*(!=|==)\s*'([^']+)'\s*\}\}$/);
  assert.ok(e, 'cancel-in-progress is an expression this pin cannot read: ' + v + ' (update the pin with it)');
  return e[1] === '!=' ? ref !== e[2] : ref === e[2];
}

for (const f of WORKFLOWS) {
  test('#4021: ' + f + ': a main run is never cancelled; a PR\'s superseded run still is', () => {
    const block = concurrencyBlock(read(f));
    assert.equal(cancelsOn(block, 'refs/heads/main'), false, f + ': main\'s run can be cancelled by the next merge again');
    assert.equal(cancelsOn(block, 'refs/pull/4021/merge'), true, f + ': a PR\'s superseded run is no longer cancelled (the #3499 contention)');
    const group = (block.split('\n').find((l) => /^\s+group:/.test(l)) || '');
    assert.match(group, /\$\{\{\s*github\.ref\s*\}\}/, f + ': the group is not keyed on github.ref, so a PR run could cancel main\'s: ' + group.trim());
  });
}

test('#4021 control: the reader sees the old setting as cancelling main', () => {
  /* Built from the line's shape, not from the live value, so this control stays meaningful (and
     quiet) even when the live file regresses to the old setting: test 1 names that. */
  const old = YML.replace(/(^\s+cancel-in-progress:).*$/m, '$1 true');
  assert.match(old, /^\s+cancel-in-progress: true$/m, 'the control could not write the old setting');
  assert.equal(cancelsOn(concurrencyBlock(old), 'refs/heads/main'), true);
});

/* Does this workflow run on a push to main? Read from the PARSED YAML (ruby, as
   tools/test-browser-checks-workflow.sh does), so every spelling counts: a block list, a bare
   `branches: main`, an unquoted flow list, `on: push`, a push with no filter. YAML 1.1 loads the
   `on` key as `true`, so both are read.
   GitHub's filter patterns (workflow syntax, "Filter pattern cheat sheet"): `*` is any run of
   characters but '/', `**` any run at all, `?` zero or one of the PRECEDING character, `+` one or
   more of it, `[...]` one character from the set. So `*` and `**` are translated, `?`, `+` and
   `[...]` already mean that in a regex and are kept, and every other regex character is literal.
   In a list, a pattern starting with `!` excludes, and a later pattern overrides an earlier one. */
const glob = (g) => new RegExp('^' + String(g).replace(/[.^${}()|\\]/g, '\\$&')
  .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
const anyMatch = (list, name) => [].concat(list).reduce((hit, g) => {
  const neg = String(g).startsWith('!');
  return glob(neg ? String(g).slice(1) : g).test(name) ? !neg : hit;
}, false);
function pushesMain(wf) {
  const on = wf && (wf.on !== undefined ? wf.on : wf.true);
  let push;
  if (on === 'push') push = {};
  else if (Array.isArray(on)) push = on.includes('push') ? {} : undefined;
  else if (on && typeof on === 'object' && 'push' in on) push = on.push || {};
  if (push === undefined) return false;
  if (push.branches !== undefined) return anyMatch(push.branches, 'main');
  if (push['branches-ignore'] !== undefined) return !anyMatch(push['branches-ignore'], 'main');
  return push.tags === undefined && push['tags-ignore'] === undefined; // tags only: no branch push
}
function parsed(file) {
  const out = execFileSync('ruby', ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.load_file(ARGV[0]).transform_keys(&:to_s))', file], { encoding: 'utf8' });
  return JSON.parse(out);
}
let RUBY = true;
try { execFileSync('ruby', ['-e', '1']); } catch { RUBY = false; }
/* Quiet only on a dev machine without ruby. Under CI a missing ruby is a broken runner, and a
   control that silently vanishes there is the guard-gone-quiet this file exists to prevent (the
   same rule tools/test-browser-checks-workflow.sh applies). */
test('#4021 control: ruby is present under CI, so the detector below cannot silently skip there', () => {
  if (process.env.CI) assert.ok(RUBY, 'ruby is missing under CI: the push-to-main detector cannot run');
});

test('#4021 control: every workflow that runs on a push to main is in the list', { skip: !RUBY && 'ruby is not on this machine (GitHub still runs the pins above)' }, () => {
  const dir = path.join(__dirname, '.github', 'workflows');
  const onMain = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).filter((f) => pushesMain(parsed(path.join(dir, f))));
  assert.ok(onMain.includes('test.yml') && onMain.includes('android.yml'), 'the push-to-main detector cannot see the known ones: ' + onMain.join(', '));
  assert.deepEqual(onMain.filter((f) => !WORKFLOWS.includes(f)), [], 'a push-to-main workflow is not pinned here');
});

test('#4021 control: the push-to-main detector reads every spelling', () => {
  const yes = [
    { on: { push: { branches: ['main'] } } }, { on: { push: { branches: 'main' } } }, { true: { push: { branches: ['main'] } } },
    { on: 'push' }, { on: ['push', 'pull_request'] }, { on: { push: null } }, { on: { push: { branches: ['**'] } } },
    { on: { push: { 'branches-ignore': ['release/*'] } } },
    { on: { push: { branches: ['mains?'] } } }, { on: { push: { branches: ['mai+n'] } } }, { on: { push: { branches: ['[mn]ain'] } } },
    { on: { push: { branches: ['*', '!release/*'] } } }, { on: { push: { branches: ['!main', 'main'] } } },
  ];
  const no = [
    { on: { pull_request: { branches: ['main'] } } }, { on: { push: { tags: ['v*'] } } }, { on: { push: { branches: ['release/*'] } } },
    { on: { push: { 'branches-ignore': ['main'] } } }, { on: 'workflow_dispatch' }, { on: { schedule: [{ cron: '0 7 * * *' }] } },
    { on: { push: { branches: ['*', '!main'] } } }, { on: { push: { branches: ['[xy]ain'] } } }, { on: { push: { branches: ['ma.n'] } } },
    { on: { push: { branches: ['release/**'] } } },
  ];
  for (const w of yes) assert.equal(pushesMain(w), true, 'missed: ' + JSON.stringify(w));
  for (const w of no) assert.equal(pushesMain(w), false, 'over-matched: ' + JSON.stringify(w));
});
