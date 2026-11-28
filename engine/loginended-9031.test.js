'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9031: an account whose Claude login has run out. Three things that missed it: the patterns that read Claude
 * Code's own sentence (the screen, the Windows stream; NOT Check now, see its test), the line `kosmos accounts` prints, and the mover's
 * idea of a usable account. Pure: no board, no Keychain, no real claude.
 *
 *   node --test engine/loginended-9031.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { isStreamSignInError } = require('./claudesignintext');
const { classify, STATE } = require('./status');
const { accountLine } = require('./accountline');
const ab = require('./autobalance');
const usagepoll = require('./usagepoll');
const create = require('./create');
const subscription = require('./subscription');

test.after(() => create.setClaudeProbe(null));
/* kosmos#8378: two arms stand in for tmux with a #!/bin/sh script run by its shebang line; Kosmos runs no tmux on
   Windows, and Windows cannot run the script. */
const TMUX_STUB = require('../test-support/skip-on-win32').skipOnWin32('it fakes tmux with a #!/bin/sh script run by its shebang line, and Kosmos runs no tmux on Windows');

const NOW = Date.parse('2026-11-24T22:00:00Z');
const H = 3600000;
/* Byte-exact from Claude Code 2.1.332; the first two also from real transcripts (11-22 and 11-24). */
/* Built from two pieces, so an agent reading this file does not show the line the screen reader looks for. */
const REMEDY = ' · Please run ' + '/login';
const LIMIT = 'Login reached its time limit' + REMEDY;
const NONE = 'Not logged in' + REMEDY;
const HEADLESS_LIMIT = 'Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again, or use `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN for unattended jobs';
const HEADLESS_REFRESH = 'Failed to authenticate: OAuth session expired and could not be refreshed. Run `claude auth login` to sign in again';

const pane = () => ({ session: 'made-here', name: 'made-here', claim: 'made-here', command: '2.1.332', title: 'Ready' });

test('#9031: an agent stopped at a login past its limit, or at no login, reads auth_failed, with the line as evidence', () => {
  for (const line of [LIMIT, NONE, NONE.replace('·', '_')]) {
    const r = classify(pane(), '> hello\n● ' + line + '\n');
    assert.equal(r.state, STATE.AUTH_FAILED, 'missed: ' + line);
    assert.ok(r.evidence.startsWith(line), 'the evidence is not the line: ' + r.evidence);
  }
});

test('#9031 CONTROL: the words without Claude Code\'s own remedy, and another tool\'s "not logged in", are not a sign-in failure', () => {
  for (const line of ['The pane said Login reached its time limit, which is #9031.', 'Not logged in',
    'gh: Not logged in to any hosts, then Please run /login was typed', 'Not logged in - Please run /login', 'Not logged in. Run az login. Later: Please run /login']) {
    assert.notEqual(classify(pane(), line + '\n').state, STATE.AUTH_FAILED, 'read as a sign-in failure: ' + line);
  }
});

test('#9031: the Windows stream reads the same two, and the headless sentences', () => {
  for (const text of [LIMIT, NONE, HEADLESS_LIMIT, HEADLESS_REFRESH]) assert.equal(isStreamSignInError(text), true, 'missed: ' + text);
  for (const text of ['the build reached its time limit', 'session expired and could not be refreshed', 'ok']) {
    assert.equal(isStreamSignInError(text), false, 'CONTROL: read as a sign-in failure: ' + text);
  }
});

test('kosmos#9082: create and Check now take "not logged in" and an ended login from their probe as a dead sign-in again', async () => {
  /* #9031's words came out after 0.8.23's promote gate (the probe named the default account's folder, so Claude Code read an
     entry the plain login is not in). kosmos#9082 makes the default probe UNSET, the login its agents use, so these mean a
     dead login again. The folder passed here is a labelled account's (its own entry), not the default. */
  const check = async (out, exitCode) => { create.setClaudeProbe(async () => ({ exitCode, out })); return create.claudeAccountCheck('/u/x/labelled'); };
  for (const out of [NONE, LIMIT, HEADLESS_LIMIT, HEADLESS_REFRESH]) {
    const got = await check(out, 1);
    assert.equal(got.state, subscription.STATE.NONE, 'not read as dead: ' + out);
  }
  assert.equal((await check('ok', 0)).state, subscription.STATE.CONNECTED, 'CONTROL: a real answer');
  assert.equal((await check('API Error: 529 overloaded', 1)).state, subscription.STATE.UNKNOWN, 'CONTROL: capacity is not a dead login');
  // The only gate on this: the default account is probed unset (claudeProbeDir), never with its folder.
  create.setProbeRealHomeForTests(require('./accounts').homeDir());   // review 4: independent of an ambient HOME
  try { assert.equal(create.claudeProbeDir(require('./accounts').homeDir() + '/.claude', { run: () => ({ ran: true, status: 1, out: '' }) }), null, 'the default account would be probed with its folder'); }   // review 2: a stub tmux, never the host's
  finally { create.setProbeRealHomeForTests(null); }
  assert.equal(create.claudeProbeDir('/u/x/labelled'), '/u/x/labelled', 'CONTROL: a labelled account keeps its folder');
});

