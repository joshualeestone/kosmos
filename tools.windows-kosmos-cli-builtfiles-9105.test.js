'use strict';
require('./test-support/tmpscope');
/**
 * kosmos#9105: the Windows `kosmos task built` sends every --file (each fingerprinted, with its name) and --check <name>,
 * as install/kosmos does. A scripted board, as tools.windows-kosmos-cli-570.test.js uses.
 *
 *   node --test tools.windows-kosmos-cli-builtfiles-9105.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const cli = require('./tools/windows/kosmos-cli');

const AGENT = 'ab'.repeat(32);
const BOARD = 'cd'.repeat(32);
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => BOARD, agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };
async function run(argv, answer) {
  const calls = [];
  const out = [];
  const err = [];
  const code = await cli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT },
    hook: hookStub,
    driveInfo: () => ({ kind: 'local', share: null }),
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    fetch: async (url, init) => {
      calls.push({ route: url.replace('http://127.0.0.1:1', ''), body: init.body === undefined ? undefined : JSON.parse(init.body) });
      const a = answer ? answer() : { status: 200, body: {} };
      return { status: a.status || 200, text: async () => JSON.stringify(a.body) };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}
const sha = (s) => 'sha256:' + crypto.createHash('sha256').update(s).digest('hex');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builtfiles-win-9105-'));
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));
const REPORT = path.join(DIR, 'report.md');
const DATA = path.join(DIR, 'data.csv');
fs.mkdirSync(path.join(DIR, 'other'));
fs.writeFileSync(REPORT, 'the report\n');
fs.writeFileSync(DATA, 'a,b\n');
fs.writeFileSync(path.join(DIR, 'other', 'report.md'), 'another\n');
const newer = () => ({ body: { task: { number: 4, builtFiles: [] }, changed: true } });
const older = () => ({ body: { task: { number: 4 }, changed: true } });

test('#9105 Windows: --file twice sends both with names, the first also the older way, and prints each', async () => {
  const r = await run(['task', 'built', 'proj/1', '4', 'both', '--file', REPORT, '--file', DATA], newer);
  assert.equal(r.code, 0, r.err);
  const b = r.calls[0].body;
  assert.deepEqual(b.files, [{ name: 'report.md', fingerprint: sha('the report\n'), file_path: REPORT }, { name: 'data.csv', fingerprint: sha('a,b\n'), file_path: DATA }]);
  assert.equal(b.fingerprint, sha('the report\n'));
  assert.equal(b.file_path, REPORT);
  assert.equal(b.note, 'both');
  assert.match(r.out, new RegExp('Fingerprint sent: ' + sha('the report\n') + ' for '));
  assert.match(r.out, new RegExp('Fingerprint sent: ' + sha('a,b\n') + ' for '));
  assert.doesNotMatch(r.out, /kept only the first/);
  const old = await run(['task', 'built', 'proj/1', '4', 'both', '--file', REPORT, '--file', DATA], older);
  assert.match(old.out, /This Kosmos kept only the first file, .*report\.md: it may be older/);
});

test('#9105 Windows: CONTROL: one --file says exactly what it said before, and also sends files', async () => {
  const r = await run(['task', 'built', 'proj/1', '4', 'merged', '--file', REPORT], older);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'Marked task 4 on proj/1 built, waiting to be released or checked. Closing it clears the mark.\nFingerprint sent: ' + sha('the report\n') + ' for ' + REPORT);
  assert.equal(r.calls[0].body.files.length, 1);
});

test('#9105 Windows: --check sends the names; refusals never reach the board', async () => {
  const r = await run(['task', 'built', 'proj/1', '4', 'read it', '--check', 'data.csv', '--check', 'report.md'], newer);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.calls[0].body.check, ['data.csv', 'report.md']);
  assert.equal('files' in r.calls[0].body, false);
  for (const [argv, said] of [
    [['--check'], /--check needs the name/],
    [['--check', 'a/b'], /without its folder/],
    [['--check', 'x', '--file', REPORT], /takes no --file/],
    [['--clear', '--check', 'x'], /takes no --check/],
    [['--file', REPORT, '--file', path.join(DIR, 'other', 'report.md')], /Two files named report\.md/],
  ]) {
    const x = await run(['task', 'built', 'proj/1', '4', ...argv], newer);
    assert.equal(x.code, 2, argv.join(' ') + ': ' + x.err);
    assert.match(x.err, said, argv.join(' '));
    assert.equal(x.calls.length, 0, argv.join(' ') + ' reached the board');
  }
});

test('#9105 review 1 Windows: --check to a board that does not know it is said; a newer board says nothing', async () => {
  const old = await run(['task', 'built', 'proj/1', '4', 'read', '--check', 'data.csv'], older);
  assert.match(old.out, /does not know --check, so it counted this as a check of the file it keeps/);
  const now = await run(['task', 'built', 'proj/1', '4', 'read', '--check', 'data.csv'], newer);
  assert.doesNotMatch(now.out, /does not know --check/);
});

test('#9105 review 3 Windows: a no-op --check says nothing of an older board; a trailing dot is not part of a name', async () => {
  const same = await run(['task', 'built', 'proj/1', '4', 'read', '--check', 'data.csv'], () => ({ body: { task: { number: 4 }, changed: false } }));
  assert.doesNotMatch(same.out, /does not know --check/);
  // A file whose own name ends in a dot and a space (this Mac keeps them; Windows drops them when it opens one).
  const dot = path.join(DIR, 'odd.csv. ');
  fs.writeFileSync(dot, 'odd\n');
  const r = await run(['task', 'built', 'proj/1', '4', 'x', '--file', REPORT, '--file', dot], newer);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.calls[0].body.files[1].name, 'odd.csv', 'the trailing dot and space were kept in the name');
});
