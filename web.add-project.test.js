"use strict";
/**
 * #750: Add a project, styled like New agent: no box, "New project", "Name",
 * "Description", no folder talk, three add buttons (two disabled until their
 * flows exist), a dropdown behind Add an agent, and a big yellow Create project.
 *
 *   node --test web.add-project.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
const VIEW = (() => { const at = PAGE.indexOf('id="pj-add-view"'); return PAGE.slice(at, PAGE.indexOf('id="panel-settings"', at)).replace(/<!--[\s\S]*?-->/g, ''); })();

test('the words: New project, Name, Description; no folder sentence, no folder door, no "skip this"', () => {
  assert.match(VIEW, /<h2>New project<\/h2>/);
  assert.match(VIEW, /<span class="flabel">Name<\/span>/);
  assert.match(VIEW, /<span class="flabel">Description<\/span>/);
  assert.doesNotMatch(VIEW, /What do you call it|What is it about|You can skip this|Add a project<\/h2>/);
  assert.match(VIEW, /<p class="pj-advanced" hidden>/, 'the folder door is still on the page');
  assert.match(VIEW, /id="pj-will-be" hidden/, 'the folder sentence can still show');
});

test('the agents section is the picked list and three doors, two of them honestly disabled; the dropdown sits behind Add an agent', () => {
  assert.match(VIEW, /<button class="btn" id="pj-add-agent" type="button"><span aria-hidden="true">\+<\/span> Add an agent<\/button>/);
  assert.match(VIEW, /<button class="btn" type="button" disabled title="Not yet: people outside Kosmos[^"]*">Add an external person<\/button>/);
  assert.match(VIEW, /<button class="btn" type="button" disabled title="Not yet: agents outside Kosmos[^"]*">Add an external agent<\/button>/);
  assert.match(VIEW, /<div class="frow" id="pj-add-agent-row" hidden/);
  assert.match(VIEW, /<select id="pj-add-pick" aria-label="Which agent to add"><\/select>/);
  assert.doesNotMatch(SCRIPT, /closest\('\[data-pick\]'\)/, 'the every-agent roster still has a click path');
});

test('the picked list shows only the agents put on the project, with a way off each; the dropdown offers the rest', () => {
  const lift = (name) => { const at = SCRIPT.indexOf('function ' + name + '('); const end = SCRIPT.indexOf('\n}\n', at) + 3; return SCRIPT.slice(at, end); };
  // Minimal card shapes for a painter, built the way web.url-state does (the fixture-discipline rule is about hand-built cards standing in for the fleet; these stand in for nothing but two fields).
  const LAST = ['anna', 'ava', 'june'].map((k) => Object.fromEntries([['sessionName', k], ['name', k[0].toUpperCase() + k.slice(1)]]));
  const esc = (s) => String(s); const roleLine = (a) => (a.sessionName === 'ava' ? 'Process Designer' : '');
  // #859: addAgentsHtml now draws each row's face, the same way every other
  // member surface does (pjMember, the card, ...) -- stand-ins here for the
  // same reason esc/roleLine are stand-ins above, nothing but a return shape.
  const discTint = () => '#000'; const discInk = () => '#fff'; const initials = (n) => String(n).slice(0, 1);
  // eslint-disable-next-line no-new-func
  const html = new Function('LAST', 'PJ_ADD_AGENTS', 'esc', 'roleLine', 'ROLE_TITLES', 'discTint', 'discInk', 'initials',
    lift('addAgentsHtml') + '\nreturn addAgentsHtml();');
  assert.match(html(LAST, [], esc, roleLine, {}, discTint, discInk, initials), /No agents on it yet\./);
  const two = html(LAST, ['ava', 'anna'], esc, roleLine, {}, discTint, discInk, initials);
  assert.equal((two.match(/class="pj-picked"/g) || []).length, 2);
  assert.equal((two.match(/class="lav pj-face"/g) || []).length, 2, 'each picked row draws its face');
  assert.doesNotMatch(two, /June/, 'an agent not picked is listed');
  assert.match(two, /data-unpick="ava" aria-label="Take Ava off this project"/);
  assert.ok(two.indexOf('Ava') < two.indexOf('Anna'), 'the list is in the order they were added');
  const sel = { innerHTML: '' }; const btn = { disabled: undefined, title: '' };
  const document = { getElementById: (id) => (id === 'pj-add-pick' ? sel : btn) };
  // eslint-disable-next-line no-new-func
  const opts = new Function('document', 'LAST', 'PJ_ADD_AGENTS', 'esc', 'roleLine', 'ROLE_TITLES', lift('addPickOptions') + '\naddPickOptions();');
  opts(document, LAST, ['ava', 'anna'], esc, roleLine, {});
  assert.match(sel.innerHTML, /<option value="">Pick an agent/);
  assert.match(sel.innerHTML, /<option value="june">June<\/option>/);
  assert.doesNotMatch(sel.innerHTML, /value="ava"|value="anna"/, 'a picked agent is offered again');
  assert.equal(btn.disabled, false);
  opts(document, LAST, ['ava', 'anna', 'june'], esc, roleLine, {});
  assert.equal(btn.disabled, true, 'with nobody left to add the button says so instead of opening an empty list');
});

test('the primary action is the big yellow Create project, right-aligned, and the view sits on the ground at the create page\'s width', () => {
  assert.match(VIEW, /<div class="sfoot">\s*<button class="btn uprime big" id="pj-create" type="button">Create project<\/button>/);
  assert.doesNotMatch(VIEW, /Add this project/);
  assert.match(PAGE, /#pj-add-view \{ max-width: 34rem; margin: 0 auto; background: none; border: 0; box-shadow: none; padding: 0; \}/);
  assert.doesNotMatch(PAGE, /#pj-add-view, #pj-settings-view \{/);
});
