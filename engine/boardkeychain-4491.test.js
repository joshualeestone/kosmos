'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)

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
// The sandbox filesystem block canonicalizes its paths (symlink correctness, e.g. /var -> /private/var
// on macOS, and the test SANDBOX under os.tmpdir() is itself such a symlink), so sandbox assertions must
// compare against resolved paths. realOr for a dir that exists; realOrLeaf for a file whose leaf may not
// (resolve the existing parent, keep the absent basename) -- mirrors the code's two helpers.
function realOr(p) { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } }
function realOrLeaf(p) {
  const abs = path.resolve(p); let dir = path.dirname(abs); const tail = [path.basename(abs)];
  for (;;) {
    try { return path.join(fs.realpathSync.native(dir), ...tail); } catch { /* climb */ }
    const parent = path.dirname(dir); if (parent === dir) return abs;
    tail.unshift(path.basename(dir)); dir = parent;
  }
}

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
  assert.ok(sb.filesystem.denyRead.includes(realOrLeaf(tokenAbs())), 'board.token not in sandbox denyRead');
  // The agent's OWN .claude is denied at DIR level (safe: no runtime state there).
  assert.ok(sb.filesystem.denyWrite.includes(realOr(path.join(dir, '.claude'))), 'own .claude not in denyWrite (shell printf > settings.json)');
  // The config HOME ~/.claude is denied at FILE level only (W4: the whole dir holds Claude Code's own
  // runtime state, so a dir-level denyWrite there would break normal operation).
  const homeClaude = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude');
  assert.ok(sb.filesystem.denyWrite.includes(realOrLeaf(path.join(homeClaude, 'settings.json'))), '~/.claude/settings.json not in denyWrite');
  assert.ok(sb.filesystem.denyWrite.includes(realOrLeaf(path.join(homeClaude, 'settings.local.json'))), '~/.claude/settings.local.json not in denyWrite');
  // Create the dir so the negative check is not vacuous: realOrLeaf(homeClaude) now resolves, so if a
  // dir-level deny WERE wrongly added the assertion could actually catch it (W4 regression guard).
  fs.mkdirSync(homeClaude, { recursive: true });
  assert.ok(!sb.filesystem.denyWrite.includes(realOrLeaf(homeClaude)), 'the whole ~/.claude was denyWritten (would break Claude Code runtime state): W4');
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
  assert.ok(sb.filesystem.denyRead.includes(realOrLeaf(tokenAbs())), 'the token denyRead was not added alongside');
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
  assert.ok(!raw.includes('\u2014'), 'an em dash reached a written settings file');
});

test('sendertoken.tokenOnlyList is the one parse site and tokenOnlyFor reads it', () => {
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['a', 'b', 42, ''] }) + '\n');
  assert.deepEqual(sendertoken.tokenOnlyList(), ['a', 'b'], 'non-string/empty entries were not filtered');
  assert.equal(sendertoken.tokenOnlyFor('a'), true);
  assert.equal(sendertoken.tokenOnlyFor('z'), false);
  try { fs.rmSync(sendertoken.tokenOnlyFile()); } catch { /* gone */ }
  assert.deepEqual(sendertoken.tokenOnlyList(), [], 'an absent list is not empty');
});

test('an EXISTING ~/.claude-<x> account home gets concrete denies in both layers (not only the glob)', () => {
  const home = path.join(SANDBOX, 'acct-home');
  const acct = path.join(home, '.claude-acctx');
  fs.mkdirSync(acct, { recursive: true });   // an existing CLAUDE_CONFIG_DIR account home
  const dir = agentDir('pilot-acctx');
  setup.guardTokenOnlyFolder(dir, 'pilot-acctx', { ...DEPS, home });
  const s = readSettings(dir);
  // permission layer: concrete Edit denies for the real account home
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(path.join(acct, 'settings.json'))})`), 'the existing account home settings.json is not concretely Edit-denied');
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(path.join(acct, 'settings.local.json'))})`), 'the existing account home settings.local.json is not concretely Edit-denied');
  // sandbox layer: concrete denyWrite for the same files (measured file-write deny, not only the glob)
  assert.ok(s.sandbox.filesystem.denyWrite.includes(realOrLeaf(path.join(acct, 'settings.json'))), 'the existing account home settings.json is not in sandbox denyWrite');
  assert.ok(s.sandbox.filesystem.denyWrite.includes(realOrLeaf(path.join(acct, 'settings.local.json'))), 'the existing account home settings.local.json is not in sandbox denyWrite');
});

test('legacy and default-world board.token are in the sandbox denyRead too, not only the permission layer', () => {
  const dir = agentDir('pilot-sbroots');
  const legacy = path.join(SANDBOX, 'sbroots-legacy', 'Kosmos');
  const worldBase = path.join(SANDBOX, 'sbroots-world');
  setup.guardTokenOnlyFolder(dir, 'pilot-sbroots', { ...DEPS, legacyRoots: [legacy], worldsBase: worldBase });
  const dr = readSettings(dir).sandbox.filesystem.denyRead;
  assert.ok(dr.includes(realOrLeaf(path.join(legacy, TOKEN_FILE))), 'the legacy board.token is not in sandbox denyRead');
  assert.ok(dr.includes(realOrLeaf(path.join(worldBase, TOKEN_FILE))), 'the default-world board.token is not in sandbox denyRead');
});

