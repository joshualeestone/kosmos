'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)

/*
 * #5516: the token-only guard also protects the folders on the PATH an agent starts with. These tests assert the
 * CONFIG WRITTEN, as boardkeychain-4491.test.js does; Claude Code's enforcement of an Edit deny was measured by hand.
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
// Review 5: the fixed folders and the install's own program folders are pinned too, so no test depends on this host's
// /opt/homebrew or /usr/local. The W3b test below clears ownProgramDirs to check the real defaults.
const BASE = { platform: 'darwin', dataRoot: store.ROOT, home: process.env.AGENT_WORKFORCE_HOME, runner: 'claude', runnerOf: () => 'claude', ownPath: '/usr/bin:/bin', launchFixed: [], ownProgramDirs: [] };

test('#5516: every folder on the pane PATH is denied to the file tools AND the shell', () => {
  const dir = agentDir('lp-a');
  const a = binDir('claude-bin');
  const b = binDir('brew-bin');
  // launchFixed unpinned here: this test checks the real fixed list (rules only, which do not depend on the host).
  const r = setup.guardTokenOnlyFolder(dir, 'lp-a', { ...BASE, panePath: [a, b, '/usr/bin'].join(path.delimiter), launchFixed: undefined });
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
  assert.deepEqual(unsafe, [], 'an empty board PATH is skipped quietly (review 2); only the pane PATH is held strictly');
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

test('#5516 review 2: the supervisor cleans the pane PATH with a function this test runs', () => {
  const sup = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  const m = sup.match(/\n_phys_or_leaf\(\) \{\n[\s\S]*?\n\}\nabs_path_only\(\) \{\n[\s\S]*?\n\}\n/);
  assert.ok(m, 'abs_path_only (and the helper it calls) is not defined in the supervisor');
  const run = (input, own) => require('child_process').execFileSync('/bin/bash', ['-c', m[0] + '\nabs_path_only "$1" "$2"', 'x', input, own || ''], { encoding: 'utf8' });
  assert.equal(run('/a::rel:/b c:.:/d*'), '/a:/b c:/d*', 'empty, relative and dot entries go; spaces and a * stay literal');
  assert.equal(run('rel:.:'), '/usr/bin:/bin:/usr/sbin:/sbin', 'nothing absolute left: the system default');
  // Review 4: the agent's own folder and folders inside it go too, as written and through a link; a sibling with the
  // same prefix stays (CONTROL), and without the folder argument nothing extra goes (CONTROL).
  const own = agentDir('lp-own-path');
  const inside = path.join(own, 'bin');
  fs.mkdirSync(inside, { recursive: true });
  const link = path.join(path.dirname(own), 'lp-own-path-link');
  try { fs.symlinkSync(inside, link); } catch {}
  const sib = own + '-sibling';
  assert.equal(run(`/a:${own}:${inside}/:${path.join(own, 'not-made-yet')}:${link}:${sib}`, own), `/a:${sib}`, 'the agent folder, inside it (made or not yet), or a link into it stayed on the PATH');
  assert.equal(run(`/a:${own}:${sib}`), `/a:${own}:${sib}`, 'with no folder given, nothing extra should go');
  // Review 5: an ancestor goes too, and a not-yet entry spelled through a link into the folder.
  const viaLink = path.join(path.dirname(own), 'lp-own-path-top');
  try { fs.symlinkSync(own, viaLink); } catch {}
  assert.equal(run(`/a:${path.dirname(own)}:${path.join(viaLink, 'later', 'bin')}:${sib}`, own), `/a:${sib}`, 'an ancestor, or a not-yet entry through a link into the folder, stayed');
  // The pane AND the guard are given its result.
  const i = sup.indexOf('_guard_path="$(abs_path_only "$_guard_path" "$WORKDIR")"');
  assert.ok(i > 0, 'the pane PATH is not cleaned');
  const block = sup.slice(i, sup.indexOf('unset _guard_path', i));
  assert.match(block, /\[ "\$RUNNER" = claude \] && PANE_ENV\+=\(-e "PATH=\$_guard_path"\)/, 'the claude pane is not given the cleaned PATH, or other runners get a second PATH key');
  assert.match(block, /KOSMOS_GUARD_PANE_PATH="\$_guard_path"/, 'the guard is not given the same PATH');
});

test('#5516 review 2: an ancestor of the agent folder is never denied (it would lock the agent out of its own folder)', () => {
  const dir = agentDir('lp-anc');
  const ancestor = path.dirname(dir);
  const r = setup.guardTokenOnlyFolder(dir, 'lp-anc', { ...BASE, panePath: ancestor });
  assert.equal(r.ok, false, JSON.stringify(r));
  const s = readSettings(dir);
  assert.ok(!s.permissions.deny.includes(`Edit(${ruleAbs(realOr(ancestor))}/**)`), 'an ancestor was denied');
  assert.ok(!s.sandbox.filesystem.denyWrite.includes(realOr(ancestor)));
});

test('#5516 review 2: broken links, folders as entries and the scan cap', () => {
  const pd = binDir('odd-path');
  fs.symlinkSync(path.join(SANDBOX, 'nowhere', 'gone'), path.join(pd, 'broken'));
  fs.mkdirSync(path.join(pd, 'subdir'));
  fs.writeFileSync(path.join(pd, 'a'), ''); fs.writeFileSync(path.join(pd, 'b'), ''); fs.writeFileSync(path.join(pd, 'c'), '');
  const r = setup.launchPathDirs(agentDir('lp-odd'), { panePath: pd, ownPath: '', linkScanMax: 2 });
  assert.ok(r.dirs.includes(realOr(pd)), JSON.stringify(r));
  assert.ok(!r.dirs.includes(realOr(path.join(pd, 'subdir'))) && !r.dirs.includes(realOr(pd) + path.sep + 'subdir'), 'a folder entry was taken as a program folder');
  assert.ok(r.unsafe.some((u) => u.startsWith(realOr(pd)) && u.includes('more than 2 entries')), `the cap was not reported: ${JSON.stringify(r.unsafe)}`);
  // CONTROL: under the cap, no cap note.
  const r2 = setup.launchPathDirs(agentDir('lp-odd2'), { panePath: pd, ownPath: '', linkScanMax: 100 });
  assert.ok(!r2.unsafe.some((u) => u.startsWith(realOr(pd))), JSON.stringify(r2.unsafe));   // (the fixed Homebrew folder may pass the cap)
});

test('#5516 review 2: odd entries in the board process PATH are skipped quietly; the pane PATH is held strictly', () => {
  const r = setup.launchPathDirs(agentDir('lp-own'), { panePath: '/usr/bin', ownPath: '::rel:/bin' });
  assert.deepEqual(r.unsafe, [], JSON.stringify(r.unsafe));
  assert.ok(r.dirs.includes(realOr('/bin')));
});

test('#5516 review 3: a launch folder whose path the rules cannot carry is reported, but the REST of the guard is written', () => {
  const dir = agentDir('lp-paren');
  const odd = binDir('App (Beta)');
  const r = setup.guardTokenOnlyFolder(dir, 'lp-paren', { ...BASE, panePath: ['/usr/bin', odd].join(path.delimiter) });
  assert.equal(r.ok, false, 'the guard claimed to be whole');
  assert.match(r.because, /could not cover/);
  const s = readSettings(dir);   // written: the guard was not abandoned
  assert.equal(s.sandbox.enabled, true);
  assert.ok(s.sandbox.filesystem.denyWrite.includes(realOr(odd)), 'the shell layer lost the folder too');
  assert.equal(s.permissions.deny.some((x) => x.includes('App (Beta)')), false, 'a rule the syntax cannot carry was written');
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(realOr('/usr/bin'))}/**)`), 'the other launch folders lost their rule');
  // CONTROL: the same agent with a plain PATH is whole.
  assert.deepEqual(setup.guardTokenOnlyFolder(agentDir('lp-paren-control'), 'lp-paren-control', { ...BASE, panePath: '/usr/bin' }), { ok: true });
});

test('#5516 review 3: a PATH entry not created yet is resolved through a symlinked parent', () => {
  const dir = agentDir('lp-leaf');
  const link = path.join(SANDBOX, 'link-to-agent');
  try { fs.symlinkSync(dir, link); } catch { /* exists */ }
  // Not created yet, and inside the agent's own folder once the link is followed: must be reported, not denied.
  const r = setup.guardTokenOnlyFolder(dir, 'lp-leaf', { ...BASE, panePath: ['/usr/bin', path.join(link, 'bin-not-yet')].join(path.delimiter) });
  assert.equal(r.ok, false, 'an entry inside the agent folder (through a link, not yet created) was taken as coverable');
  // CONTROL: the same layout with the entry outside the agent folder is whole.
  const out = path.join(SANDBOX, 'link-to-bins');
  try { fs.symlinkSync(path.join(SANDBOX, 'bins'), out); } catch { /* exists */ }
  assert.deepEqual(setup.guardTokenOnlyFolder(agentDir('lp-leaf-control'), 'lp-leaf-control', { ...BASE, panePath: ['/usr/bin', path.join(out, 'not-yet')].join(path.delimiter) }), { ok: true });
});