const row = (connection) => ({ provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'a@example.com', connection });

test('#9031: kosmos accounts says an ended login has expired, whatever its badge, and what to do', () => {
  const ended = /: its sign-in has expired\. The person signs in again to bring its agents back, or moves them to another account, in Settings > AI Models$/;
  for (const badge of ['working', 'signed_in_unverified']) {
    assert.match(accountLine(row({ state: 'connected', badge, loginEnded: true }), NOW), ended, badge);
  }
  assert.equal(accountLine(row({ state: 'connected', badge: 'working' }), NOW), 'Anthropic / Claude: a@example.com: signed in', 'CONTROL: a working login');
  assert.match(accountLine(row({ state: 'connected', badge: 'working', loginEnded: true, loginStopsAt: NOW + H }), NOW),
    /its agents keep working until/, 'CONTROL: while its agents still work, that is what it says');
});

const mrow = (dir, o = {}) => ({ provider: 'anthropic', dir, email: `${dir}@example.test`, memoryShared: true, apiKey: false,
  connection: { badge: 'working' }, weekly: { usedPct: 20, resetsAt: NOW + 72 * H }, fiveHour: null, agentsHere: { names: [], complete: true }, ...o });

test('#9031: the mover never sends agents to an ended login, and an account with one is at risk by login', () => {
  const full = () => mrow('/u/a', { weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: ['raph'], complete: true } });
  const decide = (rows) => ab.decide({ rows, movable: () => true, nowMs: NOW });
  for (const badge of ['working', 'signed_in_unverified']) {
    const spare = mrow('/u/b', { connection: { badge, loginEnded: true } });
    assert.deepEqual(decide([full(), spare]).moves, [], `an ended login (${badge}) was a target`);
    assert.equal(ab.bulkTargetable(spare, NOW), false, `the page's bulk move offers an ended login (${badge})`);
    assert.equal(decide([full(), mrow('/u/b', { connection: { badge } })]).moves.length, 1, `CONTROL: ${badge} with its login good is a target`);
  }
  const d = decide([mrow('/u/a', { connection: { badge: 'signed_in_unverified', loginEnded: true }, agentsHere: { names: ['raph'], complete: true } }), mrow('/u/b')]);
  assert.deepEqual(d.atRisk.map((x) => [x.from, x.kind]), [['/u/a', 'login']]);
  assert.match(d.atRisk[0].why, /login has stopped working/);
});

const cred = (o) => JSON.stringify({ claudeAiOauth: { accessToken: 'not-a-real-token', ...o } });
const state = async (o) => (await usagepoll.tokenStateFor({ dir: '/u/x' }, { now: NOW, platform: 'darwin', realHome: '/', readCred: async () => cred(o) })).state;

test('#9031: the usage reader tells an ended login from an access token waiting for its next renewal', async () => {
  assert.equal(await state({ expiresAt: NOW - 1, refreshTokenExpiresAt: NOW - 1 }), 'login-ended');
  assert.equal(await state({ expiresAt: NOW, refreshTokenExpiresAt: NOW }), 'login-ended', 'at the moment itself');
  assert.equal(await state({ expiresAt: NOW - 1, refreshTokenExpiresAt: NOW + 1 }), 'token-expired', 'CONTROL: it can still be renewed');
  assert.equal(await state({ expiresAt: NOW - 1 }), 'token-expired', 'CONTROL: no date to read says nothing about the login');
  for (const odd of [0, -5, null, '1']) assert.equal(await state({ expiresAt: NOW - 1, refreshTokenExpiresAt: odd }), 'token-expired', 'not a date: ' + odd);
  assert.equal(await state({ expiresAt: NOW + 30000, refreshTokenExpiresAt: NOW - 1 }), 'token-expired', 'an access token with seconds left still works');
  /* What Claude Code leaves when a renewal is refused for good, its login date still ahead. */
  assert.equal(await state({ accessToken: '', refreshToken: '', expiresAt: 0, refreshTokenExpiresAt: NOW + 72 * H, loginEnded: 'time_limit' }), 'login-ended');
  assert.equal(await state({ accessToken: '', refreshToken: 'x' }), 'no-token', 'CONTROL: it can still be renewed');
  assert.equal(await state({ accessToken: '' }), 'no-token', 'CONTROL: no renewal token to read is not an emptied one');
  assert.equal(await state({ accessToken: undefined, refreshToken: '' }), 'no-token', 'CONTROL: nor is a missing access token');
  assert.equal((await usagepoll.tokenStateFor({ dir: '/u/x' }, { now: NOW, platform: 'darwin', realHome: '/', readCred: async () => '{}' })).state, 'no-token', 'a body with no login in it');
  assert.equal(await state({ expiresAt: NOW + H, refreshTokenExpiresAt: NOW - 1 }), 'ok', 'CONTROL: its agents still work on the access they hold');
});

