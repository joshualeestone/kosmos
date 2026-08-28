'use strict';

/**
 * The all-tasks screen (#1382).
 *
 * Josh: *"for tasks, i want to see a view of them in a list form basically"*,
 * answering his earlier *"where I can see ALL of the tasks"*.
 *
 * 🔑 THE CLAIM THIS FILE EXISTS FOR is the one the card made a requirement:
 * *"the count in the button matches the number of rows on the screen... do not
 * ship a second count that can disagree with its own destination."*
 * That is #1346, whose cause was one number from the data and another from a
 * document-wide DOM query. Here it is guaranteed by construction instead:
 * there is no count on the door at all, and the screen's own count and its
 * rows are the same array.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

test('#1382: the screen exists and is one of the project views', () => {
  assert.match(PAGE, /<div id="pj-alltasks-view" hidden>/, 'the screen is gone');
  for (const id of ['alltasks-back', 'alltasks-count', 'alltasks-list', 'alltasks-msg']) {
    assert.ok(PAGE.includes('id="' + id + '"'), `the screen lost #${id}`);
  }
  const loop = PAGE.match(/for \(const v of \['list', 'one',([^\]]*)\]\)/);
  assert.ok(loop, 'the project-view loop is gone');
  assert.match(loop[0], /'alltasks'/,
    'the screen is not registered as a view, so opening it leaves another one on top of it');
});

test('#1382: the door is unconditional and carries no count', () => {
  assert.match(PAGE, /door\.textContent = 'View all tasks/, 'the door lost its label');
  /* CONTROL for the negative below: the forbidden pattern must be able to match
     the line it was written from, or the assertion could never fail. */
  const OLD = "    door.textContent = 'View all tasks (' + all.length + ') →';";
  assert.match(OLD, /door\.textContent = 'View all tasks \(' \+/,
    'the forbidden pattern cannot match the line it came from, so the assertion below is vacuous');
  assert.doesNotMatch(PAGE, /door\.textContent = 'View all tasks \(' \+/,
    'a per-project count is back on a control whose destination spans every project');
});

/**
 * 🛑 THE ONE-ARRAY GUARANTEE, ASSERTED ON THE SOURCE THAT PROVIDES IT.
 *
 * A comment saying "these come from the same array" cannot fail. This reads the
 * two lines that render the count and the rows and requires both to be built
 * from `rows`.
 */
test('#1382: the count and the rows are the same array, so they cannot disagree', () => {
  const fn = PAGE.slice(PAGE.indexOf('async function openAllTasksView'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.ok(body.length > 200, 'openAllTasksView is gone or unrecognisable, so nothing below is a test');
  assert.match(body, /const rows = \(body && body\.tasks\) \|\| \[\];/,
    'the rows no longer come from one place');
  assert.match(body, /count\.textContent = rows\.length/,
    'the count is no longer taken from the rows it sits above');
  assert.match(body, /list\.innerHTML = rows\.map\(/,
    'the rows are no longer rendered from the same array the count was taken from');
});

test('#1382: an unreadable answer is SAID, never shown as an empty list', () => {
  const fn = PAGE.slice(PAGE.indexOf('async function openAllTasksView'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  /* "No tasks anywhere yet" is a claim about somebody's own work. Serving it
     when the read failed is the quietest way to say something false, which is
     the failure /api/projects carries its own guard against. */
  assert.match(body, /catch \(err\) \{[\s\S]*msg\.textContent = String/,
    'a failed read no longer says anything, so it will render as "no tasks"');
  assert.match(body, /if \(!rows\.length\)/, 'the genuinely-empty case is gone');
  assert.match(body, /No tasks anywhere yet/, 'the empty state lost its words');
  const emptyAt = body.indexOf('No tasks anywhere yet');
  const catchAt = body.indexOf('catch (err)');
  assert.ok(catchAt > -1 && emptyAt > catchAt,
    'the empty state is reachable before the error is handled, so a failed read can render as "no tasks"');
});

test('#1382: a row opens its task on ITS OWN project, not the one we came from', () => {
  assert.match(PAGE, /data-project="' \+ esc\(t\.projectId\)/,
    'a row no longer carries its project, so a cross-project row opens the wrong task');
  assert.match(PAGE, /if \(pid && pid !== PJ_CURRENT\) \{ PJ_CURRENT = pid; \}/,
    'clicking a row from another project no longer switches to it first');
});
