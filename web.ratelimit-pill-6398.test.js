'use strict';

/**
 * #6398 (Josh, via Liu Kang): a rate-limited agent read "Paused" in its status pill and carried a long
 * paragraph on the card face ("Kosmos has seen this agent paused by a rate limit for about XXX minutes. It
 * will keep trying when the limit lifts. You can wait, or switch its model."). Josh: reduce that paragraph to
 * a "Rate Limit" pill where "Paused" was, and put the detail BEHIND the pill, not on the card.
 *
 * The mechanism: taskLine/stateReason already take an opts.card flag (the card/list pass {card:true}; the
 * agent DETAIL panel, #d-task, calls taskLine WITHOUT it). So the verbose stuck paragraph is suppressed only
 * on the card (opts.card === true) and kept on the detail -- the detail IS "behind the pill" (reached by
 * opening the card). Scope is NARROW on purpose: only the verbose stuck paragraph moves; the short
 * quota/pool/usage reset lines (#4588/#5805) still render on the card, because Josh asked to remove the
 * paragraph, not the useful reset-time lines.
 *
 * This test lifts the page's own STATE_COPY/stateCopyOf (the pill word) and stateReason/taskLine (the
 * card-vs-detail divergence) and pins all of it, plus a structural check that the card/list pass {card:true}
 * and the detail call does not, so the divergence cannot silently drift.
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

// taskLine calls stateReason; lift them plus quotaResetWords (stateReason's #4588 quota-reset arm calls it) and
// thread opts through (the card passes {card:true}, the detail none).
const taskLineOf = (() => {
  const fn = new Function(
    'a', 'opts',
    `${page.lift(SCRIPT, 'quotaResetWords')}\n${page.lift(SCRIPT, 'stateReason')}\n${page.lift(SCRIPT, 'taskLine')}\nreturn taskLine(a, opts);`,
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

test('#6398: the verbose stuck rate-limit paragraph does NOT render on the card face', () => {
  assert.equal(taskLineOf(stuckRate, { card: true }), '',
    'a stuck rate_limited CARD shows no paragraph -- only the "Rate Limit" pill');
});

test('#6398: the detail BEHIND the pill (taskLine with no opts.card) keeps the full stuck paragraph', () => {
  const detail = taskLineOf(stuckRate);   // the #d-task derivation: no opts.card
  assert.match(detail, PARAGRAPH, 'the detail still names how long');
  assert.match(detail, /switch its model/i, 'the "switch its model" affordance stays reachable behind the pill');
});

test('#6398 scope: the short quota/usage reset lines still render on the card (narrow -- only the paragraph moved)', () => {
  // These #4588/#5805 lines are useful at-a-glance reset info, not the verbose paragraph Josh complained about;
  // they stay on the card for both the card render and the detail.
  for (const opts of [{ card: true }, undefined]) {
    assert.equal(taskLineOf({ state: 'rate_limited', stateConfidence: 'scraped' }, opts), 'Looks like a usage limit', JSON.stringify(opts));
    assert.equal(taskLineOf({ state: 'rate_limited', stateConfidence: 'reported' }, opts), 'Usage limit reached', JSON.stringify(opts));
  }
  // the Google quota-reset line (#4588) is still on the card
  const quotaUntil = new Date(Date.now() + 90 * 60000).toISOString();
  assert.match(taskLineOf({ state: 'rate_limited', quotaUntil }, { card: true }), /Usage limit reached\. The Google quota resets at /,
    'the #4588 quota-reset line stays on the card');
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

test('#6398 structural: the card/list pass {card:true} and the detail (#d-task) calls taskLine without it', () => {
  // The whole "behind the pill" mechanism rests on this caller contract, so pin it against drift (the way
  // web.quoted-line-986 pins its own render path). If #d-task ever started passing {card:true}, the detail
  // would lose the paragraph too, defeating #6398.
  assert.ok(PAGE.includes('<div class="atask">${esc(taskLine(a, { card: true }))}</div>'),
    'the grid card passes {card:true} to taskLine');
  assert.ok(PAGE.includes('lrowTask(taskLine(a, { card: true })'),
    'the list row passes {card:true} to taskLine');
  assert.ok(/const taskText = taskLine\(a\);/.test(PAGE),
    'the detail panel (#d-task) calls taskLine(a) WITHOUT {card:true}, so it keeps the full sentence behind the pill');
});
