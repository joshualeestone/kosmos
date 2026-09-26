'use strict';
/*
 * #3955: the release highlights for the "Kosmos has been updated" window (web/whats-new.json), one
 * rule used by the board (read) and the cut (tools/whats-new-check.js).
 *
 *   node --test engine/whatsnew.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const whatsnew = require('./whatsnew');

const GOOD = { version: '0.6.98', highlights: [
  { icon: 'swarm', title: 'Swarms', line: 'One agent brings in helpers when parts of a task can run at once.' },
  { icon: 'tasks', title: 'Subtasks', line: 'Break a task into smaller ones, and see them fold under it.' },
] };
const tmp = (obj) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsnew-'));
  const f = path.join(dir, 'whats-new.json');
  fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return f;
};

test('#3955: a good file for its version has no problems, and read returns its highlights', () => {
  assert.deepEqual(whatsnew.problems(GOOD, '0.6.98'), []);
  assert.deepEqual(whatsnew.read('0.6.98', tmp(GOOD)), GOOD.highlights);
});

test('#3955: last release\'s file is never shown, and a missing or broken one is none', () => {
  const f = tmp(GOOD);
  assert.equal(whatsnew.read('0.6.99', f), null, 'last release\'s text would have appeared');
  assert.match(whatsnew.problems(GOOD, '0.6.99').join(' '), /it is for 0\.6\.98, not 0\.6\.99/);
  assert.equal(whatsnew.read('0.6.98', path.join(os.tmpdir(), 'no-such-whats-new.json')), null);
  assert.equal(whatsnew.read('0.6.98', tmp('{ not json')), null);
  assert.equal(whatsnew.read(null, f), null);
});

test('#3955: each shape the window cannot draw is named (a problem per rule, with a control each)', () => {
  const bad = (edit, re) => {
    const o = JSON.parse(JSON.stringify(GOOD)); edit(o);
    const p = whatsnew.problems(o, '0.6.98');
    assert.ok(p.some((x) => re.test(x)), 'expected ' + re + ' in ' + JSON.stringify(p));
    assert.equal(whatsnew.read('0.6.98', tmp(o)), null, 'the board would serve a file the window cannot draw');
  };
  bad((o) => { o.highlights = []; }, /no highlights/);
  bad((o) => { o.highlights = Array(6).fill(GOOD.highlights[0]); }, /at most 5/);
  bad((o) => { o.highlights[0].icon = 'rocket'; }, /not one the app draws/);
  bad((o) => { o.highlights[0].title = ''; }, /no title/);
  bad((o) => { o.highlights[1].line = 'x'.repeat(whatsnew.MAX_LINE + 1); }, /line is \d+ characters/);
  bad((o) => { o.highlights[0].title = 'Swarms — at last'; }, /em dash/);
  bad((o) => { o.highlights[0].line = 'Helpers &mdash; many'; }, /em dash/);
  bad((o) => { o.version = 'v0.6.98'; }, /not a version/);
  assert.deepEqual(whatsnew.problems({ ...GOOD, highlights: Array(5).fill(GOOD.highlights[0]) }, '0.6.98'), [], 'CONTROL: five is allowed');
  assert.deepEqual(whatsnew.ICONS, ['swarm', 'tasks', 'phone', 'list', 'chat', 'shield', 'spark'], 'the icon set is Mona Lisa\'s');
});

test('#3955: the committed web/whats-new.json, when there is one, is a file the window can draw', () => {
  if (!fs.existsSync(whatsnew.FILE)) return;   // written by the operator before a cut, not by this change
  const obj = JSON.parse(fs.readFileSync(whatsnew.FILE, 'utf8'));
  assert.deepEqual(whatsnew.problems(obj, obj.version), [], 'web/whats-new.json cannot be shown');
});

test('#3955: every icon the file may name is one the page draws', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const at = page.indexOf('const WN_ICONS = Object.freeze({');
  assert.notEqual(at, -1);
  const block = page.slice(at, page.indexOf('});', at));
  for (const k of whatsnew.ICONS) assert.match(block, new RegExp('\\n  ' + k + ': \''), 'the page cannot draw ' + k);
});
