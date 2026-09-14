'use strict';

/**
 * kosmos#2338 (piece 2): a Codex/ChatGPT agent can be MOVED between the user's
 * OpenAI (CODEX_HOME) accounts from the same picker that moves a Claude agent
 * between Claude accounts -- Josh's "select an account to use the subscription".
 *
 * The engine already performs the swap (`create.setCodexAccount` writes CODEX_HOME
 * and restarts); the gap this piece closes was purely the UI, which offered the
 * move to Claude agents only and told a codex agent it "cannot be moved from here".
 *
 * 🔑 THE DECIDER IS EXTRACTED AND RUN, not matched: `acctMoveWorld` is a pure
 * function (of the agent + the account list) that decides which accounts the move
 * offers and which one the agent is on -- logic a regex cannot see. The route
 * sentence and the provider-picker un-parking (which a regex CAN see) are pinned
 * to source separately.
 *
 *   node --test web.codex-account-mover-2338.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SERVER = fs.readFileSync('server.js', 'utf8');

function worldFn() {
  const a = PAGE.indexOf('function acctMoveWorld(');
  assert.ok(a > -1, 'acctMoveWorld moved; re-anchor this test');
  const b = PAGE.indexOf('\nasync function paintAccountPicker', a + 1);
  assert.ok(b > a, 'acctMoveWorld no longer ends where expected');
  const src = PAGE.slice(a, b);
  // eslint-disable-next-line no-new-func
  return new Function(src + '; return acctMoveWorld;')();
}

// A realistic account list: a default OpenAI home, a named OpenAI home, and two
// shared-memory Claude accounts. `memoryShared` is a Claude-only field; OpenAI
// rows carry `provider: 'openai'`.
const OPENAI_DEFAULT = { provider: 'openai', dir: '/Users/x/.codex', isDefault: true, name: 'Josh main' };
const OPENAI_NAMED = { provider: 'openai', dir: '/Users/x/.codex-work', isDefault: false, name: 'Josh work' };
const CLAUDE_A = { dir: '/Users/x/.claude', isDefault: true, memoryShared: true, email: 'a@x.io' };
const CLAUDE_B = { dir: '/Users/x/.claude-b', isDefault: false, memoryShared: true, email: 'b@x.io' };
const ALL = [OPENAI_DEFAULT, OPENAI_NAMED, CLAUDE_A, CLAUDE_B];

test('a DEFAULT codex agent (a.account null) offers the OpenAI accounts and resolves to the default home', () => {
  const world = worldFn();
  const w = world({ runner: 'codex', account: null }, ALL);
  assert.equal(w.isCodex, true, 'a codex agent was not recognised as codex');
  assert.deepEqual(w.movable.map((x) => x.dir), [OPENAI_DEFAULT.dir, OPENAI_NAMED.dir],
    'the move offers something other than exactly the OpenAI accounts');
  assert.equal(w.currentDir, OPENAI_DEFAULT.dir,
    'a default codex agent (no CODEX_HOME in its job) did not resolve to the default OpenAI home');
  assert.equal(w.currentRow, OPENAI_DEFAULT, 'the resolved live row is not the default OpenAI row');
});

test('a NAMED codex agent (a.account carries its CODEX_HOME dir) resolves to that account', () => {
  const world = worldFn();
  const w = world({ runner: 'codex', account: { dir: OPENAI_NAMED.dir } }, ALL);
  assert.equal(w.currentDir, OPENAI_NAMED.dir, 'a named codex agent did not resolve to its own CODEX_HOME');
  assert.equal(w.currentRow, OPENAI_NAMED, 'the live row for the named account was not found');
  // The picker excludes the current account from destinations (moveAccountNow
  // arms only on a DIFFERENT pick), so the other OpenAI account is still offered.
  assert.ok(w.movable.some((x) => x.dir === OPENAI_DEFAULT.dir),
    'the other OpenAI account is not offered as a destination');
});

test('CONTROL: a codex agent on a machine with NO OpenAI accounts is not movable (honest, not by-design)', () => {
  const world = worldFn();
  const w = world({ runner: 'codex', account: null }, [CLAUDE_A, CLAUDE_B]);
  assert.deepEqual(w.movable, [], 'OpenAI destinations were invented from a Claude-only list');
  assert.equal(w.currentDir, null, 'a codex account was resolved from a list with no OpenAI rows');
});

test('a CLAUDE agent is unchanged: it moves among shared-memory Claude accounts, never the OpenAI ones', () => {
  const world = worldFn();
  const w = world({ runner: 'claude', account: { dir: CLAUDE_A.dir } }, ALL);
  assert.equal(w.isCodex, false, 'a claude agent was treated as codex');
  assert.deepEqual(w.movable.map((x) => x.dir), [CLAUDE_A.dir, CLAUDE_B.dir],
    'the Claude move offered a non-shared or an OpenAI account');
  assert.ok(!w.movable.some((x) => x.provider === 'openai'),
    'a Claude agent was offered an OpenAI account to move to');
  assert.equal(w.currentDir, CLAUDE_A.dir, 'the claude current account changed');
});

test('CONTROL: a Claude account that does NOT share memory is not offered (the pre-existing refusal)', () => {
  const world = worldFn();
  const notShared = { dir: '/Users/x/.claude-solo', isDefault: false, memoryShared: false };
  const w = world({ runner: 'claude', account: { dir: CLAUDE_A.dir } }, [CLAUDE_A, notShared]);
  assert.ok(!w.movable.some((x) => x.dir === notShared.dir),
    'an account that keeps its own history was offered as a move target');
});

/* --- the route sentence is honest about codex history, which does NOT travel -- */
test('the account route tells a codex move the truth: files/projects travel, Codex chat stays behind', () => {
  const i = SERVER.indexOf("const acctRoute = pathname.match(/^\\/api\\/agent\\/([^/]+)\\/account$/);");
  assert.ok(i > -1, 'the account route moved; re-anchor this test');
  const body = SERVER.slice(i, i + 3200);
  assert.match(body, /const isCodexMove = !!\(wrote\.account && wrote\.account\.provider === 'openai'\)/,
    'the route no longer distinguishes a codex account move from a Claude one');
  // Codex: history does NOT come with it (per-CODEX_HOME, no cross-home symlink),
  // so the Claude "Everything it has done comes with it" would be a false promise.
  assert.match(body, /its earlier Codex chat stays with the account it was on/,
    'the codex move sentence does not disclose that Codex chat history stays behind');
  assert.match(body, /Its files and projects come with it/,
    'the codex move sentence does not say what DOES travel');
  // Claude: the shared-history promise is unchanged.
  assert.match(body, /Everything it has done comes with it/,
    'the Claude move sentence lost its shared-history promise');
});

/* --- the provider picker no longer parks the account control for codex --------- */
test('paintProviderPicker no longer disables the account control for a codex agent (#2338 un-parks it)', () => {
  const a = PAGE.indexOf('function paintProviderPicker(');
  assert.ok(a > -1, 'paintProviderPicker moved');
  const b = PAGE.indexOf('\n}', a + 1);
  // paintProviderPicker is short and ends at the first column-0 brace after it.
  const body = PAGE.slice(a, b > a ? b + 2 : a + 3000);
  assert.doesNotMatch(body, /getElementById\('d-account'\)/,
    'paintProviderPicker still reaches into #d-account -- it should leave that control to paintAccountPicker, which now offers a codex agent its OpenAI accounts');
});
