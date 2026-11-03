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
  assert.match(JS, /e\.target\.value\.trim\(\) === DEL_PLAN\.typeToConfirm/);
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
  assert.match(r, /await leftover\.delAsync\(name, \{ typed: body\.typed \}\)/);
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
  assert.match(handler, /repainted = true;\n\s*\/\/[^\n]*\n\s*document\.getElementById\('del-typed'\)\.focus\(\);/,
    'the repainted dialog leaves the cursor on Keep, so the person has to find the box to type the name');
  const open = JS.slice(JS.indexOf('function openDeleteModal('), JS.indexOf('function closeDeleteModal('));
  assert.match(open, /document\.getElementById\('del-keep'\)\.focus\(\);\n\}\s*$/, 'a fresh dialog no longer opens on the harmless answer');
});

test('#7852 an agent page whose delete is running says so, with no button, and keeps asking; another answer ends it', async () => {
  const vm = require('node:vm');
  const { scriptOf, liftAll } = require('./test-support/page');
  const els = {};
  for (const id of ['d-delete-leftover', 'd-delete-hint', 'd-delete-start']) els[id] = { id, hidden: true, textContent: '' };
  let answer = null;
  let readable = true;
  let failing = false;   // the route's 500, with its error words
  const ctx = vm.createContext({ String, Promise, encodeURIComponent, document: { getElementById: (id) => els[id] || null },
    // the route answers 200 with any plan; an unreadable answer is a proxy's page
    fetch: async () => ({ ok: !failing, json: async () => (readable ? answer : Promise.reject(new Error('not json'))) }) });
  vm.runInContext(['let DEL_TOKEN = 0; let DEL_PLAN = null; let DEL_FOR = null; let DEL_RUNNING_FOR = null; let CURRENT = { sessionName: "miles" };',
    liftAll(scriptOf(PAGE), ['fetchLeftoverPlan', 'paintLeftoverRunning', 'loadLeftover', 'leftoverOnPoll', 'leftoverOffList']),
    'this.load = loadLeftover; this.state = () => ({ DEL_PLAN, DEL_RUNNING_FOR }); this.view = (n) => { CURRENT = { sessionName: n }; }; this.dialog = (n, p) => { DEL_FOR = n; DEL_PLAN = p; }; this.onPoll = leftoverOnPoll; this.offList = leftoverOffList;'].join('\n'), ctx);
  answer = { ok: false, running: true, because: 'a delete of what is left of this agent is running now; try again when it has finished' };
  await ctx.load('miles');
  assert.equal(els['d-delete-leftover'].hidden, false, 'a running delete must keep the block showing');
  assert.equal(els['d-delete-start'].hidden, true, 'no delete button while the delete runs');
  assert.match(els['d-delete-hint'].textContent, /^A delete of what is left of this agent is running now; .*\.$/, 'the board\'s words, as a sentence');
  assert.equal(ctx.state().DEL_RUNNING_FOR, 'miles', 'the poll must be told to keep asking for this agent');
  assert.equal(ctx.state().DEL_PLAN, null);
  readable = false;
  await ctx.load('miles');
  assert.equal(els['d-delete-leftover'].hidden, false, 'an unreadable answer must not end the running block');
  assert.equal(ctx.state().DEL_RUNNING_FOR, 'miles', 'an unreadable answer must not stop the poll asking');
  readable = true;
  failing = true;
  answer = { error: 'the board could not work out what is left of this agent' };
  await ctx.load('miles');
  assert.equal(els['d-delete-leftover'].hidden, false, 'a failed request must not end the running block');
  assert.equal(ctx.state().DEL_RUNNING_FOR, 'miles', 'a failed request must not stop the poll asking');
  failing = false;
  answer = { ok: false, because: 'nothing of Miles is left on this computer, so there is nothing to delete.' };
  await ctx.load('miles');
  assert.equal(els['d-delete-leftover'].hidden, true, 'the block must leave once the delete has ended');
  assert.equal(ctx.state().DEL_RUNNING_FOR, null, 'the poll must stop asking once the delete has ended');
  assert.equal(els['d-delete-start'].hidden, false, 'the button must come back for the next plan');
  // Another agent: Miles's "running" goes before Ada's own answer comes.
  answer = { ok: false, running: true, because: 'a delete of what is left of this agent is running now; try again when it has finished' };
  await ctx.load('miles');
  ctx.view('ada');
  let seenHidden = null;
  answer = { message: 'hi' };   // a 200 that is not a plan (fetchLeftoverPlan gives null)
  const asking = ctx.load('ada');
  seenHidden = els['d-delete-leftover'].hidden;
  await asking;
  assert.equal(seenHidden, true, 'another agent\'s running block must not show on this agent\'s page');
  assert.equal(ctx.state().DEL_RUNNING_FOR, null);
  // A dialog open for another agent keeps its plan while this page's block keeps asking.
  ctx.view('miles');
  const adaPlan = { ok: true, name: 'Ada', typeToConfirm: 'Ada' };
  ctx.dialog('Ada', adaPlan);
  answer = { ok: false, running: true, because: 'a delete of what is left of this agent is running now; try again when it has finished' };
  await ctx.load('miles');
  assert.equal(ctx.state().DEL_PLAN, adaPlan, 'the running block took the plan of a dialog open for another agent');
  answer = { ok: true, name: 'Miles', hint: 'h' };
  await ctx.load('miles');
  assert.equal(ctx.state().DEL_PLAN, adaPlan, 'a plan read for this page replaced the plan of a dialog open for another agent');
  // The poll: while a page's block says running, its poll asks; once the agent has left the list, it asks once more.
  ctx.dialog(null, null);
  answer = { ok: false, running: true, because: 'a delete of what is left of this agent is running now; try again when it has finished' };
  await ctx.load('miles');
  assert.equal(ctx.onPoll('miles', true), true, 'the poll must ask while this agent\'s block says running');
  assert.equal(ctx.onPoll('ada', true), false, 'the poll must not ask for another agent');
  assert.equal(ctx.onPoll('ada', false), true, 'a repaint that is not the poll always asks');
  answer = { ok: false, because: 'nothing of Miles is left on this computer, so there is nothing to delete.' };
  ctx.offList();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(els['d-delete-leftover'].hidden, true, 'an agent that left the list keeps "running" on its page for good');
  assert.equal(ctx.state().DEL_RUNNING_FOR, null);
  assert.equal(ctx.onPoll('miles', true), false, 'the poll keeps asking after the delete ended');
  const tick = PAGE.indexOf("loadRemoval(fresh.sessionName, { fromPoll: true });");
  assert.ok(tick > 0 && /\} else \{\n[^\n]*\n    leftoverOffList\(\);/.test(PAGE.slice(tick, tick + 400)), 'the poll does not call leftoverOffList when the card is gone');
  assert.match(PAGE, /if \(leftoverOnPoll\(sessionName, fromPoll\)\) loadLeftover\(sessionName\);/, 'loadRemoval does not ask leftoverOnPoll');
});
