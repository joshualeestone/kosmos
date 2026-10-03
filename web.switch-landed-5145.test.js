'use strict';
/* #5145: chooseSwitchedAccount decides which account the page records after a provider switch (the "Right now"
   bracket and Move both read it). A table, one row per precedence rule, so a change to any rule fails by name.
   Review 2 asked for this: the browser checks cover two arms; this covers every branch. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
function fnSource(name) {
  const start = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'web/index.html has no function ' + name);
  let depth = 0;
  for (let i = SCRIPT.indexOf('{', start); i < SCRIPT.length; i++) {
    if (SCRIPT[i] === '{') depth++;
    else if (SCRIPT[i] === '}' && --depth === 0) return SCRIPT.slice(start, i + 1);
  }
  throw new Error('unbalanced function ' + name);
}
const choose = vm.runInNewContext(fnSource('chooseSwitchedAccount') + '\nchooseSwitchedAccount');

const A = [{ dir: '/c/main', provider: 'anthropic', isDefault: true }, { dir: '/c/b', provider: 'anthropic' },
  { dir: '/o/1', provider: 'openai', isDefault: true }, { dir: '/o/2', provider: 'openai' }, { dir: '/g/key', provider: 'google' }];
const ok = (accountDir) => ({ outcome: 'changed', accountDir });

const ROWS = [
  // [label, want, sent, out, mainClaudeDir, expected]
  ['Claude: the pick wins over the landed account', 'anthropic', '/c/b', ok('/c/main'), '/c/main', '/c/b'],
  ['Claude: no pick, a listed landed account', 'anthropic', null, ok('/c/b'), '/c/main', '/c/b'],
  ['Claude: no pick, route named nothing -> the main account', 'anthropic', null, ok(null), '/c/main', '/c/main'],
  ['Claude: no pick, route named an UNLISTED account (stale list) -> nothing, not main', 'anthropic', null, ok('/c/new'), '/c/main', null],
  ['Claude: a partial ignores the pick -> main', 'anthropic', '/c/b', { outcome: 'partial' }, '/c/main', '/c/main'],
  ['OpenAI: landed wins over a different sent row (codex fell back)', 'openai', '/o/2', ok('/o/1'), null, '/o/1'],
  ['OpenAI: no sent row, a listed landed account', 'openai', null, ok('/o/2'), null, '/o/2'],
  ['OpenAI: landed is UNLISTED (stale list) -> nothing, never the sent row', 'openai', '/o/2', ok('/o/new'), null, null],
  ['OpenAI: landed unlisted but exactly what was sent -> that', 'openai', '/o/new', ok('/o/new'), null, '/o/new'],
  ['Gemini: the computed default with no key (not a row) -> nothing', 'google', null, ok('/g/default'), null, null],
  ['Gemini: a listed key row', 'google', null, ok('/g/key'), null, '/g/key'],
  ['Antigravity / dry-run: no landed account -> the sent row', 'antigravity', '/x/sent', ok(null), null, '/x/sent'],
  ['No landed account and a partial -> nothing', 'openai', '/o/2', { outcome: 'partial' }, null, null],
];

for (const [label, want, sent, out, main, expected] of ROWS) {
  test('#5145 chooseSwitchedAccount: ' + label, () => {
    assert.equal(choose(want, sent, out, A, main), expected);
  });
}

test('#5145 changeProviderNow records the account through chooseSwitchedAccount (one derivation)', () => {
  const body = fnSource('changeProviderNow');
  assert.match(body, /chooseSwitchedAccount\(want, sentAccount, out, ACCOUNTS,/);
  assert.doesNotMatch(body, /CURRENT\.account = want === 'anthropic'/, 'the old inline precedence is back beside the function');
});
