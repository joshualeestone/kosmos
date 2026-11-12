'use strict';
/* kosmos#8453: ui-sample.sh --uikit --shard 1/2 and 2/2 split the UIKit arm's classes in two CI jobs. Together they must be
   exactly the whole list, each class once with its own count, or a class silently stops running on CI. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const SCRIPT = path.join(__dirname, 'ios', 'tools', 'ui-sample.sh');
function classes(...args) {
  const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, UI_SAMPLE_PRINT_CLASSES: '1' } });
  return { status: r.status, list: r.stdout.split('\n').filter(Boolean), err: r.stderr };
}
test('kosmos#8453: the two halves are the whole UIKit list, each class once, with its count', () => {
  const whole = classes('--uikit');
  assert.equal(whole.status, 0, whole.err);
  assert.ok(whole.list.length > 10, 'CONTROL: the whole list printed ' + whole.list.length + ' classes');
  const a = classes('--uikit', '--shard', '1/2');
  const b = classes('--uikit', '--shard', '2/2');
  assert.equal(a.status, 0, a.err);
  assert.equal(b.status, 0, b.err);
  assert.ok(a.list.length > 0 && b.list.length > 0, 'a half is empty: ' + JSON.stringify([a.list, b.list]));
  assert.deepEqual([...a.list, ...b.list].sort(), [...whole.list].sort(), 'the halves are not exactly the whole list');
  const names = (l) => l.map((c) => c.split(':')[0]);
  assert.equal(new Set(names([...a.list, ...b.list])).size, whole.list.length, 'a class is in both halves');
});
test('kosmos#8453: every class named for the first half is a class the UIKit arm runs (a misspelt name would move it to 2/2 unseen)', () => {
  const s = fs.readFileSync(SCRIPT, 'utf8');
  const m = s.match(/^earlier="([^"]*)"/m);
  assert.ok(m, 'CONTROL: the earlier= line was not found');
  const named = m[1].trim().split(/\s+/);
  const whole = classes('--uikit').list.map((c) => c.split(':')[0]);
  for (const n of named) assert.ok(whole.includes(n), n + ' is named for 1/2 but is not in the UIKit list');
  assert.deepEqual(classes('--uikit', '--shard', '1/2').list.map((c) => c.split(':')[0]).sort(), [...named].sort());
});
test('kosmos#8453: --shard is refused without --uikit and for anything but 1/2 or 2/2', () => {
  // Review 1: the refusal's own words, as 2 is also what an unknown argument returns.
  const noUikit = classes('--shard', '1/2');
  assert.equal(noUikit.status, 2);
  assert.match(noUikit.err, /--shard is for the UIKit arm/);
  for (const bad of [['--uikit', '--shard', '3/2'], ['--uikit', '--shard']]) {
    const r = classes(...bad);
    assert.equal(r.status, 2, bad.join(' '));
    assert.match(r.err, /--shard takes 1\/2 or 2\/2/, bad.join(' '));
  }
});
test('kosmos#8453: the ios workflow runs both halves', () => {
  const y = fs.readFileSync(path.join(__dirname, '.github', 'workflows', 'ios.yml'), 'utf8');
  assert.ok(/ui-sample\.sh --uikit --shard "\$\{\{ matrix\.shard \}\}"/.test(y), 'the uikit job does not pass its shard');
  assert.ok(/shard: \["1\/2", "2\/2"\]/.test(y), 'the uikit job does not run both halves');
  // Review 2: and a red half does not cancel the other, and each half's result bundle has its own name (they would clash).
  const job = y.slice(y.indexOf('  uikit:\n'), y.indexOf('\n  # ', y.indexOf('  uikit:\n') + 1) >>> 0 || undefined);
  assert.ok(job.includes('ui-sample.sh --uikit --shard'), 'CONTROL: the uikit job was not found');
  assert.ok(job.includes('fail-fast: false'), 'a red half cancels the other');
  assert.ok(job.includes('-${{ strategy.job-index }}'), 'the halves would upload result bundles under one name');
});
