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
function realOrLeafT(p) { const d = realOr(path.dirname(p)); return path.join(d, path.basename(p)); }
function realOr(p) { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } }
function ruleAbs(p) { return '//' + String(p).replace(/^\/+/, ''); }
function agentDir(name) { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
function readSettings(dir) { return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')); }
function binDir(name) { const d = path.join(SANDBOX, 'bins', name); fs.mkdirSync(d, { recursive: true }); return d; }
// ownPath is pinned in every call: the test process's own PATH is the runner's, not a fixture.
// Review 5: the fixed folders and the install's own program folders are pinned too, so no test depends on this host's
// /opt/homebrew or /usr/local. The W3b test below clears ownProgramDirs to check the real defaults.
const BASE = { platform: 'darwin', dataRoot: store.ROOT, home: process.env.AGENT_WORKFORCE_HOME, runner: 'claude', runnerOf: () => 'claude', ownPath: '/usr/bin:/bin', launchFixed: [], ownProgramDirs: [], launchFiles: [] };
// Review 7: the same pins for direct launchPathDirs calls.
const PIN = { launchFixed: [], ownProgramDirs: [], launchFiles: [] };

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
  const { dirs, unsafe } = setup.launchPathDirs(agentDir('lp-sym'), { ...PIN, panePath: [link, real].join(path.delimiter), ownPath: '' });
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
  const m = sup.match(/\n_phys_dir\(\) \{\n[\s\S]*?\n\}\nabs_path_only\(\) \{\n[\s\S]*?\n\}\n/);
  assert.ok(m, 'abs_path_only (and the helper it calls) is not defined in the supervisor');
  const run = (input, own) => require('child_process').execFileSync('/bin/bash', ['-c', m[0] + '\nabs_path_only "$1" "$2"', 'x', input, own || ''], { encoding: 'utf8' });
  assert.equal(run('/a::rel:/b c:.:/d*'), '/a:/b c:/d*', 'empty, relative and dot entries go; spaces and a * stay literal');
  assert.equal(run('rel:.:'), '/usr/bin:/bin:/usr/sbin:/sbin', 'nothing absolute left: the system default');
  // Review 8: a caller's noglob is left as it was, on or off.
  const fl = (pre) => require('child_process').execFileSync('/bin/bash', ['-c', m[0] + '\n' + pre + '\nabs_path_only /a /b >/dev/null; case "$-" in *f*) echo on ;; *) echo off ;; esac'], { encoding: 'utf8' }).trim();
  assert.equal(fl('set -f'), 'on'); assert.equal(fl('set +f'), 'off');
  // Review 4: the agent's own folder and folders inside it go too, as written and through a link; a sibling with the
  // same prefix stays (CONTROL), and without the folder argument nothing extra goes (CONTROL).
  const own = agentDir('lp-own-path');
  const inside = path.join(own, 'bin');
  fs.mkdirSync(inside, { recursive: true });
  const link = path.join(path.dirname(own), 'lp-own-path-link');
  try { fs.symlinkSync(inside, link); } catch {}
  const sib = own + '-sibling';
  fs.mkdirSync(sib, { recursive: true });
  const A = binDir('sh-a');
  assert.equal(run(`${A}:${own}:${inside}/:${link}:${sib}`, own), `${A}:${sib}`, 'the agent folder, inside it, or a link into it stayed on the PATH');
  assert.equal(run(`${A}:${own}:${sib}`), `${A}:${own}:${sib}`, 'with no folder given, nothing extra should go');
  // Review 7: a folder not made yet goes (inside the agent folder or not); with no folder given it stays (CONTROL).
  const never = path.join(SANDBOX, 'bins', 'never-made');
  assert.equal(run(`${A}:${path.join(own, 'later')}:${never}:${sib}`, own), `${A}:${sib}`, 'a folder not made yet stayed');
  assert.equal(run(`${A}:${never}`), `${A}:${never}`);
  // Review 7: letter case is ignored, where the disk ignores it (macOS usually).
  const upper = path.join(path.dirname(own), path.basename(own).toUpperCase());
  if (fs.existsSync(upper)) assert.equal(run(`${A}:${upper}:${sib}`, own), `${A}:${sib}`, 'the agent folder in other letter case stayed');
  // Review 6: with the folder given, an entry with a rule-pattern character or a . or .. segment goes too, though each
  // exists; a dotted name that is not a segment stays (CONTROL).
  const X = binDir('x');
  for (const d of ['App (Beta)/bin', 'b*', 'b', 'y', '.hidden', '..y']) fs.mkdirSync(path.join(X, d), { recursive: true });
  assert.equal(run([A, `${X}/App (Beta)/bin`, `${X}/b*`, `${X}/./b`, `${X}/y/../b`, `${X}/..`, `${X}/.hidden`, `${X}/..y`].join(':'), own), `${A}:${X}/.hidden:${X}/..y`, 'an entry the guard cannot name exactly stayed');
  // Review 9: an entry written through a link inside the agent folder that points out of it goes too.
  const outOfOwn = binDir('sh-out-of-own');
  try { fs.symlinkSync(outOfOwn, path.join(own, 'outlink')); } catch {}
  assert.equal(run(`${A}:${path.join(own, 'outlink')}:${outOfOwn}`, own), `${A}:${outOfOwn}`, 'an entry written through a link in the agent folder stayed');
  // Review 10: "/" itself goes (it is above every agent folder).
  assert.equal(run(`${A}:/:${sib}`, own), `${A}:${sib}`, '/ stayed');
  // Review 5: an ancestor goes too.
  assert.equal(run(`${A}:${path.dirname(own)}:${sib}`, own), `${A}:${sib}`, 'an ancestor stayed');
  // The pane AND the guard are given its result.
  const i = sup.indexOf('_guard_path="$(abs_path_only "$_guard_path" "$WORKDIR")"');
  assert.ok(i > 0, 'the pane PATH is not cleaned');
  const block = sup.slice(i, sup.indexOf('unset _guard_path', i));
  assert.match(block, /\[ "\$RUNNER" = claude \] && PANE_ENV\+=\(-e "PATH=\$_guard_path"\)/, 'the claude pane is not given the cleaned PATH, or other runners get a second PATH key');
  assert.match(block, /KOSMOS_GUARD_PANE_PATH="\$_guard_path"/, 'the guard is not given the same PATH');
  assert.match(block, /KOSMOS_GUARD_RUN_DIRS="\$\(dirname "\$CLAUDE"\):\$\(dirname "\$TMUX_BIN"\)"/, 'the guard is not given the claude and tmux folders');
  // Review 8: no later line gives a claude pane a second PATH key (only the codex/gemini/grok line adds one, gated).
  const later = sup.slice(sup.indexOf('unset _guard_path', i)).split('\n').filter((l) => /PANE_ENV\+=\(-e "PATH=/.test(l));
  assert.equal(later.length, 1, 'another PATH key for the pane: ' + JSON.stringify(later));
  const gate = sup.slice(0, sup.indexOf(later[0])).split('\n').reverse().find((l) => /RUNNER/.test(l)) || '';
  assert.match(gate, /codex.*gemini.*grok/, 'the later PATH key is not limited to codex, gemini and grok: ' + gate);
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
  const r = setup.launchPathDirs(agentDir('lp-odd'), { ...PIN, panePath: pd, ownPath: '', linkScanMax: 2 });
  assert.ok(r.dirs.includes(realOr(pd)), JSON.stringify(r));
  assert.ok(!r.dirs.includes(realOr(path.join(pd, 'subdir'))) && !r.dirs.includes(realOr(pd) + path.sep + 'subdir'), 'a folder entry was taken as a program folder');
  assert.ok(r.unsafe.some((u) => u.startsWith(realOr(pd)) && u.includes('more than 2 entries')), `the cap was not reported: ${JSON.stringify(r.unsafe)}`);
  // CONTROL: under the cap, no cap note.
  const r2 = setup.launchPathDirs(agentDir('lp-odd2'), { ...PIN, panePath: pd, ownPath: '', linkScanMax: 100 });
  assert.ok(!r2.unsafe.some((u) => u.startsWith(realOr(pd))), JSON.stringify(r2.unsafe));
  // Review 7: the dangling link's folder is covered (whatever is later made there runs by that name).
  assert.ok(r2.dirs.includes(realOrLeafT(path.join(SANDBOX, 'nowhere'))), 'a dangling link\'s folder was not covered: ' + JSON.stringify(r2.dirs));
});

test('#5516 review 2: odd entries in the board process PATH are skipped quietly; the pane PATH is held strictly', () => {
  const r = setup.launchPathDirs(agentDir('lp-board-odd'), { ...PIN, panePath: '/usr/bin', ownPath: '::rel:/bin' });
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
  const r = setup.guardTokenOnlyFolder(dir, 'lp-own', { ...BASE, panePath: '/usr/bin', ownProgramDirs: undefined, launchFiles: undefined });
  assert.deepEqual(r, { ok: true });
  const s = readSettings(dir);
  // Review 5: the INSTALLED supervisor's folder (what launchd and the pane run), named from create, not this tree's bin.
  const installed = path.dirname(require('./create').supervisorPath());
  fs.mkdirSync(installed, { recursive: true });
  assert.notEqual(realOr(installed), realOr(path.join(__dirname, '..', 'bin')), 'the fixture cannot tell the installed folder from the source bin');
  // Review 7: and the browser tool's tree, which every claude pane starts by absolute path through --mcp-config.
  for (const d of [installed, path.join(__dirname), path.dirname(process.execPath), require('./agentbrowser').homeDir()]) {
    assert.ok(s.sandbox.filesystem.denyWrite.includes(realOr(d)), 'no denyWrite for ' + d);
    assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(realOr(d))}/**)`), 'no Edit deny for ' + d);
  }
  // Review 7: the permission settings file the launch passes with --settings, in both layers.
  const perm = require('./agentpermission').settingsPath();
  assert.ok(s.permissions.deny.includes(`Edit(${ruleAbs(realOrLeafT(perm))})`), 'no Edit deny for the --settings file');
  assert.ok(s.sandbox.filesystem.denyWrite.includes(realOrLeafT(perm)), 'no denyWrite for the --settings file');
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

test('#5516 review 5 and 8: one refresh pass scans a PATH once for ALL its agents, and no user changes the cached scan', () => {
  const cache = new Map();
  const d = binDir('cache (bin)');   // a pattern character, so the guard adds to its own unsafe list
  fs.writeFileSync(path.join(d, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
  const deps = { ...PIN, panePath: d, ownPath: BASE.ownPath, launchCache: cache };   // the key the guard uses
  const a = setup.launchPathDirs(agentDir('lp-cache'), deps);
  const scan = [...cache.values()][0];
  const before = JSON.stringify(scan);
  // A second agent in the same pass: the same scan, not a second one (review 8).
  setup.launchPathDirs(agentDir('lp-cache-2'), deps);
  assert.equal(cache.size, 1, 'a second agent scanned the PATH again');
  assert.equal([...cache.values()][0], scan);
  // An agent for which a scanned folder is uncoverable (it lives inside one) adds its own notes, not the scan's.
  assert.ok(setup.launchPathDirs(path.join(d, 'an-agent'), deps).unsafe.length > 0, 'CONTROL: that agent has notes');
  assert.equal(JSON.stringify(scan), before, 'one agent\'s notes went into the shared scan');
  // Users of the answer (the guard adds its own notes; a caller may change what it was given) leave the scan as it was.
  a.unsafe.push('changed'); a.dirs.push('/changed');
  setup.guardTokenOnlyFolder(agentDir('lp-cache'), 'lp-cache', { ...BASE, panePath: d, launchCache: cache });
  assert.equal(JSON.stringify(scan), before, 'a user of the cached scan changed it');
  const again = setup.launchPathDirs(agentDir('lp-cache'), deps);
  assert.ok(again.dirs.includes(realOr(d)) && !again.dirs.includes('/changed') && !again.unsafe.includes('changed'), JSON.stringify(again));
});

test('#5516 review 7: every hop of a link chain is covered, and a program that resolves into the agent folder is reported, not denied', () => {
  const pd = binDir('chain-path');
  const hop = binDir('chain-hop');
  const end = binDir('chain-end');
  fs.writeFileSync(path.join(end, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
  fs.symlinkSync(path.join(end, 'tool'), path.join(hop, 'tool'));
  fs.symlinkSync(path.join(hop, 'tool'), path.join(pd, 'tool'));
  const r = setup.launchPathDirs(agentDir('lp-chain'), { ...PIN, panePath: pd, ownPath: '' });
  for (const d of [pd, hop, end]) assert.ok(r.dirs.includes(realOr(d)), 'not covered: ' + d + ' ' + JSON.stringify(r.dirs));
  assert.deepEqual(r.unsafe, []);
  // A program on PATH that resolves into the agent's own folder: reported, and that folder is not denied.
  const dir = agentDir('lp-into');
  const pd2 = binDir('into-path');
  fs.writeFileSync(path.join(dir, 'mine'), '#!/bin/sh\n', { mode: 0o755 });
  fs.symlinkSync(path.join(dir, 'mine'), path.join(pd2, 'mine'));
  const r2 = setup.launchPathDirs(dir, { ...PIN, panePath: pd2, ownPath: '' });
  assert.ok(r2.unsafe.includes(path.join(realOr(pd2), 'mine')), JSON.stringify(r2.unsafe));
  assert.ok(!r2.dirs.includes(realOr(dir)), 'the agent folder was denied');
  // CONTROL: without that link, nothing is reported.
  fs.unlinkSync(path.join(pd2, 'mine'));
  assert.deepEqual(setup.launchPathDirs(dir, { ...PIN, panePath: pd2, ownPath: '' }).unsafe, []);
});

test('#5516 review 7: a PATH folder that cannot be listed is reported; a missing one is not', { skip: process.getuid && process.getuid() === 0 }, () => {
  const pd = binDir('unlistable');
  fs.chmodSync(pd, 0o311);
  try {
    const r = setup.launchPathDirs(agentDir('lp-unlist'), { ...PIN, panePath: pd, ownPath: '' });
    assert.ok(r.unsafe.some((u) => u.startsWith(realOr(pd)) && u.includes('could not be listed')), JSON.stringify(r.unsafe));
  } finally { fs.chmodSync(pd, 0o755); }
  const r2 = setup.launchPathDirs(agentDir('lp-unlist'), { ...PIN, panePath: path.join(SANDBOX, 'bins', 'not-there'), ownPath: '' });
  assert.deepEqual(r2.unsafe, [], 'a missing folder was reported');
});

test('#5516 review 7: on macOS a not-yet entry inside the agent folder in other letter case is still uncoverable', () => {
  // The agent folder is not made, so the disk cannot fold the case for us: only the guard's own comparison can.
  const dir = path.join(SANDBOX, 'workers', 'lp-case-absent');
  agentDir('lp-case-parent');
  const shout = path.join(SANDBOX, 'workers', 'LP-CASE-ABSENT', 'later-bin');
  const r = setup.launchPathDirs(dir, { ...PIN, panePath: shout, ownPath: '', platform: 'darwin' });
  assert.ok(r.unsafe.includes(shout), JSON.stringify(r));
  // CONTROL: on a platform whose disks keep case, it is a different folder.
  const r2 = setup.launchPathDirs(dir, { ...PIN, panePath: shout, ownPath: '', platform: 'linux' });
  assert.ok(!r2.unsafe.includes(shout), JSON.stringify(r2));
});

test('#5516 review 8: the claude and tmux folders the supervisor passes are covered, on the PATH or not', () => {
  const cl = binDir('claude-home');
  const tm = binDir('tmux-home');
  const was = process.env.KOSMOS_GUARD_RUN_DIRS;
  process.env.KOSMOS_GUARD_RUN_DIRS = [cl, tm].join(path.delimiter);
  try {
    const r = setup.launchPathDirs(agentDir('lp-run'), { ...PIN, ownProgramDirs: undefined, panePath: '/usr/bin', ownPath: '' });
    for (const d of [cl, tm]) assert.ok(r.dirs.includes(realOr(d)), 'not covered: ' + d);
  } finally { if (was === undefined) delete process.env.KOSMOS_GUARD_RUN_DIRS; else process.env.KOSMOS_GUARD_RUN_DIRS = was; }
  // CONTROL: without the variable, neither is named.
  const r2 = setup.launchPathDirs(agentDir('lp-run'), { ...PIN, ownProgramDirs: undefined, panePath: '/usr/bin', ownPath: '' });
  assert.ok(!r2.dirs.includes(realOr(cl)));
});

test('#5516 review 9: a launch input whose place cannot be worked out is said, not silently left out', () => {
  const base = { ...PIN, ownProgramDirs: undefined, launchFiles: undefined, panePath: '/usr/bin', ownPath: '' };
  const r = setup.launchPathDirs(agentDir('lp-missed'), { ...base, launchLookups: { browserToolDir: () => null } });
  assert.ok(r.unsafe.some((u) => u.includes('the browser tool')), JSON.stringify(r.unsafe));
  const r2 = setup.launchPathDirs(agentDir('lp-missed'), { ...base, launchLookups: { permissionSettingsFile: () => null } });
  assert.ok(r2.unsafe.some((u) => u.includes('the permission settings file')), JSON.stringify(r2.unsafe));
  // CONTROL: with every lookup answering, nothing is said about them.
  const r3 = setup.launchPathDirs(agentDir('lp-missed'), base);
  assert.ok(!r3.unsafe.some((u) => u.includes('could not be worked out')), JSON.stringify(r3.unsafe));
});

test('#5516 review 9: a link along a path is followed one name at a time; the folder holding it is covered, or reported when it is the agent\'s own', () => {
  // A program whose link target passes through a folder link in the MIDDLE (an "opt"-style layout).
  const pd = binDir('mid-path');
  const cellar = binDir('mid-cellar/tool/1.0/bin');
  fs.writeFileSync(path.join(cellar, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
  const opt = binDir('mid-opt');
  fs.symlinkSync(path.join(SANDBOX, 'bins', 'mid-cellar', 'tool', '1.0'), path.join(opt, 'tool'));
  fs.symlinkSync(path.join(opt, 'tool', 'bin', 'tool'), path.join(pd, 'tool'));
  const r = setup.launchPathDirs(agentDir('lp-mid'), { ...PIN, panePath: pd, ownPath: '' });
  assert.ok(r.dirs.includes(realOr(opt)), 'the folder holding the middle link was not covered: ' + JSON.stringify(r.dirs));
  assert.ok(r.dirs.includes(realOr(cellar)), JSON.stringify(r.dirs));
  // A PATH entry written THROUGH a link inside the agent folder that points out of it: reported, not covered as whole.
  const dir = agentDir('lp-through');
  const outside = binDir('through-out');
  fs.symlinkSync(outside, path.join(dir, 'tools'));
  const r2 = setup.launchPathDirs(dir, { ...PIN, panePath: path.join(dir, 'tools'), ownPath: '' });
  assert.ok(r2.unsafe.includes(path.join(dir, 'tools')), JSON.stringify(r2));
  // CONTROL: the same folder given by its own path is coverable.
  assert.deepEqual(setup.launchPathDirs(dir, { ...PIN, panePath: outside, ownPath: '' }).unsafe, []);
  // A PROGRAM on a clean PATH folder whose link target passes through a link inside the agent folder: reported.
  const pd3 = binDir('through-prog');
  fs.writeFileSync(path.join(outside, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
  fs.symlinkSync(path.join(dir, 'tools', 'tool'), path.join(pd3, 'tool'));
  const r3 = setup.launchPathDirs(dir, { ...PIN, panePath: pd3, ownPath: '' });
  assert.ok(r3.unsafe.includes(path.join(realOr(pd3), 'tool')), JSON.stringify(r3));
  // A file named on PATH runs nothing: not reported (CONTROL for the could-not-be-listed note).
  const f = path.join(SANDBOX, 'bins', 'a-file');
  fs.writeFileSync(f, '');
  assert.deepEqual(setup.launchPathDirs(dir, { ...PIN, panePath: f, ownPath: '' }).unsafe, []);
});

test('#5516 review 10: a ".." after a link in a link target applies to where the link leads, as the system does', () => {
  const pd = binDir('dd-path');
  const away = binDir('dd-away/inner');           // where the link leads
  const real = binDir('dd-away/target');          // inner/.. is dd-away, so the program really lives here
  fs.writeFileSync(path.join(real, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
  const base = binDir('dd-base');
  fs.symlinkSync(away, path.join(base, 'lnk'));
  fs.symlinkSync(base + '/lnk/../target/tool', path.join(pd, 'tool'));   // as text: path.join would fold the .. away
  const r = setup.launchPathDirs(agentDir('lp-dd'), { ...PIN, panePath: pd, ownPath: '' });
  assert.ok(r.dirs.includes(realOr(real)), 'the folder the program really lives in was not covered: ' + JSON.stringify(r.dirs));
  assert.ok(!r.dirs.includes(path.join(realOr(base), 'target')), 'the folded spelling was taken as the program folder');
  // The reason stays readable when one folder names many programs.
  const many = binDir('many-progs');
  const dir = agentDir('lp-many');
  for (let i = 0; i < 60; i++) { fs.writeFileSync(path.join(dir, 'p' + i), ''); fs.symlinkSync(path.join(dir, 'p' + i), path.join(many, 'p' + i)); }
  const r2 = setup.launchPathDirs(dir, { ...PIN, panePath: many, ownPath: '' });
  assert.equal(r2.unsafe.length, 41, JSON.stringify(r2.unsafe.slice(-2)));
  assert.match(r2.unsafe[40], /^\(and 20 more\)$/);
});
