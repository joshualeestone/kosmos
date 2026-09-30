'use strict';
/* #4588: an Antigravity agent paused on its account's shared Google quota says when the quota resets, not only that
   it hit a limit. stateReason is lifted from the page (the same way web.pane-title-status.test.js does). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const reasonOf = (a, opts) => new Function('a', 'opts', `${page.lift(SCRIPT, 'quotaResetWords')}\n${page.lift(SCRIPT, 'stateReason')}\nreturn stateReason(a, opts);`)(a, opts);

test('#4588: a quota-paused card names when the quota resets, and its line quotes no raw API text', () => {
  // A reset in the near future, as a paused card carries (a fixed date goes stale and then gains a day, review 7).
  const until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
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
  // The page's own provider map, lifted as it is (a copy here would stay green if the page dropped antigravity).
  const map = /^const ASB_FALLBACK_PROVIDER = \{[^\n]*\};/m.exec(SCRIPT);
  assert.ok(map, 'the page defines ASB_FALLBACK_PROVIDER on one line');
  const wordsOf = (f) => new Function('f', `${map[0]}\n${page.lift(SCRIPT, 'asbFallbackWords')}\nreturn asbFallbackWords(f);`)(f);
  const agy = wordsOf({ problem: 'rate_limited', runner: 'antigravity' });
  assert.match(agy, /Your Google account/);
  assert.match(agy, /The Google quota refills by itself\./);
  assert.doesNotMatch(agy, /credits/);
  // CONTROL: every other runner keeps its existing advice.
  assert.match(wordsOf({ problem: 'rate_limited', runner: 'gemini' }), /Add credits with Gemini/);
});


test('#4588 (review 7): the page writes a reset time by the same rule as the engine, past and future', () => {
  const pageWords = new Function('at', 'now', `${page.lift(SCRIPT, 'quotaResetWords')}\nreturn quotaResetWords(at, now);`);
  const { quotaResetWords } = require('./engine/quotawords');
  const now = Date.parse('2026-09-30T07:00:00.000Z');
  const H = 3600 * 1000;
  for (const d of [-72 * H, -21 * H, -19 * H, -60000, 60000, 19 * H, 21 * H, 72 * H]) {
    assert.equal(pageWords(now + d, now), quotaResetWords(now + d, now), 'page and engine differ at ' + d / H + ' h');
  }
  // CONTROL: the rule is not constant: the day appears beyond 20 hours either way, and not within them.
  assert.notEqual(quotaResetWords(now + 21 * H, now), new Date(now + 21 * H).toLocaleString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }));
  assert.notEqual(quotaResetWords(now - 21 * H, now), new Date(now - 21 * H).toLocaleString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }));
  assert.equal(quotaResetWords(now + 19 * H, now), new Date(now + 19 * H).toLocaleString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }));
});
