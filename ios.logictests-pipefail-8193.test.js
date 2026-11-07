'use strict';
/* kosmos#8193: ios/LogicTests/run-sweep.sh runs under `set -euo pipefail` and checked ProjectsView.swift with
   `sed ... | grep -qE ...`. grep -q stops reading at its first match, so a writer with bytes still to write dies of
   SIGPIPE (141) and pipefail turns the match into a failure. On a loaded CI runner the sweep suite printed
   "VERDICT: FAIL (the Projects tab's first wait ... is no longer ConnectingWait)" on a file that holds the line.
   Every LogicTests script that sets pipefail is checked here, not only run-sweep.sh. */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { earlyReaders } = require('./test-support/early-readers');

const DIR = path.join(__dirname, 'ios', 'LogicTests');
const scripts = fs.readdirSync(DIR).filter((n) => n.endsWith('.sh'))
  .map((n) => ({ name: n, text: fs.readFileSync(path.join(DIR, n), 'utf8') }))
  .filter((s) => /\bpipefail\b/.test(s.text));

test('#8193: no LogicTests script under pipefail pipes into a reader that can stop early', () => {
  assert.ok(scripts.some((s) => s.name === 'run-sweep.sh'), 'CONTROL: run-sweep.sh is one of the scripts read');
  assert.ok(scripts.length >= 10, 'CONTROL: the scripts are actually listed (' + scripts.length + ')');
  for (const s of scripts) assert.deepEqual(earlyReaders(s.text), [], s.name + ': a pipeline here can fail because it matched');
});

test('#8193 CONTROL: the line that false-failed is caught, and the PIPESTATUS line beside it is not', () => {
  const was = `sed 's#//.*##' "$src/ProjectsView.swift" | grep -qE 'ConnectingWait\\(words: "Reaching your computer\\\\u\\{2026\\}"\\)' \\\n  || { echo "VERDICT: FAIL"; exit 1; }`;
  assert.equal(earlyReaders(was).length, 1, 'the pre-fix line is not caught');
  const now = was.replace('| grep -qE', '| grep -cE').replace(")' \\", ")' >/dev/null \\");
  assert.deepEqual(earlyReaders(now), [], 'the fixed line is still caught');
  const status = `if "$out/render-launch-sweep" --check "$dir" "$side" | grep -v '^ok$'; [ "\${PIPESTATUS[0]}" -eq 0 ]; then`;
  assert.deepEqual(earlyReaders(status), [], 'a test after ; is read as the reader\'s flags (-eq as -q)');
  assert.equal(earlyReaders(`printf x | grep -q y; [ 1 -eq 1 ]`).length, 1, 'cutting at ; lost the reader before it');
  assert.equal(earlyReaders(`printf x | grep -q y && echo ok`).length, 1, 'cutting at && lost the reader before it');
});

test('#8193: with a slow writer, grep -q under pipefail fails on a match and grep -c does not', { skip: process.platform === 'darwin' ? false : 'sed -l is the BSD line-buffered flag; GNU sed reads it as a wrap length. NOT checked here' }, () => {
  // sed -l writes line by line, standing in for a writer on a loaded runner. The input is made here (one matching
  // line, then filler), so how far a product file's match sits from its end cannot change what this measures.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-pipefail-8193-'));
  const file = path.join(dir, 'input.swift');
  fs.writeFileSync(file, 'ConnectingWait(words: "x")\n' + 'filler line, long enough to need many writes\n'.repeat(5000));
  const round = (reader) => spawnSync('bash', ['-c', `set -o pipefail; n=0; for i in 1 2 3 4 5 6 7 8 9 10; do sed -l 's#//.*##' "$1" | ${reader} 'ConnectingWait' >/dev/null || n=$((n+1)); done; echo $n`, 'x', file], { encoding: 'utf8', timeout: 60 * 1000 });
  const q = round('grep -qE'), c = round('grep -cE');
  assert.equal(q.status, 0, 'grep -q round: ' + (q.signal || q.stderr)); assert.equal(c.status, 0, 'grep -c round: ' + (c.signal || c.stderr));
  assert.equal(c.stdout.trim(), '0', 'grep -c failed on a file that matches');
  assert.ok(Number(q.stdout.trim()) > 0, 'CONTROL: grep -q never failed, so this test cannot tell the two apart here');
});
