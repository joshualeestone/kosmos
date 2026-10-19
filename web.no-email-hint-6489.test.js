'use strict';
/**
 * #6489: the phone-notifications hint in Settings no longer promises a needs-you email. That email is built (the
 * coordinator's delivery.rs, sent by its notify.rs sweep) but sits behind KOSMOS_NEEDS_YOU_EMAIL, which is off in
 * production, so the sentence promised something that never happens. If the email is switched on in production,
 * put the sentence back and change this test with it.
 *
 *   node --test web.no-email-hint-6489.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('#6489: the phone hint does not promise an email', () => {
  assert.doesNotMatch(page, /may also send you an email/i);
  assert.doesNotMatch(page, /needed you for 30 minutes and nobody has answered/i);
});

test('#6489 control: the rest of the phone hint is still there', () => {
  // #6488: the hint now says it is on by default once connected.
  assert.match(page, /Kosmos\+ is told the agent's name, its project and the time, never what they said\. It is on once this computer is connected to Kosmos\+, unless you turn it off\. While it is on, choose below what buzzes your phone\.<\/p>/);
});
