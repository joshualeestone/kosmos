'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9242 (rewritten from #1955's refusal, which this card replaces): `kosmos post <proj> --file X` now attaches the
 * file (the board decides which files may go; server.post-file-9242.test.js covers that on a real board). Here, at a dead
 * port: --file is taken as the flag and the post reaches the send path (never swept into the text), --attach and a bad
 * --file are refused before the network, and a quoted mention of --file stays text.
 *
 * The history, kept: kosmos#1955. `kosmos post` was text-only, and an agent asked to post a document
 * had no mechanism and no signal that one was missing -- an absent capability and
 * a disregarded request are indistinguishable from the operator's side. Worse,
 * `cmd_post` takes `text="$*"`, so `kosmos post <proj> --file findings.md` would
 * sweep `--file findings.md` into the message and post it as LITERAL room text.
 *
 * The immediate fix (Done #2 on the card): detect the attach attempt and say so
 * honestly, BEFORE reaching the network, so the agent learns the limit here. The
 * real attach capability is tracked as kosmos#1955 alongside kosmos#1943.
 *
 * 🛑 EVERY ARM PINS KOSMOS_PORT AT A DEAD PORT (the cli.help-flag-1674 pattern):
 * without it a regression would post real messages into whatever board is live on
 * the developer's machine. Port 9 (discard) is not listening, so `healthy()` fails
 * and any path that reaches the network says "not running" out loud -- which is
 * exactly what makes "was it intercepted BEFORE the network?" observable.
 *
 * ⭐ THE CONTROL ARM IS LOAD-BEARING. A guard that intercepted EVERYTHING would
 * pass the attach arms; the control proves a real text message is NOT intercepted
 * and still reaches the send path, so this file can tell the two apart.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const DEAD = { ...process.env, KOSMOS_PORT: '9' };

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('bash', [CLI, ...args], { env: DEAD, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): killed by the harness timeout, over the output buffer, or never started. ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` });
    });
  });
}

test('#9242: `post <proj> --file X` reaches the send path, the flag never swept into the text', async () => {
  const r = await run(['post', 'someproj', '--file', '/tmp/findings.md', 'here it is']);
  assert.match(r.out, /not running/, 'a post with a file did not reach the send path');
  assert.doesNotMatch(r.out, /not supported yet/, 'the old refusal is still there');
  const eq = await run(['post', 'someproj', '--file=/tmp/findings.md']);
  assert.match(eq.out, /not running/, 'the = form with no words did not reach the send path (a file needs no words)');
});

test('#9242: --attach is refused before the network, naming --file', async () => {
  for (const args of [['post', 'p', '--attach', '/tmp/x'], ['post', 'p', '--attach=/tmp/x']]) {
    const r = await run(args);
    assert.match(r.out, /use --file/, `not refused: ${args.join(' ')}`);
    assert.doesNotMatch(r.out, /not running/, `reached the network: ${args.join(' ')}`);
    assert.equal(r.code, 2);
  }
});

test('#9242: a bad --file is refused before the network (twice, no path, a flag as the path)', async () => {
  for (const [args, why] of [[['post', 'p', '--file', '/tmp/a', '--file', '/tmp/b', 'x'], /given twice/],
    [['post', 'p', 'x', '--file'], /needs the path of the file/], [['post', 'p', '--file', '--new', 'x'], /needs the path of the file/]]) {
    const r = await run(args);
    assert.match(r.out, why, args.join(' '));
    assert.doesNotMatch(r.out, /not running/, `reached the network: ${args.join(' ')}`);
    assert.equal(r.code, 2);
  }
});

test('#9242: a project-omitted post (`post --file X`) prints the usage, never posts with "--file" as the project', async () => {
  const r = await run(['post', '--file', '/tmp/findings.md']);
  assert.match(r.out, /Usage: kosmos post/);
  assert.doesNotMatch(r.out, /not running/);
});

test('#9242 CONTROL: a plain text post reaches the send path; a message that merely MENTIONS --file (one quoted arg) is text', async () => {
  const r = await run(['post', 'someproj', 'here are my findings']);
  assert.match(r.out, /not running/);
  const m = await run(['post', 'someproj', 'use the --file flag to attach']);
  assert.match(m.out, /not running/, 'the mention was not text');
});
