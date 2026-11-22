'use strict';
/*
 * kosmos#8896: `kosmos feedback note` adds a short note to a report this agent already wrote, kept with it and marked
 * as added later, without rewriting it. The harness is cli.feedback-2037's: an installed layout pointing at the real
 * engine, a throwaway data folder, a dead board port and a dead loopback collector, and no token or tmux window, so
 * the writer is the unnamed one.
 */
require('./test-support/tmpscope'); // this process's temp folders, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbnote-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(__dirname, 'engine'), path.join(home, 'app', 'engine'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbnote-data-'));
  return { home, data };
}

function run(args, { home, data }, input) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: data, KOSMOS_PORT: '9',
      AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback', KOSMOS_AGENT_TOKEN: '', TMUX: '', TMUX_PANE: '' };
    const child = execFile('bash', [CLI, ...args], { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + ')')); return; }
      resolve({ code: err ? err.code : 0, out: `${stdout}`, both: `${stdout}${stderr}` });
    });
    if (input != null) { child.stdin.write(input); child.stdin.end(); } else child.stdin.end();
  });
}

test('feedback note adds a line to today\'s report, after "Added later (... UTC):", and show reads it', async () => {
  const h = makeHome();
  assert.equal((await run(['feedback', 'write', 'The + button did nothing.'], h)).code, 0);
  const n = await run(['feedback', 'note', 'It works after a restart.'], h);
  assert.equal(n.code, 0, n.both);
  assert.match(n.out, /^\s*Added the note to today's product-feedback report/, n.out);
  assert.doesNotMatch(n.out, /kosmos feedback write/, 'a note was told to write the report again, which would replace it');
  assert.doesNotMatch(n.both, /SAVED/, 'the save line leaked into what the agent reads');
  const s = await run(['feedback', 'show'], h);
  assert.match(s.out, /^The \+ button did nothing\.\n\nAdded later \(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\):\nIt works after a restart\.\n$/, s.out);
});

test('the note text can be piped in, or given with --body-file', async () => {
  const h = makeHome();
  await run(['feedback', 'write', 'report'], h);
  assert.equal((await run(['feedback', 'note'], h, 'piped line\n')).code, 0);
  const f = path.join(h.home, 'note.txt');
  fs.writeFileSync(f, 'from a file');
  const b = await run(['feedback', 'note', '--body-file', f], h);
  assert.equal(b.code, 0, b.both);
  const s = (await run(['feedback', 'show'], h)).out;
  assert.match(s, /\npiped line\n/);
  assert.match(s, /\nfrom a file\n$/);
});

test('an earlier day: --date adds to that day\'s report and says it stays on this computer', async () => {
  const h = makeHome();
  assert.equal((await run(['feedback', 'show', '2026-11-05'], h)).out.trim(), 'No product-feedback report for 2026-11-05 yet.');
  // Write that day's report through the engine (the CLI's write is today's, or --unchanged's day).
  const fb = path.join(__dirname, 'engine', 'feedback.js');
  const w = require('node:child_process').spawnSync(process.execPath, ['-e', `require(${JSON.stringify(fb)}).write('old report', { date: '2026-11-05' })`],
    { env: { ...process.env, AGENT_WORKFORCE_DATA: h.data } });
  assert.equal(w.status, 0, String(w.stderr));
  const n = await run(['feedback', 'note', '--date', '2026-11-05', 'a correction'], h);
  assert.equal(n.code, 0, n.both);
  // A fresh store has sent nothing, so that day is not the last one sent: it stays here (engine/feedbacksend-note-8896 covers the day that does go).
  assert.match(n.out, /^\s*Added the note to your report of 2026-11-05, on this computer\. Kosmos sends an earlier day only when it is the last day it sent, and this one is not, so this note stays here\./);
  assert.match((await run(['feedback', 'show', '2026-11-05'], h)).out, /^old report\n\nAdded later \(.*UTC\):\na correction\n$/);
});

test('refusals save nothing and say why', async () => {
  const h = makeHome();
  const none = await run(['feedback', 'note', 'x'], h);
  assert.equal(none.code, 2);
  assert.match(none.out, /There is no report of yours for today to add a note to, so nothing was saved\. Write today's report with kosmos feedback write, or add --date YYYY-MM-DD/);
  const noneDay = await run(['feedback', 'note', '--date', '2026-11-01', 'x'], h);
  assert.equal(noneDay.code, 2);
  assert.match(noneDay.out, /There is no report of yours for 2026-11-01 to add a note to, so nothing was saved\./);
  assert.doesNotMatch(noneDay.out, /kosmos feedback write/, 'write cannot make an earlier day\'s report');
  assert.match((await run(['feedback', 'show'], h)).out, /No product-feedback report for/, 'a refused note created a report');
  await run(['feedback', 'write', 'report'], h);
  const before = (await run(['feedback', 'show'], h)).out;
  const empty = await run(['feedback', 'note', '   '], h);
  assert.equal(empty.code, 2);
  assert.match(empty.out, /Nothing to add: a note needs some words/);
  const future = await run(['feedback', 'note', '--date', '2099-01-01', 'x'], h);
  assert.equal(future.code, 2);
  assert.match(future.out, /--date must be a real day, as YYYY-MM-DD, and not after today/);
  const bad = await run(['feedback', 'note', '--date', '../etc', 'x'], h);
  assert.equal(bad.code, 2);
  assert.match(bad.out, /--date must be a real day, as YYYY-MM-DD, and not after today/);
  const blank = await run(['feedback', 'note', '--date', '', 'x'], h);
  assert.equal(blank.code, 2, 'an empty --date was taken as today');
  assert.match(blank.out, /--date needs a day, as YYYY-MM-DD\./);
  const opt = await run(['feedback', 'note', '--loud', 'x'], h);
  assert.equal(opt.code, 2);
  assert.match(opt.out, /--loud is not an option of kosmos feedback note/);
  const noval = await run(['feedback', 'note', '--date', '--loud'], h);
  assert.equal(noval.code, 2);
  assert.match(noval.out, /--date needs a value, and --loud is an option/);
  assert.equal((await run(['feedback', 'show'], h)).out, before, 'a refused note changed the report');
});

test('words after -- are text, even when they start with --', async () => {
  const h = makeHome();
  await run(['feedback', 'write', 'report'], h);
  const n = await run(['feedback', 'note', '--', '--date was wrong in my report'], h);
  assert.equal(n.code, 0, n.both);
  assert.match((await run(['feedback', 'show'], h)).out, /\n--date was wrong in my report\n$/);
});

test('--unchanged, refused because a report exists today, now names feedback note', async () => {
  const h = makeHome();
  await run(['feedback', 'write', 'today\'s report'], h);
  const u = await run(['feedback', 'write', '--unchanged', 'one more'], h);
  assert.equal(u.code, 2);
  assert.match(u.out, /To add a line to it, run: kosmos feedback note 'the line'\./, u.out);
});

test('help lists feedback note', async () => {
  const h = makeHome();
  assert.match((await run(['feedback', 'help'], h)).out, /kosmos feedback note \[--date YYYY-MM-DD\] \[--body-file <file>\] \[text\]/);
});

test('CONTROL: the report the CLI writes lands in the throwaway data folder', async () => {
  const h = makeHome();
  await run(['feedback', 'write', 'report'], h);
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\/feedback\/\d{4}-\d{2}-\d{2}\.md$/.test(p)) found.push(p); } };
  walk(h.data);
  assert.equal(found.length, 1, JSON.stringify(found));
});
