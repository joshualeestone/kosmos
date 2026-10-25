'use strict';
/**
 * kosmos#7084: the iPhone logic suites that read the board's own source (web/index.html, engine/*.js) to pin parity
 * with it run here, in the board's own node suite, on any machine with the Swift compiler. ios.yml runs them only on a
 * change under ios/ (path-filtered on purpose, #5488: the GitHub Mac queue), so a web or engine change that broke a pin
 * went green on its own PR and reddened the next unrelated iOS PR. Every full validation runs on a Mac, so this catches
 * it before the merge at no cost to that queue. On a machine without swiftc (Linux CI) it skips, and says so.
 *
 * Which suites: found, not listed. A suite reads the board when its main.swift reads a file under web/ or engine/
 * (repoText("web/...") or appendingPathComponent("engine/...")), not when it merely mentions one in a comment. Each
 * runs through its own runner (ios/LogicTests/run-<suite>.sh), exactly as ios.yml runs it, and must print its PASS
 * verdict and exit 0.
 *
 *   node --test ios.board-parity-7084.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LOGIC = path.join(__dirname, 'ios', 'LogicTests');
const READS_BOARD = /(?:repoText|appendingPathComponent)\(\s*"(?:web|engine)\//;

/* The suites whose main.swift reads the board, with their runners. */
function boardSuites() {
  return fs.readdirSync(LOGIC, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      const main = path.join(LOGIC, name, 'main.swift');
      return fs.existsSync(main) && READS_BOARD.test(fs.readFileSync(main, 'utf8'));
    })
    .sort();
}

const swiftc = spawnSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
const HAVE_SWIFT = swiftc.status === 0 && swiftc.stdout.trim() !== '';

test('the suites that read the board are found, each with its runner', () => {
  const found = boardSuites();
  // room, settings and tasks read web/index.html today (the card's three; newtask joins with #7078).
  for (const name of ['room', 'settings', 'tasks']) assert.ok(found.includes(name), name + ' reads the board and was found: ' + found.join(', '));
  for (const name of found) assert.ok(fs.existsSync(path.join(LOGIC, 'run-' + name + '.sh')), name + ' has its runner run-' + name + '.sh');
  // A suite that only names the board in a comment is not one: the top-level suite and actions read no board file.
  assert.equal(found.includes('actions'), false, 'actions reads only iOS files, which ios.yml already covers');
});

/* Review 1: discovery reads only one shape of read. Any other suite that reads the repo must read only iOS files (which
   ios.yml covers); a repo read discovery cannot classify fails here rather than leaving a pin unguarded in silence. */
test('every other suite that reads the repo reads only iOS files', () => {
  const found = new Set(boardSuites());
  const literal = /(?:repoText|appendingPathComponent)\(\s*"([^"]+)"/g;
  const unclassified = [];
  for (const d of fs.readdirSync(LOGIC, { withFileTypes: true })) {
    const main = path.join(LOGIC, d.name, 'main.swift');
    if (!d.isDirectory() || found.has(d.name) || !fs.existsSync(main)) continue;
    const src = fs.readFileSync(main, 'utf8');
    if (!/KOSMOS_REPO/.test(src)) continue;
    for (const m of src.matchAll(literal)) if (!/^(ios\/|[^/]+$)/.test(m[1])) unclassified.push(d.name + ': ' + m[1]);
  }
  assert.deepEqual(unclassified, [], 'a suite reads a repo file outside ios/ that discovery does not take: widen READS_BOARD');
});

test('the discovery reads the call, not a mention', () => {
  assert.ok(READS_BOARD.test('let page = repoText("web/index.html")'));
  assert.ok(READS_BOARD.test('.appendingPathComponent("engine/tasks.js")'));
  assert.equal(READS_BOARD.test('// the same words as engine/cardlabel.js'), false);
  assert.equal(READS_BOARD.test('repoText("ios/Kosmos/BoardLogic.swift")'), false);
});

for (const name of boardSuites()) {
  test('the ' + name + ' suite agrees with the board it reads', { skip: HAVE_SWIFT ? false : 'no swiftc on this machine (Linux CI, or a Mac without Xcode): NOT checked here; a full validation on a Mac with Xcode runs it' }, () => {
    const r = spawnSync('bash', [path.join(LOGIC, 'run-' + name + '.sh')], { encoding: 'utf8', timeout: 10 * 60 * 1000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const verdict = (out.match(/^VERDICT: .*$/m) || [''])[0];
    assert.equal(r.status, 0, name + ' exited ' + r.status + (r.signal ? ' (' + r.signal + ')' : '') + '. ' + verdict + '\n' + out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 10).join('\n'));
    assert.match(verdict, /^VERDICT: PASS \d+\/\d+$/, name + ' printed its PASS verdict');
  });
}
