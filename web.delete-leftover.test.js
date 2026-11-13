'use strict';
/**
 * #514: the delete's screen half. The confirmation's words come from the
 * engine; the destructive button is neither the calm one nor a copy of
 * Remove; the name is typed only when the files cannot come back; and
 * create's refusals no longer point at a Remove that cannot free the name.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const CREATE = fs.readFileSync(path.join(__dirname, 'engine', 'create.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));
const jsStart = SCRIPT.indexOf('/* ---- #514: delete what is left of an agent');
const jsEnd = SCRIPT.indexOf("document.addEventListener('click', async (e) => {\n  const btn = e.target.closest('[data-delete-leftover]')", jsStart);
const JS = SCRIPT.slice(jsStart, jsEnd);

test('the modal exists once, is an alertdialog, keeps Keep first, and carries no sentence of its own', () => {
  assert.equal((PAGE.match(/id="del-modal"/g) || []).length, 1);
  const m = PAGE.slice(PAGE.indexOf('id="del-modal"'), PAGE.indexOf('id="rm-modal"'));
  assert.match(m, /role="alertdialog"/);
  assert.ok(m.indexOf('id="del-keep"') < m.indexOf('id="del-go"'), 'the delete button comes before Keep');
  assert.match(m, /<h2 class="rm-title" id="del-title"><\/h2>/, 'the title carries words the engine did not say');
  assert.match(m, /<p class="rm-small" id="del-small"><\/p>/, 'the reassurance carries words the engine did not say');
  assert.match(m, /<button class="btn del-go" id="del-go" type="button"><\/button>/, 'the button carries a verb the engine did not say');
});

test('the words are the engine’s and the typed name gates the button only when the plan asks', () => {
  assert.ok(jsStart > -1 && jsEnd > jsStart, 'the delete block moved; re-anchor');
  assert.match(JS, /textContent = plan\.question/);
  assert.match(JS, /textContent = plan\.reassurance/);
  assert.match(JS, /go\.textContent = plan\.verb/);
  assert.match(JS, /if \(plan\.typeToConfirm\) \{[\s\S]*?go\.disabled = true;/);
  // kosmos#8477 review 1: the name the dialog on screen asks for (DEL_SHOWN), not a fresher DEL_PLAN's.
  assert.match(JS, /e\.target\.value\.trim\(\) === DEL_SHOWN\.typeToConfirm/);
  assert.doesNotMatch(JS, /confirm\(/, 'a browser confirm crept in');
});

test('the delete button is filled, not the Remove border, and the detail block is hidden until the engine offers it', () => {
  assert.match(PAGE, /\.del-go \{ background: var\(--warn-bg\); border-color: var\(--warn-border\)/);
  assert.match(PAGE, /<div class="dremove danger" id="d-delete-leftover" hidden>/);
  assert.match(JS, /if \(!plan \|\| !plan\.ok\) \{ box\.hidden = true;/);
});

test('the removed list carries the door, and its hint says why a name stays taken', () => {
  assert.match(SCRIPT, /data-delete-leftover="' \+ esc\(a\.name\) \+ '"/);
  assert.match(SCRIPT, /A name stays taken while its files stay; delete them to use it again\./);
});

test('create’s refusals no longer send a person to a Remove that cannot free the name', () => {
  assert.doesNotMatch(CREATE, /you can remove it there instead/);
  assert.equal((CREATE.match(/delete what was left of it/g) || []).length, 5, 'a refusal arm lost the way through');
});

test('the routes: GET plans, DELETE acts with the typed name, and neither touches remove.js', () => {
  const a = SERVER.indexOf("const lo = pathname.match(/^\\/api\\/agent\\/([^/]+)\\/leftover$/);");
  const b = SERVER.indexOf("const rs = pathname.match(", a);
  assert.ok(a > -1 && b > a, 'the leftover routes moved; re-anchor');
  const r = SERVER.slice(a, b);
  // kosmos#7835: the async forms, which run the Windows PowerShell waits off the board.
  assert.match(r, /await leftover\.planAsync\(name\)/);
  // kosmos#8477: with what the dialog promised, null (never absent) when the request carried none.
  assert.match(r, /await leftover\.delAsync\(name, \{ typed: body\.typed, confirmed: typeof body\.confirmed === 'string' \? body\.confirmed : null \}\)/);
  assert.doesNotMatch(r, /removal\./);
});

test('no em dash in anything a person reads here', () => {
  const region = PAGE.slice(PAGE.indexOf('id="del-modal"'), PAGE.indexOf('id="rm-modal"')) + JS
    + PAGE.slice(PAGE.indexOf('id="d-delete-leftover"'), PAGE.indexOf('id="d-delete-msg"'));
  assert.doesNotMatch(region, /—/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'engine', 'delete-leftover.js'), 'utf8'), /—/);
});

test('#7835 item 6: a dialog repainted to ask for the name puts the cursor in the name box; a fresh one still opens on Keep', () => {
  const at = JS.indexOf("document.getElementById('del-go').addEventListener('click'");
  assert.ok(at > 0, 'the delete button handler moved; this test no longer reads it');
  const handler = JS.slice(at, JS.indexOf('closeDeleteModal();', at));
  // kosmos#8477: a repaint because the plan changed can ask for no name; then the cursor stays on Keep.
  assert.match(handler, /repainted = true;\n\s*\/\/[^\n]*\n\s*if \(body\.plan\.typeToConfirm\) document\.getElementById\('del-typed'\)\.focus\(\);/,
    'the repainted dialog leaves the cursor on Keep, so the person has to find the box to type the name');
  const open = JS.slice(JS.indexOf('function openDeleteModal('), JS.indexOf('function closeDeleteModal('));
  assert.match(open, /document\.getElementById\('del-keep'\)\.focus\(\);\n\}\s*$/, 'a fresh dialog no longer opens on the harmless answer');
});

