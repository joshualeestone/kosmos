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
// runner/runnerOf: the guard is a Claude Code settings file, so it now refuses an unnamed or non-Claude runner
// (#4491 review WARNING 1); these tests name Claude unless they test that refusal.
const DEPS = { platform: 'darwin', dataRoot: store.ROOT, home: process.env.AGENT_WORKFORCE_HOME, runner: 'claude', runnerOf: () => 'claude' };
/* An agent's folder, made as creation makes it: the board-start refresh guards only agents that have one (review 11). */
function agentDir(name) { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
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

test('sendertoken.tokenOnlyList is the reader membership and the refresh use (undo has its own, stricter one), and tokenOnlyFor reads it', () => {
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['a', 'b', 42, ''] }) + '\n');
  assert.deepEqual(sendertoken.tokenOnlyList(), ['a', 'b'], 'non-string/empty entries were not filtered');
  assert.equal(sendertoken.tokenOnlyFor('a'), true);
  assert.equal(sendertoken.tokenOnlyFor('z'), false);
  try { fs.rmSync(sendertoken.tokenOnlyFile()); } catch { /* gone */ }
  assert.deepEqual(sendertoken.tokenOnlyList(), [], 'an absent list reads as empty');
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

/* ---- #4491 review (self-review, BLOCKERs 1 and 2, WARNINGs 1 and 4) ---- */

test('BLOCKER 1: every board.token path, its temp copy and the token-only list are denied WRITES too, in both layers', () => {
  const dir = agentDir('pilot-write');
  assert.equal(setup.guardTokenOnlyFolder(dir, 'pilot-write', DEPS).ok, true);
  const st = readSettings(dir);
  const list = sendertoken.tokenOnlyFile();
  assert.ok(st.permissions.deny.includes(`Edit(${ruleAbs(tokenAbs())})`), 'a file tool can still WRITE board.token');
  assert.ok(st.permissions.deny.includes(`Edit(${ruleAbs(path.join(store.ROOT, '.' + TOKEN_FILE))}.*)`), 'the temp copy can be written');
  assert.ok(st.permissions.deny.includes(`Edit(${ruleAbs(list)})`), 'the agent can delete itself from the token-only list');
  const dw = st.sandbox.filesystem.denyWrite;   // already resolved by the guard (realOrLeaf)
  assert.ok(dw.includes(fs.realpathSync(store.ROOT) + path.sep + TOKEN_FILE), 'a shell can still write board.token');
  assert.ok(dw.includes(fs.realpathSync(path.dirname(list)) + path.sep + path.basename(list)), 'a shell can still edit the token-only list');
});

test('BLOCKER 2: every named world store is covered (read and write), not only the current one', () => {
  const base = path.join(SANDBOX, 'worldsbase');
  const w1 = path.join(SANDBOX, 'worlds', 'w1', 'Kosmos'); const w2 = path.join(SANDBOX, 'worlds', 'w2', 'Kosmos');
  for (const d of [base, w1, w2]) fs.mkdirSync(d, { recursive: true });
  const real = require('./worlds');
  const worlds = { listWorlds: (b) => (b === base ? ['w1', 'w2'] : []), worldStoreRoot: (b, w) => (w === 'w1' ? w1 : w2), registryPath: real.registryPath, WORLDS_SUBDIR: real.WORLDS_SUBDIR };
  const dir = agentDir('pilot-worlds');
  assert.equal(setup.guardTokenOnlyFolder(dir, 'pilot-worlds', { ...DEPS, legacyRoots: [], worldsBase: base, worlds }).ok, true);
  const st = readSettings(dir);
  for (const root of [w1, w2]) {
    const tok = path.join(root, TOKEN_FILE);
    assert.ok(st.permissions.deny.includes(`Read(${ruleAbs(tok)})`), 'another world token is readable: ' + root);
    assert.ok(st.permissions.deny.includes(`Edit(${ruleAbs(tok)})`), 'another world token is writable: ' + root);
    const real = fs.realpathSync(root) + path.sep + TOKEN_FILE;
    assert.ok(st.sandbox.filesystem.denyRead.includes(real), 'a shell can read another world token: ' + root);
    assert.ok(st.sandbox.filesystem.denyWrite.includes(real), 'a shell can write another world token: ' + root);
  }
  // A world lookup that throws degrades to the other roots, never fails the guard.
  const boom = { listWorlds: () => { throw new Error('registry unreadable'); }, worldStoreRoot: () => null, registryPath: (b) => path.join(b, 'worlds.json'), WORLDS_SUBDIR: 'worlds' };
  assert.equal(setup.guardTokenOnlyFolder(agentDir('pilot-boom'), 'pilot-boom', { ...DEPS, legacyRoots: [], worldsBase: base, worlds: boom }).ok, true);
});

