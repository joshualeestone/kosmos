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
  assert.match(dismissed.join('\n'), /The person has seen the list and dismissed it for this start/);
  const putBack = renderLines({ ran: true, checked: true, damaged: 2, unread: 0, looked: 5, dismissed: false, files: [FILE()] });
  assert.match(putBack.join('\n'), /The rest were put back from a good copy since the start\./);
  assert.match(putBack.join('\n'), /- projects\.json is blank/);
  // CONTROL: with every damaged file still listed, neither sentence appears.
  const all = renderLines({ ran: true, checked: true, damaged: 1, unread: 0, looked: 5, files: [FILE()] }).join('\n');
  assert.doesNotMatch(all, /dismissed|put back from a good copy since/);
});
