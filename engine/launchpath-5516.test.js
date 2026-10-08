'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)

/*
 * #5516: Claude Code runs programs (git, at every start) outside the sandbox, found through the PATH its pane starts
 * with, so the token-only guard denies the agent's file tools and shell any write to a folder on that PATH. These tests
 * assert the CONFIG WRITTEN, as boardkeychain-4491.test.js does; that Claude Code honours an Edit deny with permissions
 * skipped was measured by hand on 2026-10-08 (Claude Code 2.1.295, two arms: written without the rule, refused with it).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'launchpath-5516-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });

const setup = require('./setup-assistant');
const store = require('./store');

fs.mkdirSync(store.ROOT, { recursive: true });
function realOr(p) { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } }
function ruleAbs(p) { return '//' + String(p).replace(/^\/+/, ''); }
function agentDir(name) { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
function readSettings(dir) { return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')); }
function binDir(name) { const d = path.join(SANDBOX, 'bins', name); fs.mkdirSync(d, { recursive: true }); return d; }
// ownPath is pinned in every call: the test process's own PATH is the runner's, not a fixture.
const BASE = { platform: 'darwin', dataRoot: store.ROOT, home: process.env.AGENT_WORKFORCE_HOME, runner: 'claude', runnerOf: () => 'claude', ownPath: '/usr/bin:/bin' };

test('#5516: every folder on the pane PATH is denied to the file tools AND the shell', () => {
  const dir = agentDir('lp-a');
  const a = binDir('claude-bin');
  const b = binDir('brew-bin');
  const r = setup.guardTokenOnlyFolder(dir, 'lp-a', { ...BASE, panePath: [a, b, '/usr/bin'].join(path.delimiter) });
  assert.deepEqual(r, { ok: true });
  const s = readSettings(dir);
  for (const d of [a, b]) {
    assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(realOr(d))}/**)`), `no Edit deny for ${d}: ${JSON.stringify(s.permissions.deny)}`);
    assert.ok(s.sandbox.filesystem.denyWrite.includes(realOr(d)), `no denyWrite for ${d}`);
  }
  // The plist's fixed folders are covered even when the pane PATH does not name them.
  for (const fixed of ['/opt/homebrew/bin', '/usr/local/bin']) {
    assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(realOr(fixed))}/**)`), `no Edit deny for ${fixed}`);
  }
  // And this process's own PATH (the board's, at a board-start refresh).
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(realOr('/bin'))}/**)`), 'the own PATH was not covered');
});

test('#5516: the pane PATH comes from KOSMOS_GUARD_PANE_PATH when the supervisor passes it', () => {
  const dir = agentDir('lp-env');
  const c = binDir('from-env');
  const before = process.env.KOSMOS_GUARD_PANE_PATH;
  process.env.KOSMOS_GUARD_PANE_PATH = c;
  try {
    const r = setup.guardTokenOnlyFolder(dir, 'lp-env', BASE);
    assert.deepEqual(r, { ok: true });
  } finally {
    if (before === undefined) delete process.env.KOSMOS_GUARD_PANE_PATH; else process.env.KOSMOS_GUARD_PANE_PATH = before;
  }
  assert.ok(readSettings(dir).permissions.deny.includes(`Edit(${ruleAbs(realOr(c))}/**)`));
  // CONTROL: without it, that folder is not named (the assertion above can fail).
  const dir2 = agentDir('lp-env-control');
  setup.guardTokenOnlyFolder(dir2, 'lp-env-control', BASE);
  assert.ok(!readSettings(dir2).permissions.deny.includes(`Edit(${ruleAbs(realOr(c))}/**)`));
});

test('#5516: a PATH entry that cannot be covered leaves the guard NOT whole, but the rest of it is still written', () => {
  const TOKEN = require('./boardauth').TOKEN_FILE;
  for (const [label, entry] of [['empty', ''], ['relative', 'bin'], ['dot', '.']]) {
    const dir = agentDir(`lp-bad-${label}`);
    const r = setup.guardTokenOnlyFolder(dir, `lp-bad-${label}`, { ...BASE, panePath: ['/usr/bin', entry].join(path.delimiter) });
    assert.equal(r.ok, false, `${label}: ${JSON.stringify(r)}`);
    assert.match(r.because, /could not cover .*the rest of the guard is in place/);
    // Review 1: an odd PATH must never leave the board token unguarded.
    const s = readSettings(dir);
    assert.ok(s.permissions.deny.includes(`Read(${ruleAbs(path.join(store.ROOT, TOKEN))})`), `${label}: the token deny was not written`);
    assert.equal(s.sandbox.enabled, true, label);
  }
  const dir = agentDir('lp-inside');
  const inside = path.join(dir, 'tools');
  fs.mkdirSync(inside, { recursive: true });
  const r = setup.guardTokenOnlyFolder(dir, 'lp-inside', { ...BASE, panePath: inside });
  assert.equal(r.ok, false, JSON.stringify(r));
  // CONTROL: the same agent with a clean PATH is guarded.
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-inside', { ...BASE, panePath: '/usr/bin' }), { ok: true });
});

test('#5516: launchPathDirs resolves symlinks and does not repeat a folder', () => {
  const real = binDir('real-bin');
  const link = path.join(SANDBOX, 'bins', 'link-bin');
  fs.symlinkSync(real, link);
  const { dirs, unsafe } = setup.launchPathDirs(agentDir('lp-sym'), { panePath: [link, real].join(path.delimiter), ownPath: '' });
  assert.equal(dirs.filter((d) => d === realOr(real)).length, 1, JSON.stringify(dirs));
  assert.ok(!dirs.includes(link), 'the symlink path itself was kept, not its target');
  assert.deepEqual(unsafe, ['(an empty entry)'], 'an empty own PATH is an empty entry, and is said');
});

test('#5516 review 1: a program on PATH that links into another folder gets that folder covered too', () => {
  const dir = agentDir('lp-link');
  const pathDir = binDir('link-path');
  const realHome = binDir('cellar-like/tool/1.0/bin');
  fs.writeFileSync(path.join(realHome, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
  fs.symlinkSync(path.join(realHome, 'tool'), path.join(pathDir, 'tool'));
  const r = setup.guardTokenOnlyFolder(dir, 'lp-link', { ...BASE, panePath: pathDir });
  assert.deepEqual(r, { ok: true });
  const s = readSettings(dir);
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(realOr(realHome))}/**)`), `the link's folder was not covered: ${JSON.stringify(s.permissions.deny)}`);
  assert.ok(s.sandbox.filesystem.denyWrite.includes(realOr(realHome)));
  // CONTROL: without the link, that folder is not named.
  const dir2 = agentDir('lp-link-control');
  setup.guardTokenOnlyFolder(dir2, 'lp-link-control', { ...BASE, panePath: binDir('no-link-path') });
  assert.ok(!readSettings(dir2).permissions.deny.includes(`Edit(${ruleAbs(realOr(realHome))}/**)`));
});

test('#5516 review 1: the supervisor hands the pane a cleaned PATH and gives the guard the same one', () => {
  const sup = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  const i = sup.indexOf('_guard_path="$("$TMUX_BIN" show-environment -g PATH');
  assert.ok(i > 0, 'the pane PATH is not read from the tmux server');
  const block = sup.slice(i, sup.indexOf('unset _guard_path', i));
  assert.match(block, /case "\$_e" in \/\*\)/, 'empty and relative entries are not removed');
  assert.match(block, /PANE_ENV\+=\(-e "PATH=\$_guard_path"\)/, 'the pane is not given the cleaned PATH');
  assert.match(block, /KOSMOS_GUARD_PANE_PATH="\$_guard_path"/, 'the guard is not given the same PATH');
  assert.match(block, /set -f/, 'entries could be globbed when split');
});
