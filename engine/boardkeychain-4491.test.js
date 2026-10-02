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
  assert.ok(sb.filesystem.denyRead.includes(tokenAbs()), 'board.token not in sandbox denyRead');
  assert.ok(sb.filesystem.denyWrite.includes(path.join(dir, '.claude')), 'own .claude not in denyWrite (shell printf > settings.json)');
  assert.ok(sb.filesystem.denyWrite.includes(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude')), 'shared ~/.claude not in denyWrite');
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

test('refreshTokenOnlyGuards is a safe no-op when the list is absent', () => {
  try { fs.rmSync(sendertoken.tokenOnlyFile()); } catch { /* already gone */ }
  const out = setup.refreshTokenOnlyGuards(DEPS);
  assert.deepEqual(out.guarded, []);
});

test('no em dash in anything written to a settings file', () => {
  const dir = agentDir('pilot-a');
  const raw = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
  assert.ok(!raw.includes('—'), 'an em dash reached a written settings file');
});