test('#9031: the sweep reads an ended login as a stopped one, never as a blip, and a renewal as a blip', () => {
  const list = [{ dir: '/u/work', memoryShared: true, email: 'w@example.test' }, { dir: '/u/spare', memoryShared: true, email: 's@example.test' }];
  const rec = (usedPct, st, email) => ({ at: NOW, measuredAt: NOW, state: st, email, weekly: { usedPct, resetsAt: (NOW + 72 * H) / 1000 }, fiveHour: null });
  const at = (spareState) => ab.rowsFromReadings({ list, nowMs: NOW,
    readUsage: (dir) => (dir === '/u/spare' ? rec(10, spareState, 's@example.test') : rec(95, 'ok', 'w@example.test')),
    agentsOn: (dir) => ({ names: dir === '/u/work' ? ['ada'] : [], complete: true }) });
  assert.equal(at('login-ended')[1].connection.badge, 'rejected');
  assert.deepEqual(ab.decide({ rows: at('login-ended'), movable: () => true, nowMs: NOW }).moves, [], 'agents would move onto an ended login');
  assert.equal(ab.decide({ rows: at('token-expired'), movable: () => true, nowMs: NOW }).moves.length, 1, 'CONTROL: a renewal is a blip');
});

test('kosmos#9082 review 1: the default is probed with the tmux server\'s pinned folder when set, else unset; a sandbox keeps its folder', () => {
  const nodePath = require('node:path');
  const os = require('node:os');
  const def = nodePath.join(require('./accounts').homeDir(), '.claude');
  create.setProbeRealHomeForTests(require('./accounts').homeDir());   // review 4: independent of an ambient HOME
  const tmux = (status, out, ran = true) => ({ run: () => ({ ran, status, out }) });
  assert.equal(create.claudeProbeDir(def, tmux(0, 'CLAUDE_CONFIG_DIR=/Users/x/.claude\n')), '/Users/x/.claude', 'a tmux-pinned folder (the supervisor pins default agents to it) was not probed');
  assert.equal(create.claudeProbeDir(def, tmux(0, '-CLAUDE_CONFIG_DIR\n')), null, 'a removed global is not a pin');
  assert.equal(create.claudeProbeDir(def, tmux(1, '')), null, 'tmux says unknown variable: unset');
  assert.equal(create.claudeProbeDir(def, tmux(null, '', false)), null, 'no tmux to ask: unset, as the supervisor finds nothing either');
  assert.equal(create.claudeProbeDir('/u/x/labelled', tmux(0, 'CLAUDE_CONFIG_DIR=/elsewhere\n')), '/u/x/labelled', 'CONTROL: a labelled account keeps its own folder');
  const was = process.env.AGENT_WORKFORCE_HOME;
  const sandbox = require('node:fs').mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-9082-sandbox-'));
  process.env.AGENT_WORKFORCE_HOME = sandbox;
  try {
    const sdef = nodePath.join(sandbox, '.claude');
    assert.equal(require('./accounts').isDefaultDir(sdef), true, 'CONTROL: the sandbox folder is the default there');
    create.setProbeRealHomeForTests(null);
    assert.equal(create.claudeProbeDir(sdef, tmux(1, '')), sdef, 'a sandboxed board would probe the real login');
  } finally { create.setProbeRealHomeForTests(null); if (was === undefined) delete process.env.AGENT_WORKFORCE_HOME; else process.env.AGENT_WORKFORCE_HOME = was; }
});