test('#4475: every agent\'s sender-token folder is Read-denied (current, legacy and default-world roots) and in the sandbox denyRead', () => {
  const dir = agentDir('pilot-tokens');
  const legacy = path.join(SANDBOX, 'tok-legacy', 'Kosmos');
  const worldBase = path.join(SANDBOX, 'tok-world');
  setup.guardTokenOnlyFolder(dir, 'pilot-tokens', { ...DEPS, legacyRoots: [legacy], worldsBase: worldBase });
  const s = readSettings(dir);
  for (const root of [store.ROOT, legacy, worldBase]) {
    const tokens = path.join(root, 'sendertokens');
    assert.ok(s.permissions.deny.includes(`Read(${ruleAbs(tokens)}/**)`), 'another agent\'s token files are readable under ' + root + ': ' + JSON.stringify(s.permissions.deny));
    assert.ok(s.sandbox.filesystem.denyRead.includes(realOrLeaf(tokens)), 'the sender-token folder is not in sandbox denyRead under ' + root);
  }
  // CONTROL: the token-only list (read by the supervisor, outside the sandbox) and the agent's own folder are not denied.
  assert.ok(!s.permissions.deny.some((r) => r.startsWith('Read(') && r.includes('agent-token-only.json')), 'the token-only list was Read-denied');
  assert.ok(path.dirname(sendertoken.tokenOnlyFile()) === store.ROOT, 'CONTROL: the token-only list moved into a denied folder');
});

test('#4475: the records the board trusts, and the sender-token folder, are write-denied (permission and sandbox)', () => {
  const dir = agentDir('pilot-trusted');
  const legacy = path.join(SANDBOX, 'tr-legacy', 'Kosmos');
  setup.guardTokenOnlyFolder(dir, 'pilot-trusted', { ...DEPS, legacyRoots: [legacy] });
  const s = readSettings(dir);
  for (const root of [store.ROOT, legacy]) {
    for (const f of ['created.jsonl', 'ended-agents.jsonl', 'agent-token-only.json']) {
      const p = path.join(root, f);
      assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(p)})`), f + ' under ' + root + ' is writable: a forged birth or an erased end');
      assert.ok(s.sandbox.filesystem.denyWrite.includes(realOrLeaf(p)), f + ' under ' + root + ' is not in sandbox denyWrite');
    }
    const tokens = path.join(root, 'sendertokens');
    assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(tokens)}/**)`), 'the sender-token folder is writable under ' + root);
    assert.ok(s.sandbox.filesystem.denyWrite.includes(realOrLeaf(tokens)), 'the sender-token folder is not in sandbox denyWrite under ' + root);
  }
  // CONTROL: these are the same files the board writes and reads, so a test of the right paths can fail.
  assert.equal(require('./create').createdLogFile(), path.join(store.ROOT, 'created.jsonl'));
  assert.equal(sendertoken.endedLogFile(), path.join(store.ROOT, 'ended-agents.jsonl'));
  assert.equal(sendertoken.tokenOnlyFile(), path.join(store.ROOT, 'agent-token-only.json'));
});

test('#4475: the supervisor\'s launch hand-off folders are Read-denied (beside the data root, and in the app folder)', () => {
  const dir = agentDir('pilot-launch');
  const app = path.join(SANDBOX, 'app');
  setup.guardTokenOnlyFolder(dir, 'pilot-launch', { ...DEPS, appRoot: app });
  const s = readSettings(dir);
  for (const p of [path.join(path.dirname(store.ROOT), 'launch-secrets'), path.join(app, 'launch-secrets')]) {
    assert.ok(s.permissions.deny.includes(`Read(${ruleAbs(p)}/**)`), 'a waiting launch token is readable at ' + p);
    assert.ok(s.sandbox.filesystem.denyRead.includes(realOrLeaf(p)), p + ' is not in sandbox denyRead');
  }
});

test('realOrLeaf: resolves an existing leaf (incl a symlink), a symlinked parent of an absent leaf, and an all-missing path', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'realorleaf-'));
  // existing symlink leaf -> target: resolves to the target
  const target = path.join(base, 'target.txt'); fs.writeFileSync(target, 'x');
  const link = path.join(base, 'link.txt'); fs.symlinkSync(target, link);
  assert.equal(setup.realOrLeaf(link), fs.realpathSync.native(target), 'an existing symlink leaf was not resolved to its target');
  // symlinked PARENT, absent leaf: parent is followed, absent basename kept
  const realDir = path.join(base, 'real'); fs.mkdirSync(realDir);
  const linkDir = path.join(base, 'ldir'); fs.symlinkSync(realDir, linkDir);
  assert.equal(setup.realOrLeaf(path.join(linkDir, 'nope.json')), path.join(fs.realpathSync.native(realDir), 'nope.json'), 'a symlinked parent of an absent leaf was not followed');
  // all-missing path: returns the resolved-absolute form without throwing
  const missing = path.join(base, 'no', 'such', 'dir', 'x.json');
  assert.equal(setup.realOrLeaf(missing), path.join(fs.realpathSync.native(base), 'no', 'such', 'dir', 'x.json'), 'an all-missing path under an existing base was not rejoined correctly');
});
