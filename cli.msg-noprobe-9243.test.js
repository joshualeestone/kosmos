'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9243: after a direct message that timed out or was not confirmed, both CLIs point at the receipt, never at
 * "check with them" (the probe #9240 removed). The same sentences in install/kosmos and tools/windows/kosmos-cli.js, read
 * as text: these outcomes need a board that times out or answers unconfirmed, and the words are what this card is about.
 *
 *   node --test cli.msg-noprobe-9243.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAC = fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8');
const WIN = fs.readFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js'), 'utf8');

/* The two endings a maybe outcome can take: wait for their answer, or (a --no-reply send) do not send it again. Both CLIs
   join them to the same openings; the run-level tests in cli.busy-health-4466 and tools.windows-kosmos-cli-busy-4466
   check the whole sentences as printed. */
const AFTER_WAIT = 'with no id, kosmos msg --status cannot check it, so wait for their answer before sending it again.';
const AFTER_NOREPLY = 'with no id, kosmos msg --status cannot check it, and you asked for no reply, so do not send it again.';
const OPEN_TIMEOUT = 'Kosmos was slow to answer and we stopped waiting. The message may have been delivered; ';
const OPEN_RETRIED = 'Kosmos did not answer, and did not answer when asked once more. The message may have been delivered; ';
const UNCONFIRMED_WAIT = '. Do not send it again: if an id is shown, kosmos msg --status says later whether they read it; if not, wait for their answer.';
const UNCONFIRMED_NOREPLY = '. Do not send it again: if an id is shown, kosmos msg --status says later whether they read it.';

test('#9243: both CLIs carry the same openings and both endings for a direct message that may have arrived', () => {
  for (const [name, src] of [['install/kosmos', MAC], ['tools/windows/kosmos-cli.js', WIN]]) {
    for (const part of [AFTER_WAIT, AFTER_NOREPLY, OPEN_TIMEOUT, OPEN_RETRIED, UNCONFIRMED_WAIT, UNCONFIRMED_NOREPLY]) {
      assert.ok(src.includes(part), name + ' lost: ' + part);
    }
  }
});

test('#9243: no direct-message outcome tells the sender to check with them (the probe)', () => {
  for (const [name, src] of [['install/kosmos', MAC], ['tools/windows/kosmos-cli.js', WIN]]) {
    assert.doesNotMatch(src, /delivered; check with them before sending it again/, name + ' still sends the sender to check with them');
    assert.doesNotMatch(src, /Do not re-send; check with them/, name + ' still says check with them when unconfirmed');
  }
  // CONTROL: the pattern can match; it does on the line this card replaced.
  assert.match('The message may have been delivered; check with them before sending it again.', /delivered; check with them before sending it again/);
});
