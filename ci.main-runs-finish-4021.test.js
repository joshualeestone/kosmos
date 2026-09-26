'use strict';

/**
 * #4021: a run on main must never be cancelled by the next merge. On 2026-09-26 every main run
 * for an hour was cancelled, so a red main showed first at a release cut's step 3. A PR's
 * superseded run is still cancelled (that is the #3499 contention fix).
 *
 * A SOURCE pin on every workflow that runs on a push to main (test.yml, android.yml, ios.yml):
 * GitHub evaluates the expression and nothing here can run it, so the test reads the text and
 * evaluates the expression for both refs. It also pins the group key, since cancel-in-progress is
 * decided by the NEW run: a group shared by main and PRs, or by two workflows, would let another
 * run cancel or replace main's.
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
const PINNED_WORKFLOWS = ['test.yml', 'android.yml', 'ios.yml'];
const WORKFLOW_DIR = path.join(__dirname, '.github', 'workflows');
const readWorkflowText = (file) => fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8');
const TEST_WORKFLOW_TEXT = readWorkflowText('test.yml');

/* The workflow's top-level concurrency block: from `concurrency:` at column 0 to the next
   top-level key. */
function concurrencyBlockOf(text, file) {
  const m = text.match(/^concurrency:\n((?:[ \t]+.*\n|[ \t]*#.*\n|\n)*)/m);
  assert.ok(m, file + ' has no top-level concurrency block');
  return m[1];
}

/* A key's value inside the block, with any trailing YAML comment removed (a `# ${{ github.ref }}`
   comment must not read as the value). */
function blockValue(block, key) {
  const line = block.split('\n').find((l) => new RegExp('^\\s+' + key + ':').test(l));
  if (!line) return null;
  return line.replace(new RegExp('^\\s+' + key + ':\\s*'), '').replace(/\s+#.*$/, '').trim();
}

/* Evaluate the only expression shape allowed here, `${{ github.ref != '<ref>' }}`, or a literal. */
function cancelsInProgressOn(block, ref) {
  const value = blockValue(block, 'cancel-in-progress');
  assert.ok(value !== null, 'no cancel-in-progress line in the concurrency block');
  if (value === 'true') return true;
  if (value === 'false') return false;
  const e = value.match(/^\$\{\{\s*github\.ref\s*(!=|==)\s*'([^']+)'\s*\}\}$/);
  assert.ok(e, 'cancel-in-progress is an expression this pin cannot read: ' + value + ' (update the pin with it)');
  return e[1] === '!=' ? ref !== e[2] : ref === e[2];
}

for (const file of PINNED_WORKFLOWS) {
  test('#4021: ' + file + ': a main run is never cancelled; a PR\'s superseded run still is', () => {
    const block = concurrencyBlockOf(readWorkflowText(file), file);
    assert.equal(cancelsInProgressOn(block, 'refs/heads/main'), false, file + ': main\'s run can be cancelled by the next merge again');
    assert.equal(cancelsInProgressOn(block, 'refs/pull/4021/merge'), true, file + ': a PR\'s superseded run is no longer cancelled (the #3499 contention)');
    const group = blockValue(block, 'group') || '';
    assert.match(group, /^[A-Za-z0-9_-]+-\$\{\{\s*github\.ref\s*\}\}$/,
      file + ': the group must be `<own-prefix>-${{ github.ref }}`, or a PR run (or another workflow) could cancel or replace main\'s: ' + group);
  });
}

test('#4021: each pinned workflow has its own group prefix', () => {
  const prefixes = PINNED_WORKFLOWS.map((file) => (blockValue(concurrencyBlockOf(readWorkflowText(file), file), 'group') || '').split('-${{')[0]);
  assert.equal(new Set(prefixes).size, prefixes.length, 'two workflows share a concurrency group, so one\'s pending run replaces the other\'s: ' + prefixes.join(', '));
});

test('#4021 control: the reader sees the old setting as cancelling main', () => {
  /* Built from the line's shape, not from the live value, so this control stays meaningful (and
     quiet) even when the live file regresses to the old setting: the pin above names that. */
  const old = TEST_WORKFLOW_TEXT.replace(/(^\s+cancel-in-progress:).*$/m, '$1 true');
  assert.match(old, /^\s+cancel-in-progress: true$/m, 'the control could not write the old setting');
  assert.equal(cancelsInProgressOn(concurrencyBlockOf(old, 'test.yml'), 'refs/heads/main'), true);
});

test('#4021 control: a group named only in a comment is not a group', () => {
  const commented = TEST_WORKFLOW_TEXT.replace(/(^\s+group:).*$/m, '$1 test # ${{ github.ref }}');
  assert.equal(blockValue(concurrencyBlockOf(commented, 'test.yml'), 'group'), 'test');
});

/* Does this workflow run on a push to main? Read from the PARSED YAML (ruby, as
   tools/test-browser-checks-workflow.sh does), so every spelling counts: a block list, a bare
   `branches: main`, an unquoted flow list, `on: push`, a push with no filter. YAML 1.1 loads the
   `on` key as `true`, so both are read.
   GitHub's filter patterns (workflow syntax, "Filter pattern cheat sheet"): `*` is any run of
   characters but '/', `**` any run at all (and `**\/` also zero directories), `?` zero or one of
   the PRECEDING character, `+` one or more of it, `[...]` one character from the set, `\` makes
   the next character literal. In a list, a pattern starting with `!` excludes, and a later
   pattern overrides an earlier one. */
function branchFilterToRegex(pattern) {
  const p = String(pattern);
  let out = '';
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '\\' && i + 1 < p.length) { out += p[i + 1].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); i += 1; }
    else if (c === '*' && p[i + 1] === '*' && p[i + 2] === '/') { out += '(?:.*/)?'; i += 2; }
    else if (c === '*' && p[i + 1] === '*') { out += '.*'; i += 1; }
    else if (c === '*') out += '[^/]*';
    else if ((c === '?' || c === '+') && out !== '' && !/[?+*]$/.test(out)) out += c;
    else if (c === '[') { const end = p.indexOf(']', i + 1); if (end < 0) { out += '\\['; } else { out += p.slice(i, end + 1); i = end; } }
    else out += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp('^' + out + '$');
}
const branchListMatches = (list, branch) => [].concat(list).reduce((hit, pattern) => {
  const excludes = String(pattern).startsWith('!');
  return branchFilterToRegex(excludes ? String(pattern).slice(1) : pattern).test(branch) ? !excludes : hit;
}, false);
function pushesToMain(workflow) {
  const on = workflow && (workflow.on !== undefined ? workflow.on : workflow.true);
  let push;
  if (on === 'push') push = {};
  else if (Array.isArray(on)) push = on.includes('push') ? {} : undefined;
  else if (on && typeof on === 'object' && 'push' in on) push = on.push || {};
  if (push === undefined) return false;
  if (push.branches !== undefined) return branchListMatches(push.branches, 'main');
  if (push['branches-ignore'] !== undefined) return !branchListMatches(push['branches-ignore'], 'main');
  return push.tags === undefined && push['tags-ignore'] === undefined; // tags only: no branch push
}
/* Anchors (`&b` / `*b`) are legal in a workflow and Psych 4 refuses them by default; dates and
   symbols likewise. Allowed, so an unrelated workflow edit cannot red this test with a parser error. */
function parseWorkflowYaml(file) {
  const out = execFileSync('ruby', ['-ryaml', '-rjson', '-rdate', '-e',
    'puts JSON.generate(YAML.load_file(ARGV[0], aliases: true, permitted_classes: [Date, Symbol]).transform_keys(&:to_s))', file], { encoding: 'utf8' });
  return JSON.parse(out);
}
let RUBY_PROBLEM = null;
try { execFileSync('ruby', ['-ryaml', '-e', '1'], { stdio: 'pipe' }); } catch (err) {
  RUBY_PROBLEM = err && err.code === 'ENOENT' ? 'ruby is not on this machine' : 'ruby is present but fails: ' + String((err && err.message) || err).split('\n')[0];
}
const ON_CI = !!process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0';
/* Quiet only on a dev machine without a working ruby. Under CI that is a broken runner, and a
   control that silently vanishes there is the guard-gone-quiet this file exists to prevent (the
   same rule tools/test-browser-checks-workflow.sh applies). */
test('#4021 control: ruby works under CI, so the detector below cannot silently skip there', () => {
  if (ON_CI) assert.equal(RUBY_PROBLEM, null, RUBY_PROBLEM + ' under CI: the push-to-main detector cannot run');
});

test('#4021 control: every workflow that runs on a push to main is in the list', { skip: RUBY_PROBLEM ? RUBY_PROBLEM + ' (the pins above still run)' : false }, () => {
  const onMain = fs.readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f)).filter((f) => pushesToMain(parseWorkflowYaml(path.join(WORKFLOW_DIR, f))));
  for (const known of PINNED_WORKFLOWS) assert.ok(onMain.includes(known), 'the push-to-main detector cannot see ' + known + ': ' + onMain.join(', '));
  assert.deepEqual(onMain.filter((f) => !PINNED_WORKFLOWS.includes(f)), [], 'a push-to-main workflow is not pinned here');
});

test('#4021 control: the push-to-main detector reads every spelling', () => {
  const yes = [
    { on: { push: { branches: ['main'] } } }, { on: { push: { branches: 'main' } } }, { true: { push: { branches: ['main'] } } },
    { on: 'push' }, { on: ['push', 'pull_request'] }, { on: { push: null } }, { on: { push: { branches: ['**'] } } },
    { on: { push: { 'branches-ignore': ['release/*'] } } },
    { on: { push: { branches: ['mains?'] } } }, { on: { push: { branches: ['mai+n'] } } }, { on: { push: { branches: ['[mn]ain'] } } },
    { on: { push: { branches: ['*', '!release/*'] } } }, { on: { push: { branches: ['!main', 'main'] } } },
    { on: { push: { branches: ['**/main'] } } }, { on: { push: { branches: ['ma\\in'] } } },
  ];
  const no = [
    { on: { pull_request: { branches: ['main'] } } }, { on: { push: { tags: ['v*'] } } }, { on: { push: { branches: ['release/*'] } } },
    { on: { push: { 'branches-ignore': ['main'] } } }, { on: 'workflow_dispatch' }, { on: { schedule: [{ cron: '0 7 * * *' }] } },
    { on: { push: { branches: ['*', '!main'] } } }, { on: { push: { branches: ['[xy]ain'] } } }, { on: { push: { branches: ['ma.n'] } } },
    { on: { push: { branches: ['release/**'] } } }, { on: { push: { branches: ['mai\\*'] } } }, { on: { push: { branches: ['?main'] } } },
  ];
  for (const w of yes) assert.equal(pushesToMain(w), true, 'missed: ' + JSON.stringify(w));
  for (const w of no) assert.equal(pushesToMain(w), false, 'over-matched: ' + JSON.stringify(w));
});
