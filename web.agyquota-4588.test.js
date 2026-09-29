'use strict';
/* #4588: an Antigravity agent paused on its account's shared Google quota says WHEN Kosmos resumes it, not only
   that it hit a limit. stateReason is lifted from the page (the same way web.pane-title-status.test.js does). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const reasonOf = (a) => new Function('a', `${page.lift(SCRIPT, 'stateReason')}\nreturn stateReason(a);`)(a);

test('#4588: a quota-paused card names the time Kosmos resumes it', () => {
  const until = '2026-09-28T22:11:54.000Z';
  const want = 'Usage limit reached. Kosmos resumes it at '
    + new Date(Date.parse(until)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.';
  assert.equal(reasonOf({ state: 'rate_limited', stateConfidence: 'structured', quotaUntil: until }), want);
});

test('#4588: CONTROLS: no quotaUntil, or an unreadable one, keeps the existing wording', () => {
  assert.equal(reasonOf({ state: 'rate_limited', stateConfidence: 'reported' }), 'Usage limit reached');
  assert.equal(reasonOf({ state: 'rate_limited', stateConfidence: 'scraped', quotaUntil: null }), 'Looks like a usage limit');
  assert.equal(reasonOf({ state: 'rate_limited', stateConfidence: 'reported', quotaUntil: 'soon' }), 'Usage limit reached');
  assert.equal(reasonOf({ state: 'idle', quotaUntil: '2026-09-28T22:11:54.000Z' }), '', 'only a paused card says it');
});
