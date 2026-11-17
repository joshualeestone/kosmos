'use strict';
/**
 * kosmos#8627 (Josh, 2026-11-17 08:53): "I need some way to sort these files on this screen and this probably exists
 * on the project screen as well." Four orders on an agent's Files page and a project's Files page: Newest first,
 * Oldest first, A to Z, Z to A; newest first by default. These run the shipped functions lifted out of the page.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scriptOf, liftAll } = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);

function lifted() {
  const consts = /const FILES_SORTS = \[[^\]]*\];/.exec(SCRIPT);
  assert.ok(consts, 'FILES_SORTS left the page or changed shape');
  const src = liftAll(SCRIPT, ['filesSortMode', 'filesSorted']);
  return new Function(`${consts[0]}\n${src}\nreturn { FILES_SORTS, filesSortMode, filesSorted };`)();
}

const F = (name, modified) => ({ name, size: 1, modified });
const older = F('Bravo.md', '2026-11-16T10:00:00.000Z');
const newest = F('alpha.md', '2026-11-17T14:53:00.000Z');
const middle = F('charlie.md', '2026-11-17T09:00:00.000Z');

test('the four orders do what their words say', () => {
  const { filesSorted } = lifted();
  const names = (m) => filesSorted([older, newest, middle], m).map((f) => f.name);
  assert.deepEqual(names('newest'), ['alpha.md', 'charlie.md', 'Bravo.md'], 'Newest first');
  assert.deepEqual(names('oldest'), ['Bravo.md', 'charlie.md', 'alpha.md'], 'Oldest first');
  assert.deepEqual(names('az'), ['alpha.md', 'Bravo.md', 'charlie.md'], 'A to Z ignores case');
  assert.deepEqual(names('za'), ['charlie.md', 'Bravo.md', 'alpha.md'], 'Z to A is the reverse');
});

test('newest first is the default, and anything else saved falls back to it', () => {
  const { filesSortMode, filesSorted, FILES_SORTS } = lifted();
  assert.deepEqual(FILES_SORTS, ['newest', 'oldest', 'az', 'za'], 'exactly the four choices on the card');
  for (const bad of [null, undefined, '', 'name', 'custom', 7]) assert.equal(filesSortMode(bad), 'newest', JSON.stringify(bad));
  for (const good of FILES_SORTS) assert.equal(filesSortMode(good), good);
  assert.equal(filesSorted([older, newest], undefined)[0].name, 'alpha.md', 'no mode sorts as the default');
});

test('a sort keeps every row, puts undated rows last in both date orders, and breaks date ties A to Z', () => {
  const { filesSorted, FILES_SORTS } = lifted();
  const undated = F('delta.md', undefined);
  const garbled = F('echo.md', 'not a date');
  const tieB = F('b-tie.md', '2026-11-17T09:00:00.000Z');
  const all = [undated, older, tieB, newest, garbled, middle];
  for (const m of FILES_SORTS) {
    const out = filesSorted(all, m);
    assert.equal(out.length, all.length, m + ' dropped a row');
    assert.deepEqual(new Set(out), new Set(all), m + ' changed the rows');
  }
  assert.deepEqual(filesSorted(all, 'newest').map((f) => f.name), ['alpha.md', 'b-tie.md', 'charlie.md', 'Bravo.md', 'delta.md', 'echo.md']);
  assert.deepEqual(filesSorted(all, 'oldest').map((f) => f.name), ['Bravo.md', 'b-tie.md', 'charlie.md', 'alpha.md', 'delta.md', 'echo.md']);
  assert.deepEqual(all.map((f) => f.name), ['delta.md', 'Bravo.md', 'b-tie.md', 'alpha.md', 'echo.md', 'charlie.md'], 'the input is not reordered in place');
  assert.deepEqual(filesSorted(null, 'az'), [], 'no rows is no rows');
});

test('A to Z is exactly the order the Files screen showed before (the server listing), numbers and case included', () => {
  const projects = require('./engine/projects');
  const { filesSorted } = lifted();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-sort-8627-'));
  try {
    const names = ['file10.txt', 'file2.txt', 'Zeta.md', 'alpha.md', 'Alpha2.md', 'beta 1.txt', 'beta-1.txt', '_under.txt', '100.txt', '9.txt'];
    names.forEach((n, i) => {
      fs.writeFileSync(path.join(dir, n), 'x');
      const t = new Date(Date.UTC(2026, 10, 1 + i));
      fs.utimesSync(path.join(dir, n), t, t);
    });
    const listed = projects.listDir(dir, '', 'a test folder', { maxDepth: 1 });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    const server = listed.files.map((f) => f.name);
    assert.equal(server.length, names.length);
    assert.deepEqual(filesSorted(listed.files.slice().reverse(), 'az').map((f) => f.name), server, 'A to Z on the page and the server agree');
    // The control: newest first is NOT the server order here, so the agreement above is not a list that never moved.
    assert.notDeepEqual(filesSorted(listed.files, 'newest').map((f) => f.name), server);
    assert.equal(filesSorted(listed.files, 'newest')[0].name, '9.txt', 'the last file written is on top');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('both pages carry the control with the four words, newest first chosen, and remember per page', () => {
  for (const id of ['d-files-sort', 'docs-sort']) {
    const m = new RegExp('<select id="' + id + '" aria-label="Sort files">([\\s\\S]*?)</select>').exec(PAGE);
    assert.ok(m, id + ' is on the page');
    const opts = [...m[1].matchAll(/<option value="([a-z]+)">([^<]+)<\/option>/g)].map((o) => [o[1], o[2]]);
    assert.deepEqual(opts, [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['az', 'A to Z'], ['za', 'Z to A']], id);
  }
  assert.match(SCRIPT, /const AGENT_FILES_SORT_KEY = 'kosmos\.sort\.files\.agent';/);
  assert.match(SCRIPT, /const DOCS_SORT_KEY = 'kosmos\.sort\.files\.project';/);
  // Both painters sort what they show with the page's own choice.
  assert.match(SCRIPT, /const files = filesSorted\(body\.files, AGENT_FILES_SORT\);/);
  assert.match(SCRIPT, /PJ_DOCS_FILES = filesSorted\(files, DOCS_SORT\);/);
});
