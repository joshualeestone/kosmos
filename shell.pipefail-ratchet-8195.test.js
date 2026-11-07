'use strict';
/* kosmos#8195: under `set -o pipefail`, `writer | grep -q x` (or head, read, a quitting sed, an awk that exits) can
   FAIL BECAUSE IT MATCHED: the reader exits early, the writer takes SIGPIPE (141), and pipefail reports the pipeline as
   failed (#8193 measured 41/50 false fails on one check). Today's hits across every tracked shell script that sets
   pipefail were triaged on #8195 and are listed in test-support/pipefail-baseline-8195.txt, so this file is a RATCHET:
   a NEW early reader fails here and its author judges it (rewrite it, e.g. grep -c ... >/dev/null, or add the line
   with a reason it cannot bite), and a listed line that no longer exists fails too, so the list stays exact.
   ios/LogicTests is held to zero by ios.logictests-pipefail-8193.test.js. Not covered: a script that gets pipefail
   only from whoever sources it (no pipefail of its own), and the helper's own known gaps (see early-readers.js). */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { earlyReaders } = require('./test-support/early-readers');

const ROOT = __dirname;
const BASELINE = path.join(ROOT, 'test-support', 'pipefail-baseline-8195.txt');

/** Tracked shell scripts (and install/kosmos, a shell script with no .sh) that set pipefail. */
function scripts() {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--', '*.sh', 'install/kosmos'], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'git ls-files failed: ' + r.stderr);
  return r.stdout.split('\0').filter(Boolean)
    .map((rel) => ({ rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') }))
    .filter((s) => /\bpipefail\b/.test(s.text));
}

/** Each hit as "path<TAB>line", one entry per occurrence (a line repeated in a file counts twice). */
function hits(list) {
  const out = [];
  for (const s of list) for (const h of earlyReaders(s.text)) out.push(s.rel + '\t' + h);
  return out;
}

function baseline() {
  return fs.readFileSync(BASELINE, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
}

/** Multiset difference: the entries of a not matched one for one in b. */
function minus(a, b) {
  const left = new Map();
  for (const x of b) left.set(x, (left.get(x) || 0) + 1);
  const out = [];
  for (const x of a) { const n = left.get(x) || 0; if (n) left.set(x, n - 1); else out.push(x); }
  return out;
}

test('#8195: no NEW pipeline under pipefail ends in a reader that can stop early, and the list holds no line that is gone', () => {
  const list = scripts();
  assert.ok(list.length >= 100, 'CONTROL: the scripts are actually listed (' + list.length + ')');
  assert.ok(list.some((s) => s.rel === 'install/kosmos'), 'CONTROL: install/kosmos is read');
  const now = hits(list), base = baseline();
  assert.ok(now.length > 0 && base.length > 0, 'CONTROL: the scan and the list both found something');
  const added = minus(now, base), gone = minus(base, now);
  assert.deepEqual(added, [], 'a pipeline here can fail because it matched (kosmos#8195). Rewrite it so the reader reads to the end '
    + '(grep -c ... >/dev/null, or capture first), or, only if it cannot bite (one small write, or its status is never read), add the line '
    + 'exactly as printed to test-support/pipefail-baseline-8195.txt:\n' + added.join('\n'));
  assert.deepEqual(gone, [], 'these listed lines no longer exist; remove them from test-support/pipefail-baseline-8195.txt:\n' + gone.join('\n'));
});

test('#8195 CONTROL: the comparison catches one new hit and one gone line, and counts a repeated line twice', () => {
  const base = ['a.sh\tx | head -1', 'a.sh\tx | head -1', 'b.sh\ty | grep -q z'];
  assert.deepEqual(minus(['a.sh\tx | head -1', 'a.sh\tx | head -1', 'a.sh\tx | head -1', 'b.sh\ty | grep -q z'], base), ['a.sh\tx | head -1']);
  assert.deepEqual(minus(base, ['a.sh\tx | head -1', 'b.sh\ty | grep -q z']), ['a.sh\tx | head -1']);
  assert.deepEqual(hits([{ rel: 'c.sh', text: 'set -o pipefail\nprintf x | grep -q y\nprintf x | grep -c y >/dev/null\n' }]), ['c.sh\tprintf x | grep -q y']);
});