test('#5516 review 3 (W3b): the folders of the programs the supervisor starts by absolute path are covered too', () => {
  const dir = agentDir('lp-own');
  const r = setup.guardTokenOnlyFolder(dir, 'lp-own', { ...BASE, panePath: '/usr/bin', ownProgramDirs: undefined });
  assert.deepEqual(r, { ok: true });
  const s = readSettings(dir);
  // Review 5: the INSTALLED supervisor's folder (what launchd and the pane run), named from create, not this tree's bin.
  const installed = path.dirname(require('./create').supervisorPath());
  fs.mkdirSync(installed, { recursive: true });
  assert.notEqual(realOr(installed), realOr(path.join(__dirname, '..', 'bin')), 'the fixture cannot tell the installed folder from the source bin');
  for (const d of [installed, path.join(__dirname), path.dirname(process.execPath)]) {
    assert.ok(s.sandbox.filesystem.denyWrite.includes(realOr(d)), 'no denyWrite for ' + d);
    assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(realOr(d))}/**)`), 'no Edit deny for ' + d);
  }
});

test('#5516 review 5: a PATH folder reached through a link is named both ways in the file-tool rules', () => {
  const dir = agentDir('lp-alias');
  const real = binDir('alias-real');
  const link = path.join(SANDBOX, 'bins', 'alias-link');
  try { fs.symlinkSync(real, link); } catch {}
  assert.deepEqual(setup.guardTokenOnlyFolder(dir, 'lp-alias', { ...BASE, panePath: link }), { ok: true });
  const s = readSettings(dir);
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(realOr(real))}/**)`), 'the resolved spelling is missing');
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(link)}/**)`), 'the as-written spelling is missing');
  assert.ok(s.sandbox.filesystem.denyWrite.includes(realOr(real)));
  // CONTROL: a folder given by its real path gets no second spelling.
  const dir2 = agentDir('lp-alias-control');
  setup.guardTokenOnlyFolder(dir2, 'lp-alias-control', { ...BASE, panePath: realOr(real) });
  assert.ok(!readSettings(dir2).permissions.deny.includes(`Edit(${ruleAbs(link)}/**)`));
});

test('#5516 review 5: one refresh pass scans a PATH once, and the cached answer is not changed by its users', () => {
  const cache = new Map();
  const d = binDir('cache (bin)');   // a pattern character, so the guard adds to its own unsafe list
  const deps = { panePath: d, ownPath: BASE.ownPath, launchFixed: [], ownProgramDirs: [], launchCache: cache };   // the key the guard uses
  const a = setup.launchPathDirs(agentDir('lp-cache'), deps);
  const before = JSON.stringify(a);
  const b = setup.launchPathDirs(agentDir('lp-cache'), deps);
  assert.equal(a, b, 'the second call scanned again');
  setup.guardTokenOnlyFolder(agentDir('lp-cache'), 'lp-cache', { ...BASE, panePath: d, launchCache: cache });
  assert.equal(JSON.stringify(setup.launchPathDirs(agentDir('lp-cache'), deps)), before, 'a user of the cached answer changed it');
});
