'use strict';

/*
 * kosmos#8865: the words `kosmos start-check` prints (engine/startcheckwords.js), for the states the board's answer can
 * be in. The live arms (a damaged start and a clean one, on both CLIs) are in server.startcheck-8865.test.js; this
 * covers the edges no planted file reaches. The one rule above the rest: it never says the files are fine unless the
 * scan ran and could look at everything.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderLines } = require('./startcheckwords');

const NONE_DAMAGED = /none is damaged/;
const FILE = (over) => ({ file: 'projects.json', holds: 'your projects', problem: 'nul', says: 'is blank, as a crash can leave a file', backup: null, secret: false, savedOver: false, ...over });

test('kosmos#8865: no result is never read as fine', () => {
  for (const r of [null, undefined, {}, { ran: false, checked: false }, 'x', []]) {
    const lines = renderLines(r);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /has no result from this start's check/);
    assert.doesNotMatch(lines.join('\n'), NONE_DAMAGED);
  }
});

test('kosmos#8865: a clean start says how many files and none damaged; CONTROL, one unread is not fine', () => {
  assert.deepEqual(renderLines({ ran: true, checked: true, damaged: 0, unread: 0, looked: 12, files: [] }),
    ['Kosmos checked its own files at this start (12 files): none is damaged.']);
  assert.deepEqual(renderLines({ ran: true, checked: true, damaged: 0, unread: 0, looked: 1, files: [] }),
    ['Kosmos checked its own files at this start (1 file): none is damaged.']);
  const unread = renderLines({ ran: true, checked: false, damaged: 0, unread: 2, looked: 10, files: [] }).join('\n');
  assert.doesNotMatch(unread, NONE_DAMAGED, 'files it could not look at were called fine');
  assert.match(unread, /could not look at 2 files or folders, so it cannot say those are fine/);
});

test('kosmos#8865: each damaged file says what it holds and what can be done, and a floor is said as one', () => {
  const lines = renderLines({ ran: true, checked: true, damaged: 3, unread: 1, looked: 9, files: [
    FILE({ backup: { file: 'projects.json.recovered-x', at: '2026-11-21T10:00:00.000Z' } }),
    FILE({ file: 'remote.json', holds: 'your Kosmos+ settings', problem: 'empty', says: 'is empty', secret: true }),
    FILE({ file: 'removed.json', holds: 'the agents you removed', problem: 'empty', says: 'is empty', savedOver: true }),
  ] });
  assert.match(lines[0], /^Kosmos checked its own files at this start \(9 files\) and found 3 damaged\. It could not look at 1 other file or folder, so there may be more\.$/);
  assert.match(lines[1], /^- projects\.json is blank, as a crash can leave a file \(it holds your projects\)\. Kosmos left it as it is\. A good copy saved 2026-11-21T10:00:00\.000Z is at projects\.json\.recovered-x; the person can put it back in Kosmos\.$/);
  assert.match(lines[2], /^- remote\.json is empty \(it holds your Kosmos\+ settings\)\. Kosmos left it as it is\. It holds a key or something that can be taken back, so Kosmos keeps no copy of it\.$/);
  assert.match(lines[3], /^- removed\.json is empty \(it holds the agents you removed\)\. It has been saved since the start, so what it holds now is newer than what was found\. No good copy of it was found\.$/);
  assert.equal(lines.length, 4);
});

test('kosmos#8865: a dismissed list and a file already put back are said, never left as an unexplained gap', () => {
  const dismissed = renderLines({ ran: true, checked: true, damaged: 2, unread: 0, looked: 5, dismissed: true, files: [] });
  assert.match(dismissed.join('\n'), /found 2 damaged/);
  assert.match(dismissed.join('\n'), /The person has seen the list and dismissed it on the page for this start\./);
  const putBack = renderLines({ ran: true, checked: true, damaged: 2, unread: 0, looked: 5, restored: 1, dismissed: false, files: [FILE()] });
  assert.match(putBack.join('\n'), /1 of them was put back from a good copy since the start\./);
  assert.match(putBack.join('\n'), /- projects\.json is blank/);
  // CONTROL: with every damaged file still listed, neither sentence appears.
  const all = renderLines({ ran: true, checked: true, damaged: 1, unread: 0, looked: 5, files: [FILE()] }).join('\n');
  assert.doesNotMatch(all, /dismissed|put back from a good copy since/);
  // review 2: put back and then dismissed says both; a shorter list alone is never read as put back.
  const both = renderLines({ ran: true, checked: true, damaged: 3, unread: 0, looked: 5, restored: 1, dismissed: true, files: [] }).join('\n');
  assert.match(both, /1 of them was put back from a good copy since the start\./);
  assert.match(both, /dismissed it on the page for this start/);
  // Not a shape the board sends (it counts every put-back in `restored`); here only to show a gap is never read as put back.
  const shorter = renderLines({ ran: true, checked: true, damaged: 2, unread: 0, looked: 5, restored: 0, files: [FILE()] }).join('\n');
  assert.doesNotMatch(shorter, /put back/, 'a shorter list was read as put back');
});

test('kosmos#8865 review 1: every damaged file put back says so, and a malformed unchecked answer prints no false count', () => {
  const all = renderLines({ ran: true, checked: true, damaged: 2, unread: 0, looked: 5, restored: 2, dismissed: false, files: [] });
  assert.deepEqual(all, ['Kosmos checked its own files at this start (5 files) and found 2 damaged.', 'All of them were put back from a good copy since the start.']);
  const odd = renderLines({ ran: true, checked: false, damaged: 0, unread: 0, looked: 5, files: [] }).join('\n');
  assert.doesNotMatch(odd, NONE_DAMAGED);
  assert.doesNotMatch(odd, /\b0 files or folders/, 'a false count of zero was printed');
  assert.match(odd, /could not look at all of them, so it cannot say those are fine/);
});

test('kosmos#8865 review 3: a locked or too-large file is not said to have no copy, and an empty install is said as one', () => {
  for (const problem of ['unopenable', 'toobig']) {
    const line = renderLines({ ran: true, checked: true, damaged: 1, unread: 0, looked: 3, files: [FILE({ problem, says: 'cannot be opened' })] })[1];
    assert.match(line, /Kosmos did not look for a good copy of it\.$/, problem);
    assert.doesNotMatch(line, /No good copy of it was found/, problem);
  }
  // CONTROL: an empty or blank file still says none was found, since the scan looked.
  assert.match(renderLines({ ran: true, checked: true, damaged: 1, unread: 0, looked: 3, files: [FILE()] })[1], /No good copy of it was found\.$/);
  const none = renderLines({ ran: true, checked: true, damaged: 0, unread: 0, looked: 0, files: [] });
  assert.deepEqual(none, ['Kosmos found none of its own files to check at this start.']);
  assert.doesNotMatch(none.join(' '), NONE_DAMAGED, 'nothing looked at was said to be fine');
  // review 4: a damaged count with nothing listed and nothing explaining it says so, never a bare count.
  const bare = renderLines({ ran: true, checked: true, damaged: 2, unread: 0, looked: 4, restored: 0, dismissed: false, files: [] });
  assert.equal(bare[1], 'Kosmos no longer holds the list of them for this start.');
});

test('kosmos#8865 review 5: a store saved since the start keeps its copy named but never offers to put it back', () => {
  const backup = { file: 'projects.json.recovered-x', at: '2026-11-21T10:00:00.000Z' };
  const saved = renderLines({ ran: true, checked: true, damaged: 1, unread: 0, looked: 3, files: [FILE({ backup, savedOver: true })] })[1];
  assert.match(saved, /The copy saved 2026-11-21T10:00:00\.000Z is kept at projects\.json\.recovered-x\.$/);
  assert.doesNotMatch(saved, /can put it back/, 'restore refuses a store saved since the start');
  // CONTROL: the same file not saved since still offers it.
  const open = renderLines({ ran: true, checked: true, damaged: 1, unread: 0, looked: 3, files: [FILE({ backup, savedOver: false })] })[1];
  assert.match(open, /the person can put it back in Kosmos\.$/);
});

test('kosmos#8865 review 6: a dismissed list is still named to an agent, file by file', () => {
  const lines = renderLines({ ran: true, checked: true, damaged: 2, unread: 0, looked: 4, restored: 0, dismissed: true, files: [],
    hidden: [FILE(), FILE({ file: 'removed.json', holds: 'the agents you removed', says: 'is empty' })] });
  assert.equal(lines[1], 'The person has seen the list and dismissed it on the page for this start; still damaged:');
  assert.match(lines[2], /^- projects\.json is blank/);
  assert.match(lines[3], /^- removed\.json is empty/);
  assert.equal(lines.length, 4);
});
