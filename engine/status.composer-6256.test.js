'use strict';
/* #6256 items 6 and 7: the box reader (status.composerText) on the two screen shapes the #6249 rounds named.
   Item 6 is measured: tmux's capture (capture-pane -e) writes an escape only where the style changes, so a dim run that
   wraps onto a second row carries no escape of its own there (scratch tmux server, 30 columns, 2026-10-15). */
const test = require('node:test');
const assert = require('node:assert/strict');

const status = require('./status');

const ESC = '\x1b';
const BOX = '❯ ';
const RULE = '─'.repeat(30);

test('#6256 item 6: a dim suggestion that wraps onto a second row is not read as typed text', () => {
  const screen = [
    ESC + '[38;5;244m' + RULE + ESC + '[39m',
    BOX + ESC + '[2mTry "write a test for the parser',
    'and run it"' + ESC + '[0m',
    ESC + '[38;5;244m' + RULE + ESC + '[39m',
    '  ? for shortcuts',
  ].join('\n');
  assert.deepEqual(status.composerText(screen), { ok: true, text: '' });
  // CONTROL: the same rows with the dim escape removed are typed text, so this reader does read text on these rows.
  // (The carry itself is pinned by the assertion above: without it the second row reads as typed text.)
  assert.equal(status.composerText(screen.replace(ESC + '[2m', '')).text, 'Try "write a test for the parser and run it"');
});

test('#6256 item 6: dim ends where its reset is, so typed text after it on the next row still reads', () => {
  const screen = [BOX + 'ok ' + ESC + '[2msuggest', 'ion' + ESC + '[0m then more', RULE].join('\n');
  assert.equal(status.composerText(screen).text, 'ok then more');
});

test('#6256 item 7: a rule drawn dim still ends the box, so the footer is not read into it', () => {
  const screen = [BOX + 'hello there', ESC + '[2m' + RULE + ESC + '[0m', '  ? for shortcuts'].join('\n');
  assert.equal(status.composerText(screen).text, 'hello there');
  // CONTROL: with no rule row at all the footer does run into the box, so the rule above is what ended it.
  assert.equal(status.composerText([BOX + 'hello there', '  ? for shortcuts'].join('\n')).text, 'hello there ? for shortcuts');
});

test('#6256 review 2: a dim run left open above the box never makes typed text in it read as empty', () => {
  const screen = [ESC + '[2man old dim line with no reset', 'more scrollback', RULE, BOX + 'typed by a person', RULE].join('\n');
  assert.equal(status.composerText(screen).text, 'typed by a person');
  // CONTROL: a placeholder the box draws dim on its own row still reads empty.
  const placeholder = [ESC + '[2man old dim line with no reset', RULE, BOX + ESC + '[2mTry "something"' + ESC + '[0m', RULE].join('\n');
  assert.equal(status.composerText(placeholder).text, '');
});
