'use strict';
/* kosmos#7609: ui-sample counts a retried test once, by its last result, and names one that failed then passed. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const SCRIPT = path.join(__dirname, 'ios', 'tools', 'ui-sample-tally.sh');
const line = (t, r) => "Test Case '-[KosmosUITests." + t + "]' " + r + ' (1.0 seconds).';
function tally(lines) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tally-')), 'log');
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return execFileSync('bash', [SCRIPT, f], { encoding: 'utf8' }).trim().split('\n');
}
test('kosmos#7609: failed then passed counts once, as passed and flaky; failed twice stays failed; a skip is a skip', () => {
  const out = tally([line('A one', 'passed'), line('A two', 'failed'), 'noise', line('A three', 'failed'), line('A four', 'skipped'), line('A two', 'passed'), line('A three', 'failed')]);
  assert.deepEqual(out, ['A.one passed', 'A.two passed', 'A.two flaky', 'A.three failed', 'A.four skipped']);
});
test('kosmos#7609: the sample script retries and counts through the tally (a rename here would count nothing)', () => {
  const s = fs.readFileSync(path.join(__dirname, 'ios', 'tools', 'ui-sample.sh'), 'utf8');
  assert.ok(s.includes('-retry-tests-on-failure -test-iterations 2'));
  assert.ok(s.includes('ui-sample-tally.sh'));
  assert.ok(s.includes('sed \'s/^/FLAKY /\''));
});
