'use strict';
/**
 * kosmos#9083: "Not logged in" printed by a command or a tool is not the agent's own sign-in failure; Claude Code's own, drawn with the
 * same `\u23bf`, still is. On real 2.1.332 screens (test-support/claude-screens/signin-*), written with the remedy's command spelled
 * apart so that reading them does not put the line on an agent's own screen.
 *
 *   node --test engine/signinquoted-9083.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classify, STATE } = require('./status');

const LOGIN = '/' + 'login';
const screen = (name) => fs.readFileSync(path.join(__dirname, '..', 'test-support', 'claude-screens', `signin-${name}-2.1.332.txt`), 'utf8')
  .replaceAll('/{LOGIN}', LOGIN).replaceAll("/{LOG}", "/log''in");
const pane = () => ({ session: 'made-here', name: 'made-here', claim: 'made-here', command: '2.1.332', title: 'Ready' });
const isRefusal = (text) => classify(pane(), text).state === STATE.AUTH_FAILED;
const QUOTED = '  \u23bf \u00a0Not logged in \u00b7 Please run ' + LOGIN;
const FOOTER = ' '.repeat(60) + 'Not logged in \u00b7 run ' + LOGIN;

test('#9083: the real screens: a refused token and no login are refusals, the same words from a command are not', () => {
  assert.equal(isRefusal(screen('refused-token')), true, 'a refused token');
  assert.equal(isRefusal(screen('not-logged-in')), true, 'no login');
  assert.ok(screen('quoted-by-a-command').includes(QUOTED.trim()), 'CONTROL: the capture holds the line');
  assert.equal(isRefusal(screen('quoted-by-a-command')), false, 'a command printed it');
});

const NL = 'Not logged in · Please run ' + LOGIN;
test('#9083: in the first block of a command or a tool it is output, on its first row or a later one', () => {
  for (const head of ['⏺ Bash(claude -p hi)', '● Bash(claude -p hi)', '⏺ server - run (MCP)(x: 1)', '! claude -p hi']) {
    assert.equal(isRefusal(head + '\n' + QUOTED), false, 'output read as a refusal: ' + head);
    assert.equal(isRefusal(head + '\n  ⎿  starting\n     ' + NL), false, 'a later row: ' + head);
  }
});

test('#9083: a refusal is never dropped: any other head, anything between, a second block, or no head in sight', () => {
  for (const head of ['❯ say ok', '> say ok', '', 'words with no head (cut)', '❯ a long\n  prompt of two rows', '⏺ Read 3 files (ctrl+o to expand)',
    '⏺ Done (PR 5 is up).', '⏺ Background command "x" completed (exit code 0)', '⏺ bash(x)', '!']) {
    assert.equal(isRefusal(head + '\n' + QUOTED), true, 'dropped under: ' + head);
  }
  for (const first of ['⏺ Bash(ls)', '! ls']) {
    for (const [what, between] of [['a blank row', '  ⎿  a\n\n'], ['a second block', '  ⎿  a\n'], ['a message', '  ⎿  a\n← discord · someone: hi\n'],
      ['a worked row', '  ⎿  a\n✻ Worked for 3s\n'], ['a new prompt', '  ⎿  a\n❯ say ok\n']]) {
      assert.equal(isRefusal(first + '\n' + between + QUOTED), true, `dropped after ${what} under ${first}`);
    }
  }
  assert.equal(isRefusal(QUOTED), true, 'no head at all');
  assert.equal(isRefusal('! ls\n  \u23bf  a\n     \n     ' + NL), true, 'a row of spaces ends the block');
});

test('#9083: with Claude Code\'s own notice anywhere on the screen, in any of its forms, it is a refusal', () => {
  const run = 'Not logged in · run ' + LOGIN;
  for (const notice of [' '.repeat(60) + run, '  ⏵⏵ auto mode on (shift+tab to cycle)' + ' '.repeat(20) + run, '  ' + run,
    '  ⏵⏵ bypass permissions on (shift+tab to cycle)  ' + run, '  ⏵⏵ bypass permissions on (shift+tab to cycle) Not logged in · run /l',
    '   Not logged in _ run ' + LOGIN]) {
    assert.equal(isRefusal('⏺ Bash(ls)\n' + QUOTED + '\n' + notice), true, 'missed: ' + notice);
  }
});

test('#9083: every other sentence, and the row Claude Code draws at its own bullet, are read as before', () => {
  for (const words of ['Login expired', 'Login reached its time limit', 'OAuth access token has been revoked']) {
    assert.equal(isRefusal('⏺ Bash(ls)\n  ⎿  ' + words + ' · Please run ' + LOGIN), true, 'changed: ' + words);
  }
  assert.equal(isRefusal('! ls\n  ⎿  a\n⏺ ' + NL), true, 'its own bullet row');
  assert.equal(isRefusal('⏺ ' + NL + ' (again)'), true, 'its own row is not its own head');
});
