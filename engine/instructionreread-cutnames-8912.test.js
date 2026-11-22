'use strict';
/* kosmos#8912 slice 1: a cut changes file names the sections whose changes it left out, so the agent re-reads those and
   not every section the notice names. node --test engine/instructionreread-cutnames-8912.test.js */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-ircutnames-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const test = require('node:test');
const assert = require('node:assert/strict');
const ir = require('./instructionreread');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const lastLine = (d) => { const l = d.split('\n'); return l[l.length - 1]; };
const withinCaps = (d) => d.split('\n').length <= ir.CHANGES_LINES_MAX && Buffer.byteLength(d) <= ir.CHANGES_BYTES_MAX;
/* Sections in order, each with `n` changed lines of `width` characters. */
function texts(sections) {
  const b = [];
  const a = [];
  for (const { head, n, width = 10 } of sections) {
    b.push('## ' + head);
    a.push('## ' + head);
    for (let k = 0; k < n; k += 1) {
      const pad = 'x'.repeat(Math.max(0, width - 12));
      b.push('old ' + head + ' ' + k + ' ' + pad);
      a.push('new ' + head + ' ' + k + ' ' + pad);
    }
  }
  return [b.join('\n') + '\n', a.join('\n') + '\n'];
}

test('the cut note names the section it cut inside and every one after it, and none it showed whole', () => {
  const [before, after] = texts([{ head: 'Alpha', n: 2 }, { head: 'Beta', n: 300 }, { head: 'Gamma', n: 1 }, { head: 'Delta', n: 1 }]);
  const d = ir.changedLines(before, after);
  assert.ok(withinCaps(d), 'over a cap');
  assert.equal(lastLine(d), '[More changed than fits here. Not shown: the changes under "Beta"; "Gamma"; "Delta". Read those sections in full.]');
  assert.ok(d.includes('Under Alpha:'), 'the section shown whole was dropped');
  assert.ok(d.includes('Under Beta:'), 'the section it cut inside shows none of its lines');
  assert.ok(!d.includes('Under Gamma:'), 'a section after the cut was shown');
});

test('CONTROL: a diff that fits has no cut note at all', () => {
  const [before, after] = texts([{ head: 'Alpha', n: 2 }, { head: 'Beta', n: 3 }]);
  const d = ir.changedLines(before, after);
  assert.ok(!d.includes('More changed than fits here'), 'a complete diff said it was cut');
  assert.ok(d.includes('Under Beta:'));
});

test('one section cut: the note says "that section"; a section named twice is listed once', () => {
  // Beta changes in two places with an unchanged line between, so it is two runs under one heading.
  const before = '## Alpha\na\n## Beta\n' + Array.from({ length: 200 }, (_, k) => 'b' + k).join('\n') + '\nkeep\nlast\n';
  const after = '## Alpha\na\n## Beta\n' + Array.from({ length: 200 }, (_, k) => 'B' + k).join('\n') + '\nkeep\nLAST\n';
  const d = ir.changedLines(before, after);
  assert.equal(lastLine(d), '[More changed than fits here. Not shown: the changes under "Beta". Read that section in full.]');
});

test('lines before the first heading are named as such', () => {
  const before = Array.from({ length: 200 }, (_, k) => 'top' + k).join('\n') + '\n## After\nz\n';
  const after = Array.from({ length: 200 }, (_, k) => 'TOP' + k).join('\n') + '\n## After\nZ\n';
  const d = ir.changedLines(before, after);
  assert.equal(lastLine(d), '[More changed than fits here. Not shown: the changes under the lines before the first heading; "After". Read those sections in full.]');
});

test('long names: shown runs give way so the whole list fits, inside both caps', () => {
  /* Ten sections (fewer than the twelve-name cap) with 1,500-character headings, each with one wide change: two names
     alone are far larger than the room kept for the plain note, so without giving way the list would shorten to
     "and N more sections" (measured: the mutation that never gives way leaves this red). */
  const head = (k) => 'Section ' + k + ' ' + 'h'.repeat(1500);
  const [before, after] = texts(Array.from({ length: 10 }, (_, k) => ({ head: head(k), n: 1, width: 1500 })));
  const d = ir.changedLines(before, after);
  assert.ok(withinCaps(d), 'over a cap: ' + d.split('\n').length + ' lines, ' + Buffer.byteLength(d) + ' bytes');
  const note = lastLine(d);
  assert.match(note, /^\[More changed than fits here\. Not shown: /);
  assert.ok(!/more sections?/.test(note), 'the list was shortened although ten names fit once runs gave way: ' + note.slice(-120));
  // Every section exactly once: shown, or named in the note.
  let shownCount = 0;
  for (let k = 0; k < 10; k += 1) {
    const shown = d.includes('Under ' + head(k) + ':');
    const named = note.includes('"' + head(k) + '"');
    assert.ok(shown !== named, 'section ' + k + (shown ? ' is both shown and named' : ' is neither shown nor named'));
    if (shown) shownCount += 1;
  }
  assert.ok(shownCount >= 1, 'no run was kept at all');
});

test('more than twelve left out: twelve names, then "and N more sections", and the notice sections in full', () => {
  const secs = [{ head: 'Big', n: 300 }, ...Array.from({ length: 20 }, (_, k) => ({ head: 'S' + k, n: 1 }))];
  const [before, after] = texts(secs);
  const d = ir.changedLines(before, after);
  assert.ok(withinCaps(d));
  const names = ['"Big"', ...Array.from({ length: 11 }, (_, k) => '"S' + k + '"')];
  assert.equal(lastLine(d), '[More changed than fits here. Not shown: the changes under ' + names.join('; ')
    + '; and 9 more sections. Read those, and every section the notice names, in full.]');
});

test('the changes file header says the note names the sections to read', () => {
  const src = fs.readFileSync(path.join(__dirname, 'instructionreread.js'), 'utf8');
  assert.ok(src.includes('If it ends with a note that more changed, it is not complete: that note names the sections to read in full.'));
});
