'use strict';

/*
 * #4491: guardTokenOnlyFolder writes a token-only agent's <folder>/.claude/settings.json so a sandboxed
 * shell cannot read board.token and cannot turn its own guard off, while its own data folder, the loopback
 * board and the network still work. These tests assert the CONFIG WRITTEN (the deny set, the sandbox block,
 * merge/idempotency, safe refusal) -- NOT that Seatbelt enforces it, which is Claude Code's job and was
 * measured by hand on this Mac in the branch's spike (card comments, three arms). Same test boundary as the
 * guide's own tests.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'boardkeychain-4491-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });

const setup = require('./setup-assistant');
const store = require('./store');
const sendertoken = require('./sendertoken');
const TOKEN_FILE = require('./boardauth').TOKEN_FILE;

// store.ROOT is AGENT_WORKFORCE_DATA + '/Kosmos'; that is where board.token and the token-only list live,
// and what guardTokenOnlyFolder defaults dataRoot to in production (called with no deps).
fs.mkdirSync(store.ROOT, { recursive: true });
const DEPS = { platform: 'darwin', dataRoot: store.ROOT, home: process.env.AGENT_WORKFORCE_HOME };
function agentDir(name) { return path.join(SANDBOX, 'workers', name); }
function readSettings(dir) { return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')); }
function tokenAbs() { return path.join(store.ROOT, TOKEN_FILE); }
function ruleAbs(p) { return '//' + String(p).replace(/^\/+/, ''); }
// The sandbox filesystem block realOr's its paths (symlink correctness, e.g. /var -> /private/var on
// macOS), so sandbox assertions must compare against resolved paths, not the raw ones.
function realOr(p) { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } }

test('writes the board.token Read deny and the settings Edit denies (own + shared ~/.claude)', () => {
  const dir = agentDir('pilot-a');
  const r = setup.guardTokenOnlyFolder(dir, 'pilot-a', DEPS);
  assert.deepEqual(r, { ok: true });
  const s = readSettings(dir);
  const deny = s.permissions.deny;
  assert.ok(deny.includes(`Read(${ruleAbs(tokenAbs())})`), 'board.token is not Read-denied: ' + JSON.stringify(deny));
  assert.ok(deny.includes(`Read(${ruleAbs(path.join(store.ROOT, '.' + TOKEN_FILE))}.*)`), 'the token temp copy is not denied');
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(dir, '.claude', 'settings.json'))})`), 'own settings.json not Edit-denied');
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(dir, '.claude', 'settings.local.json'))})`), 'own settings.local.json not Edit-denied');
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude', 'settings.json'))})`), 'shared ~/.claude/settings.json not Edit-denied (hole 1)');
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude', 'settings.local.json'))})`), 'shared ~/.claude/settings.local.json not Edit-denied');
});

test('does NOT deny the agent own data folder, so a normal working agent can still work', () => {
  const dir = agentDir('pilot-work');
  setup.guardTokenOnlyFolder(dir, 'pilot-work', DEPS);
  const deny = readSettings(dir).permissions.deny;
  // The guide denies the whole data root (Read(<dataRoot>/**)); a token-only agent must NOT.
  assert.ok(!deny.some((r) => r === `Read(${ruleAbs(store.ROOT)}/**)`), 'a token-only agent wrongly had its whole data folder denied like a guide');
});

test('on darwin the sandbox block is enabled, cannot be self-disabled, keeps loopback, and denies read/write', () => {
  const dir = agentDir('pilot-sb');
  setup.guardTokenOnlyFolder(dir, 'pilot-sb', DEPS);
  const sb = readSettings(dir).sandbox;
  assert.equal(sb.enabled, true);
  assert.equal(sb.autoAllowBashIfSandboxed, true);
  assert.equal(sb.allowUnsandboxedCommands, false, 'without this a refused command is re-run with dangerouslyDisableSandbox');
  assert.equal(sb.network.allowLocalBinding, true, 'the loopback board must stay reachable');
  assert.ok(sb.filesystem.denyRead.includes(realOr(tokenAbs())), 'board.token not in sandbox denyRead');
  // The agent's OWN .claude is denied at DIR level (safe: no runtime state there).
  assert.ok(sb.filesystem.denyWrite.includes(realOr(path.join(dir, '.claude'))), 'own .claude not in denyWrite (shell printf > settings.json)');
  // The config HOME ~/.claude is denied at FILE level only (W4: the whole dir holds Claude Code's own
  // runtime state, so a dir-level denyWrite there would break normal operation).
  const homeClaude = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude');
  assert.ok(sb.filesystem.denyWrite.includes(realOr(path.join(homeClaude, 'settings.json'))), '~/.claude/settings.json not in denyWrite');
  assert.ok(sb.filesystem.denyWrite.includes(realOr(path.join(homeClaude, 'settings.local.json'))), '~/.claude/settings.local.json not in denyWrite');
  assert.ok(!sb.filesystem.denyWrite.includes(realOr(homeClaude)), 'the whole ~/.claude was denyWritten (would break Claude Code runtime state) — W4');
});

test('covers board.token in a legacy root and the default-world base (concrete), not just the current store', () => {
  const dir = agentDir('pilot-roots');
  const legacy = path.join(SANDBOX, 'legacy-support', 'Kosmos');
  const worldBase = path.join(SANDBOX, 'world-base');
  setup.guardTokenOnlyFolder(dir, 'pilot-roots', { ...DEPS, legacyRoots: [legacy], worldsBase: worldBase });
  const deny = readSettings(dir).permissions.deny;
  assert.ok(deny.includes(`Read(${ruleAbs(path.join(legacy, TOKEN_FILE))})`), 'the legacy root board.token is not denied');
  assert.ok(deny.includes(`Read(${ruleAbs(path.join(worldBase, TOKEN_FILE))})`), 'the default-world base board.token is not denied');
});

test('covers the ~/.claude-* account config variants with an Edit glob (CLAUDE_CONFIG_DIR)', () => {
  const dir = agentDir('pilot-account');
  setup.guardTokenOnlyFolder(dir, 'pilot-account', DEPS);
  const deny = readSettings(dir).permissions.deny;
  const star = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude-*');
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(star, 'settings.json'))})`), 'the ~/.claude-* settings.json Edit glob is missing (hole 2)');
  assert.ok(deny.includes(`Edit(${ruleAbs(path.join(star, 'settings.local.json'))})`), 'the ~/.claude-* settings.local.json Edit glob is missing');
});

test('preserves pre-existing sandbox.filesystem and sandbox.network entries on merge', () => {
  const dir = agentDir('pilot-sbmerge');
  const file = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ sandbox: { network: { allowUnixSockets: ['/tmp/x.sock'] }, filesystem: { denyRead: ['/some/other/secret'], denyWrite: ['/some/other/dir'] } } }) + '\n');
  setup.guardTokenOnlyFolder(dir, 'pilot-sbmerge', DEPS);
  const sb = readSettings(dir).sandbox;
  assert.deepEqual(sb.network.allowUnixSockets, ['/tmp/x.sock'], 'a pre-existing network key was dropped');
  assert.equal(sb.network.allowLocalBinding, true, 'allowLocalBinding was not added alongside');
  assert.ok(sb.filesystem.denyRead.includes('/some/other/secret'), 'a pre-existing denyRead entry was dropped');
  assert.ok(sb.filesystem.denyWrite.includes('/some/other/dir'), 'a pre-existing denyWrite entry was dropped');
  assert.ok(sb.filesystem.denyRead.includes(realOr(tokenAbs())), 'the token denyRead was not added alongside');
});

test('off darwin, no sandbox block is written (it is Seatbelt-specific)', () => {
  const dir = agentDir('pilot-linux');
  setup.guardTokenOnlyFolder(dir, 'pilot-linux', { ...DEPS, platform: 'linux' });
  const s = readSettings(dir);
  assert.equal(s.sandbox, undefined, 'a sandbox block was written off darwin');
  assert.ok(s.permissions.deny.includes(`Read(${ruleAbs(tokenAbs())})`), 'the permission denies still apply off darwin');
});

test('merges with a persons own existing rules and is idempotent', () => {
  const dir = agentDir('pilot-merge');
  const file = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ permissions: { deny: ['Read(//some/private/thing)'] }, env: { KEEP: '1' } }) + '\n');
  setup.guardTokenOnlyFolder(dir, 'pilot-merge', DEPS);
  let s = readSettings(dir);
  assert.ok(s.permissions.deny.includes('Read(//some/private/thing)'), 'a persons own rule was dropped');
  assert.ok(s.permissions.deny.includes(`Read(${ruleAbs(tokenAbs())})`), 'the token rule was not added');
  assert.equal(s.env.KEEP, '1', 'an unrelated setting was lost');
  const first = JSON.stringify(s);
  setup.guardTokenOnlyFolder(dir, 'pilot-merge', DEPS);   // second run
  assert.equal(JSON.stringify(readSettings(dir)), first, 'a second run changed the file (not idempotent)');
  // no duplicate token rule
  const n = readSettings(dir).permissions.deny.filter((r) => r === `Read(${ruleAbs(tokenAbs())})`).length;
  assert.equal(n, 1, 'the token rule was duplicated on re-run');
});

test('returns {ok:false} on a bad folder and never throws', () => {
  assert.deepEqual(setup.guardTokenOnlyFolder('', 'x', DEPS), { ok: false, because: 'no folder' });
  assert.deepEqual(setup.guardTokenOnlyFolder('/some/dir', '', DEPS), { ok: false, because: 'no folder' });
});

test('managedSettingsPresent is false off darwin, and refreshTokenOnlyGuards warns when the belt is absent', () => {
  assert.equal(setup.managedSettingsPresent('linux'), false);
  // list two agents via the real token-only file (store.ROOT-based) + stub workerDir; managed belt absent.
  const listFile = sendertoken.tokenOnlyFile();
  fs.writeFileSync(listFile, JSON.stringify({ agents: ['echo', 'two'] }) + '\n');
  const warned = [];
  const realWrite = process.stderr.write;
  process.stderr.write = (s) => { warned.push(String(s)); return true; };
  let out;
  try {
    out = setup.refreshTokenOnlyGuards({ ...DEPS, workerDir: (n) => agentDir('refresh-' + n) });
  } finally { process.stderr.write = realWrite; }
  assert.deepEqual(out.guarded.sort(), ['echo', 'two'], 'not every listed agent was guarded: ' + JSON.stringify(out));
  assert.equal(out.managed, false);
  assert.ok(warned.join('').includes('#4491'), 'no managed-belt-absent warning was emitted');
  // each guarded folder really got the token deny
  const s = readSettings(agentDir('refresh-echo'));
  assert.ok(s.permissions.deny.includes(`Read(${ruleAbs(tokenAbs())})`), 'echo was listed as guarded but its settings lack the token deny');
});

test('off darwin, refreshTokenOnlyGuards guards without warning (managed-settings is a macOS concept)', () => {
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['lin'] }) + '\n');
  const warned = [];
  const realWrite = process.stderr.write;
  process.stderr.write = (s) => { warned.push(String(s)); return true; };
  let out;
  try {
    out = setup.refreshTokenOnlyGuards({ ...DEPS, platform: 'linux', workerDir: (n) => agentDir('lin-' + n) });
  } finally { process.stderr.write = realWrite; }
  assert.deepEqual(out.guarded, ['lin'], 'the agent was not guarded off darwin');
  assert.ok(!warned.join('').includes('#4491'), 'the managed-belt warning fired off darwin, where it is misleading');
  assert.equal(readSettings(agentDir('lin-lin')).sandbox, undefined, 'a sandbox block was written off darwin');
});

test('refreshTokenOnlyGuards is a safe no-op when the list is absent', () => {
  try { fs.rmSync(sendertoken.tokenOnlyFile()); } catch { /* already gone */ }
  const out = setup.refreshTokenOnlyGuards(DEPS);
  assert.deepEqual(out.guarded, []);
});

test('no em dash in a settings file this test writes', () => {
  const dir = agentDir('pilot-emdash');
  setup.guardTokenOnlyFolder(dir, 'pilot-emdash', DEPS);
  const raw = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
  assert.ok(!raw.includes('—'), 'an em dash reached a written settings file');
});

test('sendertoken.tokenOnlyList is the one parse site and tokenOnlyFor reads it', () => {
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['a', 'b', 42, ''] }) + '\n');
  assert.deepEqual(sendertoken.tokenOnlyList(), ['a', 'b'], 'non-string/empty entries were not filtered');
  assert.equal(sendertoken.tokenOnlyFor('a'), true);
  assert.equal(sendertoken.tokenOnlyFor('z'), false);
  try { fs.rmSync(sendertoken.tokenOnlyFile()); } catch { /* gone */ }
  assert.deepEqual(sendertoken.tokenOnlyList(), [], 'an absent list is not empty');
});
