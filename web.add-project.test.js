"use strict";
/**
 * #750: Add a project, styled like New agent: no box, "Name", "Description", no folder
 * talk, a dropdown behind Add an agent, and a big yellow Create project.
 * #3312 (Josh 2026-09-19): the screen is now two MODES -- Create New Project and Join
 * External Project (relay federation MVP) -- so the heading is visually hidden behind the
 * pill toggle, and the two external-add doors are LIVE (they mint an invite code) rather
 * than the #750 honestly-disabled placeholders.
 *
 *   node --test web.add-project.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
const VIEW = (() => { const at = PAGE.indexOf('id="pj-add-view"'); return PAGE.slice(at, PAGE.indexOf('id="panel-settings"', at)).replace(/<!--[\s\S]*?-->/g, ''); })();

test('the words: Name, Description; no folder sentence, no folder door, no "skip this"; the heading is behind the mode toggle', () => {
  // #3312: the visible top control is the pill toggle; the heading is kept for the heading
  // list but visually hidden (class vh) since the toggle names the choice.
  assert.match(VIEW, /<h2 class="vh">Add a project<\/h2>/);
  assert.match(VIEW, /<span class="flabel">Name<\/span>/);
  assert.match(VIEW, /<span class="flabel">Description<\/span>/);
  assert.doesNotMatch(VIEW, /What do you call it|What is it about|You can skip this/);
  assert.match(VIEW, /<p class="pj-advanced" hidden>/, 'the folder door is still on the page');
  assert.match(VIEW, /id="pj-will-be" hidden/, 'the folder sentence can still show');
});

test('#3312: the top toggle offers Create New Project vs Join External Project', () => {
  assert.match(VIEW, /<button type="button" class="pj-mode-opt" id="pj-mode-create" role="radio" aria-checked="true">Create New Project<\/button>/);
  assert.match(VIEW, /<button type="button" class="pj-mode-opt" id="pj-mode-join" role="radio" aria-checked="false">Join External Project<\/button>/);
});

test('#3312: the two external doors are LIVE now (they mint an invite code), no longer disabled placeholders', () => {
  assert.match(VIEW, /<button class="btn" id="pj-add-agent" type="button"><span aria-hidden="true">\+<\/span> Add an agent<\/button>/);
  assert.match(VIEW, /<button class="btn" id="pj-add-ext-person" type="button" title="[^"]*">Add an external person<\/button>/);
  assert.match(VIEW, /<button class="btn" id="pj-add-ext-agent" type="button" title="[^"]*">Add an external agent<\/button>/);
  assert.doesNotMatch(VIEW, /disabled title="Not yet: (people|agents) outside Kosmos/, 'the external doors are no longer the honestly-disabled placeholders');
  // The invite panel (verbatim message + code + copy) is present, hidden until a door is pressed.
  assert.match(VIEW, /id="pj-invite-panel" hidden/);
  assert.match(VIEW, /To connect external Kosmos users or their agents, give them this code to enter when joining an external project on Kosmos:/);
});

test('#3312: the Join-External mode carries a code + Verify and a Join Project submit', () => {
  assert.match(VIEW, /Enter your code to access an external project:/);
  assert.match(VIEW, /<button class="btn" id="pj-join-verify" type="button">Verify<\/button>/);
  assert.match(VIEW, /id="pj-join-result" hidden/);
  assert.match(VIEW, /<button class="btn uprime big" id="pj-join-submit" type="button">Join Project<\/button>/);
});

test('the agents picker: the picked list and Add an agent with its dropdown behind it', () => {
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

test('#3134 (Josh 6.70): after a successful Create project, the person lands INSIDE the new project, not back on the list', () => {
  // Josh's 6.68 ask was "return to the list" (PR #3160); his 6.70 verification
  // reversed it: "once you create a project ... it should take you directly into
  // that project." This behaviour has flip-flopped once already, so pin it to the
  // source of the create handler rather than trust the prose comment.
  const at = SCRIPT.indexOf("getElementById('pj-create').addEventListener");
  assert.ok(at !== -1, 'the Create project click handler is on the page');
  const handler = SCRIPT.slice(at, SCRIPT.indexOf('\n});', at));
  assert.match(handler, /openProject\(newProjectId\)/,
    'the create success path no longer opens the new project (it must land the person inside it)');
  assert.doesNotMatch(handler, /pjView\('list'\)/,
    'the create handler routes back to the projects list again, the 6.68 behaviour Josh reversed in 6.70');
});
