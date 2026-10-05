'use strict';
/**
 * kosmos#4554: the kind picker's Team card and the Team screen describe a team with the same noun. The card said
 * "the people who report to it" while the screen said "the agents"; they are agents (Josh's #4554 brief: agents
 * "that report to it"). Read from the shipped page's markup.
 *
 *   node --test web.teamcopy-4554.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function teamCardDesc() {
  const btn = HTML.indexOf('class="nak-btn" data-path="team"');
  assert.ok(btn > 0, 'the kind picker has no Team card');
  const end = HTML.indexOf('</button>', btn);
  const m = /<span class="nak-desc">([^<]*)<\/span>/.exec(HTML.slice(btn, end));
  assert.ok(m, 'the Team card has no description');
  return m[1];
}

function teamScreenHint() {
  const at = HTML.indexOf('<div id="cstep-team"');
  assert.ok(at > 0, 'the Team screen is missing');
  const m = /<p class="dhint"[^>]*>([^<]*)<\/p>/.exec(HTML.slice(at, at + 2000));
  assert.ok(m, 'the Team screen has no hint line');
  return m[1];
}

test('#4554: the Team card says the agents report to the lead, as the Team screen does', () => {
  const card = teamCardDesc();
  const hint = teamScreenHint();
  assert.equal(card, 'A lead and the agents who report to it');
  assert.ok(hint.startsWith(card), 'the Team screen no longer opens with the card\'s words: "' + hint + '"');
  assert.ok(!/\bpeople\b/i.test(card), 'the Team card calls the agents people again');
});
