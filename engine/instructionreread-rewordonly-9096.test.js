'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9096 item 5: in the re-read pointer's change list, a line that changed only in spacing, in sentence punctuation
 * at the end of a word, or in straight against curly quotes is counted and not printed. Case, hyphens and every other
 * symbol still count.
 *
 *   node --test engine/instructionreread-rewordonly-9096.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { changedLines } = require('./instructionreread');

const NOTE = /Not shown: (\d+) lines? that changed only in spacing or punctuation \(the rule reads the same\)\./;

test('a rule that only gained or lost end punctuation or spacing is counted, not printed; a real change still prints', () => {
  const before = '# Rules\nUse kosmos post --no-reply to close a thread.\nKeep it short\nNever share keys.\n';
  const after = '# Rules\nUse kosmos post --no-reply to close a thread\nKeep  it short.\nNever share secrets.\n';
  const out = changedLines(before, after);
  assert.match(out, /- Never share keys\.\n\+ Never share secrets\./, 'the real change is not printed');
  assert.doesNotMatch(out, /close a thread/, 'a punctuation-only change was printed');
  assert.doesNotMatch(out, /Keep/, 'a spacing-and-punctuation-only change was printed');
  assert.equal(out.match(NOTE)[1], '2');
});

test('curly against straight quotes is wording only', () => {
  const out = changedLines('# R\nSay “done” and it’s done.\n', '# R\nSay "done" and it\'s done.\n');
  assert.equal(out.match(NOTE)[1], '1');
  assert.doesNotMatch(out, /```diff/, 'nothing else changed, so no diff is printed');
});

test('CONTROL: a flag, a case change, a symbol and a path dot still print', () => {
  for (const [a, b] of [
    ['Use --no-reply here.', 'Use --noreply here.'],
    ['run -d now', 'run -D now'],
    ['when a > b', 'when a < b'],
    ['open a.b/c', 'open ab/c'],
  ]) {
    const out = changedLines('# R\n' + a + '\n', '# R\n' + b + '\n');
    assert.ok(out.includes('- ' + a) && out.includes('+ ' + b), 'hidden as wording only: ' + a + ' -> ' + b);
    assert.doesNotMatch(out, NOTE, 'counted as wording only: ' + a + ' -> ' + b);
  }
});

test('CONTROL: an unchanged file still prints nothing, and a file with no wording-only change carries no note', () => {
  assert.equal(changedLines('# R\nA rule.\n', '# R\nA rule.\n'), '');
  assert.doesNotMatch(changedLines('# R\nOld rule.\n', '# R\nNew rule.\n'), NOTE);
});
