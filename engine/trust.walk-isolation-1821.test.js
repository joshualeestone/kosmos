'use strict';
/**
 * #1821: a QA walk that connects a provider or creates an agent must be able to
 * ISOLATE the trust write with a config seam, because trust.js resolves its
 * fallback through a RAW `os.homedir()` (engine/trust.js `homeDir()`) that does
 * NOT honour `AGENT_WORKFORCE_HOME`. A walk that sandboxes `AGENT_WORKFORCE_HOME`
 * and nothing else believes it is isolated and is not: its create/flow trust
 * write lands in the operator's real `~/.claude.json`, the 140KB file that holds
 * the fleet's oauthAccount.
 *
 * 🛑 WHY trust.flip-1629.test.js DOES NOT COVER THIS. That file always sets a
 * config seam (`AGENT_WORKFORCE_CLAUDE_CONFIG` or `CLAUDE_CONFIG_DIR`) BEFORE the
 * write, so it never exercises the bare-`os.homedir()` fallback. #1821 is exactly
 * that fallback. The first arm below reproduces the leak; the rest prove the two
 * seams that stop it.
 *
 * THE STEER (Splinter, kosmos#1821, and it is the reason this is a test and not a
 * trust.js change): do NOT add an `AGENT_WORKFORCE_HOME` seam to trust.js. Its
 * docblock is account-aware and a second seam would be the "second derivation of
 * one fact" defect server.js:474-484 documents. Instead a walk points the seam
 * trust.js ALREADY has at a disposable config. This file codifies that contract.
 *
 * ⚠️ TWO SEAMS, NOT ONE, said honestly because the card named only the second.
 * trust.js's CONFIG() fallback is `dir -> AGENT_WORKFORCE_CLAUDE_CONFIG ->
 * CLAUDE_CONFIG_DIR -> os.homedir()`. So BOTH of these isolate a walk:
 *   - `AGENT_WORKFORCE_CLAUDE_CONFIG` : a FILE path. tools/test-install.sh:245
 *     already uses it, which is why the install harness does not leak.
 *   - `CLAUDE_CONFIG_DIR`             : a DIR. Claude Code itself honours it.
 * A walk that sets NEITHER is the leak. Both are asserted below, with the
 * precedence between them, so the "one fact" cannot silently split in two.
 *
 * 🛑 SAFETY, and it is the first thing asserted. `HOME` is redirected to a
 * throwaway so `os.homedir()` ITSELF points there. The leak arm therefore lands
 * in that throwaway "pretend real machine", never the operator's actual
 * `~/.claude.json`. If the `HOME` redirect does not take on this platform, the
 * guard fails LOUD before a single write rather than letting the leak reach the
 * real file. (Mirrors engine/firstrun-isolation-1780.test.js.)
 *
 *   node --test engine/trust.walk-isolation-1821.test.js
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KEY = 'hasTrustDialogAccepted';

// Snapshot every env var this file mutates so after() restores the process
// exactly (matters if ever run in a shared process rather than node's default
// per-file isolation).
const ENV_KEYS = ['HOME', 'AGENT_WORKFORCE_HOME', 'AGENT_WORKFORCE_CLAUDE_CONFIG', 'CLAUDE_CONFIG_DIR'];
const ENV_SNAPSHOT = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

// DISPOSABLE_HOME is what a walk sets AGENT_WORKFORCE_HOME to, believing it
// sandboxes everything. PRETEND_REAL stands in for the operator's real machine:
// os.homedir() is redirected onto it, so any write that leaks past the seam
// lands here and is inspectable, never on the real box.
const DISPOSABLE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1821-home-'));
const PRETEND_REAL = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1821-pretend-real-'));
process.env.AGENT_WORKFORCE_HOME = DISPOSABLE_HOME;
process.env.HOME = PRETEND_REAL;
delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
delete process.env.CLAUDE_CONFIG_DIR;

after(() => {
  for (const k of ENV_KEYS) {
    if (ENV_SNAPSHOT[k] === undefined) delete process.env[k]; else process.env[k] = ENV_SNAPSHOT[k];
  }
  for (const d of [DISPOSABLE_HOME, PRETEND_REAL]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// 🛑 The load-bearing safety guard. If os.homedir() does not honour $HOME on this
// platform, the leak arm below would reach the operator's REAL home, so refuse to
// run at all. Asserted at require time, before any trust write can happen.
assert.equal(os.homedir(), PRETEND_REAL,
  'os.homedir() must resolve to the throwaway HOME, or the leak arm could reach the real machine; refusing to run');

// The file trust.js writes when no seam is set: os.homedir()/.claude.json.
const HOME_CONFIG = path.join(PRETEND_REAL, '.claude.json');

const trust = require('./trust');

// A config file trust.js will accept: it refuses on absent/empty/non-object, so
// every target must be seeded with a valid, non-empty shape first.
function seedConfig(fileAbs, projects) {
  fs.mkdirSync(path.dirname(fileAbs), { recursive: true });
  fs.writeFileSync(fileAbs, JSON.stringify({ projects: projects || {} }), 'utf8');
  return fileAbs;
}

// A Kosmos-made worker folder. realpath because trust.js keys the entry on the
// resolved path (/tmp is a symlink to /private/tmp on macOS).
function workerFolder(name) {
  const d = path.join(DISPOSABLE_HOME, 'workers', name);
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync(d);
}

// Read the trust state a specific .claude.json records for a worker folder.
// Returns 'ENTRY-ABSENT' (no entry at all), 'KEY-ABSENT' (entry, no key), or the
// boolean the key holds.
function readTrust(fileAbs, workKey) {
  const d = JSON.parse(fs.readFileSync(fileAbs, 'utf8'));
  const e = (d.projects || {})[workKey];
  return e === undefined ? 'ENTRY-ABSENT' : (KEY in e ? e[KEY] : 'KEY-ABSENT');
}

// A destination is UNTOUCHED if the file never appeared, or appeared but never
// gained an entry for this folder. Both count as "the seam held".
function isUntouched(fileAbs, workKey) {
  if (!fs.existsSync(fileAbs)) return true;
  return readTrust(fileAbs, workKey) === 'ENTRY-ABSENT';
}

/* 🛑 THE LEAK. This arm asserts the DANGEROUS answer: with AGENT_WORKFORCE_HOME
   sandboxed and NO config seam set, a default-account trust write (the shape
   create.js and setAccount pass for the default account: configDir null) lands
   in os.homedir()/.claude.json, NOT under AGENT_WORKFORCE_HOME. This is the
   #1821 defect reproduced, and it is the positive control that the rest of the
   file can tell a leaked write from an isolated one. If trust.js is ever changed
   to honour AGENT_WORKFORCE_HOME (the thing the steer declined), this arm goes
   red on purpose. */
