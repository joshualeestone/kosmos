'use strict';
/* kosmos#6842 slice 2: the words Project settings shows for what a project's finished tasks cost, from the real functions
 * in web/index.html.
 *   node --test web.project-cost-6842.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(RAW);
const lift = (name) => page.lift(SCRIPT, name);

function bundle() {
  // eslint-disable-next-line no-new-func
  return new Function(
    page.liftConst(SCRIPT, 'USAGE_MODEL_PRICES') + '\n'
    + page.liftConst(SCRIPT, 'PJS_COST_PRS_SHOWN') + '\n'
    + lift('esc') + '\n'
    + lift('usageNum') + '\n'
    + lift('usageAbbr') + '\n'
    + lift('usageUsd') + '\n'
    + lift('usageRowTokenTotal') + '\n'
    + lift('usageModelPrice') + '\n'
    + lift('usageApiCost') + '\n'
    + lift('tkReceiptPrsHtml') + '\n'
    + lift('tkTokensAndCost') + '\n'
    + lift('pjsCostParts') + '\n'
    + 'return { pjsCostParts, usageApiCost };',
  )();
}
const B = bundle();
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const buckets = (i) => ({ input_tokens: i, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 });
const ok = (over) => ({ ok: true, tasks: 2, notCounted: 0, failed: 0, unread: 0, partial: 0, models: { 'claude-fable-5': buckets(1e6) }, prs: [], prsMore: 0, ...over });

test('the finished tasks, their tokens and the cost at API prices, from the page\'s one price table', () => {
  assert.ok(B.usageApiCost({ receipt: { 'claude-fable-5': buckets(1e6) } }).cost > 0, 'control: the fixture model is priced');
  assert.match(B.pjsCostParts(ok()).line, /^2 finished tasks: 1(\.0)?M tokens, \$10 at API prices\.$/, 'no overlapping holds: no overlap line');
  assert.match(B.pjsCostParts(ok({ overlapping: true })).line, / An agent worked on two of these tasks at once, and that time counts on both, so this reads high\.$/);
  assert.match(B.pjsCostParts(ok({ tasks: 1 })).line, /^1 finished task: /);
});

test('what was left out is said: older tasks, and work that could not be read', () => {
  const older = B.pjsCostParts(ok({ tasks: 50, notCounted: 3 })).line;
  assert.match(older, /Counting the newest 50; 3 older tasks are not counted\./);
  assert.match(B.pjsCostParts(ok({ notCounted: 1 })).line, /1 older task is not counted\./);
  for (const k of ['unread', 'partial', 'failed']) {
    assert.match(B.pjsCostParts(ok({ [k]: 1 })).line, /could not be read, so the real cost may be higher\./, k);
  }
  assert.doesNotMatch(B.pjsCostParts(ok()).line, /could not be read|not counted/, 'the control says neither');
});

test('nothing finished, nothing readable, and a failed answer each say so', () => {
  assert.equal(B.pjsCostParts(ok({ tasks: 0, models: {} })).line, 'No finished tasks yet.');
  assert.equal(B.pjsCostParts(ok({ tasks: 0, failed: 2, models: {} })).line, 'Kosmos could not read the work on its finished tasks.');
  assert.match(B.pjsCostParts({ ok: false, because: 'no-project' }).line, /could not work out/);
  assert.match(B.pjsCostParts(null).line, /could not work out/);
});

test('the pull requests the tasks worked on, at most 20 named and the rest counted, links only to github.com', () => {
  const prs = Array.from({ length: 22 }, (_, i) => ({ repo: 'acme/app', number: i + 1, url: 'https://github.com/acme/app/pull/' + (i + 1), tasks: [1] }));
  const t = text(B.pjsCostParts(ok({ prs, prsMore: 1 })).prs);
  assert.match(t, /^Worked on pull requests app#1 /);
  assert.match(t, /app#20 ?\(opens in your browser\) ?and up to 3 more\.$/, '2 beyond the shown 20, plus 1 an agent counted: an upper bound');
  assert.doesNotMatch(t, /app#21/);
  const bad = B.pjsCostParts(ok({ prs: [{ repo: 'acme/<b>x', number: 5, url: 'javascript:alert(1)' }] })).prs;
  assert.doesNotMatch(bad, /<a |<b>x/);
  assert.equal(B.pjsCostParts(ok()).prs, '', 'no line when there are none');
});

test('pull requests that were never recorded read as unknown, not none', () => {
  assert.match(text(B.pjsCostParts(ok({ prsUnknown: 1 })).prs), /^Some of the work on these tasks may not record pull requests, so some may not be listed\.$/);
  const both = text(B.pjsCostParts(ok({ prsUnknown: 3, prs: [{ repo: 'acme/app', number: 4, url: 'https://github.com/acme/app/pull/4' }] })).prs);
  assert.match(both, /^Worked on pull request app#4 .*\. Some of the work on these tasks may not record pull requests, so some may not be listed\.$/);
  assert.equal(B.pjsCostParts(ok({ prsUnknown: 0 })).prs, '', 'control: none unknown, no line');
});

test('the newest N names the tasks looked at, even when some failed; all failing says so, never 0 tokens', () => {
  const some = B.pjsCostParts(ok({ picked: 50, tasks: 48, failed: 2, notCounted: 3 })).line;
  assert.match(some, /Counting the newest 50; 3 older tasks are not counted\./);
  assert.match(some, /could not be read/);
  const none = B.pjsCostParts(ok({ picked: 50, tasks: 0, failed: 50, notCounted: 3, models: {} }));
  assert.equal(none.line, 'Kosmos could not read the work on its newest finished tasks.');
  assert.equal(none.prs, '');
});

test('the project total and the task receipt word their cost the same way (one helper)', () => {
  assert.ok(SCRIPT.includes('function tkTokensAndCost('), 'the helper is on the page');
  const body = (name) => SCRIPT.slice(SCRIPT.indexOf('function ' + name + '('), SCRIPT.indexOf('\nfunction ', SCRIPT.indexOf('function ' + name + '(') + 1));
  for (const name of ['pjsCostParts', 'tkReceiptAgentHtml']) {
    assert.match(body(name), /tkTokensAndCost\(/, name + ' does not use the shared helper');
    assert.doesNotMatch(body(name), /at API prices/, name + ' words the cost itself again');
  }
});

test('a total with nothing readable says so, never "0 tokens"', () => {
  assert.equal(B.pjsCostParts(ok({ tasks: 2, unread: 2, readable: 0, models: {} })).line, 'Kosmos could not read the work on its newest finished tasks.');
  assert.match(B.pjsCostParts(ok({ tasks: 2, failed: 1, readable: 3, models: {} })).line, /^2 finished tasks: 0 tokens/, 'readable agents with no activity: a measured none, not unreadable');
  assert.match(B.pjsCostParts(ok({ tasks: 2, models: {} })).line, /^2 finished tasks: 0 tokens/, 'the control: read, and none, is 0');
});

test('nothing readable: no "reads high" sentence, since there is no total', () => {
  const line = B.pjsCostParts(ok({ tasks: 2, unread: 2, readable: 0, models: {}, overlapping: true })).line;
  assert.equal(line, 'Kosmos could not read the work on its newest finished tasks.');
});

test('some unread, some readable, and overlapping: "may be higher" and "reads high" both said, in that order', () => {
  const line = B.pjsCostParts(ok({ tasks: 2, unread: 1, overlapping: true })).line;
  assert.match(line, /may be higher\. An agent worked on two of these tasks at once, and that time counts on both, so this reads high\.$/);
  assert.doesNotMatch(line, /cost is higher/, 'an unread agent may have cost nothing: never "is higher"');
});

test('with some tasks failed, the leading count names the tasks looked at', () => {
  assert.match(B.pjsCostParts(ok({ picked: 50, tasks: 48, failed: 2 })).line, /^50 finished tasks: /);
  assert.match(B.pjsCostParts(ok({ picked: 50, tasks: 50 })).line, /^50 finished tasks: /, 'the control');
});
