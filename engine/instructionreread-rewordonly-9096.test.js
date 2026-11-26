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

test('review 4: a line with a quote mark is compared exactly (curly against straight quotes is shown)', () => {
  const out = changedLines('# R\nSay \u201Cdone\u201D and it\u2019s done.\n', '# R\nSay "done" and it\'s done.\n');
  assert.doesNotMatch(out, NOTE);
  assert.match(out, /- Say \u201Cdone\u201D/);
});

test('CONTROL: a flag, a case change, a symbol and a path dot still print', () => {
  for (const [a, b] of [
    ['Use --no-reply here.', 'Use --noreply here.'],
    ['run -d now', 'run -D now'],
    ['when a > b', 'when a < b'],
    ['open a.b/c', 'open ab/c'],
    // Review 1: a mark standing alone, ? ! ; :, and leading indentation are never wording only.
    ['git add .', 'git add'],
    ['cd ..', 'cd'],
    ['if ! grep -q x f; then', 'if grep -q x f; then'],
    ['cmd1 ; rm x', 'cmd1 rm x'],
    ['url https://a.com/x?', 'url https://a.com/x'],
    ['Delete it?', 'Delete it.'],
    ['  key: v', 'key: v'],
    ['  - sub', '- sub'],
    // Review 2: stacked dots after a word, and any comma, are not wording.
    ['git log origin/main.. --oneline', 'git log origin/main --oneline'],
    ['git diff main..', 'git diff main'],
    ['  "strict": true,', '  "strict": true'],
    ['echo a, b', 'echo a b'],
    ['Pass --dry-run, --force', 'Pass --dry-run --force'],
    // Review 2: a line with a code span is compared exactly (its quotes and spacing are syntax).
    ['Run `grep "a  b" f`', 'Run `grep "a b" f`'],
    ["Run `echo 'x'`", 'Run `echo \u2018x\u2019`'],
    // Review 3: a full stop inside the line is not wording.
    ['Do not merge. Wait for CI', 'Do not merge Wait for CI'],
    ['1. Push', '1 Push'],
    // Review 4: a command with quotes outside backticks; 3 spaces and a tab is an indented code block.
    ['- Run: kosmos post x \u201Chi there\u201D', '- Run: kosmos post x "hi there"'],
    ['  \tgrep  x', '  \tgrep x'],   // 2 spaces + a tab reach column 4 only if the tab is counted to the next stop
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

test('review 1: a wording-only line under a moved heading does not leave the "may be in ... too" sentence behind', () => {
  const moved = { under: '## Tasks', where: 'kosmos task --how', lines: new Set(['An old task rule.']) };
  const out = changedLines('## Tasks\nKeep it short\n', '## Tasks\nKeep it short.\n', [moved]);
  assert.match(out, NOTE);
  assert.doesNotMatch(out, /may be in kosmos task --how too/, 'the conditional sentence printed with no - line shown');
  // CONTROL: a real change under that heading still gets the sentence.
  assert.match(changedLines('## Tasks\nOld rule.\n', '## Tasks\nNew rule.\n', [moved]), /may be in kosmos task --how too/);
});

test('a cut list with wording-only lines keeps the cap and ends with the cut note', () => {
  const { CHANGES_LINES_MAX } = require('./instructionreread');
  const a = [], b = [];
  for (let i = 0; i < 400; i += 1) { a.push('Rule ' + i + ' old'); b.push(i % 2 ? 'Rule ' + i + ' old.' : 'Rule ' + i + ' new'); }
  const out = changedLines('# R\n' + a.join('\n') + '\n', '# R\n' + b.join('\n') + '\n');
  assert.ok(out.split('\n').length <= CHANGES_LINES_MAX, 'over the line cap');
  assert.match(out, NOTE);
  assert.match(out.split('\n').pop(), /^\[More changed than fits here/, 'the cut note is not last');
});

test('review 2: a line inside a code fence is compared exactly, even when only a quote or a full stop changed', () => {
  const before = '# R\n```sh\necho \'x\'\ngit add file.\n```\n';
  const after = '# R\n```sh\necho \u2018x\u2019\ngit add file\n```\n';
  const out = changedLines(before, after);
  assert.doesNotMatch(out, NOTE, 'a code line was counted as wording only');
  assert.ok(out.includes("- echo 'x'") && out.includes('+ git add file'), 'a code change was not printed');
  // CONTROL: the full-stop edit in prose is wording only (the quote edit is not, since review 4).
  assert.equal(changedLines('# R\nSay \'x\' now\nAdd the file.\n', '# R\nSay \u2018x\u2019 now\nAdd the file\n').match(NOTE)[1], '1');
});

test('review 3: a nested, tab-indented or quoted fence, and an indented code block, are code', () => {
  for (const [before, after] of [
    ['1. Run:\n\n    ```sh\n    echo \u201Ca\u201D\n    ```', '1. Run:\n\n    ```sh\n    echo "a"\n    ```'],
    ['\t```sh\n\techo \u201Ca\u201D\n\t```', '\t```sh\n\techo "a"\n\t```'],
    ['> ```sh\n> echo \u201Ca\u201D\n> ```', '> ```sh\n> echo "a"\n> ```'],
    ['Text\n\n    echo \u201Chi\u201D', 'Text\n\n    echo "hi"'],
  ]) {
    const out = changedLines('# R\n' + before + '\n', '# R\n' + after + '\n');
    assert.doesNotMatch(out, NOTE, 'code hidden as wording only: ' + JSON.stringify(after));
  }
});

test('review 4: a ``` indented deeper than its opener + 3 does not close the fence', () => {
  const before = '# H\n```md\n    ```\ngrep  a x\n```\n';
  const after = '# H\n```md\n    ```\ngrep a x\n```\n';
  assert.doesNotMatch(changedLines(before, after), NOTE, 'a line still inside the fence was hidden');
  // CONTROL: the same line outside any fence is wording only.
  assert.match(changedLines('# H\ngrep  a x\n', '# H\ngrep a x\n'), NOTE);
});
