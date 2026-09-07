'use strict';
/**
 * #2414: find-agents LOCATION coverage. Josh's requirement, verbatim: "look in ALL
 * the possible places ... it could have been called anything." He seeded agents in
 * an ARBITRARY-named folder ("Work") and only 2 of 10 surfaced. The scan today walks
 * a FIXED name list (SCAN_DEEP_NAMES) deep, plus a shallow $HOME walk (HOME_DEPTH=2)
 * that misses anything nested deeper than a grandchild in a non-curated folder.
 *
 * The fix DISCOVERS candidate parents: every real top-level $HOME folder becomes a
 * DEEP root, so an agent under an arbitrary name is reached at full depth, WITHOUT
 * reintroducing the #2125 no-ambush regression (SCAN_SKIP still excludes the
 * TCC-protected folders, and dotdirs are still skipped).
 *
 * 🛑 SANDBOXED VIA A *CONSISTENT* FIXTURE HOME. Every other scan test points explicit
 * roots at a sandbox and so bypasses defaultScanRoots entirely -- but the discovery
 * this card adds LIVES in defaultScanRoots, which only runs on a BARE scan (no roots).
 * To exercise it without walking the operator's real machine, this fixture points
 * BOTH $HOME (os.homedir honours it here) AND AGENT_WORKFORCE_DATA under one mkdtemp
 * root. That makes the sandbox CONSISTENT (data under temp AND home under temp), so
 * the sandbox guard does NOT fire and the bare scan walks the FIXTURE home. The guard
 * only ever refuses an INCONSISTENT sandbox (data in temp, home real).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-loc2414-'));
const HOME = path.join(SB, 'home');
fs.mkdirSync(HOME, { recursive: true });

/* A consistent sandbox: home AND data both under the temp root. */
const savedHome = process.env.HOME;
const savedData = process.env.AGENT_WORKFORCE_DATA;
const savedConfig = process.env.AGENT_WORKFORCE_CONFIG_ROOT;
const savedRoots = process.env.AGENT_WORKFORCE_SCAN_ROOTS;
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, 'claude');
delete process.env.AGENT_WORKFORCE_SCAN_ROOTS;   // force the default-roots path (defaultScanRoots)

const discover = require('./discover');

test.after(() => {
  if (savedHome !== undefined) process.env.HOME = savedHome; else delete process.env.HOME;
  if (savedData !== undefined) process.env.AGENT_WORKFORCE_DATA = savedData; else delete process.env.AGENT_WORKFORCE_DATA;
  if (savedConfig !== undefined) process.env.AGENT_WORKFORCE_CONFIG_ROOT = savedConfig; else delete process.env.AGENT_WORKFORCE_CONFIG_ROOT;
  if (savedRoots !== undefined) process.env.AGENT_WORKFORCE_SCAN_ROOTS = savedRoots; else delete process.env.AGENT_WORKFORCE_SCAN_ROOTS;
  fs.rmSync(SB, { recursive: true, force: true });
});

/** A folder with an introducing CLAUDE.md at HOME/<rel>. */
function agentAt(rel, who) {
  const dir = path.join(HOME, rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `You are **${who}**, a tester.\n`);
  return dir;
}

test('sanity: os.homedir honours the fixture HOME so the bare scan is sandboxed', () => {
  assert.equal(os.homedir(), HOME, 'os.homedir did not follow the fixture $HOME -- the sandbox is unsafe, aborting');
});

