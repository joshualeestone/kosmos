'use strict';
/*
 * kosmos#2037 slice 2: the `kosmos feedback` CLI write path. An agent authors its
 * daily product-feedback report into the LOCAL store (engine/feedback.js),
 * engine-direct (no board API), so it works with NO board running.
 *
 * The harness fakes the installed layout the CLI expects: KOSMOS_HOME with
 * runtime/bin/node -> this node, and app/engine -> the real engine dir (so
 * feedback.js and its requires resolve), plus a sandboxed AGENT_WORKFORCE_DATA
 * for the store. KOSMOS_PORT=9 (dead) proves the verb needs no board: a network
 * verb would print "not running"; feedback must not.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-feedback-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  // The REAL engine, so feedback.js + its requires (store, ping) resolve.
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'app', 'engine'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-feedback-data-'));
  return { home, data };
}

function run(args, { home, data }, input) {
  return new Promise((resolve) => {
    const env = { ...process.env, KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: data, KOSMOS_PORT: '9' };
    const child = execFile('bash', [CLI, ...args], { env, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}`, err: `${stderr}`, both: `${stdout}${stderr}` });
    });
    if (input != null) { child.stdin.write(input); child.stdin.end(); }
  });
}

test('feedback write (arg) then show round-trips the body, with NO board running', async () => {
  const h = makeHome();
  const w = await run(['feedback', 'write', 'The + button did nothing. Suggestion: label it.'], h);
  assert.equal(w.code, 0, `write failed: ${w.both}`);
  assert.doesNotMatch(w.both, /not running/, 'the write path must not touch the board');
  const s = await run(['feedback', 'show'], h);
  assert.equal(s.code, 0);
  assert.match(s.out, /The \+ button did nothing\./);
});

test('feedback write reads the body from STDIN when no args are given', async () => {
  const h = makeHome();
  const md = '## Did not work\n- X\n\n## Suggestions\n- Y';
  const w = await run(['feedback', 'write'], h, md);
  assert.equal(w.code, 0, `write failed: ${w.both}`);
  const s = await run(['feedback', 'show'], h);
  assert.match(s.out, /## Suggestions/);
  assert.match(s.out, /- Y/);
});

test('feedback write with an empty/whitespace body is refused (exit 2), nothing saved', async () => {
  const h = makeHome();
  const w = await run(['feedback', 'write'], h, '   \n  ');
  assert.equal(w.code, 2);
  assert.match(w.both, /needs a body/);
  const l = await run(['feedback', 'list'], h);
  assert.equal(l.out.trim(), '', 'a refused write still created a report');
});

test('feedback list shows the days that have a report', async () => {
  const h = makeHome();
  await run(['feedback', 'write', 'todays note'], h);
  const l = await run(['feedback', 'list'], h);
  assert.equal(l.code, 0);
  assert.match(l.out, /^\d{4}-\d{2}-\d{2}$/m);
});

test('feedback show with a malformed date is refused (exit 2)', async () => {
  const h = makeHome();
  const s = await run(['feedback', 'show', '../../etc/passwd'], h);
  assert.equal(s.code, 2);
  assert.match(s.both, /YYYY-MM-DD/);
});

test('feedback show for a day with no report exits 1 (not a crash)', async () => {
  const h = makeHome();
  const s = await run(['feedback', 'show', '2020-01-01'], h);
  assert.equal(s.code, 1);
  assert.match(s.both, /no product-feedback report/);
});

test('bare feedback prints usage (exit 2)', async () => {
  const h = makeHome();
  const u = await run(['feedback'], h);
  assert.equal(u.code, 2);
  assert.match(u.both, /kosmos feedback write/);
});
