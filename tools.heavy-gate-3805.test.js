'use strict';

/**
 * #3805: tools/heavy-gate.sh answers "is it safe to start a heavy run?" for the whole fleet.
 * Each case the card names is tested with its control: the same input with only the deciding
 * detail changed must give the other answer, so no pass comes from a check that cannot fail.
 * The process table and the reservation come in through the tool's seams (KOSMOS_HG_SNAPSHOT,
 * KOSMOS_HG_CLAIM), so every case is deterministic; one smoke test runs it against the live Mac.
 *
 *   node --test tools.heavy-gate-3805.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TOOL = path.join(__dirname, 'tools', 'heavy-gate.sh');
const FREE = 'no release holds the machine right now.';
const HELD = 'the machine is reserved for a release (release 0.6.95, pid 1 on this Mac) until 15:19 CDT.';
const WORK = '/Users/someone/work/kosmos';          // a checkout, not a test sandbox
const KT = '/private/var/folders/ab/cd/T/kt4242/kosmos-gate-x1'; // run-tests.sh sandbox

function run(lines, { claim = FREE, args = [], env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-'));
  const snap = path.join(dir, 'snap.tsv');
  fs.writeFileSync(snap, lines.map((l) => l.join('\x1f')).join('\n') + (lines.length ? '\n' : ''));
  const r = spawnSync('bash', [TOOL, ...args], {
    encoding: 'utf8',
    env: { ...process.env, KOSMOS_HG_SNAPSHOT: snap, KOSMOS_HG_CLAIM: claim, KOSMOS_HG_TWICE_SECONDS: '0', ...env },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr };
}
const realRun = (cwd = WORK, anc = 'zsh') => ['101', cwd, 'bash tools/browser-checks.sh', anc];

test('nothing running and no reservation reads clear', () => {
  const r = run([]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /heavy-gate: CLEAR/);
});

test('a reservation reads busy (control: the same table without one is clear)', () => {
  assert.equal(run([], { claim: HELD }).code, 1);
  assert.equal(run([], { claim: FREE }).code, 0);
});

test('a real release or browser-checks run in a checkout reads busy (control: without it, clear)', () => {
  const rel = ['102', WORK, 'bash tools/release.sh 0.6.96', 'zsh'];
  const r = run([realRun(), rel]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /COUNTS 101/);
  assert.match(r.out, /COUNTS 102/);
  assert.equal(run([]).code, 0);
});

test('a shell that only MENTIONS the names does not count (control: a real run beside them does)', () => {
  const mentions = [
    ['201', WORK, 'zsh -c for i in 1 2; do pgrep -f tools/browser-checks.sh; done', 'claude'],
    ['202', WORK, 'bash -c echo tools/release.sh', 'zsh'],
    ['203', WORK, 'grep tools/release.sh notes.md', 'zsh'],
  ];
  const quiet = run(mentions);
  assert.equal(quiet.code, 0, quiet.out);
  assert.match(quiet.out, /ignore 201/);
  assert.equal(run([...mentions, realRun()]).code, 1);
});

test('a fixture under $TMPDIR/kt<digits>/ does not count (control: the same run in a checkout does)', () => {
  const r = run([['301', KT, 'bash ' + KT + '/tools/release.sh 0.6.56', 'zsh']]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /run-tests\.sh sandbox/);
  assert.equal(run([['301', WORK, 'bash tools/release.sh 0.6.56', 'zsh']]).code, 1);
});

test('a node --test child does not count (control: the same run without that ancestor does)', () => {
  const anc = 'node --test --test-concurrency=0 tools.release-gate.test.js | bash tools/run-tests.sh';
  const r = run([realRun(WORK, anc)]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /node --test ancestor/);
  assert.equal(run([realRun(WORK, 'zsh | tmux')]).code, 1);
});

test('a run that already exited does not count (control: the same run still going does)', () => {
  const gone = run([['401', '', 'bash tools/browser-checks.sh', 'zsh']]);
  assert.equal(gone.code, 0, gone.out);
  assert.match(gone.out, /ignore 401: already exited/, 'ignored for the right reason, not a field shift');
  assert.equal(run([['401', WORK, 'bash tools/browser-checks.sh', 'zsh']]).code, 1);
});

test('--except-cwd rules out your own run, exact or below, and not a sibling that shares the prefix', () => {
  /* Made under /tmp, not os.tmpdir(): tools/run-tests.sh points TMPDIR at its $TMPDIR/kt<pid>/
     sandbox, and the tool rightly ignores a run there as a test fixture, so a sibling in the
     sandbox would read as ignored for that reason instead of testing the prefix match. */
  const base = fs.realpathSync(fs.mkdtempSync('/tmp/hg-own-'));
  assert.doesNotMatch(base, /\/T\/kt[0-9]/, 'the own-run folders must sit outside the kt sandbox pattern');
  const mine = path.join(base, 'kosmos');
  fs.mkdirSync(path.join(mine, 'sub'), { recursive: true });
  const args = ['--except-cwd', mine];
  assert.equal(run([realRun(mine)], { args }).code, 0, 'exact dir is mine');
  assert.equal(run([realRun(path.join(mine, 'sub'))], { args }).code, 0, 'below is mine');
  const sibling = run([realRun(mine + '-bar')], { args });
  assert.equal(sibling.code, 1, 'kosmos-bar is not kosmos: ' + sibling.out);
  assert.equal(run([realRun(mine)]).code, 1, 'control: without --except-cwd the same run counts');
  fs.rmSync(base, { recursive: true, force: true });
});

test('--except-cwd with a missing or non-existent directory is an error, never a clear', () => {
  const noArg = run([], { args: ['--except-cwd'] });
  assert.equal(noArg.code, 2, noArg.out);
  assert.equal(run([], { args: ['--except-cwd', ''] }).code, 2);
  assert.equal(run([], { args: ['--except-cwd', '/no/such/dir-3805'] }).code, 2);
  assert.equal(run([], { args: ['--bogus'] }).code, 2);
});

test('--twice takes two reads when the first is clear, and stops at a busy first read', () => {
  const clear = run([], { args: ['--twice'] });
  assert.equal(clear.code, 0, clear.out);
  assert.equal((clear.out.match(/^reservation:/gm) || []).length, 2, clear.out);
  const busy = run([], { args: ['--twice'], claim: HELD });
  assert.equal(busy.code, 1);
  assert.equal((busy.out.match(/^reservation:/gm) || []).length, 1, busy.out);
});

test('smoke: against the live Mac it gives an answer (0 or 1), never a usage error', () => {
  const r = spawnSync('bash', [TOOL], { encoding: 'utf8', env: { ...process.env, KOSMOS_HG_SNAPSHOT: '', KOSMOS_HG_CLAIM: FREE } });
  assert.ok(r.status === 0 || r.status === 1, 'exit ' + r.status + ': ' + r.stdout + r.stderr);
  assert.match(r.stdout, /^reservation:/m);
});
