'use strict';
/*
 * kosmos#8896: the Windows `kosmos feedback note`, run as the shipped CLI file in a process on its own data root (the
 * harness tools.windows-kosmos-cli-verbs.test.js uses for feedback), with a dead loopback collector, and no token or
 * tmux window, so the writer is the unnamed one. The same behaviour as install/kosmos (cli.feedback-note-8896.test.js).
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const CLI_FILE = path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js');
const FB = path.join(__dirname, 'engine', 'feedback');

function home() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win-fbnote-'));
  const env = Object.assign({}, process.env, { AGENT_WORKFORCE_DATA: root, AGENT_WORKFORCE_FEEDBACK_URL: 'http://127.0.0.1:9/api/feedback',
    KOSMOS_AGENT_TOKEN: '', TMUX: '', TMUX_PANE: '' });
  delete env.KOSMOS_WORLD;
  const cli = (args, input) => {
    const r = cp.spawnSync(process.execPath, [CLI_FILE, ...args], { env, input: input === undefined ? '' : input, encoding: 'utf8', timeout: 60000 });
    return { code: r.status, out: String(r.stdout).replace(/\r?\n$/, ''), err: String(r.stderr).replace(/\r?\n$/, '') };
  };
  const plant = (body, date) => {
    const r = cp.spawnSync(process.execPath, ['-e', 'require(process.argv[1]).write(process.argv[2], { date: process.argv[3] })', FB, body, date], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  return { cli, plant };
}

test('a note is added to today\'s report, marked as added later, and the send sentence never says to write again', () => {
  const { cli } = home();
  assert.equal(cli(['feedback', 'write', 'The + button did nothing.']).code, 0);
  const n = cli(['feedback', 'note', 'It works after a restart.']);
  assert.equal(n.code, 0, n.err);
  assert.match(n.out, /^Added the note to today's product-feedback report/, n.out);
  assert.doesNotMatch(n.out, /kosmos feedback write/, 'a note was told to write the report again, which would replace it');
  assert.match(cli(['feedback', 'show']).out, /^The \+ button did nothing\.\n\nAdded later \(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\):\nIt works after a restart\.$/);
});

test('--date adds to an earlier day\'s report, kept on this computer', () => {
  const { cli, plant } = home();
  plant('old report', '2026-11-05');
  const n = cli(['feedback', 'note', '--date', '2026-11-05', 'a correction']);
  assert.equal(n.code, 0, n.err);
  assert.equal(n.out, 'Added the note to your report of 2026-11-05, on this computer. Kosmos sends an earlier day only when it is the last day it sent, and this one is not, so this note stays here.');
  assert.match(cli(['feedback', 'show', '2026-11-05']).out, /^old report\n\nAdded later \(.* UTC\):\na correction$/);
});

test('refusals save nothing, on stderr, exit 2', () => {
  const { cli } = home();
  const none = cli(['feedback', 'note', 'x']);
  assert.equal(none.code, 2);
  assert.match(none.err, /There is no report of yours for today to add a note to, so nothing was saved\./);
  assert.equal(none.out, '');
  assert.equal(cli(['feedback', 'write', 'report']).code, 0);
  const before = cli(['feedback', 'show']).out;
  const future = cli(['feedback', 'note', '--date', '2099-01-01', 'x']);
  assert.equal(future.code, 2);
  assert.match(future.err, /--date must be a real day, as YYYY-MM-DD, and not after today/);
  for (const args of [['--date'], ['--date', '', 'x']]) {
    const r = cli(['feedback', 'note', ...args]);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.match(r.err, /--date needs a day, as YYYY-MM-DD\./, JSON.stringify(args));
  }
  const noval = cli(['feedback', 'note', '--date', '--loud']);
  assert.equal(noval.code, 2);
  assert.match(noval.err, /--date needs a value, and --loud is an option/);
  const opt = cli(['feedback', 'note', '--loud', 'x']);
  assert.equal(opt.code, 2);
  assert.match(opt.err, /--loud is not an option of kosmos feedback note/);
  assert.equal(cli(['feedback', 'show']).out, before, 'a refused note changed the report');
});

test('--unchanged, refused because a report exists today, names feedback note', () => {
  const { cli } = home();
  assert.equal(cli(['feedback', 'write', 'today\'s report']).code, 0);
  const u = cli(['feedback', 'write', '--unchanged', 'one more']);
  assert.equal(u.code, 2);
  assert.match(u.err, /To add a line to it, run: kosmos feedback note 'the line'\./);
});
