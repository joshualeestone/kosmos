/**
 * #2145: create must not hand a new agent a provider it has NO account for.
 *
 * 🛑 THE GAP. #1903 built accountConnectable to refuse a positively-DEAD
 * sign-in before anything is written. It missed the sibling: a create with NO
 * account chosen on a provider that has no default account at all. On a
 * machine that never signed in to Claude, the wizard (after #2097 defaults to
 * OpenAI) still lets a user open the provider menu, pick Anthropic, and Create
 * with the account row empty -- the client sends no account, so
 * accountConnectable saw no default row and returned {ok:true} on the
 * assumption createAgentInner would refuse. It does NOT: with no accountDir it
 * leaves configDir null and CREATES on the default (empty) config, an agent
 * that 401s on its first call. The same #1903 incident, reached by a MISSING
 * account rather than a dead one -- which #1903's liveness gate cannot see,
 * because there is no account to probe.
 *
 * These drive the GATE directly (accountConnectable), which the server route
 * (server.js) calls before every create. No live probe is stubbed: the refusal
 * fires on a `list()` that returned empty, BEFORE any liveness call, so a stub
 * would be dead code -- and a CONTROL on each fixture proves list() reflects the
 * filesystem the test built, or nothing below means anything.
 *
 * 🛑 Seals AGENT_WORKFORCE_HOME and the codex roots BEFORE requiring anything,
 * the suite rule: an unsealed home reads the operator's real accounts.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'create-noaccount-2145-'));
const HOME = nodePath.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.AGENT_WORKFORCE_HOME = HOME;
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const create = require('./create');
const accounts = require('./accounts');
const openai = require('./openaiaccounts');

const CLAUDE_JSON = nodePath.join(HOME, '.claude.json');
const CODEX_DIR = nodePath.join(HOME, '.codex');
const CODEX_AUTH = nodePath.join(CODEX_DIR, 'auth.json');

// A default Claude account is "the one beside ~/.claude": a .claude.json with an
// oauthAccount plus a projects tree (the #1903 fixture shape).
function addClaude() {
  fs.writeFileSync(CLAUDE_JSON, JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
  fs.mkdirSync(nodePath.join(HOME, '.claude', 'projects'), { recursive: true });
}
function removeClaude() {
  try { fs.rmSync(CLAUDE_JSON, { force: true }); } catch { /* ignore */ }
  try { fs.rmSync(nodePath.join(HOME, '.claude'), { recursive: true, force: true }); } catch { /* ignore */ }
}
function addOpenai() {
  fs.mkdirSync(CODEX_DIR, { recursive: true });
  fs.writeFileSync(CODEX_AUTH, JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-xxxxxxxxxxxxxxxxxxxxABCD' }));
}
function removeOpenai() {
  try { fs.rmSync(CODEX_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}

test.after(() => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('#2145 CONTROL: with only OpenAI signed in, accounts.list() is empty and openai.list() is not', () => {
  removeClaude(); addOpenai();
  assert.equal(accounts.list().length, 0, 'a Claude account leaked into the no-Claude fixture: ' + JSON.stringify(accounts.list()));
  assert.ok(openai.list().length >= 1, 'the OpenAI fixture is not listed');
});

test('#2145: an Anthropic create with NO account on a machine with no Claude account is REFUSED (the wizard shape)', async () => {
  removeClaude(); addOpenai();
  // provider undefined == anthropic default, account undefined == the exact bytes the wizard sends.
  const r = await create.accountConnectable({});
  assert.equal(r.ok, false, 'a Claude create with no Claude account on the machine was accepted (the dead-agent footgun)');
  assert.match(r.because, /no Claude account signed in/);
  assert.match(r.because, /Settings/);
});

test('#2145: the refusal offers the OpenAI alternative ONLY when OpenAI is connected (pill-door rule)', async () => {
  // OpenAI present -> the alternative is real, so it is offered.
  removeClaude(); addOpenai();
  const withOpenai = await create.accountConnectable({ provider: 'anthropic', accountDir: '' });
  assert.equal(withOpenai.ok, false);
  assert.match(withOpenai.because, /or create this agent on OpenAI instead/);

  // Neither provider -> no alternative to offer, so the clause is absent (no dead click in words).
  removeClaude(); removeOpenai();
  const withNeither = await create.accountConnectable({ provider: 'anthropic', accountDir: '' });
  assert.equal(withNeither.ok, false, 'a machine with no accounts at all still refused, correctly');
  assert.doesNotMatch(withNeither.because, /OpenAI instead/, 'offered an OpenAI path that dead-ends');
});

test('#2145: a SPECIFIED but unknown Claude dir is still {ok:true} here (createAgentInner owns REFUSE_ACCOUNT) — #1903 asymmetry preserved', async () => {
  removeClaude(); addOpenai();
  const r = await create.accountConnectable({ provider: 'anthropic', accountDir: nodePath.join(HOME, '.claude-nope') });
  assert.deepEqual(r, { ok: true }, 'a specified-unknown dir was refused at the gate instead of delegating to createAgentInner');
});

test('#2145 (mirror): an OpenAI create with NO account on a machine with no OpenAI sign-in is REFUSED', async () => {
  removeOpenai(); addClaude();
  const r = await create.accountConnectable({ provider: 'openai', accountDir: '' });
  assert.equal(r.ok, false, 'an OpenAI create with no OpenAI sign-in was accepted (the mirror footgun)');
  assert.match(r.because, /no OpenAI sign-in/);
  assert.match(r.because, /or create this agent on Claude instead/, 'a Claude account is present, so the alternative should be offered');
});

test('#2145: under a CODEX_HOME override, an OpenAI no-account create FAILS OPEN — the agent runs on the real ~/.codex, not the managed home', async () => {
  /* The bug this guards: openai.list() reads the OVERRIDDEN (managed) codex home,
     but a created no-account default OpenAI agent runs on the REAL ~/.codex (its
     launchd job does not inherit the server's CODEX_HOME override). So an empty
     MANAGED home says nothing about the home the agent will use -- refusing there
     would block a create that would run fine on a signed-in real ~/.codex. The gate
     mirrors createAgentInner's own codexHomeOverridden() fail-open. This test shows
     the override FLIPS the outcome: refused without it, {ok:true} with it. */
  removeClaude(); removeOpenai();
  // Without the override, the empty machine refuses (the mirror footgun, same as above).
  const withoutOverride = await create.accountConnectable({ provider: 'openai', accountDir: '' });
  assert.equal(withoutOverride.ok, false, 'control: with no override and no account, the create should refuse');

  const MANAGED = nodePath.join(SANDBOX, 'managed-codex-empty');
  fs.mkdirSync(MANAGED, { recursive: true }); // empty: no auth.json in the managed home
  process.env.CODEX_HOME = MANAGED;
  try {
    // CONTROL: the override points list() at the empty managed home (no OpenAI account there).
    assert.equal(openai.list().length, 0, 'the managed codex home should list no OpenAI account');
    assert.deepEqual(await create.accountConnectable({ provider: 'openai', accountDir: '' }), { ok: true },
      'a no-account OpenAI create was refused under a CODEX_HOME override, though the agent runs on the real ~/.codex the gate never checked');
  } finally { delete process.env.CODEX_HOME; }
});

test('#2145: with a real (default) Claude account present, an Anthropic no-account create is NOT refused by the missing-account arm', async () => {
  /* The guard is scoped to a MISSING account. A present default account must
     pass this arm and go on to the #1903 liveness check (stubbed live here so
     the missing-account arm is what is under test, not liveness). */
  removeOpenai(); addClaude();
  create.setClaudeProbe(async () => ({ exitCode: 0, out: 'ok' }));
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'anthropic', accountDir: '' }), { ok: true },
      'a present, live default Claude account was refused by the missing-account guard');
  } finally { create.setClaudeProbe(null); }
});
