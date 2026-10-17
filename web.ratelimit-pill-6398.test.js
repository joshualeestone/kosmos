'use strict';

/**
 * #6398 (Josh, via Liu Kang): a rate-limited agent read "Paused" in its status pill and carried a long
 * paragraph on the card face ("Kosmos has seen this agent paused by a rate limit for about XXX minutes. It
 * will keep trying when the limit lifts. You can wait, or switch its model."). Josh: reduce all that to a
 * "Rate Limit" pill where "Paused" was, and put the detail BEHIND the pill, not on the card.
 *
 * The mechanism: taskLine/stateReason already take an opts.card flag (the card/list pass {card:true}; the
 * agent DETAIL panel, #d-task, calls taskLine WITHOUT it). So the rate-limit sentence is suppressed only on
 * the card (opts.card === true) and kept on the detail -- the detail IS "behind the pill" (reached by opening
 * the card). This test lifts the page's own STATE_COPY/stateCopyOf (the pill word) and stateReason/taskLine
 * (the card-vs-detail divergence) and pins both. The auth_failed stuck sentence is a control: it still
 * renders on the card (that change was rate_limited-only).
 *
 *   node --test web.ratelimit-pill-6398.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

// STATE_COPY is a multi-line object with semicolons in its comments, so slice it by its braces (not liftConst).
function constBlock(name) {
  const at = PAGE.indexOf('const ' + name + ' = {');
  assert.notEqual(at, -1, name + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n};', at) + 3);
}

const stateCopyOf = (() => {
  const fn = new Function(
    'a',
    `${constBlock('STATE_COPY')}\nfunction restartingLabel() { return 'Restarting agent'; }\n${page.lift(SCRIPT, 'stateCopyOf')}\nreturn stateCopyOf(a);`,
  );
  return (a) => fn(a);
})();

// taskLine calls stateReason; lift both and thread opts through (the card passes {card:true}, the detail none).
const taskLineOf = (() => {
  const fn = new Function(
    'a', 'opts',
    `${page.lift(SCRIPT, 'stateReason')}\n${page.lift(SCRIPT, 'taskLine')}\nreturn taskLine(a, opts);`,
  );
  return (a, opts) => fn(a, opts);
})();

const PARAGRAPH = /paused by a rate limit for about\s+40\s+minutes/i;
const stuckRate = {
  state: 'rate_limited', stateConfidence: 'structured',
  stuckError: { stuck: true, state: 'rate_limited', forMs: 40 * 60000 },
};

test('#6398: the rate-limited status pill reads "Rate Limit", not "Paused"', () => {
  assert.equal(stateCopyOf({ state: 'rate_limited' }).label, 'Rate Limit');
  assert.notEqual(stateCopyOf({ state: 'rate_limited' }).label, 'Paused');
  assert.equal(stateCopyOf({ state: 'rate_limited' }).attn, true, 'still an attention state');
});

test('#6398: the long rate-limit paragraph does NOT render on the card face', () => {
  assert.equal(taskLineOf(stuckRate, { card: true }), '',
    'a stuck rate_limited CARD shows no paragraph -- only the "Rate Limit" pill');
  // a plain (not-stuck) rate_limited agent is silent on the card too: all its detail is behind the pill.
  assert.equal(taskLineOf({ state: 'rate_limited', stateConfidence: 'scraped' }, { card: true }), '');
  assert.equal(taskLineOf({ state: 'rate_limited', stateConfidence: 'reported' }, { card: true }), '');
});

test('#6398: the detail BEHIND the pill (taskLine with no opts.card) keeps the full detail', () => {
  const detail = taskLineOf(stuckRate);   // the #d-task derivation: no opts.card
  assert.match(detail, PARAGRAPH, 'the detail still names how long');
  assert.match(detail, /switch its model/i, 'the "switch its model" affordance stays reachable behind the pill');
  // and a plain rate_limited agent still names its reason on the detail
  assert.equal(taskLineOf({ state: 'rate_limited', stateConfidence: 'scraped' }), 'Looks like a usage limit');
  assert.equal(taskLineOf({ state: 'rate_limited', stateConfidence: 'reported' }), 'Usage limit reached');
});

test('#6398 control: auth_failed is untouched -- its stuck sentence still renders on the card', () => {
  const stuckAuth = {
    state: 'auth_failed', stateConfidence: 'structured',
    stuckError: { stuck: true, state: 'auth_failed', forMs: 20 * 60000 },
  };
  assert.match(taskLineOf(stuckAuth, { card: true }), /unable to sign in for about\s+20\s+minutes/i,
    'the auth_failed stuck paragraph is rate_limited-independent and stays on the card');
  assert.equal(stateCopyOf({ state: 'auth_failed' }).label, "Sign-in isn't working", 'and its pill is unchanged');
});
