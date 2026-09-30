'use strict';

/**
 * #3939 slice 3c-2: the Meta Muse row in Settings, AI Models (provider 'meta', authMode 'muse') has no
 * key and no account folder. acctProvider used to send any provider it did not know to 'anthropic', so
 * the create form would have offered this row as a Claude account and counted it as "has Claude". These
 * execute the page's own functions on it (as web.agy-row-3998.test.js does for the Gemini subscription).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function grab(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}
const routeAt = PAGE.indexOf('const ACCT_KEYED_ROUTE');
// eslint-disable-next-line no-new-func
const api = new Function(PAGE.slice(routeAt, PAGE.indexOf('\n', routeAt)) + '\n' + grab('function acctProvider(') + '\n'
  + grab('function keyOnlyProvider(') + '\n' + grab('function switchKeyedWord(') + '\n'
  + grab('function acctOfferableTarget(') + '\n' + grab('function acctMoveWorld(') + '\n'
  + 'return { acctProvider, switchKeyedWord, acctMoveWorld };')();

const MUSE = { provider: 'meta', providerName: 'Meta', dir: null, authMode: 'muse', email: null,
  connection: { state: 'connected', badge: 'signed_in_unverified' } };
const CLAUDE = { provider: 'anthropic', dir: '/h/.claude-a', email: 'a@example.com', memoryShared: true, connection: { state: 'connected' } };

test('#3939 3c-2: the Meta Muse row is its own provider, never Claude and never a key', () => {
  assert.equal(api.acctProvider(MUSE), 'meta');
  assert.equal(api.acctProvider({ ...MUSE, provider: 'muse' }), 'meta', 'a row naming itself muse is still Meta Muse');
  assert.equal(api.acctProvider({ provider: 'mystery' }), 'anthropic', 'CONTROL: an unknown provider still falls back as before');
  assert.equal(api.switchKeyedWord('meta'), 'Meta Muse', 'the Meta Muse row was named OpenAI');
  // The create form maps its menu value through acctProvider too: Meta chosen must not list Claude accounts.
  assert.equal(api.acctProvider({ provider: 'meta' }), 'meta', 'the Meta menu choice read as Claude');
});

test('#3939 3c-2: the create form\'s Claude filter and "has Claude" check do not take the Meta Muse row', () => {
  const list = [MUSE, { provider: 'openai', dir: '/h/.codex', connection: { state: 'connected' } }];
  // The create form's own filters (fillCreateAccounts, loadCreateExtras): acctProvider(x) === 'anthropic'.
  assert.deepEqual(list.filter((x) => api.acctProvider(x) === 'anthropic'), [], 'the Meta Muse row was offered as a Claude account');
  assert.equal(list.some((x) => api.acctProvider(x) === 'anthropic'), false, 'the Meta Muse row counted as "has Claude"');
  assert.equal([CLAUDE, MUSE].filter((x) => api.acctProvider(x) === 'anthropic').length, 1, 'CONTROL: a real Claude row still counts');
});

test('#3939 3c-2: the page\'s create filters still decide Claude through acctProvider (the fix above reaches them)', () => {
  // If a filter stopped using acctProvider, the test above would pass while the form offered the row.
  for (const sig of ['function fillCreateAccounts(', 'async function loadCreateExtras(']) {
    assert.match(grab(sig), /acctProvider\(x\) === (want|'anthropic')/, sig + ' no longer decides the provider through acctProvider');
  }
});

test('#3939 3c-2 / #4569: the server builds the row only when Muse is on and installed (signed in, or refused), and names it Meta', () => {
  const src = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const at = src.indexOf('let museSub = [];');
  assert.notEqual(at, -1, 'the Meta Muse row is gone from /api/accounts');
  const block = src.slice(at, src.indexOf('sendJson(res, 200, { accounts:', at));
  assert.match(block, /muse\.enabled\(\) && muse\.installed\(\)\.installed/);
  // #4569: signed in is green when seen working, amber otherwise; a refusal is a red row, not no row.
  assert.match(block, /if \(muse\.signedIn\(\)\.signedIn\)/);
  assert.match(block, /else if \(muse\.refused\(\)\)/);
  assert.match(block, /badge: 'working'/);
  assert.match(block, /badge: 'rejected'/);
  assert.match(block, /provider: 'meta', providerName: 'Meta'/);
  assert.match(block, /authMode: 'muse'/);
  assert.match(block, /badge: 'signed_in_unverified'/);
  // Round 1: the row must reach the response, not only be built.
  const send = src.slice(src.indexOf('sendJson(res, 200, { accounts:', at), src.indexOf('\n', src.indexOf('sendJson(res, 200, { accounts:', at)));
  assert.match(send, /\.\.\.museSub\]/, 'the Meta Muse row is built but never sent');
});

test('#3939 3c-2 round 3: the move picker never offers the Meta Muse row, to a Claude agent or a keyed one', () => {
  // The Claude arm excludes the row because it has no memoryShared (acctMoveWorld's Claude filter), not
  // by provider; the server never sets memoryShared on it. The keyed arm excludes it by provider.
  const CLAUDE_B = { ...CLAUDE, dir: '/h/.claude-b', email: 'b@example.com' };
  const claudeWorld = api.acctMoveWorld({ runner: 'claude', account: CLAUDE.dir }, [MUSE, CLAUDE, CLAUDE_B]);
  const dirs = (w) => (w.movable || []).map((x) => x.dir);
  assert.equal(dirs(claudeWorld).includes(null), false, 'the Meta Muse row was a Claude move target');
  assert.equal(dirs(claudeWorld).includes('/h/.claude-b'), true, 'CONTROL: a real Claude account is a move target');
  const codexWorld = api.acctMoveWorld({ runner: 'codex', account: '/h/.codex' }, [MUSE, { provider: 'openai', dir: '/h/.codex', connection: { state: 'connected' } }]);
  assert.equal(dirs(codexWorld).includes(null), false, 'the Meta Muse row was a keyed move target');
});
