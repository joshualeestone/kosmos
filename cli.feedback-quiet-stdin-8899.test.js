'use strict';
/*
 * kosmos#8899: on the Mac, `kosmos feedback write` and `kosmos feedback note` with no words read their body from stdin by
 * a bare $(cat), so an open pipe nobody writes to waited for ever. The Windows CLI and the Mac --unchanged reader (#8844)
 * already stop once the input ends or has been quiet for 3 seconds. Now both Mac verbs do too (_read_stdin_quiet):
 * a silent pipe is an empty body, refused as before; a body that stops without ending is refused as maybe cut short;
 * a body piped in whole is saved as before (CONTROLS). Nothing is saved on a refusal.
 *
 * The real CLI and the real engine against a throwaway data folder (the #8844 harness), sending to a dead loopback.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const OLD = '2020-01-02';
const fbDir = (data) => path.join(data, 'Kosmos', 'feedback');

function makeHome({ earlier = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbquiet-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'app', 'engine'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbquiet-data-'));
  if (earlier) {
    fs.mkdirSync(fbDir(data), { recursive: true });
    fs.writeFileSync(path.join(fbDir(data), OLD + '.md'), '---\ndate: ' + OLD + '\n---\n\nthe earlier report\n');
  }
  return { home, data };
}

/* stdin: a string is written and the pipe closed; { partial } is written and the pipe left OPEN; { open: true } writes
   nothing and leaves the pipe open. The pipe is closed after the CLI exits, so an open case can never leak. */
function run(args, { home, data }, stdin) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: data, KOSMOS_PORT: '9',
      AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback', KOSMOS_AGENT_TOKEN: '', TMUX: '', TMUX_PANE: '' };
    const started = Date.now();
    const child = spawn('bash', [CLI, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let both = '';
    child.stdout.on('data', (d) => { both += d; });
    child.stderr.on('data', (d) => { both += d; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('error', reject);
    child.on('close', (exitCode, signal) => {
      clearTimeout(killer);
      try { child.stdin.destroy(); } catch {}
      const res = { code: exitCode, both, ms: Date.now() - started };
      if (typeof res.code !== 'number') { reject(new Error('the CLI gave no exit code (' + signal + ') after ' + res.ms + ' ms: it hung')); return; }
      resolve(res);
    });
    child.stdin.on('error', () => {});
    if (typeof stdin === 'string') child.stdin.end(stdin);
    else if (stdin && typeof stdin.partial === 'string') child.stdin.write(stdin.partial);
    else if (!(stdin && stdin.open)) child.stdin.end();
  });
}

const todays = (data) => { try { return fs.readdirSync(fbDir(data)).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n) && n !== OLD + '.md'); } catch { return []; } };
const savedBody = (data) => {
  const t = todays(data);
  assert.equal(t.length, 1, 'expected one report for today, found ' + JSON.stringify(t));
  return fs.readFileSync(path.join(fbDir(data), t[0]), 'utf8');
};
const QUIET_MS = 3000;

test('kosmos#8899: feedback write with an open, silent pipe ends within the quiet limit and saves nothing', async () => {
  const h = makeHome({ earlier: false });
  const r = await run(['feedback', 'write'], h, { open: true });
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /Nothing was saved: nothing arrived on stdin for 3 seconds\. If the report comes from a slow command, save it in a file first/);   // review 3
  assert.doesNotMatch(r.both, /pipe it in on stdin/, 'a person whose command was slow to start was told to pipe it in');
  assert.ok(r.ms < QUIET_MS + 8000, 'it took ' + r.ms + ' ms');
  assert.deepEqual(todays(h.data), [], 'a report was saved');
});

test('kosmos#8899: feedback write refuses a piped report that stops without ending, and saves nothing', async () => {
  const h = makeHome({ earlier: false });
  const r = await run(['feedback', 'write'], h, { partial: 'the first half of a report' });
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /Nothing was saved: the piped report stopped arriving for 3 seconds without ending, so it may be cut short/);
  assert.deepEqual(todays(h.data), [], 'a cut-short report was saved');
});

test('kosmos#8899 CONTROL: feedback write saves a report piped in whole, as before', async () => {
  const h = makeHome({ earlier: false });
  const r = await run(['feedback', 'write'], h, 'a whole report piped in\n');
  assert.equal(r.code, 0, r.both);
  assert.match(savedBody(h.data), /a whole report piped in/);
});

async function withTodaysReport() {
  const h = makeHome({ earlier: false });
  const w = await run(['feedback', 'write', 'the report for today'], h, '');
  assert.equal(w.code, 0, w.both);
  return { h, before: savedBody(h.data) };
}

test('kosmos#8899: feedback note with an open, silent pipe ends within the quiet limit and adds nothing', async () => {
  const { h, before } = await withTodaysReport();
  const r = await run(['feedback', 'note'], h, { open: true });
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /Nothing was saved: nothing arrived on stdin for 3 seconds\. Give the note as words/);   // review 3
  assert.ok(r.ms < QUIET_MS + 8000, 'it took ' + r.ms + ' ms');
  assert.equal(savedBody(h.data), before, 'the report changed');
});

test('kosmos#8899: feedback note refuses a piped note that stops without ending, and adds nothing', async () => {
  const { h, before } = await withTodaysReport();
  const r = await run(['feedback', 'note'], h, { partial: 'half a note' });
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /Nothing was saved: the piped note stopped arriving for 3 seconds without ending, so it may be cut short/);
  assert.equal(savedBody(h.data), before, 'a cut-short note was added');
});

test('kosmos#8899 CONTROL: feedback note adds a note piped in whole, as before', async () => {
  const { h } = await withTodaysReport();
  const r = await run(['feedback', 'note'], h, 'a note piped in whole\n');
  assert.equal(r.code, 0, r.both);
  assert.match(savedBody(h.data), /a note piped in whole/);
});

/* Review 1: only white space, then quiet, is an empty body (as on Windows), not a report cut short. */
test('kosmos#8899 review 1: feedback write given only white space on an open pipe says there is no body, not cut short', async () => {
  const h = makeHome({ earlier: false });
  const r = await run(['feedback', 'write'], h, { partial: '  \n' });
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /Nothing to write: a feedback report needs a body/);
  assert.doesNotMatch(r.both, /may be cut short/);
  assert.deepEqual(todays(h.data), []);
});

/* Review 3 CONTROL: a pipe that ENDS with nothing in it is still the plain empty-body refusal, not "nothing arrived". */
test('kosmos#8899 review 3 CONTROL: an empty pipe that ends at once still says the report needs a body', async () => {
  const h = makeHome({ earlier: false });
  const r = await run(['feedback', 'write'], h, '');
  assert.equal(r.code, 2, r.both);
  assert.match(r.both, /Nothing to write: a feedback report needs a body/);
  assert.doesNotMatch(r.both, /nothing arrived on stdin/);
  assert.ok(r.ms < 3000, 'an ended pipe waited for the quiet limit (' + r.ms + ' ms)');
});
