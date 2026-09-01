"use strict";
/**
 * #737: the step-one role pickers match the pack: taller rows, a check mark
 * when chosen (no radio dot), the Project Manager description with
 * Recommended after it, and the pack's line under the heading.
 *
 *   node --test web.role-picker.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

test('the rows carry a check mark and keep their radio for the keyboard; the description sits beside every row', () => {
  const body = PAGE.replace(/<!--[\s\S]*?-->/g, '');
  assert.match(body, /<h2>What should this agent do\?<\/h2>\s*<p class="dhint"[^>]*>You can change any of this later\.<\/p>/);
  for (const id of ['pick-pm', 'pick-list', 'pick-own']) {
    const at = body.indexOf('id="' + id + '"');
    const row = body.slice(at, body.indexOf('</label>', at));
    assert.match(row, /<input type="radio" name="rmode"/, id + ' lost its radio');
    assert.match(row, /<span class="pickmark" aria-hidden="true">&#10003;<\/span>/, id + ' has no check mark');
  }
  assert.match(body, /<span class="p2n" id="pick-pm-name"><\/span>\s*<span class="p2d" id="pick-pm-desc"><\/span>/, 'the Project Manager row has no description span');
  assert.match(PAGE, /\.pick2 > input\[type="radio"\] \{\n  position: absolute; opacity: 0;/);
  assert.doesNotMatch(PAGE, /\.pick2 > input\[type="radio"\] \{[^}]*display: none/);
  assert.match(PAGE, /\.pick2:has\(input:checked\) \.pickmark \{ color: var\(--label\); \}/);
  assert.match(PAGE, /\.pickmark \{ color: transparent;/);
  assert.match(PAGE, /border-radius: var\(--radius-control\); padding: 24px 18px; position: relative;\n\}/, 'the rows are not twice as fat');
});

test('the Project Manager row says what the role does, and Recommended comes after the words', () => {
  assert.match(SCRIPT, /getElementById\('pick-pm-desc'\)\.textContent = pm\.blurb \|\| '';/);

  const at = SCRIPT.indexOf('function updateRecPill');
  const fn = SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 3);
  assert.match(fn, /getElementById\('pick-pm-desc'\)/, 'the pill is not aimed at the description');
  assert.doesNotMatch(fn, /getElementById\('pick-pm-name'\)/, 'the pill still lands on the name');
  const kids = []; const el = { textContent: 'Breaks down work', querySelector: (sel) => kids.find((k) => k.className === sel.slice(1)) || null, appendChild: (k) => { kids.push(k); } };
  const document = { getElementById: (id) => (id === 'pick-pm-desc' ? el : null), createElement: (t) => ({ tag: t, className: '', textContent: '' }), createTextNode: (t) => ({ text: t, className: '' }) };
  // eslint-disable-next-line no-new-func
  const run = new Function('document', 'ROLES', fn + '\nreturn updateRecPill;')(document, [{ key: 'pm' }]);
  run(); run();
  assert.equal(kids.filter((k) => k.className === 'prec').length, 1, 'the pill was added twice');
  assert.equal(kids[kids.length - 1].textContent, 'Recommended');
});


test('a role\'s limit is said on step one, under the dropdown, the moment it is chosen; nothing for a role without one', () => {
  const body = PAGE.replace(/<!--[\s\S]*?-->/g, '');
  assert.match(body, /<select id="rolesel"><\/select>\s*<p class="rolelimit" id="pick-limit" hidden><\/p>/);
  const at = SCRIPT.indexOf('function paintPickLimit'); const fn = SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 3);
  const run = (picked, hidden, caution) => {
    const line = { textContent: '', hidden: undefined };
    const document = { getElementById: (id) => (id === 'pick-limit' ? line : { hidden }) };
    // eslint-disable-next-line no-new-func
    new Function('document', 'PICKED', 'roleByKey', fn + '\npaintPickLimit();')(document, picked, () => ({ caution }));
    return line;
  };
  const ea = run('ea', false, 'It never sends anything.');
  assert.equal(ea.hidden, false); assert.equal(ea.textContent, 'It never sends anything.');
  assert.equal(run('bk', false, null).hidden, true, 'a role with no limit draws a line');
  assert.equal(run('ea', true, 'It never sends anything.').hidden, true, 'the line shows while the dropdown is closed');
  assert.equal(run('own', false, 'x').hidden, true, 'describe-it-yourself has no limit to say');
  assert.match(SCRIPT, /PICKED = document\.getElementById\('rolesel'\)\.value;\n  paintPickLimit\(\);/);
  assert.match(SCRIPT, /getElementById\('role-next'\)\.disabled = importing;\n  paintPickLimit\(\);\n\}/);
});

test('the fourth option imports an agent from a file: its own panel, the shared Continue hidden, a client-side read into the textarea, and a parse-only post', () => {
  const body = PAGE.replace(/<!--[\s\S]*?-->/g, '');
  // The row is a real pick option: radio for the keyboard, check mark when chosen.
  const at = body.indexOf('id="pick-import"');
  const row = body.slice(at, body.indexOf('</label>', at));
  assert.match(row, /<input type="radio" name="rmode" value="import"/, 'pick-import lost its radio');
  assert.match(row, /<span class="pickmark" aria-hidden="true">&#10003;<\/span>/, 'pick-import has no check mark');
  // Its panel holds a paste box, a file picker, and its own advance button.
  assert.match(body, /<textarea id="import-text"/);
  assert.match(body, /<input type="file" id="import-file"[^>]*hidden>/);
  assert.match(body, /<button class="btn uprime" type="button" id="import-load">/);
  // Gated exactly like `own` (both use the own role key), so it never offers a
  // path whose create would refuse.
  assert.match(SCRIPT, /getElementById\('pick-import'\)\.hidden = !OWN_ROLE;/);
  // pickMode routes 'import' to its own panel and takes the shared Continue out
  // of the flow -- the panel's own button is the advance.
  assert.match(SCRIPT, /const importing = mode === 'import';/);
  assert.match(SCRIPT, /getElementById\('importpick'\)\.hidden = !importing;/);
  assert.match(SCRIPT, /getElementById\('role-next'\)\.hidden = importing;/);
  // Import PARSES then reuses the one create path: it reads the file client-side,
  // posts it to the parse endpoint, and a refusal is shown rather than advanced past.
  assert.match(SCRIPT, /readAsText\(f\)/);
  assert.match(SCRIPT, /fetch\('\/api\/agent-import'/);
  assert.match(SCRIPT, /importMsg\(data\.because/);
});
