'use strict';
/**
 * kosmos#2606. Josh, product review 2026-09-09, reported on 0.6.50:
 *
 *   "form-validation errors are not surfaced inline. When submit fails, the page
 *    just refreshes quickly with no clear signal; the only feedback is small text
 *    far below the Create agent button."
 *
 * Same structural defect as #1303 G, one form along: the reason a create was
 * refused sat AFTER the button, so it was off screen at the moment it was needed.
 * The fix puts the reason AT the field (red border + message + focus, via the
 * shared pjFieldBad helper) on BOTH the Create an Agent and Create a Project forms.
 *
 * These are the same read-the-page-source assertions the sibling web.*.test.js
 * files use (not jsdom): the markup slots must exist, the handlers must route to
 * them, and the engine must tag the refusal with the field it is about.
 *
 *   node --test web.inline-errors-2606.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');
const CREATE = fs.readFileSync(path.join(__dirname, 'engine', 'create.js'), 'utf8');

// Slice one handler/function body out of the page by its anchor, up to a bound
// that stays inside it (the next top-level `\ndocument.getElementById(` or
// `\nfunction `), so a later edit growing the handler does not silently move the
// thing under test out of a fixed window.
function region(anchor) {
  const at = PAGE.indexOf(anchor);
  assert.notEqual(at, -1, anchor + ' is gone from the page');
  const rest = PAGE.slice(at + anchor.length);
  const ends = [rest.indexOf('\ndocument.getElementById('), rest.indexOf('\nfunction ')]
    .filter((n) => n !== -1);
  const end = ends.length ? Math.min(...ends) : rest.length;
  return PAGE.slice(at, at + anchor.length + end);
}

test('the three field-error slots exist, beside their fields, aria-live', () => {
  for (const id of ['create-name-err', 'create-label-err', 'pj-name-err']) {
    const m = PAGE.match(new RegExp('<p class="ferr" id="' + id + '" aria-live="polite">'));
    assert.ok(m, id + ' is missing, so its field has nowhere to show a reason');
  }
});

test('the red border reaches plain .frow inputs, not only .tk-inp', () => {
  // The agent name/role and the project name are `.frow input`, not `.tk-inp`;
  // without this the `bad` class would set aria-invalid but paint no border.
  assert.match(PAGE, /\.frow input\.bad(,|\s*\{)/,
    'the .bad border rule was not broadened to .frow input, so flagged inputs show no red');
});

test('the engine tags a name refusal with the field it is about', () => {
  // The page routes on result.field; if the engine stops sending it, name
  // refusals fall back to the below-button slot (the exact #2606 defect).
  assert.match(CREATE, /nameProblem\(shown\)/, 'the name gate moved or was renamed');
  assert.match(CREATE,
    /if \(problem\) return \{ outcome: OUTCOME\.REFUSED, because: problem, field: 'name', steps \}/,
    "the name refusal no longer carries field: 'name', so the page cannot route it to the field");
});

test('Create an Agent routes a name refusal and the empty-role gate to the field', () => {
  const h = region("document.getElementById('create-go').addEventListener");
  // A server refusal tagged as the name lands at the name field, not below the button.
  assert.match(h, /result\.field === 'name'/, 'the refusal is not routed by field');
  assert.match(h, /pjFieldBad\('create-name', 'create-name-err', result\.because/,
    'a name refusal does not reach the name field');
  // The empty-Role gate flags the Role field (and focuses it) rather than writing
  // below the button and hand-rolling focus.
  assert.match(h, /pjFieldBad\('create-label', 'create-label-err',/,
    'the empty-role gate no longer reports at the Role field');
  // Both field errors are cleared at the start of an attempt, so a fixed field
  // does not keep its red border.
  assert.match(h, /pjFieldOk\('create-name', 'create-name-err'\)/);
  assert.match(h, /pjFieldOk\('create-label', 'create-label-err'\)/);
});

test('Create a Project pre-checks an empty name and routes a name refusal to the field', () => {
  const h = region("document.getElementById('pj-create').addEventListener");
  // Empty name is caught at the field before the round trip (the char rule and the
  // length cap stay the server's; empty is unambiguous).
  assert.match(h, /if \(!document\.getElementById\('pj-name'\)\.value\.trim\(\)\) \{/,
    'the empty-name pre-check is gone');
  assert.match(h, /pjFieldBad\('pj-name', 'pj-name-err', 'Give this project a name\.'\)/);
  // A server name refusal is routed to the name field, AFTER the description check
  // so a both-mentioning message still routes to description.
  const descAt = h.indexOf('/description/i.test(err.message)');
  // The name branch matches the specific name-rule phrases (not a broad /name/i -- see the
  // coupling test below), so anchor on the first phrase of that regex.
  const nameAt = h.indexOf('give this project a name|a name has to be words');
  assert.ok(descAt !== -1 && nameAt !== -1, 'a routing branch is missing');
  assert.ok(descAt < nameAt, 'the name branch must come AFTER the description branch');
  assert.match(h, /pjFieldBad\('pj-name', 'pj-name-err', pjSentence\(err\.message\)/,
    'a server name refusal does not reach the name field');
});

test('reopening either form and typing clears a stale field flag', () => {
  const oc = region('function openCreate');
  assert.match(oc, /pjFieldOk\('create-name', 'create-name-err'\)/, 'openCreate leaves a stale name flag');
  assert.match(oc, /pjFieldOk\('create-label', 'create-label-err'\)/, 'openCreate leaves a stale role flag');
  const oap = region('function openAddProject');
  assert.match(oap, /pjFieldOk\('pj-name', 'pj-name-err'\)/, 'openAddProject leaves a stale name flag');
  // Editing the name clears its flag live, so the red border tracks the fix.
  const inp = region("document.getElementById('pj-name').addEventListener('input'");
  assert.match(inp, /pjFieldOk\('pj-name', 'pj-name-err'\)/, 'typing the name does not clear its flag');
});

test('every name-collision refusal is tagged field: name; the system-check failure is deliberately NOT (#2606)', () => {
  // The reported case (the nameProblem char/length/format rule) is not the only NAME
  // refusal. A name COLLISION -- already an agent, on the removed list, a folder / job /
  // loaded launchd service left behind, or already running -- is equally a name refusal and
  // must reach the name field, not the below-button slot #2606 is moving away from. Each
  // such `because` must carry field: 'name' before its return closes (`steps,`).
  const collisions = [
    'is on your removed list',
    'there is already an agent called',
    'is still set to start on this computer',      // hasJob, no folder
    'already set to start on this computer',        // launchd service loaded, nothing else left
    'there is already a folder for an agent called',
    'is already running on this computer',
  ];
  for (const frag of collisions) {
    const at = CREATE.indexOf(frag);
    assert.notEqual(at, -1, `the collision refusal "${frag}" is gone from create.js`);
    const end = CREATE.indexOf('steps,', at);
    assert.ok(end > at, `no return-closing steps, after "${frag}"`);
    assert.match(CREATE.slice(at, end), /field: 'name'/,
      `the collision refusal "${frag}" is not tagged field: 'name', so it lands below the button`);
  }
  // The ONE refusal deliberately NOT tagged: a fail-closed SYSTEM refusal (tmux/paneRoster
  // unreachable) is not a name that is known to be taken, so flagging the name field red
  // would assert the name is wrong when it may be fine. It stays below-button. Re-tagging it
  // would re-introduce that misleading red border (#2606, iteration 4).
  const sysAt = CREATE.indexOf('we could not check which agents are already running');
  assert.notEqual(sysAt, -1, 'the could-not-check refusal is gone from create.js');
  assert.doesNotMatch(CREATE.slice(sysAt, CREATE.indexOf('steps,', sysAt)), /field: 'name'/,
    "the could-not-check SYSTEM refusal must NOT be field: 'name' -- it is not a bad name");
});

test('the project name-rule routing matches projects.js name refusals but never a folder collision (#2606)', () => {
  const PROJECTS = fs.readFileSync(path.join(__dirname, 'engine', 'projects.js'), 'utf8');
  // The exact regex the pj-create catch uses to route a NAME-RULE refusal to the field.
  const RE = /give this project a name|a name has to be words|name is longer than a project name|too many projects with that name/i;
  // The handler must use THIS regex, not a broad /name/i (which the iter-4 review showed
  // false-matches a folder collision whose interpolated title contains "name").
  assert.ok(PAGE.includes('give this project a name|a name has to be words|name is longer than a project name|too many projects with that name'),
    'the pj-create catch is not using the specific name-rule regex');
  // Every name-RULE message projects.js actually throws must be routed to the field.
  for (const m of [
    'give this project a name',
    'a name has to be words',
    'that name is longer than a project name should be',
    'there are too many projects with that name',
  ]) {
    assert.ok(PROJECTS.includes(m), `projects.js no longer throws "${m}" -- the routing regex is stale`);
    assert.match(m, RE, `the routing regex does not match the name refusal "${m}"`);
  }
  // A folder collision interpolates an existing project's TITLE; a title containing "name"
  // must NOT false-route to the name field.
  assert.doesNotMatch('that folder is already the project "Renamed Client Docs"', RE,
    'a folder-collision refusal whose title contains "name" false-matches the name-field regex');
});