test('an agent under an ARBITRARY-named top-level folder, nested DEEP, is found by a bare scan', () => {
  /* 🔑 THE WHOLE POINT. "Freelance" (not in SCAN_DEEP_NAMES, and NOT a case variant
     of one -- "Work" would case-collide with the curated "work" on a case-insensitive
     fs and be found by the CURATED root, answering a different question) nested THREE
     levels deep, beyond the shallow $HOME walk's HOME_DEPTH=2. Without candidate-parent
     discovery this agent is invisible on the find-agents screen (Josh's exact miss). */
  const dir = agentAt('Freelance/some-project/nested/deeper', 'Deep Arbitrary');
  const r = discover.scan();   // BARE: no roots, exercises defaultScanRoots + discovery
  assert.equal(r.ok, true);
  const hit = r.candidates.find((c) => c.dir === dir);
  assert.ok(hit, `a deeply-nested agent under an arbitrary-named folder was missed: ${JSON.stringify(r.candidates.map((c) => c.dir))}`);
  assert.equal(hit.name, 'Deep Arbitrary');
});

test('an agent at the user HOME ROOT itself is found', () => {
  /* The root's own CLAUDE.md (depth 0 of the $HOME walk). Part of Josh's "possibly the
     user home root". */
  const dir = agentAt('.', 'Home Root');   // HOME/CLAUDE.md
  void dir;
  const hit = discover.scan().candidates.find((c) => c.dir === HOME);
  assert.ok(hit, 'an agent at the user home root was missed');
  assert.equal(hit.name, 'Home Root');
});

test('#2125 PRESERVED: a bare (auto) scan does NOT reach ~/Documents, ~/Downloads or ~/Desktop', () => {
  /* 🛑 THE NO-AMBUSH CONTROL. These are TCC-protected; entering them on the auto scan
     fires a macOS access prompt on a fresh install (the exact regression #2125 fixed).
     Discovery must NOT promote them to deep roots -- SCAN_SKIP excludes them. An agent
     planted in each must stay ABSENT on the bare scan. */
  const docs = agentAt('Documents/proj', 'In Documents');
  const dl = agentAt('Downloads/proj', 'In Downloads');
  const desk = agentAt('Desktop/proj', 'In Desktop');
  const dirs = discover.scan().candidates.map((c) => c.dir);
  assert.ok(!dirs.includes(docs), 'the auto scan walked ~/Documents (TCC ambush regression, #2125)');
  assert.ok(!dirs.includes(dl), 'the auto scan walked ~/Downloads (TCC ambush regression, #2125)');
  assert.ok(!dirs.includes(desk), 'the auto scan walked ~/Desktop (TCC ambush regression, #2125)');
});

test('a dotdir at the top level is not promoted to a deep root', () => {
  /* Discovery must skip dotdirs exactly as the descent does: ~/.config, ~/.cache etc.
     never become deep roots. */
  const hidden = agentAt('.hidden-tool/agent', 'Dot Hidden');
  const dirs = discover.scan().candidates.map((c) => c.dir);
  assert.ok(!dirs.includes(hidden), 'a top-level dotdir was promoted to a deep scan root');
});

test('build/vendor noise (node_modules) at the top level is not promoted', () => {
  const vend = agentAt('node_modules/pkg', 'Vendored Top');
  const dirs = discover.scan().candidates.map((c) => c.dir);
  assert.ok(!dirs.includes(vend), 'a top-level node_modules was promoted to a deep scan root');
});

test('#2414 heavyweight non-agent trees (~/go, ~/anaconda3, ~/miniconda3) are not promoted', () => {
  /* Budget mitigation: these dependency/toolchain caches (routinely tens of
     thousands of dirs) must not become deep roots that starve real agents. They are
     in SCAN_SKIP, same class as node_modules. */
  const goAgent = agentAt('go/pkg/mod/x', 'In Go Cache');
  const conda = agentAt('anaconda3/lib/x', 'In Anaconda');
  const mini = agentAt('miniconda3/lib/x', 'In Miniconda');
  const dirs = discover.scan().candidates.map((c) => c.dir);
  assert.ok(!dirs.includes(goAgent), '~/go was promoted to a deep scan root (budget starvation risk)');
  assert.ok(!dirs.includes(conda), '~/anaconda3 was promoted to a deep scan root');
  assert.ok(!dirs.includes(mini), '~/miniconda3 was promoted to a deep scan root');
});

