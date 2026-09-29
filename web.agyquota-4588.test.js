'use strict';
/* #4588: an Antigravity agent paused on its account's shared Google quota says WHEN Kosmos resumes it, not only
   that it hit a limit. stateReason is lifted from the page (the same way web.pane-title-status.test.js does). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const reasonOf = (a, opts) => new Function('a', 'opts', `${page.lift(SCRIPT, 'stateReason')}\nreturn stateReason(a, opts);`)(a, opts);

test('#4588: a quota-paused card names when the quota resets (the grid path), and the detail path quotes no raw API text', () => {
  const until = '2026-09-28T22:11:54.000Z';
  const hhmm = new Date(Date.parse(until)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  // The shape a real card has: reported, with the engine's own sentence as its because (status.js).
  const card = { state: 'rate_limited', stateConfidence: 'structured', stateReported: true, quotaUntil: until,
    because: "its Google account's shared Antigravity quota ran out; it resets at " + hhmm };
  assert.equal(reasonOf(card, { noQuote: true }), 'Usage limit reached. The Google quota resets at ' + hhmm + '.');
  const detail = reasonOf(card);
  assert.match(detail, /resets at/);
  assert.doesNotMatch(detail, /RESOURCE_EXHAUSTED|Resets in|Kosmos resumes/);
});

test('#4588: CONTROLS: no quotaUntil, or an unreadable one, keeps the existing wording', () => {
  assert.equal(reasonOf({ state: 'rate_limited', stateConfidence: 'reported' }), 'Usage limit reached');
  assert.equal(reasonOf({ state: 'rate_limited', stateConfidence: 'scraped', quotaUntil: null }), 'Looks like a usage limit');
  assert.equal(reasonOf({ state: 'rate_limited', stateConfidence: 'reported', quotaUntil: 'soon' }), 'Usage limit reached');
  assert.equal(reasonOf({ state: 'idle', quotaUntil: '2026-09-28T22:11:54.000Z' }), '', 'only a paused card says it');
});

test('#4588: the guide fallback does not tell an Antigravity guide to add credits (review 4)', () => {
  const wordsOf = (f) => new Function('f', `${page.lift(SCRIPT, 'asbFallbackWords').replace(/^/, `const ASB_FALLBACK_PROVIDER = { codex: 'OpenAI', gemini: 'Gemini', grok: 'Grok', antigravity: 'Google' };\n`)}\nreturn asbFallbackWords(f);`)(f);
  const agy = wordsOf({ problem: 'rate_limited', runner: 'antigravity' });
  assert.match(agy, /Google quota refills by itself/);
  assert.doesNotMatch(agy, /credits/);
  // CONTROL: every other runner keeps its existing advice.
  assert.match(wordsOf({ problem: 'rate_limited', runner: 'gemini' }), /Add credits with Gemini/);
});

