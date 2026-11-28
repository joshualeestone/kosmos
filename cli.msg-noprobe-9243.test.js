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

const TIMEOUT = 'Kosmos was slow to answer and we stopped waiting. The message may have been delivered; with no id, kosmos msg --status cannot check it, so wait for their answer before sending it again.';
const RETRIED = 'Kosmos did not answer, and did not answer when asked once more. The message may have been delivered; with no id, kosmos msg --status cannot check it, so wait for their answer before sending it again.';
const UNCONFIRMED = '. Do not send it again: if an id is shown below, kosmos msg --status says later whether they read it; if not, wait for their answer.';

test('#9243: a timed-out direct message points at waiting for an answer, on both CLIs', () => {
  assert.ok(MAC.includes(TIMEOUT), 'install/kosmos lost the timeout sentence');
  assert.ok(WIN.includes(TIMEOUT), 'the Windows CLI lost the timeout sentence');
  assert.ok(WIN.includes(RETRIED), 'the Windows CLI lost the asked-once-more sentence');
});

test('#9243: an unconfirmed direct message points at msg --status, on both CLIs', () => {
  assert.ok(MAC.includes('Not confirmed: ${because:-the text may already be in their composer}' + UNCONFIRMED), 'install/kosmos lost the unconfirmed sentence');
  assert.ok(WIN.includes("'" + UNCONFIRMED + "'"), 'the Windows CLI lost the unconfirmed sentence');
});

test('#9243: no direct-message outcome tells the sender to check with them (the probe)', () => {
  for (const [name, src] of [['install/kosmos', MAC], ['tools/windows/kosmos-cli.js', WIN]]) {
    assert.doesNotMatch(src, /delivered; check with them before sending it again/, name + ' still sends the sender to check with them');
    assert.doesNotMatch(src, /Do not re-send; check with them/, name + ' still says check with them when unconfirmed');
  }
  // CONTROL: the pattern can match; it does on the line this card replaced.
  assert.match('The message may have been delivered; check with them before sending it again.', /delivered; check with them before sending it again/);
});
