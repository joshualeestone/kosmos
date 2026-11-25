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

test('#9083: under a tool it is output, on the first row of it or a later one; under a prompt, or with no head in sight, it is not', () => {
  for (const head of ['\u23fa Bash(claude -p hi)', '\u25cf Bash(claude -p hi)', '\u23fa server - run (MCP)(x: 1)', '! claude -p hi']) {
    assert.equal(isRefusal(head + '\n' + QUOTED), false, 'output read as a refusal: ' + head);
    assert.equal(isRefusal(head + '\n  \u23bf  starting\n     Not logged in \u00b7 Please run ' + LOGIN), false, 'a later row: ' + head);
  }
  for (const head of ['\u276f say ok', '> say ok', '', 'words with no head (cut)']) {
    assert.equal(isRefusal(head + '\n' + QUOTED), true, 'a refusal was dropped under: ' + head);
  }
  assert.equal(isRefusal('\u23fa Bash(ls)\n  \u23bf  a\n\u276f say ok\n' + QUOTED), true, 'the nearest head decides');
});

test('#9083: with Claude Code\'s own "run" footer on the screen, it is a refusal whatever it is under', () => {
  const mode = '  \u23f5\u23f5 auto mode on (shift+tab to cycle)' + FOOTER;   // as agents run: at the end of the mode row
  assert.equal(isRefusal('\u23fa Bash(ls)\n' + QUOTED + '\n' + mode), true, 'at the end of the mode row');
  assert.equal(isRefusal('\u23fa Bash(ls)\n' + QUOTED + '\n     it says Not logged in \u00b7 run ' + LOGIN), false, 'CONTROL: words of output are not the footer');
  assert.equal(isRefusal('\u23fa Bash(ls)\n' + QUOTED + '\n' + FOOTER), true);
  assert.equal(isRefusal('! ls\n' + QUOTED + '\n' + FOOTER), true);
});

test('#9083: every other sentence, and the row Claude Code draws at its own bullet, are read as before', () => {
  for (const words of ['Login expired', 'Login reached its time limit', 'OAuth access token has been revoked']) {
    assert.equal(isRefusal('\u23fa Bash(ls)\n  \u23bf  ' + words + ' \u00b7 Please run ' + LOGIN), true, 'changed: ' + words);
  }
  assert.equal(isRefusal('! ls\n  \u23bf  a\n\u23fa Not logged in \u00b7 Please run ' + LOGIN), true, 'its own bullet row');
  assert.equal(isRefusal('! ls\n\u23fa Not logged in \u00b7 Please run ' + LOGIN + ' (again)'), true, 'its own row is not its own head');
});