test('#1821: AGENT_WORKFORCE_HOME alone does NOT isolate the trust write, it leaks to os.homedir()', () => {
  seedConfig(HOME_CONFIG);
  const work = workerFolder('leak');
  const homeSandboxFile = path.join(DISPOSABLE_HOME, '.claude.json');
  assert.equal(fs.existsSync(homeSandboxFile), false, 'fixture is dirty: the sandbox home already has a .claude.json');

  const r = trust.trustFolder(work, { configDir: null });
  assert.equal(r.ok, true, r.because);
  assert.equal(readTrust(HOME_CONFIG, work), true,
    'the write did not reach os.homedir(): the leak this card exists for is not being reproduced, so the isolation arms below prove nothing');
  assert.equal(fs.existsSync(homeSandboxFile), false,
    'AGENT_WORKFORCE_HOME captured the trust write, which would mean trust.js grew a HOME seam the steer declined; the leak arm no longer models the defect');
});

/* THE FIX, seam 1: CLAUDE_CONFIG_DIR (the seam the card named). A walk that
   points it at a disposable dir gets the write there, and the real home is left
   untouched. */
test('#1821: CLAUDE_CONFIG_DIR isolates the walk, real ~/.claude.json untouched', () => {
  seedConfig(HOME_CONFIG);
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1821-cfgdir-'));
  seedConfig(path.join(cfgDir, '.claude.json'));
  process.env.CLAUDE_CONFIG_DIR = cfgDir;
  const work = workerFolder('via-config-dir');
  try {
    const r = trust.trustFolder(work, { configDir: null });
    assert.equal(r.ok, true, r.because);
    assert.equal(readTrust(path.join(cfgDir, '.claude.json'), work), true,
      'CLAUDE_CONFIG_DIR was not honoured, so the walk cannot isolate its trust write');
    assert.ok(isUntouched(HOME_CONFIG, work),
      'the real home config was written despite the seam: the walk leaked into ~/.claude.json');
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(cfgDir, { recursive: true, force: true });
  }
});

