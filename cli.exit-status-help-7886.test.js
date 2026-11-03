'use strict';
/**
 * kosmos#7886 item 1. A room post that went through but could not confirm every member exits 3, and an agent read that
 * as a failure, which invites the re-post its own words warn against. 3 stays 3 (the Mac CLI and the Windows CLI share
 * it), and the top-level help now says what each exit status means.
 *
 * Held here: both CLIs' help names 0, 1, 2 and 3 in the SAME words, and the post outcome that exits 3 still does on both
 * (the control: if that outcome stopped exiting 3, the help would describe a code nothing returns for it).
 *
 * The Mac arm pins KOSMOS_PORT at a dead port (9, discard), as cli.help-lines-4785.test.js does.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const cli = require('./tools/windows/kosmos-cli');

const CLI = path.join(__dirname, 'install', 'kosmos');
const DEAD = { ...process.env, KOSMOS_PORT: '9' };
const SENTENCE = 'Most commands end with exit status 0 when it was done, 1 when it was not, 2 when the command was not '
  + 'written right (its usage says how), and 3 when the answer is not a plain yes or no: usually it went through, or may have, '
  + 'so read what it printed before you send it again. A few use other numbers too.';

function macHelp() {
  return new Promise((resolve, reject) => {
    execFile('bash', [CLI, 'help'], { env: DEAD, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code')); return; }
      resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` });
    });
  });
}

test('kosmos#7886: the Mac help says what each exit status means', async () => {
  const r = await macHelp();
  assert.equal(r.code, 0);
  // The Mac wraps the sentence over three printed lines; joined, it must read exactly as the Windows one.
  const joined = r.out.split('\n').map((l) => l.trim()).join(' ').replace(/\s+/g, ' ');
  assert.ok(joined.includes(SENTENCE), 'the exit-status sentence is missing from the Mac help');
});

test('kosmos#7886: the Windows help says the same, word for word', async () => {
  const lines = [];
  const code = await cli.main(['help'], { out: (s) => lines.push(s), err: (s) => lines.push(s) });
  assert.equal(code, 0);
  assert.ok(lines.includes(SENTENCE), 'the exit-status sentence is missing from the Windows help');
});

test('kosmos#7886 control: the unconfirmed post outcome the help describes still exits 3 on the Mac', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const start = src.indexOf('\'{"delivery":{"state":"unconfirmed"\'*)');
  assert.ok(start > 0, 'the unconfirmed post branch was not found');
  const end = src.indexOf('\n      ;;', start);
  assert.match(src.slice(start, end), /\n\s+exit 3$/, 'the unconfirmed post no longer exits 3');
});

test('kosmos#7886 control: the unconfirmed post outcome exits 3 on Windows too', async () => {
  const err = [];
  const code = await cli.main(['post', 'proj-1', 'hello'], {
    env: { KOSMOS_AGENT_TOKEN: 'ab'.repeat(32) },
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'cd'.repeat(32), agentToken: (env) => env.KOSMOS_AGENT_TOKEN },
    out: () => {}, err: (s) => err.push(s),
    fetch: async () => ({ status: 200, text: async () => JSON.stringify({ delivery: { state: 'unconfirmed', because: null, outcomes: { mara: 'unconfirmed' } } }) }),
  });
  assert.equal(code, 3, 'Windows: ' + err.join(' | '));
  assert.match(err.join('\n'), /Posted, but not everyone is confirmed/);
});