test('WARNING 1: a non-Claude or unnamed runner is NOT reported guarded, and nothing is written for it', () => {
  for (const runner of ['codex', 'gemini', 'grok', 'antigravity', 'muse', undefined]) {
    const dir = agentDir('pilot-np-' + (runner || 'none'));
    const g = setup.guardTokenOnlyFolder(dir, 'np', { ...DEPS, runner });
    assert.equal(g.ok, false, String(runner) + ' was reported guarded');
    assert.equal(g.unsupported, true);
    assert.match(g.because, /only Claude agents/);
    assert.equal(fs.existsSync(path.join(dir, '.claude', 'settings.json')), false, 'a settings file nobody reads was written');
  }
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['cl', 'cx'] }) + '\n');
  const warned = [];
  const realWrite = process.stderr.write;
  process.stderr.write = (x) => { warned.push(String(x)); return true; };
  let out;
  try {
    out = setup.refreshTokenOnlyGuards({ ...DEPS, runnerOf: (n) => (n === 'cx' ? 'codex' : 'claude'), workerDir: (n) => agentDir('np-refresh-' + n) });
  } finally { process.stderr.write = realWrite; }
  assert.deepEqual(out.guarded, ['cl']);
  assert.deepEqual(out.unguarded.map((u) => u.name), ['cx']);
  assert.match(warned.join(''), /NOT guarded[^\n]*cx \(only Claude agents/);
});

test('WARNING 4: creation names the runner to the guard and still refuses when it fails; the board start refreshes the guards', () => {
  const CREATE = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  const at = CREATE.indexOf("step('kept the board token out of its reach'");
  assert.ok(at > 0, 'the guard step is gone from createAgent');
  const stepSrc = CREATE.slice(at, CREATE.indexOf('\n  });', at));   // the step's own close (its body has `{ runner });`)
  assert.match(stepSrc, /guardTokenOnlyFolder\(workerDir\(name\), name, \{ runner \}\)/, 'the runner is not passed, so every agent reads as unnamed');
  assert.match(stepSrc, /if \(!guarded\.ok\) throw new Error/, 'a failed guard no longer refuses the creation');
  assert.match(CREATE.slice(0, at), /const runner = providerRunner\(provider\);/, 'runner is not the recorded provider runner');
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(SERVER, /setupAssistant\.refreshTokenOnlyGuards\(\)/, 'the board start no longer refreshes the guards');
});

test('re-review (Kitty): the worlds registry is write-denied, and a world added LATER is covered by a glob (both verbs)', () => {
  const base = path.join(SANDBOX, 'worldsbase-later');
  fs.mkdirSync(base, { recursive: true });
  const real = require('./worlds');
  const worlds = { listWorlds: () => [], worldStoreRoot: () => null, registryPath: real.registryPath, WORLDS_SUBDIR: real.WORLDS_SUBDIR };
  const dir = agentDir('pilot-later');
  assert.equal(setup.guardTokenOnlyFolder(dir, 'pilot-later', { ...DEPS, legacyRoots: [], worldsBase: base, worlds }).ok, true);
  const st = readSettings(dir);
  const reg = real.registryPath(base);
  assert.ok(st.permissions.deny.includes(`Edit(${ruleAbs(reg)})`), 'the agent can add a world to the registry');
  assert.ok(st.permissions.deny.includes(`Edit(${ruleAbs(path.join(base, '.' + path.basename(reg)))}.*)`), 'the registry temp/lock names are writable');
  assert.ok(st.sandbox.filesystem.denyWrite.includes(fs.realpathSync(base) + path.sep + path.basename(reg)), 'a shell can write the registry');
  const wd = ruleAbs(path.join(base, real.WORLDS_SUBDIR));
  for (const verb of ['Read', 'Edit']) {
    assert.ok(st.permissions.deny.includes(`${verb}(${wd}/*/${store.APP}/${TOKEN_FILE})`), verb + ': a world made after the guard is uncovered');
  }
});

