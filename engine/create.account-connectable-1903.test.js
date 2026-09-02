/**
 * #1903: create must not hand a new agent an account that cannot sign in.
 *
 * 🛑 THE INCIDENT. A real tester created a fresh Claude agent that reported
 * created, ran, received its first message, and 401'd on its first API call
 * ("OAuth access token has expired"), because create points an agent at the
 * chosen account's config dir and never checked the credential there was live.
 * `create.accountConnectable` is the create-time gate (the #1315 template): it
 * refuses ONLY a positively-confirmed dead sign-in and proceeds on connected,
 * unconfirmable, or unresolvable.
 *
 * The two external boundaries are faked with each module's OWN seam
 * (`create.setClaudeProbe` for Claude's real `claude -p` liveness call (#1916),
 * `openaiaccounts.setFetcher` for OpenAI's `/v1/models`) -- never the real
 * network, and no credential value is ever written or asserted.
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

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'create-connectable-1903-'));
const HOME = nodePath.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.AGENT_WORKFORCE_HOME = HOME;
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const create = require('./create');
const openai = require('./openaiaccounts');

// Default Claude account (record BESIDE ~/.claude) + a labelled one.
fs.writeFileSync(nodePath.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'default@example.com' } }));
fs.mkdirSync(nodePath.join(HOME, '.claude', 'projects'), { recursive: true });
const DEAD_CLAUDE = nodePath.join(HOME, '.claude-dead');
fs.mkdirSync(nodePath.join(DEAD_CLAUDE, 'projects'), { recursive: true });
fs.writeFileSync(nodePath.join(DEAD_CLAUDE, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'dead@example.com' } }));

// An OpenAI account (codex apikey home).
const DEAD_OPENAI = nodePath.join(HOME, '.codex-dead');
fs.mkdirSync(DEAD_OPENAI, { recursive: true });
fs.writeFileSync(nodePath.join(DEAD_OPENAI, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-deadkeydeadkeyDEAD' }));

test.after(() => {
  openai.setFetcher(null); create.setClaudeProbe(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('#1903 CONTROL: the fixture accounts are actually listed, or nothing below means anything', () => {
  const claudeDirs = require('./accounts').list().map((a) => a.dir);
  assert.ok(claudeDirs.some((d) => d.indexOf('.claude-dead') !== -1), 'dead Claude account not listed: ' + JSON.stringify(claudeDirs));
  assert.ok(openai.list().some((a) => a.dir.indexOf('.codex-dead') !== -1), 'dead OpenAI account not listed');
  for (const d of claudeDirs) assert.ok(d.startsWith(SANDBOX), 'a real account leaked in: ' + d);
});

/* #1916: the Claude liveness check is now a REAL `claude -p` call, not
   subscription.checkLive (which reads `claude auth status` = a stored login, and
   badged a fully-expired OAuth token as "Signed in" -- the field bug). The probe
   is stubbed via create.setClaudeProbe, returning {exitCode, out}. A dead sign-in
   is a genuine AUTH failure in the OUTPUT; capacity/rate/network all fail open. */
const DEAD_AUTH_OUT = 'Please run /login · API Error: 401 OAuth access token has expired.';

test('#1903/#1916: a Claude account whose sign-in is DEAD (real 401) is refused, naming the remedy', async () => {
  create.setClaudeProbe(async () => ({ exitCode: 1, out: DEAD_AUTH_OUT }));
  try {
    const r = await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE });
    assert.equal(r.ok, false, 'a dead Claude account was accepted at create');
    assert.match(r.because, /sign-in is not working/);
    assert.match(r.because, /Re-authenticate/);
  } finally { create.setClaudeProbe(null); }
});

test('#1903/#1916: a Claude account whose real call SUCCEEDS (exit 0) is accepted', async () => {
  create.setClaudeProbe(async () => ({ exitCode: 0, out: 'ok' }));
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE }), { ok: true });
  } finally { create.setClaudeProbe(null); }
});

test('#1916: a dead token that RETRIES then times out is still read dead from its captured 401', async () => {
  /* The retry-timeout case: exitCode null-ish (killed), but the 401 was printed
     before the kill. Classified by CONTENT, so it still refuses. And "Retrying"
     must NOT be treated as capacity, or a dead token would fail open. */
  create.setClaudeProbe(async () => ({ exitCode: 1, out: DEAD_AUTH_OUT + '\nRetrying in 30 seconds… (attempt 7/10)' }));
  try {
    const r = await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE });
    assert.equal(r.ok, false, 'a retrying dead token failed open instead of being refused');
  } finally { create.setClaudeProbe(null); }
});

test('#1916: a USAGE/RATE-LIMITED account is ACCEPTED (live+paid, must not be blocked)', async () => {
  for (const out of ['You have reached your usage limit for this week.', 'rate limit exceeded', 'Run /usage-credits to continue', 'overloaded_error']) {
    create.setClaudeProbe(async () => ({ exitCode: 1, out }));
    try {
      assert.deepEqual(await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE }), { ok: true },
        'a capacity/rate failure was treated as dead: ' + JSON.stringify(out));
    } finally { create.setClaudeProbe(null); }
  }
});

test('#1916: CAPACITY wins over DEAD_AUTH when BOTH markers appear (precedence, not just presence)', async () => {
  /* The load-bearing ordering: capacity is checked before dead-auth, so an
     account whose output carries a usage-limit AND an auth-ish string fails OPEN
     rather than being refused. Without this fixture the ordering is asserted only
     in prose (a capacity string alone would fall through to UNKNOWN anyway). */
  create.setClaudeProbe(async () => ({ exitCode: 1, out: 'You have reached your usage limit. OAuth access token has expired.' }));
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE }), { ok: true },
      'a capacity+auth co-occurrence was refused instead of failing open (capacity must win)');
  } finally { create.setClaudeProbe(null); }
});