/* THE FIX, seam 2: AGENT_WORKFORCE_CLAUDE_CONFIG (a FILE path). This is the seam
   the install harness tools/test-install.sh already uses, and the card did not
   mention it. Documented here so "standardise on one seam" is not read as
   "invent a third". */
test('#1821: AGENT_WORKFORCE_CLAUDE_CONFIG isolates the walk (the seam the install harness uses)', () => {
  seedConfig(HOME_CONFIG);
  const cfgFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1821-cfgfile-')), 'claude.json');
  seedConfig(cfgFile);
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = cfgFile;
  const work = workerFolder('via-config-file');
  try {
    const r = trust.trustFolder(work, { configDir: null });
    assert.equal(r.ok, true, r.because);
    assert.equal(readTrust(cfgFile, work), true,
      'AGENT_WORKFORCE_CLAUDE_CONFIG was not honoured, so the install harness would leak trust into ~/.claude.json');
    assert.ok(isUntouched(HOME_CONFIG, work),
      'the real home config was written despite the seam: the walk leaked into ~/.claude.json');
  } finally {
    delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
    fs.rmSync(path.dirname(cfgFile), { recursive: true, force: true });
  }
});

/* PRECEDENCE, so the two seams cannot silently diverge into two facts. trust.js's
   fallback order is AGENT_WORKFORCE_CLAUDE_CONFIG before CLAUDE_CONFIG_DIR: when a
   walk sets both, the file-path seam wins and the dir seam is left untouched. */
test('#1821: AGENT_WORKFORCE_CLAUDE_CONFIG takes precedence over CLAUDE_CONFIG_DIR', () => {
  seedConfig(HOME_CONFIG);
  const cfgFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1821-prec-file-')), 'claude.json');
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1821-prec-dir-'));
  seedConfig(cfgFile);
  seedConfig(path.join(cfgDir, '.claude.json'));
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = cfgFile;
  process.env.CLAUDE_CONFIG_DIR = cfgDir;
  const work = workerFolder('precedence');
  try {
    const r = trust.trustFolder(work, { configDir: null });
    assert.equal(r.ok, true, r.because);
    assert.equal(readTrust(cfgFile, work), true, 'the file-path seam did not win');
    assert.equal(readTrust(path.join(cfgDir, '.claude.json'), work), 'ENTRY-ABSENT',
      'CLAUDE_CONFIG_DIR won over AGENT_WORKFORCE_CLAUDE_CONFIG: the two seams have split into two facts and a walk cannot predict which it isolates');
    assert.ok(isUntouched(HOME_CONFIG, work), 'the real home config was written despite both seams being set');
  } finally {
    delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(path.dirname(cfgFile), { recursive: true, force: true });
    fs.rmSync(cfgDir, { recursive: true, force: true });
  }
});

/* An explicit account destination (the non-default create/flip path,
   create.js:2951 / :775) still beats every environment seam: the caller is
   pointing an agent at a specific account, and a walk's isolation env must not
   redirect a write that names where it must go. */
test('#1821: an explicit account configDir beats the walk-isolation env seams', () => {
  seedConfig(HOME_CONFIG);
  const acctDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1821-acct-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1821-envdir-'));
  seedConfig(path.join(acctDir, '.claude.json'));
  seedConfig(path.join(cfgDir, '.claude.json'));
  process.env.CLAUDE_CONFIG_DIR = cfgDir;
  const work = workerFolder('explicit-acct');
  try {
    const r = trust.trustFolder(work, { configDir: acctDir });
    assert.equal(r.ok, true, r.because);
    assert.equal(readTrust(path.join(acctDir, '.claude.json'), work), true, 'the explicit account destination was not written');
    assert.equal(readTrust(path.join(cfgDir, '.claude.json'), work), 'ENTRY-ABSENT',
      'the isolation env won over the explicit account destination, so a real flip would trust the wrong account');
    assert.ok(isUntouched(HOME_CONFIG, work), 'the real home config was written');
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(acctDir, { recursive: true, force: true });
    fs.rmSync(cfgDir, { recursive: true, force: true });
  }
});