test('#4491 post-rebase review: the undo copy store is read- and write-denied in both layers', () => {
  const dir = agentDir('pilot-undo');
  setup.guardTokenOnlyFolder(dir, 'pilot-undo', DEPS);
  const s = readSettings(dir);
  for (const leaf of ['undo', 'undo-saved']) {
    const d = path.join(store.ROOT, leaf);
    assert.ok(s.permissions.deny.includes(`Read(${ruleAbs(d)}/**)`), leaf + ' is not Read-denied: ' + JSON.stringify(s.permissions.deny));
    assert.ok(s.sandbox.filesystem.denyRead.includes(realOrLeaf(d)), leaf + ' is not in the sandbox denyRead');
    // Write-denied too: a forged record there is what restore would write out.
    assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(d)}/**)`), leaf + ' is not Edit-denied');
    assert.ok(s.sandbox.filesystem.denyWrite.includes(realOrLeaf(d)), leaf + ' is not in the sandbox denyWrite');
  }
});

test('#4491 whole-branch review: keys that undo the guard are dropped at every write (excludedCommands, allowRead, allowWrite)', () => {
  const dir = agentDir('pilot-planted');
  const file = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ sandbox: { excludedCommands: ['cat'], network: { allowUnixSockets: ['/tmp/y.sock'] },
    filesystem: { allowRead: [tokenAbs()], allowWrite: [store.ROOT], denyRead: ['/kept/secret'] } } }) + '\n');
  setup.guardTokenOnlyFolder(dir, 'pilot-planted', DEPS);
  const sb = readSettings(dir).sandbox;
  assert.equal(sb.excludedCommands, undefined, 'a planted excludedCommands survived the guard');
  assert.equal(sb.filesystem.allowRead, undefined, 'a planted allowRead survived the guard');
  assert.equal(sb.filesystem.allowWrite, undefined, 'a planted allowWrite survived the guard');
  assert.ok(sb.filesystem.denyRead.includes('/kept/secret'), 'CONTROL: an ordinary denyRead entry was dropped too');
  assert.deepEqual(sb.network.allowUnixSockets, ['/tmp/y.sock'], 'CONTROL: allowUnixSockets is kept');
});

test('#4491 review 11: the board-start refresh never creates a folder for a listed name that has none (it would block creating it)', () => {
  const listFile = sendertoken.tokenOnlyFile();
  fs.writeFileSync(listFile, JSON.stringify({ agents: ['made', 'notyet'] }) + '\n');
  const made = agentDir('r11-made');
  const notyet = path.join(path.dirname(made), 'r11-notyet-never-made');
  const realWrite = process.stderr.write;
  process.stderr.write = () => true;
  let out;
  try { out = setup.refreshTokenOnlyGuards({ ...DEPS, workerDir: (n) => (n === 'made' ? made : notyet) }); } finally { process.stderr.write = realWrite; }
  assert.deepEqual(out.guarded, ['made'], 'CONTROL: the agent with a folder is guarded');
  assert.deepEqual(out.unguarded, [{ name: 'notyet', because: 'no agent folder yet' }]);
  assert.equal(fs.existsSync(notyet), false, 'the refresh made a folder for a name with no agent, so that name can no longer be created');
});

test('#4491 review 11: keys that undo the guard are removed from settings.local.json too; other keys stay', () => {
  const dir = agentDir('pilot-local');
  const local = path.join(dir, '.claude', 'settings.local.json');
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, JSON.stringify({ model: 'x', sandbox: { enabled: false, allowUnsandboxedCommands: true, excludedCommands: ['cat'], filesystem: { allowRead: ['/'], denyRead: ['/kept'] } } }) + '\n');
  const realErr = console.error;
  console.error = () => {};
  try { setup.guardTokenOnlyFolder(dir, 'pilot-local', DEPS); } finally { console.error = realErr; }
  const j = JSON.parse(fs.readFileSync(local, 'utf8'));
  assert.equal(j.sandbox.enabled, undefined, 'a local sandbox switch-off survived');
  assert.equal(j.sandbox.allowUnsandboxedCommands, undefined);
  assert.equal(j.sandbox.excludedCommands, undefined);
  assert.equal(j.sandbox.filesystem.allowRead, undefined);
  assert.deepEqual(j.sandbox.filesystem.denyRead, ['/kept'], 'CONTROL: an ordinary local key was removed too');
  assert.equal(j.model, 'x', 'CONTROL: a non-sandbox key was removed');
});

test('#4491 review 14: a rule whose path has a pattern character is dropped and said, never written to misparse', () => {
  const odd = fs.mkdtempSync(path.join(SANDBOX, 'home(x)-'));
  const errs = [];
  const real = process.stderr.write;
  process.stderr.write = (t) => { errs.push(String(t)); return true; };
  const dir = agentDir('pilot-odd');
  let g;
  try { g = setup.guardTokenOnlyFolder(dir, 'pilot-odd', { ...DEPS, home: odd }); } finally { process.stderr.write = real; }
  assert.equal(g.ok, true, JSON.stringify(g));
  const deny = readSettings(dir).permissions.deny;
  assert.ok(!deny.some((r) => r.includes('(x)')), 'a rule with a pattern character was written: ' + JSON.stringify(deny.filter((r) => r.includes('(x)'))));
  assert.ok(errs.join('').includes('no rule'), 'the dropped rule was not said');
  assert.ok(deny.some((r) => r.startsWith('Read(') && r.includes('board.token')), 'CONTROL: the plain token rules are still there');
});