test('kosmos#9082 review 1: #9031\'s state words count only from a run that failed', async () => {
  const check = async (out, exitCode) => { create.setClaudeProbe(async () => ({ exitCode, out })); return create.claudeAccountCheck('/u/x/labelled'); };
  try {
    assert.equal((await check('A notice: Not logged in · Please run /' + 'login (another tool)\nok', 0)).state, subscription.STATE.CONNECTED, 'a run that answered was read as dead');
    assert.equal((await check(NONE, 1)).state, subscription.STATE.NONE, 'CONTROL: the same words from a failed run are dead');
    assert.equal((await check('Login expired · Please run /' + 'login', 0)).state, subscription.STATE.NONE, 'CONTROL: a refused token stays dead whatever the exit');
  } finally { create.setClaudeProbe(null); }
});

test('kosmos#9082 review 2: the tmux lookup runs without TMUX, so a board started in a pane asks the default server', { skip: TMUX_STUB }, () => {
  const fs = require('node:fs'); const nodePath = require('node:path'); const os = require('node:os');
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-9082-tmux-'));
  const stub = nodePath.join(dir, 'tmux');
  fs.writeFileSync(stub, '#!/bin/sh\necho "CLAUDE_CONFIG_DIR=${TMUX:-noTMUX}"\n', { mode: 0o755 });
  const was = process.env.TMUX;
  process.env.TMUX = '/tmp/some-pane-socket,1,0';
  try {
    assert.equal(require('./sessionccd').globalClaudeDir({ bin: stub }), 'noTMUX', 'the lookup inherited the pane\'s TMUX');
    assert.equal(require('./sessionccd').globalClaudeDir({ bin: stub, env: { ...process.env } }), '/tmp/some-pane-socket,1,0', 'CONTROL: the stub reports TMUX when given it');
  } finally { if (was === undefined) delete process.env.TMUX; else process.env.TMUX = was; }
});

test('kosmos#9082 review 3: a sandbox that replaces HOME itself keeps its folder (the real home comes from the OS)', () => {
  const fs = require('node:fs'); const nodePath = require('node:path'); const os = require('node:os');
  const sandbox = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-9082-home-'));
  const wasHome = process.env.HOME; const wasAWH = process.env.AGENT_WORKFORCE_HOME;
  // kosmos#8378: USERPROFILE beside HOME, since os.homedir() reads USERPROFILE on Windows, not HOME.
  const wasProfile = process.env.USERPROFILE;
  process.env.HOME = sandbox; process.env.USERPROFILE = sandbox; delete process.env.AGENT_WORKFORCE_HOME;
  const noPin = { run: () => ({ ran: true, status: 1, out: '' }) };
  try {
    const sdef = nodePath.join(sandbox, '.claude');
    assert.equal(require('./accounts').isDefaultDir(sdef), true, 'CONTROL: the sandbox folder is the default there');
    assert.equal(create.claudeProbeDir(sdef, noPin), sdef, 'a harness that replaced HOME would probe the real login');
    create.setProbeRealHomeForTests(sandbox);
    assert.equal(create.claudeProbeDir(sdef, noPin), null, 'CONTROL: named as the real home, it is probed unset');
  } finally {
    create.setProbeRealHomeForTests(null);
    if (wasHome === undefined) delete process.env.HOME; else process.env.HOME = wasHome;
    if (wasProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = wasProfile;
    if (wasAWH === undefined) delete process.env.AGENT_WORKFORCE_HOME; else process.env.AGENT_WORKFORCE_HOME = wasAWH;
  }
});

test('kosmos#9082 review 3: a pin reaches the probe through the real lookup (the board\'s tmux, not a stub run)', { skip: TMUX_STUB }, () => {
  const fs = require('node:fs'); const nodePath = require('node:path'); const os = require('node:os');
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-9082-pin-'));
  const stub = nodePath.join(dir, 'tmux');
  fs.writeFileSync(stub, '#!/bin/sh\n[ "$1 $2 $3" = "show-environment -g CLAUDE_CONFIG_DIR" ] && echo "CLAUDE_CONFIG_DIR=/pinned/by/tmux" && exit 0\nexit 1\n', { mode: 0o755 });
  const was = process.env.AGENT_WORKFORCE_TMUX_BIN;
  process.env.AGENT_WORKFORCE_TMUX_BIN = stub;
  create.setProbeRealHomeForTests(require('./accounts').homeDir());   // review 4
  try {
    const def = nodePath.join(require('./accounts').homeDir(), '.claude');
    assert.equal(require('./status').boardTmux(), stub, 'CONTROL: the board would ask this tmux');
    assert.equal(create.claudeProbeDir(def), '/pinned/by/tmux', 'a tmux-pinned folder did not reach the probe through the real lookup');
  } finally {
    create.setProbeRealHomeForTests(null);
    if (was === undefined) delete process.env.AGENT_WORKFORCE_TMUX_BIN; else process.env.AGENT_WORKFORCE_TMUX_BIN = was;
  }
});
