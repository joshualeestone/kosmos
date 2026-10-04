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

test('#3955 round 12: a highlights file that cannot be shown leaves one log line; another version\'s file (the usual state) leaves none', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const whatsnew = require('./whatsnew');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-log-'));
  const f = path.join(dir, 'whats-new.json');
  const said = [];
  const warn = console.warn;
  console.warn = (m) => said.push(String(m));
  try {
    whatsnew.setFileForTests(f);
    fs.writeFileSync(f, JSON.stringify({ version: '0.6.97', highlights: [{ icon: 'spark', title: 'T', line: 'L.' }] }));
    assert.equal(whatsnew.read('0.6.98'), null);
    assert.deepEqual(said, [], 'last release\'s file (the ordinary state) was logged');
    fs.writeFileSync(f, '{ not json');
    whatsnew.read('0.6.98'); whatsnew.read('0.6.98');
    assert.equal(said.length, 1, 'a broken file was not logged once: ' + JSON.stringify(said));
    assert.match(said[0], /not valid JSON/);
    fs.rmSync(f);
    assert.equal(whatsnew.read('0.6.98'), null);
    assert.equal(said.length, 1, 'a missing file (no highlights this release) was logged');
  } finally { console.warn = warn; whatsnew.setFileForTests(null); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#4928: the highlights show for any version in "also" (a platform cut on another number), and only those', () => {
  const obj = Object.assign({}, GOOD, { also: ['0.6.95'] });
  assert.deepEqual(whatsnew.problems(obj, '0.6.98'), [], 'the main version still shows');
  assert.deepEqual(whatsnew.problems(obj, '0.6.95'), [], 'the also version shows');
  assert.match(whatsnew.problems(obj, '0.6.97').join(' '), /it is for 0\.6\.98 and 0\.6\.95, not 0\.6\.97/, 'CONTROL: another version still does not');
  assert.match(whatsnew.problems(Object.assign({}, GOOD, { also: '0.6.95' }), '0.6.98').join(' '), /"also" is not a list/);
  assert.match(whatsnew.problems(Object.assign({}, GOOD, { also: ['v0.6.95'] }), '0.6.98').join(' '), /"also" is not a list/);
});

test('#5224: a highlight tagged for one platform shows only there; an untagged one shows everywhere', () => {
  const o = { version: '0.6.98', highlights: [
    { icon: 'shield', title: 'Keeps stopping', line: 'On a Mac, an agent that keeps stopping now says so.', platforms: ['mac'] },
    { icon: 'tasks', title: 'Tasks', line: 'Break a task into smaller ones.' },
    { icon: 'spark', title: 'Installer', line: 'The Windows installer is smaller.', platforms: ['windows'] },
  ] };
  const f = tmp(o);
  const titles = (p) => (whatsnew.read('0.6.98', f, p) || []).map((h) => h.title);
  assert.deepEqual(titles('darwin'), ['Keeps stopping', 'Tasks']);
  assert.deepEqual(titles('win32'), ['Tasks', 'Installer'], 'a Windows user would be told about a Mac');
  assert.deepEqual(titles('linux'), ['Tasks'], 'any other platform shows only untagged highlights');
  assert.ok(!('platforms' in whatsnew.read('0.6.98', f, 'darwin')[0]), 'the tag is not served to the page');
});

test('#5224: when every highlight is for another platform there is no window (null), and key follows the same read', () => {
  const o = { version: '0.6.98', highlights: [
    { icon: 'shield', title: 'Keeps stopping', line: 'On a Mac, an agent that keeps stopping now says so.', platforms: ['mac'] },
  ] };
  const f = tmp(o);
  assert.equal(whatsnew.read('0.6.98', f, 'win32'), null);
  assert.equal(whatsnew.readFull('0.6.98', f, 'win32'), null);
  assert.deepEqual(whatsnew.read('0.6.98', f, 'darwin').map((h) => h.title), ['Keeps stopping'], 'CONTROL: the Mac still sees it');
  assert.equal(whatsnew.key('0.6.98', f, 'win32'), null, 'a dismissal on Windows records no words it never showed');
  assert.equal(whatsnew.key('0.6.98', f, 'darwin'), '0.6.98');
  assert.deepEqual(whatsnew.countsByPlatform(o), { mac: 1, windows: 0 });
});

