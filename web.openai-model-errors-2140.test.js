'use strict';
/**
 * #2140 error matrix, client half: openaiNoModelsNote maps the engine's distinct
 * per-status `because` (accountModels) into an honest note. The point is that a
 * BROKEN account (401 rejected, 403 denied) no longer reads as "we could not reach
 * OpenAI" or "no models" -- it names what happened and the remedy. Slices the
 * SHIPPED openaiNoModelsNote out of web/index.html and drives it directly.
 *
 *   node --test web.openai-model-errors-2140.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
function sliceFn(name) {
  let at = SCRIPT.indexOf('async function ' + name + '(');
  if (at < 0) at = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' not found -- moved?');
  return SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 2);
}
// eslint-disable-next-line no-new-func
const note = new Function(sliceFn('openaiNoModelsNote') + '\nreturn openaiNoModelsNote;')();

test('#2140 note: a 401 says the key was rejected + reconnect, never no-models/unreachable', () => {
  const n = note("this account's API key was rejected by OpenAI (401)");
  assert.match(n, /rejected/i);
  assert.match(n, /[Rr]econnect/);
  assert.doesNotMatch(n, /could not reach|no model/i, 'a rejected key must not read as unreachable or no-models');
});

test('#2140 note: a scope-restricted 401 says the key works but cannot list, never "reconnect"', () => {
  // The refinement: a 401 that is NOT invalid_api_key is a permissions answer,
  // so the account works for running the agent and must not be told to reconnect.
  const n = note("this account's key cannot list models, though the key itself works (401)");
  assert.match(n, /cannot list models/i);
  assert.match(n, /still works|works for running/i);
  assert.doesNotMatch(n, /[Rr]econnect/, 'a scope-restricted 401 must not tell a working account to reconnect');
  assert.doesNotMatch(n, /rejected/i, 'a scope-restricted 401 is not a rejected key');
});

test('#2140 note: a 403 names the denied operation, never "no models"', () => {
  const n = note("this account's key is not allowed to list models (403)");
  assert.match(n, /not allowed to list models/i);
  assert.doesNotMatch(n, /no model/i);
});

test('#2140 note: a 429 billing state is distinct from a rate limit', () => {
  const billing = note('this account has hit its OpenAI usage or billing limit (429)');
  assert.match(billing, /usage or billing limit/i);
  const rate = note('OpenAI is rate-limiting this account right now (429)');
  assert.match(rate, /rate-limiting/i);
  assert.match(rate, /try again/i);
  assert.notEqual(billing, rate, 'billing and rate-limit notes must differ');
});

test('#2140 note: a 5xx reads as a temporary OpenAI problem, retryable', () => {
  const n = note('OpenAI is having trouble right now (503)');
  assert.match(n, /having trouble/i);
  assert.match(n, /try again/i);
});

test('#2140 note CONTROL: the ChatGPT (not-an-api-key) case is unchanged by the new arms', () => {
  const n = note('this sign-in cannot list models yet; it is not an API key');
  assert.match(n, /signed in with ChatGPT/);
});

test('#2140 note CONTROL: a genuinely unreachable OpenAI still reads as could-not-reach', () => {
  const n = note('we could not reach OpenAI to check whether this key still works');
  assert.match(n, /could not reach/i);
});