test('#1916: a bare "Please run /login" with NO specific auth failure does NOT refuse (false-refusal guard)', async () => {
  /* The remedy phrase alone is not a dead sign-in: a live call could print a
     /login notice. On a clean exit 0 with only that phrase, the account is
     CONNECTED, not refused. Guards the removal of the bare /login marker. */
  create.setClaudeProbe(async () => ({ exitCode: 0, out: 'ok\n(tip: you can Please run /login to switch accounts)' }));
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE }), { ok: true },
      'a live account that merely mentioned /login was refused');
  } finally { create.setClaudeProbe(null); }
});

test('#1916: a 401 that renders authentication_error in NON-JSON text is still dead', async () => {
  // The marker is the bare `authentication_error`, so both the JSON envelope
  // (`"type": "authentication_error"`) and a plain `API Error: 401 authentication_error`
  // are caught -- neither string appears in a successful "reply ok" response.
  for (const out of ['API Error: 401 authentication_error', '{"type":"error","error":{"type":"authentication_error"}}']) {
    create.setClaudeProbe(async () => ({ exitCode: 1, out }));
    try {
      const r = await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE });
      assert.equal(r.ok, false, 'a non-JSON authentication_error slipped the gate: ' + JSON.stringify(out));
    } finally { create.setClaudeProbe(null); }
  }
});

test('#1916 KNOWN GAP: a dead sign-in that prints ONLY a bare /login (no 401/auth string) fails OPEN', async () => {
  /* Deliberate, per Splinter: only a genuine auth-failure string is dead; a bare
     remedy phrase is not, because a LIVE call could print it, and false-refusing
     a live/heavy user is the worse failure. So this rare dead form slips the
     create gate and is caught later by #1884's board surfacing, not prevented at
     create. If a real dead account is ever observed printing ONLY /login with no
     auth string, revisit -- but not by reintroducing the bare marker (it
     false-refuses live accounts, see the guard above). */
  create.setClaudeProbe(async () => ({ exitCode: 1, out: 'Please run /login' }));
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE }), { ok: true },
      'this is now covered -- flip to ok:false and drop the KNOWN GAP note');
  } finally { create.setClaudeProbe(null); }
});

test('#1903/#1916: a Claude account we CANNOT CONFIRM dead is accepted (fail-open, never a false block)', async () => {
  // A network error with no auth marker -> UNKNOWN -> proceed.
  create.setClaudeProbe(async () => ({ exitCode: 1, out: 'getaddrinfo ENOTFOUND api.anthropic.com' }));
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE }), { ok: true });
  } finally { create.setClaudeProbe(null); }
  // An unrunnable claude (probe can't even start) -> UNKNOWN -> proceed.
  create.setClaudeProbe(async () => ({ exitCode: null, out: '' }));
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'anthropic', accountDir: DEAD_CLAUDE }), { ok: true });
  } finally { create.setClaudeProbe(null); }
});

test('#1903: an UNKNOWN account is accepted here (createAgentInner owns that refusal), and the probe never runs', async () => {
  let asked = false;
  create.setClaudeProbe(async () => { asked = true; return { exitCode: 1, out: DEAD_AUTH_OUT }; });
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'anthropic', accountDir: nodePath.join(HOME, '.claude-nope') }), { ok: true });
    assert.equal(asked, false, 'the live probe ran on an account that is not even known');
  } finally { create.setClaudeProbe(null); }
});

test('#1903/#1916: the DEFAULT account is checked with NO configDir, and a dead default is refused', async () => {
  /* claudeAccountLive is called with configDir=null for the default (the true
     default, not a scoped dir). The stub is dead only when configDir is falsy,
     so a refusal here proves the default was checked as the true default. */
  create.setClaudeProbe(async (configDir) => (configDir
    ? { exitCode: 0, out: 'ok' }
    : { exitCode: 1, out: DEAD_AUTH_OUT }));
  try {
    const r = await create.accountConnectable({ provider: 'anthropic', accountDir: '' });
    assert.equal(r.ok, false, 'a dead DEFAULT account was accepted, or it was checked with the wrong (scoped) dir');
    assert.match(r.because, /sign-in is not working/);
  } finally { create.setClaudeProbe(null); }
});

test('#1903: an OpenAI account whose key OpenAI rejects is refused', async () => {
  openai.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  try {
    const r = await create.accountConnectable({ provider: 'openai', accountDir: DEAD_OPENAI });
    assert.equal(r.ok, false, 'a dead OpenAI account was accepted at create');
    assert.match(r.because, /sign-in is not working/);
  } finally { openai.setFetcher(null); }
});

test('#1903: an OpenAI account OpenAI accepts (200) is accepted, and a scope-restricted 401 is not blocked', async () => {
  openai.setFetcher(async () => ({ status: 200, body: { data: [{ id: 'gpt-4o' }] } }));
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'openai', accountDir: DEAD_OPENAI }), { ok: true });
  } finally { openai.setFetcher(null); }
  openai.setFetcher(async () => ({ status: 403, body: { error: { code: 'insufficient_permissions' } } }));
  try {
    assert.deepEqual(await create.accountConnectable({ provider: 'openai', accountDir: DEAD_OPENAI }), { ok: true });
  } finally { openai.setFetcher(null); }
});
