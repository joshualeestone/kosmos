'use strict';
/**
 * kosmos#1955. `kosmos post` is text-only, and an agent asked to post a document
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
  return new Promise((resolve) => {
    execFile('bash', [CLI, ...args], { env: DEAD, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

test('#1955: `post <proj> --file X` says attachments are unsupported and never reaches the network', async () => {
  const r = await run(['post', 'someproj', '--file', '/tmp/findings.md']);
  assert.match(r.out, /not supported yet \(kosmos#1955\)/, 'the attach attempt did not get the honest message');
  assert.doesNotMatch(r.out, /not running/, 'it reached healthy(), so it was intercepted too late to prevent a literal-text post');
  assert.equal(r.code, 2, 'a refused attach should exit non-zero (usage/2), not silently');
});

test('#1955: `--attach` and the `=` forms are caught too', async () => {
  for (const args of [['post', 'p', '--attach', '/tmp/x'], ['post', 'p', '--file=/tmp/x'], ['post', 'p', '--attach=/tmp/x']]) {
    const r = await run(args);
    assert.match(r.out, /not supported yet \(kosmos#1955\)/, `not caught: ${args.join(' ')}`);
    assert.doesNotMatch(r.out, /not running/, `reached the network: ${args.join(' ')}`);
  }
});

test('#1955 CONTROL: a real text message is NOT intercepted and still reaches the send path', async () => {
  const r = await run(['post', 'someproj', 'here are my findings']);
  assert.doesNotMatch(r.out, /not supported yet \(kosmos#1955\)/, 'a plain text post was wrongly treated as an attach');
  assert.match(r.out, /not running/, 'a plain text post did not reach healthy(), so the guard intercepts too much');
});

test('#1955 edge: a message that merely MENTIONS --file (as one quoted arg) is text, not an attach', async () => {
  const r = await run(['post', 'someproj', 'use the --file flag to attach']);
  assert.doesNotMatch(r.out, /not supported yet \(kosmos#1955\)/, 'text containing "--file" was wrongly intercepted');
  assert.match(r.out, /not running/, 'the mention arm did not reach the send path');
});