test('an arbitrary top-level SYMLINK is NOT followed (no escape via a discovered parent)', () => {
  /* ⚠️ A discovered name is untrusted (unlike a curated root name). An agent reachable
     only through an arbitrary top-level symlink out of $HOME must NOT surface -- the
     no-symlink-escape rule. Contrast with a curated ~/work symlink, which IS followed
     (covered by the scan-1938 suite). */
  const outside = path.join(SB, 'outside-home');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'CLAUDE.md'), 'You are **Escaped Via Link**, a tester.\n');
  const link = path.join(HOME, 'MyLinkedWork');
  try { fs.symlinkSync(outside, link, 'dir'); } catch { return; }   // platform without symlinks: skip
  const names = discover.scan().candidates.map((c) => c.name);
  assert.ok(!names.includes('Escaped Via Link'), 'an arbitrary top-level symlink was followed, escaping $HOME');
});

test('#2125 case-insensitive: a lowercase ~/downloads (case variant of a TCC folder) is NOT walked', () => {
  /* 🛑 THE WARNING-1 FIX. On a case-INSENSITIVE fs (macOS default, the target) a
     folder whose STORED name is `downloads` is the same TCC-protected location as
     `Downloads`; a case-SENSITIVE SCAN_SKIP check would miss it and promote it to a
     deep root, firing the exact macOS access prompt #2125 removed.

     🔑 THIS NEEDS ITS OWN HOME. The shared fixture already created `Downloads`
     (capital) in the #2125 arm, and a case-insensitive fs stores the FIRST-created
     case, so here `downloads` would resolve to a dir stored as `Downloads` -- which
     even a case-sensitive check skips, making the test vacuous (measured: it passed
     against a case-SENSITIVE perturbation). A private home where the ONLY spelling
     ever created is lowercase is the only fixture that discriminates. */
  const H2 = path.join(SB, 'home-lc');
  fs.mkdirSync(path.join(H2, 'downloads', 'proj'), { recursive: true });
  fs.writeFileSync(path.join(H2, 'downloads', 'proj', 'CLAUDE.md'), 'You are **In Lowercase Downloads**, a tester.\n');
  /* Confirm the on-disk stored case really is lowercase before trusting the result
     -- if the platform up-cased it, the arm proves nothing and must skip. */
  const stored = fs.readdirSync(H2);
  if (!stored.includes('downloads')) return;   // stored case is not lowercase here; the case-variant cannot be exercised
  const saved = process.env.HOME;
  process.env.HOME = H2;
  try {
    assert.equal(os.homedir(), H2, 'HOME override did not take -- cannot trust this arm');
    const dirs = discover.scan().candidates.map((c) => c.dir);
    assert.ok(!dirs.includes(path.join(H2, 'downloads', 'proj')),
      'a lowercase ~/downloads was walked (case-sensitive SCAN_SKIP reintroduced the #2125 TCC ambush)');
  } finally {
    if (saved !== undefined) process.env.HOME = saved; else delete process.env.HOME;
  }
});

test('a folder whose name IS a curated name is offered exactly once (seenDirs dedup, not a name-skip)', () => {
  /* #2414: discovery does NOT skip a name already in SCAN_DEEP_NAMES (that skip breaks
     case-sensitive-fs coverage). On the case-insensitive target, `~/work` is then both a
     curated root and a discovered root -- seenDirs (dev+ino) must collapse the two so the
     agent is offered ONCE, not twice. */
  const dir = agentAt('work/an-agent', 'Curated Name Agent');
  const hits = discover.scan().candidates.filter((c) => c.dir === dir);
  assert.equal(hits.length, 1, `an agent under a curated-named folder was offered ${hits.length} times (seenDirs dedup failed)`);
});

