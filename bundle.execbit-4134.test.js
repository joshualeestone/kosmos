'use strict';

/**
 * #4134: every file the bundle `chmod +x`'s from the tree is executable IN the tree.
 *
 * tools/build-kosmos-bundle.sh copies files out of the repo and marks some of them executable.
 * The cut (tools/lib/release-freeze.sh release_bundle_matches_tree, step 4b) then refuses a bundle
 * whose file's executable bit differs from the tree's copy. So a file committed 100644 that the
 * bundle makes executable passes every pre-merge test (the bridges' own tests run them with
 * `node <file>`, and the bundle tests compare lists and bytes) and is found only at cut time:
 * #4043 committed bin/agy-report-bridge.js as 100644 and the 0.7.01 cut refused it.
 *
 * The set is READ FROM THE SCRIPT, not kept here: each `chmod +x "$STAGE/..."` is paired with the
 * last `cp` into that path above it. A `cp` from `$REPO/...` must be 100755 in the git index. A
 * `cp` from anything else (the connector, the Node runtime) has no tree copy and is skipped. Two
 * shapes this parser does not read fail rather than pass: a chmod target no `cp` accounts for,
 * and any other line that runs `chmod` (another mode spelling, a variable path, a loop).
 *
 * It reads git's INDEX, which is what a merge carries. The cut reads the checked-out file's `-x`
 * bit instead.
 *
 *   node --test bundle.execbit-4134.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = __dirname;
/* git with no GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE inherited: inside a git hook those are set,
   and they would point every call here, the control's writes included, at the outer repo. */
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|INDEX_FILE|WORK_TREE|COMMON_DIR|OBJECT_DIRECTORY|NAMESPACE|PREFIX)$/.test(k)));
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
const SCRIPT = path.join(ROOT, 'tools', 'build-kosmos-bundle.sh');

/* The placements a script makes: [{ dst, src, fromRepo, at }], `dst` relative to $STAGE. */
function placements(text) {
  const out = [];
  for (const [at, line] of text.split('\n').entries()) {
    const m = line.match(/^\s*cp\s+(?:-[a-zA-Z]+\s+)*"([^"]+)"\s+"\$STAGE\/([^"]+)"\s*$/);
    if (!m) continue;
    const [, src, to] = m;
    const repo = src.match(/^\$REPO\/(.+)$/);
    const dst = to.endsWith('/') ? to + path.basename(src) : to;
    out.push({ dst, src: repo ? repo[1] : src, fromRepo: !!repo, at });
  }
  return out;
}

/* A line this parser reads as marking files executable: `chmod +x` and nothing but quoted
   "$STAGE/..." paths after it. */
const CHMOD_LINE = /^\s*chmod\s+\+x((?:\s+"\$STAGE\/[^"]+")+)\s*$/;

/* Every `chmod +x` target under $STAGE, relative to it, with its line index. */
function chmodTargets(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    const m = line.match(CHMOD_LINE);
    if (!m) return;
    for (const q of m[1].matchAll(/"\$STAGE\/([^"]+)"/g)) out.push({ dst: q[1], at: i });
  });
  return out;
}