test('#5224: a title or line that names a platform must carry a "platforms" tag naming only platforms it names', () => {
  const one = (h) => whatsnew.problems({ version: '0.6.98', highlights: [{ icon: 'chat', title: 'T', line: 'L', ...h }] }, '0.6.98');
  assert.match(one({ line: 'On a Mac set to another language, agents are told your language.' }).join(' '), /names mac but has no "platforms"/,
    'the #5224 sentence itself, untagged');
  assert.match(one({ title: 'Windows PCs' }).join(' '), /names windows but has no "platforms"/);
  assert.match(one({ line: 'Works on macOS.', platforms: ['mac', 'windows'] }).join(' '), /is for mac and windows but names only mac: take the other platform out/);
  assert.match(one({ line: 'Now on MacOS.' }).join(' '), /names mac but has no "platforms"/, 'a common miswriting of macOS');
  assert.match(one({ title: 'WINDOWS' }).join(' '), /names windows but has no "platforms"/);
  for (const line of ['Now on macos.', 'On a Macintosh.', 'Since OS X 10.9.', 'On an imac.', 'PCS too.']) {
    assert.ok(one({ line }).some((p) => /has no "platforms"/.test(p)), line + ' was not seen as naming a platform');
  }
  assert.match(one({ line: 'On a Mac, like Windows already did.', platforms: ['mac'] }).join(' '), /is for mac but names mac and windows.*reword it to name only/,
    'a Mac-tagged line that names Windows too');
  assert.match(one({ line: 'On a MacBook or an iMac.' }).join(' '), /names mac but has no "platforms"/);
  assert.match(one({ title: 'Windows that remember their size' }).join(' '), /or reword it if it is not about one/,
    'a word list cannot tell the platform from the UI word, so the refusal offers both ways out');
  assert.match(one({ platforms: 'mac' }).join(' '), /"platforms" is not a list/);
  assert.match(one({ platforms: [] }).join(' '), /"platforms" is not a list/);
  assert.match(one({ platforms: ['linux'] }).join(' '), /"platforms" is not a list/);
  assert.match(one({ platforms: ['mac', 'mac'] }).join(' '), /"platforms" is not a list/);
  // CONTROLS: tagged correctly, both named, a tag with no platform word, and words that are not platforms.
  assert.deepEqual(one({ line: 'On a Mac, it says so.', platforms: ['mac'] }), []);
  assert.deepEqual(one({ line: 'On a Mac or a Windows PC.', platforms: ['mac', 'windows'] }), []);
  assert.deepEqual(one({ line: 'A smaller download.', platforms: ['windows'] }), [], 'a tag needs no platform word');
  assert.deepEqual(one({ line: 'The machine shows its windows and a mac address.' }), [], 'whole words, case-sensitive');
});

test('#5224: the committed file never tells one platform about another (checked as each board reads it)', () => {
  if (!fs.existsSync(whatsnew.FILE)) return;
  const obj = JSON.parse(fs.readFileSync(whatsnew.FILE, 'utf8'));
  assert.ok(whatsnew.read(obj.version, whatsnew.FILE, 'darwin') || whatsnew.read(obj.version, whatsnew.FILE, 'win32'),
    'CONTROL: some platform shows the committed file, so the loop below reads something');
  for (const [node, other] of [['darwin', 'windows'], ['win32', 'mac']]) {
    const shown = whatsnew.read(obj.version, whatsnew.FILE, node) || [];   // none is allowed: every highlight may be for the other
    for (const h of shown) {
      const named = whatsnew.platformsNamed(h.title + ' ' + h.line);
      assert.ok(!named.length || named.includes(node === 'darwin' ? 'mac' : 'windows'), node + ' would show "' + h.line + '" (about ' + other + ')');
    }
  }
});