test('case-SENSITIVE fs: ~/Work (distinct from curated work) is still found', () => {
  /* 🛑 THE WARNING FIX. On a case-SENSITIVE fs `~/Work` is a DISTINCT directory from the
     curated `~/work` (which does not exist here), so a name-based curated skip would leave
     it covered by neither -- exactly the "could have been called anything" miss. Discovery
     must reach it. Only meaningful on a case-sensitive fs; on the case-insensitive target
     `~/Work` IS `~/work` (found via the curated root), so detect and skip there. */
  const workCap = path.join(HOME, 'Work');
  fs.mkdirSync(workCap, { recursive: true });
  let caseSensitive;
  // On a case-INSENSITIVE fs, ~/work resolves to the just-created ~/Work (same ino) -> not
  // the gap. On a case-SENSITIVE fs, ~/work does not exist -> statSync throws -> the gap.
  try { caseSensitive = fs.statSync(path.join(HOME, 'work')).ino !== fs.statSync(workCap).ino; }
  catch { caseSensitive = true; }
  if (!caseSensitive) return;
  const dir = path.join(workCap, 'proj');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'You are **Work Cap Agent**, a tester.\n');
  const dirs = discover.scan().candidates.map((c) => c.dir);
  assert.ok(dirs.includes(dir), '~/Work (distinct from curated work on a case-sensitive fs) was missed');
});

test('the user home root is read UP FRONT and is never starved by a heavyweight sibling', () => {
  /* 🔑 THE WARNING-2 FIX. Every top-level folder is a deep root, so a heavyweight
     non-agent tree could exhaust MAX_DIRS before a $HOME-last walk ran. The home
     root is now the FIRST root at depth 0, so ~/CLAUDE.md is read on the first
     directory visit. With maxDirs=1, ONLY that first root runs -- if ~/CLAUDE.md
     still surfaces, it was read before any deep sibling could starve it. */
  agentAt('.', 'Front Home Root');            // HOME/CLAUDE.md
  agentAt('BigCache/a/b/c/d', 'Buried Deep'); // a heavyweight sibling that would eat the budget
  const r = discover.scan({ maxDirs: 1 });
  assert.ok(r.candidates.some((c) => c.dir === HOME && c.name === 'Front Home Root'),
    'the home-root agent was starved -- it is not read up front');
  assert.equal(r.bounded.dirs, true, 'the dir budget was hit but not reported (honest truncation)');
});

test('#2414 the depth-0 home read does NOT raise bounded.depth (it is read-only by design, not truncated)', () => {
  /* NIT fix: the $HOME root is walked at maxDepth 0. Its non-descent is deliberate
     (children covered by the discovered deep roots), so it must not set the "there may
     be deeper agents" flag -- otherwise bounded.depth would be permanently, falsely
     true on every scan. Own home so accumulated fixtures (some nested) cannot perturb
     it; a shallow agent well within DEEP_DEPTH so no discovered root truncates either. */
  const H3 = path.join(SB, 'home-depthflag');
  fs.mkdirSync(path.join(H3, 'Reachable', 'proj'), { recursive: true });
  fs.writeFileSync(path.join(H3, 'Reachable', 'proj', 'CLAUDE.md'), 'You are **Depth Flag Agent**, a tester.\n');
  const saved = process.env.HOME;
  process.env.HOME = H3;
  try {
    assert.equal(os.homedir(), H3, 'HOME override did not take -- cannot trust this arm');
    const r = discover.scan();
    assert.ok(r.candidates.some((c) => c.name === 'Depth Flag Agent'), 'the fixture was not scanned -- the arm would be vacuous');
    assert.equal(r.bounded.depth, false, 'the depth-0 home read falsely raised bounded.depth');
  } finally {
    if (saved !== undefined) process.env.HOME = saved; else delete process.env.HOME;
  }
});

test('CONTROL: the fixture home is really being scanned (an absence above is the guard, not a dead scan)', () => {
  agentAt('Stuff/an-agent', 'Control Agent');   // arbitrary name, shallow
  const r = discover.scan();
  assert.ok(r.candidates.some((c) => c.name === 'Control Agent'),
    'the fixture home stopped being scanned -- every absence assertion above is vacuous');
});