/* Lines that run chmod in a shape CHMOD_LINE does not read. Comments are skipped. */
function unreadChmods(text) {
  return text.split('\n')
    .filter((line) => /\bchmod\b/.test(line) && !/^\s*#/.test(line) && !CHMOD_LINE.test(line))
    .map((line) => line.trim());
}

/* What is wrong, as sentences: a tree file the bundle makes executable that the index holds
   non-executable, a chmod target nothing here can trace to a source, and a chmod this parser
   cannot read. */
function problems(text, modeOf) {
  const placed = placements(text);
  const out = [];
  for (const line of unreadChmods(text)) out.push('this test cannot read the chmod in: ' + line);
  for (const { dst, at } of chmodTargets(text)) {
    const p = placed.filter((x) => x.dst === dst && x.at < at).pop();
    if (!p) { out.push('the bundle makes ' + dst + ' executable, and this test cannot tell where it comes from'); continue; }
    if (!p.fromRepo) continue;   // not from the tree: nothing in git to hold a mode
    const mode = modeOf(p.src);
    if (mode !== '100755') out.push(p.src + ' is ' + (mode || 'not in the index') + ' in git, and the bundle makes it executable (' + dst + ')');
  }
  return out;
}

/* The mode git records for a path, from the index. */
function gitModeOf(cwd) {
  return (rel) => {
    const line = git(cwd, ['--literal-pathspecs', 'ls-files', '-s', '--', rel]).trim();
    return line ? line.split(/\s+/)[0] : null;
  };
}

const real = () => fs.readFileSync(SCRIPT, 'utf8');
const realProblems = (modeOf) => problems(real(), modeOf);

test('every tree file the bundle makes executable is 100755 in git', () => {
  assert.deepEqual(realProblems(gitModeOf(ROOT)), []);
});

test('the script is actually read: the known executable bridges and the command are in the set', () => {
  const targets = chmodTargets(real()).map((t) => t.dst);
  const fromRepo = placements(real()).filter((p) => p.fromRepo && targets.includes(p.dst)).map((p) => p.src);
  for (const want of ['bin/agent-supervisor.sh', 'bin/board-watchdog.sh', 'bin/codex-report-bridge.js', 'bin/gemini-report-bridge.js',
    'bin/grok-report-bridge.js', 'bin/agy-report-bridge.js', 'install/kosmos', 'install/kosmos-report-hook.sh']) {
    assert.ok(fromRepo.includes(want), want + ' was not found among the chmod +x files from the tree: ' + JSON.stringify(fromRepo));
  }
});

test('CONTROL: a file planted as 100644 in a real git index is caught, and its 100755 twin is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'execbit-4134-'));
  try {
    const g = (...a) => git(dir, a);
    g('init', '-q');
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'plain.js'), '#!/usr/bin/env node\n');
    fs.writeFileSync(path.join(dir, 'bin', 'exec.js'), '#!/usr/bin/env node\n');
    g('add', 'bin/plain.js', 'bin/exec.js');
    g('update-index', '--chmod=-x', 'bin/plain.js');
    g('update-index', '--chmod=+x', 'bin/exec.js');
    const script = [
      'cp "$REPO/bin/plain.js" "$STAGE/app/bin/"',
      'chmod +x "$STAGE/app/bin/plain.js"',
      'cp "$REPO/bin/exec.js" "$STAGE/app/bin/exec.js"',
      'chmod +x "$STAGE/app/bin/exec.js"',
    ].join('\n');
    const found = problems(script, gitModeOf(dir));
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.match(found[0], /^bin\/plain\.js is 100644 in git/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CONTROL: the real script with one bridge read as 100644 names that bridge', () => {
  const tree = gitModeOf(ROOT);
  const found = realProblems((rel) => (rel === 'bin/codex-report-bridge.js' ? '100644' : tree(rel)));
  assert.deepEqual(found, ['bin/codex-report-bridge.js is 100644 in git, and the bundle makes it executable (app/bin/codex-report-bridge.js)']);
});

test('CONTROL: a chmod this parser cannot read fails rather than being skipped', () => {
  for (const line of ['chmod 755 "$STAGE/app/bin/x"', 'chmod a+x "$STAGE/app/bin/x"', 'chmod +x "$dst"',
    'cp "$REPO/bin/x" "$STAGE/app/bin/x" && chmod +x "$STAGE/app/bin/x"']) {
    assert.deepEqual(problems(line, () => '100755'), ['this test cannot read the chmod in: ' + line], line);
  }
  // A comment that mentions chmod is not a chmod.
  assert.deepEqual(problems('# chmod +x "$dst" later', () => '100755'), []);
});

test('CONTROL: a cp AFTER the chmod is not credited as its source', () => {
  const script = [
    'cp "$REPO/bin/plain.js" "$STAGE/app/bin/x"',
    'chmod +x "$STAGE/app/bin/x"',
    'cp "$REPO/bin/exec.js" "$STAGE/app/bin/x"',
  ].join('\n');
  const modes = { 'bin/plain.js': '100644', 'bin/exec.js': '100755' };
  assert.deepEqual(problems(script, (rel) => modes[rel]),
    ['bin/plain.js is 100644 in git, and the bundle makes it executable (app/bin/x)']);
});

test('CONTROL: a chmod target no cp accounts for fails rather than being skipped', () => {
  assert.deepEqual(problems('chmod +x "$STAGE/app/bin/mystery"', () => '100755'),
    ['the bundle makes app/bin/mystery executable, and this test cannot tell where it comes from']);
  // A source outside the tree is traced, and skipped: it has no mode in git.
  assert.deepEqual(problems('cp "$TUNNEL_BIN" "$STAGE/app/bin/kosmos-tunnel"\nchmod +x "$STAGE/app/bin/kosmos-tunnel"', () => null), []);
});
