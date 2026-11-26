'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#8952: Claude Code draws "↑ 37 more lines" when a permission prompt is taller than the window (a long command),
   and it can sit between the last option and the "Esc to cancel" footer. Before, that line made the options unreadable
   (a two-space indent: null) or was glued onto the No label (three spaces: "No ↑ 37 more lines"). It is skipped now.
   The screen is the real 2.1.296 Bash capture in test-support/claude-screens, with the line inserted. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const status = require('./engine/status');
const chat = require('./engine/chat');

const BASH = fs.readFileSync(path.join(__dirname, 'test-support', 'claude-screens', 'permission-prompt-bash-2.1.296.txt'), 'utf8');

// The real screen with one line put just under its last option ("4. No").
function withLineUnderNo(line) {
  const lines = BASH.split('\n');
  const no = lines.findIndex((l) => /^\s*4\.\s+No\b/.test(l));
  assert.ok(no > 0, 'premise: the capture has its "4. No" option');
  return [...lines.slice(0, no + 1), line, ...lines.slice(no + 1)].join('\n');
}

test('#8952: a scroll line between the options and the footer leaves the options exactly as the real prompt reads them', () => {
  const real = status.claudePermissionPrompt(BASH);
  assert.ok(real, 'premise: the real prompt reads');
  for (const line of [' ↑ 37 more lines', '  ↑ 37 more lines', '   ↑ 37 more lines', '  ↓ 3 more lines', '  ↑ 1 more line']) {
    const got = status.claudePermissionPrompt(withLineUnderNo(line));
    assert.ok(got, 'unreadable with ' + JSON.stringify(line));
    assert.deepEqual(got.options, real.options, 'the options changed with ' + JSON.stringify(line));
    assert.equal(status.claudePermissionPromptKind(withLineUnderNo(line)), 'wording');
  }
});

test('#8952 CONTROL: any other line in that place is still refused, so the walk did not loosen', () => {
  for (const line of ['  some other text', '  ↑ more lines', '  37 more lines']) {
    assert.equal(status.claudePermissionPrompt(withLineUnderNo(line)), null, 'read a prompt with ' + JSON.stringify(line));
  }
});

/* slice (d) review 5 CHANGED THIS: the scroll line now makes a box not answerable even with a top above it. Claude Code
   draws it only for a box it did not draw whole (see cutOff below), and a top above such a box can be a stale one left
   in scrollback by an earlier, taller drawing of the same window. */
test('#8952: a box carrying the scroll line is not answerable, even with a top above it; without it, it is', () => {
  for (const line of ['  ↑ 37 more lines', '  ↓ 3 more lines']) assert.equal(chat.permissionAnswerable(withLineUnderNo(line)), false, line);
  assert.equal(chat.permissionCard(withLineUnderNo('  ↑ 37 more lines')), null);
  assert.equal(chat.permissionAnswerable(BASH), true, 'CONTROL: the whole box is');
});

// The only place the line appears for real: a box taller than the window, its top (the full-width rule) scrolled away.
function cutOff(screen) {
  const lines = screen.split('\n');
  const rule = lines.findIndex((l) => /^─{20,}\s*$/.test(l));
  assert.ok(rule >= 0, 'premise: the capture has its full-width rule');
  return lines.slice(rule + 1).join('\n');
}

test('#8952: a cut-off box with the scroll line now reads as a permission prompt, and still gets no buttons and no card', () => {
  const real = status.claudePermissionPrompt(BASH);
  const screen = cutOff(withLineUnderNo('  ↑ 37 more lines'));
  const got = status.claudePermissionPrompt(screen);
  assert.ok(got, 'unreadable once its top scrolled away');
  assert.deepEqual(got.options, real.options);
  assert.equal(chat.permissionAnswerable(screen), false, 'a box whose top scrolled away must not be answerable (#6054)');
  assert.equal(chat.permissionCard(screen), null, 'no card for a box whose top scrolled away');
  assert.equal(chat.permissionAnswerable(cutOff(BASH)), false, 'CONTROL: the same cut box without the line is not answerable either');
});
