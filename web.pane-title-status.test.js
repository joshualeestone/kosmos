'use strict';

/**
 * #209: the agent card's status line was the tmux pane title, a fossil of the
 * session's FIRST message.
 *
 * Claude Code writes the pane title once from a summary of the opening message
 * and never refreshes it, and Kosmos NEVER writes it (there is no
 * rename-window, no select-pane -T, no title escape anywhere in this repo; it
 * is read-only at status.js `#{pane_title}`). So the title cannot track current
 * work even in principle. On 2026-08-23 the live fleet proved it: agents deep
 * in one task showed the title of a different one they started on, and two
 * agents that ran the same boot routine showed the identical frozen title.
 *
 * The fix: `taskLine` never returns the title, in any state. It returns only a
 * state's own honest reason (today only `rate_limited` has one) and otherwise
 * nothing, letting the card's `.astate` carry the observed truth and leaving an
 * empty task slot rather than a confident fossil.
 *
 * This test lifts `taskLine` from the page and pins that it shows no title. It
 * fails against the pre-#209 code, which returned the title as the fallback:
 * verified by restoring that fallback and watching every "must not show the
 * title" case go red.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

// taskLine calls stateReason, so both are lifted and composed.
function taskLineOf(a) {
  const fn = new Function(
    'a',
    `${page.lift(SCRIPT, 'stateReason')}\n${page.lift(SCRIPT, 'taskLine')}\nreturn taskLine(a);`,
  );
  return fn(a);
}

const FROZEN = 'Project 821226pmtest m54'; // Christina's real frozen title, from the card

test('#209: the frozen pane title is never shown as the task, in any working-ish state', () => {
  for (const state of ['working', 'idle', 'stopped', 'unknown']) {
    assert.equal(
      taskLineOf({ state, task: FROZEN }),
      '',
      `a ${state} agent showed its frozen pane title as its task (the #209 defect)`,
    );
  }
  // Even the plainest fossils the card called out by name.
  assert.equal(taskLineOf({ state: 'idle', task: 'Hello' }), '');
  assert.equal(taskLineOf({ state: 'idle', task: 'Testing response' }), '');
});

test('#209: needs_you no longer borrows the title as its qualifier', () => {
  // This was a deliberate exception (the title as "the thing it needs you
  // about"); the same fossil evidence retired it, with Mona Lisa's agreement.
  // It misled worst here, because a person deciding whether to answer read it
  // as what the agent is stuck on.
  assert.equal(
    taskLineOf({ state: 'needs_you', task: FROZEN }),
    '',
    'needs_you showed the frozen title as the thing it needs you about',
  );
});

test('rate_limited still speaks its own reason, and never the title', () => {
  // The one state with an honest reason of its own keeps it; that reason is
  // the classifier's, not the pane title, so a title alongside it is ignored.
  assert.equal(taskLineOf({ state: 'rate_limited', stateConfidence: 'scraped', task: FROZEN }),
    'Looks like a usage limit');
  assert.equal(taskLineOf({ state: 'rate_limited', stateConfidence: 'reported', task: FROZEN }),
    'Usage limit reached');
});

test('a missing or empty title is handled the same as any other: nothing', () => {
  assert.equal(taskLineOf({ state: 'idle' }), '');
  assert.equal(taskLineOf({ state: 'working', task: '' }), '');
  assert.equal(taskLineOf({ state: 'idle', task: 'Claude Code' }), '',
    'the #222 "Claude Code" default is subsumed: no title shows at all now');
});
