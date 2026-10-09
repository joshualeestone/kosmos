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
// Review 22 NIT: a copy can share a bug with the code; one test below pins this copy to a literal resolved path.
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

test('preserves pre-existing sandbox.filesystem entries on merge, drops Unix-socket allowances (review 22)', () => {
  const dir = agentDir('pilot-sbmerge');
  const file = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ sandbox: { network: { allowUnixSockets: ['/tmp/x.sock'] }, filesystem: { denyRead: ['/some/other/secret'], denyWrite: ['/some/other/dir'] } } }) + '\n');
  setup.guardTokenOnlyFolder(dir, 'pilot-sbmerge', DEPS);
  const sb = readSettings(dir).sandbox;
  assert.equal(sb.network.allowUnixSockets, undefined, 'review 22: a Unix-socket allowance survived the guard');
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
  assert.ok(!warned.join('').includes('managed-settings belt'), 'the managed-belt warning fired off darwin, where it is misleading');
  assert.ok(warned.join('').includes('permission rules only'), 'review 15: off macOS the guard does not say it binds only the file tools');
  assert.equal(readSettings(agentDir('lin-lin')).sandbox, undefined, 'a sandbox block was written off darwin');
});

test('refreshTokenOnlyGuards is a safe no-op when the list is absent', () => {
  try { fs.rmSync(sendertoken.tokenOnlyFile()); } catch { /* already gone */ }
  const out = setup.refreshTokenOnlyGuards(DEPS);
  assert.deepEqual(out.guarded, []);
});

