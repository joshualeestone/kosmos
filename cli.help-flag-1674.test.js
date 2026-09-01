'use strict';
/**
 * kosmos#1674. `kosmos reply --help` did not print help: it SENT "--help" as a
 * message and answered "Answered. It is in their conversation with you."
 * `cmd_reply` takes `text="$*"`, so every argument is the message. `report
 * --help` likewise tried to record a state.
 *
 * ⚠️ `msg` and `post` were safe ONLY BY ACCIDENT: they need two arguments, so a
 * lone flag lands in their usage branch. `kosmos msg <agent> --help` sent it
 * just the same, and that case is asserted below because it is the one a reader
 * assumes is already covered.
 *
 * 🛑 EVERY ARM PINS KOSMOS_PORT AT A DEAD PORT. Without it a regression in the
 * guard would make this suite SEND REAL MESSAGES to whatever board is running on
 * the developer's machine, which is exactly the defect under test. I sent
 * "--help" into a live conversation twice while investigating this card; the
 * test must not be able to do it a third time.
 *
 * ⭐ THE LAST CASE IS LOAD-BEARING. A guard that intercepted EVERYTHING would
 * pass the first three, so the control proves the send path is still reachable
 * and that this file can see it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
/* Port 9 (discard) is not listening, so `healthy()` fails and any code path that
   reaches the network says so out loud. That is what makes "did it send?"
   observable without a stub. */
const DEAD = { ...process.env, KOSMOS_PORT: '9' };

function run(args) {
  return new Promise((resolve) => {
    execFile('bash', [CLI, ...args], { env: DEAD, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

test('#1674: `reply --help` prints usage and never reaches the network', async () => {
  const r = await run(['reply', '--help']);
  assert.match(r.out, /Usage: kosmos reply/, 'reply --help does not print its usage');
  assert.doesNotMatch(r.out, /Answered\./, 'reply --help SENT the flag as a message, which is the defect');
  assert.doesNotMatch(r.out, /not running/, 'reply --help reached healthy(), so the guard ran too late to prevent a send');
});

test('#1674: `report --help` prints usage instead of trying to record a state', async () => {
  const r = await run(['report', '--help']);
  assert.match(r.out, /Usage: kosmos report/, 'report --help does not print its usage');
  assert.doesNotMatch(r.out, /not a state we know/, 'report --help still reached the state parser');
});

test('#1674: the two-argument verbs, safe only by accident, are now safe on purpose', async () => {
  /* `msg --help` always printed usage because `text` was empty. This is the
     other shape: a target AND the flag, which used to send. */
  const r = await run(['msg', 'zzq-cannot-exist', '--help']);
  assert.match(r.out, /Usage: kosmos msg/, 'msg <agent> --help does not print usage');
  assert.doesNotMatch(r.out, /not running/, 'msg <agent> --help reached the network, so it would have sent');
});

test('#1674: a bare -h or --help prints the verb list and exits 0', async () => {
  for (const flag of ['--help', '-h']) {
    const r = await run([flag]);
    assert.match(r.out, /kosmos start \| stop \| restart/, `${flag} does not print the verb list`);
    assert.equal(r.code, 0, `${flag} exits ${r.code}, and asking for help is not an error`);
  }
});

test('#1674 CONTROL: a real send still reaches the network, so the arms above mean something', async () => {
  /* Without this, a guard that swallowed EVERY invocation would pass all four
     tests above. This proves the send path is intact and that this file can
     observe it. It stays at the dead port, so nothing is delivered. */
  const r = await run(['reply', 'a real message']);
  assert.match(r.out, /not running/, 'the send path no longer reaches the network, so the arms above prove nothing');
});
