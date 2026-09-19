'use strict';
/**
 * A refused OpenAI install says WHY, on both screens that start one.
 *
 * Found by the founder on a clean Windows 11 laptop (prod 0.6.72): first-run GPT
 * card, Confirm, then "We could not start that install." The engine had refused
 * with a reason, but at `job.because`, and both screens read only
 * `out.error || out.because`. The deciding function is extracted and run; the
 * wiring (both handlers route through it, the Settings catch no longer calls a
 * showBar it cannot see) is asserted from the source.
 *
 *   node --test web.runner-install-refusal.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

function extract(name, endAnchor) {
  const a = PAGE.indexOf('function ' + name + '(');
  assert.ok(a > -1, name + ' moved; re-anchor this test');
  const b = PAGE.indexOf(endAnchor, a + 1);
  assert.ok(b > a, name + ' no longer ends where expected');
  return PAGE.slice(a, b);
}

const pj = extract('pjSentence', '\n}\n') + '\n}\n';
// eslint-disable-next-line no-new-func
const refusal = new Function(pj + extract('runnerInstallRefusal', '\nasync function acctOpenaiLook') + '; return runnerInstallRefusal;')();

test('the reason at job.because reaches the person, as a sentence', () => {
  const said = refusal({ job: { phase: 'failed', because: "installing OpenAI's Codex from here is not supported on this kind of computer (linux), so nothing was downloaded" } });
  assert.match(said, /^Installing OpenAI's Codex/);
  assert.match(said, /nothing was downloaded\.$/);
});

test('top-level error still wins, and an empty answer gets a sentence with something to do', () => {
  assert.equal(refusal({ error: 'we could not start that install', job: { because: 'other' } }), 'We could not start that install.');
  for (const empty of [null, {}, { job: {} }]) {
    const said = refusal(empty);
    assert.match(said, /try again/, 'the fallback tells the person what they can do');
    assert.doesNotMatch(said, /—/, 'no em dash');
  }
});

test('both install handlers read the refusal through runnerInstallRefusal', () => {
  const calls = PAGE.split("fetch('/api/runners/openai/install'").length - 1;
  assert.equal(calls, 2, 'expected the Settings and first-run handlers');
  const uses = PAGE.split('throw new Error(runnerInstallRefusal(out))').length - 1;
  assert.equal(uses, calls, 'every install POST reads its refusal through the one function');
  assert.equal(PAGE.includes("(out && (out.error || out.because)) || 'We could not start that install.'"), false,
    'the wrapper that dropped job.because is gone');
});

test('the Settings install catch no longer calls a showBar that is not in its scope', () => {
  const a = PAGE.indexOf("document.getElementById('acct-openai-install-go').addEventListener('click'");
  assert.ok(a > -1);
  const b = PAGE.indexOf('\n});', a);
  const handler = PAGE.slice(a, b);
  assert.equal(/showBar\(/.test(handler.replace(/\/\*[\s\S]*?\*\//g, '')), false,
    'a ReferenceError in the catch kept Settings on "Starting..." for ever');
});

test('the first-run poll ends on a failed job instead of waiting five minutes', () => {
  const a = PAGE.indexOf("document.getElementById('fr-openai-confirm-go').addEventListener('click'");
  assert.ok(a > -1);
  const b = PAGE.indexOf('\n});', a);
  const handler = PAGE.slice(a, b);
  assert.match(handler, /o\.job\.phase === 'failed'/);
  assert.match(handler, /pjSentence\(o\.job\.because\)/);
});

test('the first-run timeout gives Confirm back instead of leaving it disabled', () => {
  const a = PAGE.indexOf("document.getElementById('fr-openai-confirm-go').addEventListener('click'");
  const handler = PAGE.slice(a, PAGE.indexOf('\n});', a));
  const t = handler.indexOf('Date.now() - started >');
  assert.ok(t > -1, 'the timeout branch moved; re-anchor this test');
  const branch = handler.slice(t, handler.indexOf('}, 2000);', t));
  assert.match(branch, /go\.disabled = false/, 'a timed-out install must leave a way to try again');
  assert.match(branch, /600000/, 'ten minutes: a 140MB download plus a virus scan can pass five');
  assert.doesNotMatch(branch, /—/, 'no em dash');
});