test('no em dash in a settings file the guard writes, nor in the guard source', () => {
  const dir = agentDir('pilot-emdash');
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-emdash', DEPS);
  assert.equal(g.ok, true, 'the guard did not write, so the check below would read nothing');
  const raw = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
  assert.ok(raw.length > 50 && raw.includes('sandbox'), 'the written settings file is not the guard');
  assert.ok(!raw.includes('\u2014'), 'an em dash reached a written settings file');
  // Review 21: the file above carries only rules, so also read the strings the guard and undo can say.
  for (const f of ['setup-assistant.js', 'undo.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.ok(!/\u2014|&mdash;|&#8212;|&#x2014;|\\u2014|\\u\{2014\}/i.test(src), 'an em dash spelling in ' + f);
  }
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
  // Review 22 (reverses the earlier degrade): a world lookup that throws leaves that world's token unguarded, so the
  // guard says so and is not reported in place.
  const boom = { listWorlds: () => { throw new Error('registry unreadable'); }, worldStoreRoot: () => null, registryPath: (b) => path.join(b, 'worlds.json'), WORLDS_SUBDIR: 'worlds' };
  const g = setup.guardTokenOnlyFolder(agentDir('pilot-boom'), 'pilot-boom', { ...DEPS, legacyRoots: [], worldsBase: base, worlds: boom });
  assert.equal(g.ok, false, 'a failed world lookup was reported guarded');
  assert.ok(/list of worlds/.test(g.because), g.because);
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

test('re-review (independent): the worlds registry is write-denied, and a world added LATER is covered by a glob (both verbs)', () => {
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
  assert.equal(sb.network.allowUnixSockets, undefined, 'review 22: a planted allowUnixSockets survived the guard');
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

test('#4491 reviews 14 and 17: a rule whose path has a pattern character is never written, and the guard is then not ok', () => {
  const odd = fs.mkdtempSync(path.join(SANDBOX, 'home(x)-'));
  const errs = [];
  const real = process.stderr.write;
  process.stderr.write = (t) => { errs.push(String(t)); return true; };
  const dir = agentDir('pilot-odd');
  let g;
  try { g = setup.guardTokenOnlyFolder(dir, 'pilot-odd', { ...DEPS, home: odd }); } finally { process.stderr.write = real; }
  // Review 17: the dropped rules are the ~/.claude settings Edit denies (the agent's own guard), so the guard is NOT ok.
  assert.equal(g.ok, false, 'a guard missing its self-protection rules reported ok: ' + JSON.stringify(g));
  assert.match(g.because, /cannot carry/);
  assert.ok(errs.join('').includes('no rule'), 'the dropped rule was not said');
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'settings.json')) || !readSettings(dir).permissions.deny.some((r) => r.includes('(x)')), 'a rule with a pattern character was written');
});

test('#4491 review 15: the pattern-character check reads a Windows path\'s backslashes as separators, not patterns', () => {
  const win = 'Read(//C:\\Users\\a\\AppData\\Local\\Kosmos\\board.token)';
  assert.equal(setup.ruleHasPatternChar(win, '\\'), false, 'every Windows rule would be dropped');
  assert.equal(setup.ruleHasPatternChar('Read(//C:\\Users\\a(b)\\board.token)', '\\'), true, 'CONTROL: a real pattern character on Windows');
  assert.equal(setup.ruleHasPatternChar('Read(//Users/a/x/board.token)', '/'), false, 'CONTROL: a plain macOS rule');
  assert.equal(setup.ruleHasPatternChar('Read(//Users/a/undo/**)', '/'), false, 'CONTROL: the guard\'s own trailing glob');
});

test('#4491 review 15: other agents\' sender tokens and undo\'s switch are denied to a token-only agent in both layers', () => {
  const dir = agentDir('pilot-st');
  setup.guardTokenOnlyFolder(dir, 'pilot-st', DEPS);
  const s = readSettings(dir);
  const st = path.join(store.ROOT, 'sendertokens');
  assert.ok(s.permissions.deny.includes(`Read(${ruleAbs(st)}/**)`), 'sender tokens are readable by the file tools');
  assert.ok(s.sandbox.filesystem.denyRead.includes(realOrLeaf(st)), 'sender tokens are readable by the shell');
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(path.join(store.ROOT, 'undo.json'))})`), 'undo switch is writable');
  assert.ok(s.sandbox.filesystem.denyWrite.includes(realOrLeaf(path.join(store.ROOT, 'undo.json'))), 'undo switch is writable by the shell');
});

test('#4491 review 16: a board.token rule that cannot be written makes the guard NOT ok; off macOS the guard says permission-only at create time', () => {
  const odd = fs.mkdtempSync(path.join(SANDBOX, 'store(x)-'));
  const errs = [];
  const real = process.stderr.write;
  process.stderr.write = (t) => { errs.push(String(t)); return true; };
  let g;
  let lin;
  try {
    g = setup.guardTokenOnlyFolder(agentDir('pilot-oddstore'), 'pilot-oddstore', { ...DEPS, dataRoot: odd });
    lin = setup.guardTokenOnlyFolder(agentDir('pilot-linux'), 'pilot-linux', { ...DEPS, platform: 'linux' });
  } finally { process.stderr.write = real; }
  assert.equal(g.ok, false, 'a guard without its board.token rule reported ok');
  assert.match(g.because, /cannot carry/);
  assert.equal(lin.ok, true, 'CONTROL: a plain store on Linux is guarded: ' + JSON.stringify(lin));
  assert.ok(errs.join('').includes('off macOS pilot-linux gets permission rules only'), 'no off-macOS note at create time');
});

test('#4491 review 18: a settings.json that does not parse is kept as a dated copy before the guard is written', () => {
  const dir = agentDir('pilot-badjson');
  const file = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ "mine": true, }');
  const errs = [];
  const real = process.stderr.write;
  process.stderr.write = (t) => { errs.push(String(t)); return true; };
  let g;
  try { g = setup.guardTokenOnlyFolder(dir, 'pilot-badjson', DEPS); } finally { process.stderr.write = real; }
  assert.equal(g.ok, true, 'CONTROL: the guard is still written');
  const kept = fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith('settings.json.unreadable-'));
  assert.equal(kept.length, 1, 'the person\'s unreadable settings were replaced with no copy');
  assert.equal(fs.readFileSync(path.join(path.dirname(file), kept[0]), 'utf8'), '{ "mine": true, }');
  assert.ok(errs.join('').includes('could not be read as settings'), 'the replacement was not said');
});

test('#4491 review 21: the person\'s own user settings that weaken the sandbox are said at board start, never edited', () => {
  const home = fs.mkdtempSync(path.join(SANDBOX, 'home21-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const userFile = path.join(home, '.claude', 'settings.json');
  const before = JSON.stringify({ sandbox: { excludedCommands: ['cat'] } });
  fs.writeFileSync(userFile, before);
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['u21'] }) + '\n');
  const errs = [];
  const real = process.stderr.write;
  process.stderr.write = (t) => { errs.push(String(t)); return true; };
  try { setup.refreshTokenOnlyGuards({ ...DEPS, home, workerDir: () => agentDir('u21') }); } finally { process.stderr.write = real; }
  assert.ok(errs.join('').includes('your own Claude settings') && errs.join('').includes('excludedCommands'), 'the weakening user setting was not said: ' + errs.join(''));
  assert.equal(fs.readFileSync(userFile, 'utf8'), before, 'the person\'s own settings were edited');
});

test('#4491 review 22: realOrLeaf (the code and this copy) resolves a symlinked parent and keeps an absent leaf', () => {
  const real = fs.mkdtempSync(path.join(SANDBOX, 'r22real-'));
  const link = path.join(SANDBOX, 'r22link-' + process.pid);
  fs.symlinkSync(real, link);
  try {
    const want = path.join(fs.realpathSync.native(real), 'absent.token');
    assert.equal(setup.realOrLeaf(path.join(link, 'absent.token')), want, 'the code did not resolve the symlinked parent');
    assert.equal(realOrLeaf(path.join(link, 'absent.token')), want, 'the test copy differs from the code');
    assert.notEqual(want, path.join(link, 'absent.token'), 'CONTROL: the fixture has no symlink to resolve');
  } finally { fs.rmSync(link, { force: true }); }
});

test('#4491 review 22: a token place that cannot be worked out refuses the guard rather than reporting it guarded', () => {
  const dir = agentDir('r22miss');
  const g = setup.guardTokenOnlyFolder(dir, 'r22miss', { ...DEPS, worlds: { registryPath() { throw new Error('boom'); }, WORLDS_SUBDIR: 'worlds', listWorlds() { return []; } }, worldsBase: SANDBOX });
  assert.equal(g.ok, false, 'the guard reported ok with the worlds registry left out');
  assert.ok(/worlds registry/.test(g.because), g.because);
  const ok = setup.guardTokenOnlyFolder(dir, 'r22miss', DEPS);
  assert.equal(ok.ok, true, 'CONTROL: the same folder guards when every place is known: ' + ok.because);
});

test('#4491 review 22: Unix-socket allowances are removed from settings.local.json; process-starting keys there are said, not removed', () => {
  const dir = agentDir('r22local');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const local = path.join(dir, '.claude', 'settings.local.json');
  fs.writeFileSync(local, JSON.stringify({ hooks: { SessionStart: [] }, sandbox: { network: { allowAllUnixSockets: true, allowUnixSockets: ['/tmp/s'] } } }));
  const errs = [];
  const real = process.stderr.write;
  process.stderr.write = (t) => { errs.push(String(t)); return true; };
  try { assert.equal(setup.guardTokenOnlyFolder(dir, 'r22local', DEPS).ok, true); } finally { process.stderr.write = real; }
  const j = JSON.parse(fs.readFileSync(local, 'utf8'));
  assert.equal(j.sandbox?.network?.allowAllUnixSockets, undefined, 'allowAllUnixSockets survived in settings.local.json');
  assert.equal(j.sandbox?.network?.allowUnixSockets, undefined, 'allowUnixSockets survived in settings.local.json');
  assert.ok(j.hooks, 'the hooks key was removed (it is the person\'s call)');
  assert.ok(errs.join('').includes('hooks'), 'the hooks key was not said: ' + errs.join(''));
});

test('#4491 review 22: refreshTokenOnlyGuards({ only }) guards just that listed agent', () => {
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['r22a', 'r22b'] }) + '\n');
  const a = agentDir('r22a'); const b = agentDir('r22b');
  fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true });
  const map = { r22a: a, r22b: b };
  const out = setup.refreshTokenOnlyGuards({ ...DEPS, only: 'r22b', workerDir: (n) => map[n] });
  assert.deepEqual(out.guarded, ['r22b']);
  assert.equal(fs.existsSync(path.join(a, '.claude', 'settings.json')), false, 'the other listed agent was guarded too');
  assert.equal(fs.existsSync(path.join(b, '.claude', 'settings.json')), true, 'CONTROL: the named agent was not guarded');
});

test('#4491 review 22: the supervisor guards a listed agent at launch (its own snippet, run as written)', () => {
  const sup = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  const at = sup.indexOf('#4491 review 22: write (or confirm) its guard now');
  assert.ok(at > 0, 'the launch-time guard is gone from the supervisor');
  const sw = sup.lastIndexOf('SECRET_ENV+=("KOSMOS_AGENT_TOKEN_ONLY=1")', at);
  assert.ok(sw > 0 && at - sw < 400, 'the launch-time guard is not beside the token-only switch');
  const open = sup.indexOf("-e '", at) + 4;
  const close = sup.indexOf("' \"$_eng/setup-assistant.js\" \"$_roster\"", open);
  assert.ok(open > 4 && close > open, 'could not find the snippet');
  const snippet = sup.slice(open, close);
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['r22sup'] }) + '\n');
  const dir = agentDir('r22sup');
  fs.mkdirSync(dir, { recursive: true });
  const shim = path.join(SANDBOX, 'r22shim.js');
  // The board resolves the agent folder and runner itself; the shim points them at this sandbox.
  fs.writeFileSync(shim, `const s = require(${JSON.stringify(path.join(__dirname, 'setup-assistant.js'))}); const real = s.refreshTokenOnlyGuards;
    s.refreshTokenOnlyGuards = (d) => real({ ...d, ...${JSON.stringify({ platform: 'darwin', home: process.env.AGENT_WORKFORCE_HOME })}, runnerOf: () => 'claude', workerDir: () => ${JSON.stringify(dir)} }); module.exports = s;`);
  const r = require('child_process').spawnSync(process.execPath, ['-e', snippet, shim, 'r22sup'], { env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '', 'the launch said the agent is not guarded: ' + r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')), 'the launch did not write the guard');
  fs.rmSync(shim, { force: true });
});

test('#4491 review 23: settings.local.json keeps only sandbox deny lists, whatever the other values are', () => {
  const dir = agentDir('r23local');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const local = path.join(dir, '.claude', 'settings.local.json');
  fs.writeFileSync(local, JSON.stringify({ model: 'x', sandbox: { enabled: 'false', allowUnsandboxedCommands: 1, someFutureKey: true,
    network: { allowLocalBinding: true }, filesystem: { denyRead: ['/kept/r'], denyWrite: ['/kept/w'], allowRead: ['/x'], newKind: ['/y'] } } }));
  assert.equal(setup.guardTokenOnlyFolder(dir, 'r23local', DEPS).ok, true);
  const j = JSON.parse(fs.readFileSync(local, 'utf8'));
  assert.deepEqual(j.sandbox, { filesystem: { denyRead: ['/kept/r'], denyWrite: ['/kept/w'] } }, JSON.stringify(j.sandbox));
  assert.equal(j.model, 'x', 'CONTROL: a key outside the sandbox block was touched');
});

test('#4491 review 23: the supervisor says so when the guard code is missing at launch', () => {
  const sup = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  const at = sup.indexOf('#4491 review 22: write (or confirm) its guard now');
  const block = sup.slice(at, sup.indexOf('\n      fi', at));
  assert.ok(/else\n\s+echo "#4491: \$_roster is listed token-only but its guard could not be checked at launch/.test(block), block.slice(-400));
});

test('#4491 review 24: on Windows the guard says it cannot hold yet, and writes nothing', () => {
  const dir = agentDir('r24win');
  fs.mkdirSync(dir, { recursive: true });
  const g = setup.guardTokenOnlyFolder(dir, 'r24win', { ...DEPS, platform: 'win32' });
  assert.equal(g.ok, false, 'a Windows guard was reported in place');
  assert.equal(g.unsupported, true);
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'settings.json')), false, 'a Windows guard wrote a settings file');
  assert.equal(setup.guardTokenOnlyFolder(dir, 'r24win', { ...DEPS, platform: 'darwin' }).ok, true, 'CONTROL: the same folder guards on macOS');
});

test('#4491 review 24: permissions.additionalDirectories is removed from both agent files and said in the person\'s', () => {
  const dir = agentDir('r24dirs');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { additionalDirectories: [store.ROOT], allow: ['Read'] } }));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { additionalDirectories: ['/x'], allow: ['Bash'] } }));
  assert.equal(setup.guardTokenOnlyFolder(dir, 'r24dirs', DEPS).ok, true);
  const main = readSettings(dir).permissions;
  const local = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8')).permissions;
  assert.equal(main.additionalDirectories, undefined, 'additionalDirectories survived in settings.json');
  assert.equal(local.additionalDirectories, undefined, 'additionalDirectories survived in settings.local.json');
  assert.deepEqual([main.allow, local.allow], [['Read'], ['Bash']], 'CONTROL: other permission keys were touched');
  const home = fs.mkdtempSync(path.join(SANDBOX, 'home24-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { additionalDirectories: ['/y'] } }));
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['r24dirs'] }) + '\n');
  const errs = []; const real = process.stderr.write;
  process.stderr.write = (t) => { errs.push(String(t)); return true; };
  try { setup.refreshTokenOnlyGuards({ ...DEPS, home, workerDir: () => dir }); } finally { process.stderr.write = real; }
  assert.ok(errs.join('').includes('permissions.additionalDirectories'), 'not said for the person\'s own settings: ' + errs.join(''));
});

test('#4491 review 24: a hidden world\'s token is denied too (hiding does not revoke it)', () => {
  const base = path.join(SANDBOX, 'worldsbase24');
  const shown = path.join(SANDBOX, 'w24', 'shown', 'Kosmos'); const hidden = path.join(SANDBOX, 'w24', 'hidden', 'Kosmos');
  for (const d of [base, shown, hidden]) fs.mkdirSync(d, { recursive: true });
  const real = require('./worlds');
  const all = [{ id: 'shown' }, { id: 'hidden', hiddenAt: 1 }];
  const worlds = { readRegistry: () => ({ worlds: all }), listWorlds: () => all.filter((w) => !w.hiddenAt),
    worldStoreRoot: (b, w) => (w.id === 'shown' ? shown : hidden), registryPath: real.registryPath, WORLDS_SUBDIR: real.WORLDS_SUBDIR };
  const dir = agentDir('r24hidden');
  assert.equal(setup.guardTokenOnlyFolder(dir, 'r24hidden', { ...DEPS, legacyRoots: [], worldsBase: base, worlds }).ok, true);
  const deny = readSettings(dir).permissions.deny;
  assert.ok(deny.includes(`Read(${ruleAbs(path.join(hidden, TOKEN_FILE))})`), 'a hidden world\'s token is readable');
  assert.ok(deny.includes(`Read(${ruleAbs(path.join(shown, TOKEN_FILE))})`), 'CONTROL: the shown world\'s token is readable');
});
