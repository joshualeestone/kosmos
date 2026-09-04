'use strict';

/*
 * kosmos#2129: on a FRESH macOS user, no agent comes online because Claude Code
 * shows its trust-folder prompt in a TUI nobody can answer (default = "No, exit"
 * = the agent dies). The pre-trust write (trustFolder) existed but REFUSED when
 * ~/.claude.json was absent -- which is exactly the fresh-install state -- so the
 * trust entry never landed. The fix is a createIfAbsent opt-in that creates a
 * MINIMAL config (a trust preference, not a fabricated session history), mirroring
 * how preacceptBypass already creates settings.json on a fresh install (#1919).
 *
 * These tests pin both halves: the refuse-by-default that every other caller
 * relies on, and the create-on-absent that the create-time caller opts into.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox the data root before requiring trust.js, so the trust-writes record
// never touches the operator's real store (same discipline as trust.test.js).
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trust-2129-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { trustFolder, KEY } = require('./trust');

let n = 0;
// A folder that exists (Kosmos made it), fresh per test, realpath-clean.
const folder = () => {
  const d = path.join(SANDBOX, `w${++n}`);
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync(d);
};
// A config dir path that does NOT exist yet (a fresh macOS user).
const freshConfigDir = () => path.join(SANDBOX, `cfg${++n}-absent`);

test('DEFAULT (no createIfAbsent) still refuses when the config is absent -- the #2129 bug, and the behaviour every other caller relies on', () => {
  const d = folder();
  const cfgDir = freshConfigDir();
  const r = trustFolder(d, { configDir: cfgDir });
  assert.equal(r.ok, false);
  assert.equal(r.because, 'Claude Code has not run on this computer yet');
  assert.equal(fs.existsSync(path.join(cfgDir, '.claude.json')), false, 'default must not invent a config');
});

test('DEFAULT (no createIfAbsent) still refuses an EMPTY config file', () => {
  const d = folder();
  const cfgDir = path.join(SANDBOX, `cfg${++n}-empty`);
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, '.claude.json'), '');
  const r = trustFolder(d, { configDir: cfgDir });
  assert.equal(r.ok, false);
  assert.equal(r.because, 'their config file is empty');
});

test('createIfAbsent CREATES a minimal config when the file (and its dir) do not exist', () => {
  const d = folder();
  const cfgDir = freshConfigDir();               // dir does not exist yet
  const r = trustFolder(d, { configDir: cfgDir, createIfAbsent: true });
  assert.equal(r.ok, true);
  assert.equal(r.already, false);
  assert.equal(r.madeEntry, true);
  const cfg = path.join(cfgDir, '.claude.json');
  assert.ok(fs.existsSync(cfg), 'the config was not created');
  const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  // MINIMAL: only the trust preference, no fabricated session fields.
  assert.deepEqual(j, { projects: { [d]: { [KEY]: true } } });
});

test('the created config is keyed on the RESOLVED path Claude Code will read', () => {
  const d = folder();                            // folder() already realpaths
  const cfgDir = freshConfigDir();
  const r = trustFolder(d, { configDir: cfgDir, createIfAbsent: true });
  assert.equal(r.key, d);
  const j = JSON.parse(fs.readFileSync(path.join(cfgDir, '.claude.json'), 'utf8'));
  assert.deepEqual(Object.keys(j.projects), [d]);
});

test('the created config is born private (mode 600) -- it holds account/session details', () => {
  const d = folder();
  const cfgDir = freshConfigDir();
  trustFolder(d, { configDir: cfgDir, createIfAbsent: true });
  const mode = fs.statSync(path.join(cfgDir, '.claude.json')).mode & 0o777;
  assert.equal(mode, 0o600, `expected 600, got ${mode.toString(8)}`);
});

test('createIfAbsent fills an EMPTY existing config file, KEEPING its existing mode (not tightening to 600 like the born-from-absent path)', () => {
  const d = folder();
  const cfgDir = path.join(SANDBOX, `cfg${++n}-empty2`);
  fs.mkdirSync(cfgDir, { recursive: true });
  const cfg = path.join(cfgDir, '.claude.json');
  fs.writeFileSync(cfg, '');
  fs.chmodSync(cfg, 0o644);   // the person's chosen mode on a file that already exists
  const r = trustFolder(d, { configDir: cfgDir, createIfAbsent: true });
  assert.equal(r.ok, true);
  const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  assert.equal(j.projects[d][KEY], true);
  // The empty-EXISTING path keeps the existing mode; only the ENOENT create path
  // is born private (0o600). Pins that the two paths are not accidentally unified.
  assert.equal(fs.statSync(cfg).mode & 0o777, 0o644,
    'an empty existing config must keep its on-disk mode, not be tightened to 600');
});

test('createIfAbsent is idempotent: a second call reports already-trusted and rewrites nothing new', () => {
  const d = folder();
  const cfgDir = freshConfigDir();
  trustFolder(d, { configDir: cfgDir, createIfAbsent: true });
  const before = fs.readFileSync(path.join(cfgDir, '.claude.json'), 'utf8');
  const r2 = trustFolder(d, { configDir: cfgDir, createIfAbsent: true });
  assert.equal(r2.ok, true);
  assert.equal(r2.already, true);
  assert.equal(fs.readFileSync(path.join(cfgDir, '.claude.json'), 'utf8'), before);
});

test('createIfAbsent still MERGES into an existing config, preserving other projects and top-level settings', () => {
  const d = folder();
  const cfgDir = path.join(SANDBOX, `cfg${++n}-existing`);
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, '.claude.json'),
    JSON.stringify({ projects: { '/somewhere/else': { allowedTools: ['x'] } }, someTopLevel: 1 }));
  const r = trustFolder(d, { configDir: cfgDir, createIfAbsent: true });
  assert.equal(r.ok, true);
  const j = JSON.parse(fs.readFileSync(path.join(cfgDir, '.claude.json'), 'utf8'));
  assert.deepEqual(j.projects['/somewhere/else'], { allowedTools: ['x'] }, 'another project was disturbed');
  assert.equal(j.someTopLevel, 1, 'a top-level setting was lost');
  assert.equal(j.projects[d][KEY], true);
});

test('createIfAbsent still REFUSES a symlinked config target (the safety guard is not bypassed by the flag)', () => {
  const d = folder();
  const cfgDir = path.join(SANDBOX, `cfg${++n}-symlink`);
  fs.mkdirSync(cfgDir, { recursive: true });
  const realElsewhere = path.join(SANDBOX, `real${n}.json`);
  fs.writeFileSync(realElsewhere, JSON.stringify({ projects: {} }));
  fs.symlinkSync(realElsewhere, path.join(cfgDir, '.claude.json'));
  const r = trustFolder(d, { configDir: cfgDir, createIfAbsent: true });
  assert.equal(r.ok, false);
  assert.equal(r.because, 'their config file is a symlink');
});
