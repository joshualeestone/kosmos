'use strict';
/* kosmos#8195: under `set -o pipefail`, `writer | grep -q x` (or head, read, a quitting sed, an awk that exits) can
   FAIL BECAUSE IT MATCHED: the reader exits early, the writer takes SIGPIPE (141), and pipefail reports the pipeline as
   failed (#8193 measured 41/50 false fails on one check). Today's hits across every tracked shell script that sets
   pipefail were triaged on #8195 and are listed in test-support/pipefail-baseline-8195.txt, so this file is a RATCHET:
   a NEW early reader fails here and its author judges it (rewrite it, e.g. grep -c ... >/dev/null, or add the line
   with a reason it cannot bite), and a listed line that no longer exists fails too, so the list stays exact.
   ios/LogicTests is held to zero by ios.logictests-pipefail-8193.test.js. Scanned: a script that sets pipefail anywhere
   outside a comment (a set or bash line, a subshell included) or in its #! line, and every shell file under tools/lib/ (sourced by scripts that set it). Not covered: any
   other sourced file with no pipefail of its own, and the helper's own known gaps (see early-readers.js).
   To print a fresh list (after a change to the helper): KOSMOS_PRINT_PIPEFAIL_BASELINE=1 node --test <this file>. */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { earlyReaders } = require('./test-support/early-readers');

const ROOT = __dirname;
const BASELINE = path.join(ROOT, 'test-support', 'pipefail-baseline-8195.txt');

// `set ... pipefail` or `bash ... pipefail` on a line that is not a comment (after && or in a subshell too), or in #!.
const SETS_PIPEFAIL = /^[^#\n]*\b(?:set|bash)(?:[ \t]+(?:-o[ \t]+\w+|-[A-Za-z-]+))*[ \t]+-[A-Za-z]*o[ \t]+pipefail\b|^#![^\n]*-[A-Za-z]*o[ \t]+pipefail\b/m;

const SHEBANG_SH = /^#![^\n]*\b(?:ba|z|k|da)?sh\b/;

/** Tracked shell scripts that set pipefail, plus tools/lib/. A shell script is a *.sh file or any tracked file whose
    #! line names a shell (install/kosmos, .githooks/*). Files are listed by git, so an untracked script is not scanned. */
function scripts() {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, 'git ls-files failed: ' + r.stderr);
  const out = [];
  for (const rel of r.stdout.split('\0').filter(Boolean)) {
    const abs = path.join(ROOT, rel);
    if (!rel.endsWith('.sh')) {
      let head = '';
      try { const fd = fs.openSync(abs, 'r'); const b = Buffer.alloc(128); const n = fs.readSync(fd, b, 0, 128, 0); fs.closeSync(fd); head = b.subarray(0, n).toString('utf8'); } catch { continue; }
      if (!SHEBANG_SH.test(head)) continue;
    }
    assert.ok(fs.existsSync(abs), rel + ' is tracked but not on disk (a rename or delete not yet staged?)');
    const text = fs.readFileSync(abs, 'utf8');
    if (rel.startsWith('tools/lib/') || SETS_PIPEFAIL.test(text)) out.push({ rel, text });
  }
  return out;
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
  assert.ok(list.some((s) => s.rel === '.githooks/prepare-commit-msg'), 'CONTROL: an extensionless script found by its #! line is read');
  const now = hits(list), base = baseline();
  assert.ok(now.length > 0 && base.length > 0, 'CONTROL: the scan and the list both found something');
  if (process.env.KOSMOS_PRINT_PIPEFAIL_BASELINE === '1') process.stdout.write(now.join('\n') + '\n');
  const added = minus(now, base), gone = minus(base, now);
  const paths = (l) => new Set(l.map((x) => x.split('\t')[0]));
  const changed = [...paths(added)].filter((p) => paths(gone).has(p));
  assert.ok(added.length === 0 && gone.length === 0, [
    'early readers under pipefail (kosmos#8195) do not match test-support/pipefail-baseline-8195.txt.',
    changed.length ? 'A listed line in ' + changed.join(', ') + ' may have changed: if so, replace its old entry with the new one (both are below).' : '',
    added.length ? 'NEW, can fail because it matched. Rewrite it so the reader reads to the end (grep -c ... >/dev/null, or capture '
      + 'first), or, only if it cannot bite (one small write, or a status nothing reads), add it exactly as printed:\n' + added.join('\n') : '',
    gone.length ? 'GONE, no longer in the scanned scripts; remove from the list:\n' + gone.join('\n') : '',
  ].filter(Boolean).join('\n'));
});

test('#8195 CONTROL: each way of turning pipefail on is seen, and turning it off or mentioning it is not', () => {
  for (const on of ['set -euo pipefail', 'set -o pipefail', 'set -e -u -o pipefail', 'set -Eeuo pipefail', 'set -o errexit -o pipefail',
    'set -o nounset -o errexit -o pipefail', '[ -n "$BASH_VERSION" ] && set -o pipefail || true', 'out="$(set -euo pipefail; f)"',
    'bash --noprofile -eo pipefail x.sh', '#!/bin/bash -eo pipefail']) assert.ok(SETS_PIPEFAIL.test(on), 'not seen: ' + on);
  for (const off of ['set +o pipefail', '# then set -o pipefail', '  # set -euo pipefail', 'pipefail is off here', 'set -eu'])
    assert.equal(SETS_PIPEFAIL.test(off), false, 'seen, wrongly: ' + off);
});

test('#8195 CONTROL: the comparison catches one new hit and one gone line, and counts a repeated line twice', () => {
  const base = ['a.sh\tx | head -1', 'a.sh\tx | head -1', 'b.sh\ty | grep -q z'];
  assert.deepEqual(minus(['a.sh\tx | head -1', 'a.sh\tx | head -1', 'a.sh\tx | head -1', 'b.sh\ty | grep -q z'], base), ['a.sh\tx | head -1']);
  assert.deepEqual(minus(base, ['a.sh\tx | head -1', 'b.sh\ty | grep -q z']), ['a.sh\tx | head -1']);
  assert.deepEqual(hits([{ rel: 'c.sh', text: 'set -o pipefail\nprintf x | grep -q y\nprintf x | grep -c y >/dev/null\n' }]), ['c.sh\tprintf x | grep -q y']);
});
