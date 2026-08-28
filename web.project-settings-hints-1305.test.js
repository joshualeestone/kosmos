'use strict';
/**
 * The project settings screen answers Josh's two questions where he asks them
 * (#1305).
 *
 * 🛑 THE CARD IS NOT THE DELIVERABLE. His words: *"if we change a project name,
 * do agents lose context of that... Also if I change the description, are they
 * made aware that I changed the description?"* He was **avoiding a legitimate
 * action** because the screen would not say whether it was destructive. An
 * answer that lives in a GitHub comment does not reach the person standing in
 * front of the rename box.
 *
 * 🔑 WHAT THE TWO SENTENCES MUST KEEP SAYING, and why each is true:
 *
 *   Renaming is SAFE. The record is keyed by the project id and a rename does
 *   not move it, and `PUT /api/project/:id` re-tells every member when the name
 *   changed, so their instruction file carries the new one.
 *
 *   A description change does NOT reach agents, and there is nothing for it to
 *   reach: the managed block carries the name, the folder, the post command and
 *   that agent's tasks. Never the description.
 *
 * ⚠️ THIS FILE PINS THE CLAIM, NOT THE WORDING. Each assertion asks whether the
 * sentence still makes the promise, so the copy can be reworded freely and only
 * a change of MEANING fails it. A test that pinned the exact string would go red
 * on every polish pass and teach people to edit the test rather than think.
 *
 * ⚠️ AND IT IS A SOURCE ASSERTION, deliberately, matching every other screen-copy
 * pin in this repo. The behaviour it describes is already pinned by
 * `server.projects.test.js`; what is unpinned is that the SCREEN still says so.
 *
 *   node --test web.project-settings-hints-1305.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/** The rendered text of one element, by id, with tags and comments removed. */
function hintText(id) {
  const at = PAGE.indexOf(`id="${id}"`);
  assert.notEqual(at, -1, `${id} is gone from the page, so the answer is no longer on the screen`);
  const open = PAGE.lastIndexOf('<', at);
  const close = PAGE.indexOf('</p>', at);
  assert.notEqual(close, -1, `${id} is not a paragraph any more; restate this pin`);
  return PAGE.slice(PAGE.indexOf('>', at) + 1, close).replace(/<[^>]*>/g, '').trim();
}

test('#1305: the Name field says a rename is safe and that agents are told', () => {
  const t = hintText('pjs-name-hint');
  assert.match(t, /\bsafe\b/i,
    'the name hint no longer says renaming is safe, which is the question he asked');
  assert.match(t, /\bstay\b|\bkeep\b|\bremain\b/i,
    'the name hint no longer says the agents stay on the project');
  assert.match(t, /\btell|\bknow|\bnotif/i,
    'the name hint no longer says the agents are told the new name');
});

/* 🛑 `pjs-desc-note`, NOT `pjs-desc-hint`, AND THE SPLIT IS DELIBERATE. #1303 G
   landed a limit hint on the same field while this branch was open, and both
   wanted the same id. They cannot share one element: web.desc-error-1303g.test.js
   pins the limit with a regex matching the WHOLE element ("Up to N characters."
   and nothing else), so appending this sentence to it would silently break the
   check that keeps the page's number and PJ_DESC_MAX agreeing. Two paragraphs,
   both named in `aria-describedby`, so the field still announces both facts. */
test('#1305: the Description field says agents are NOT told', () => {
  const t = hintText('pjs-desc-note');
  assert.match(t, /\bnot\b/i,
    'the description hint no longer carries a negative, so it cannot still be saying agents are not told');
  assert.match(t, /\btold\b|\bnotif|\bknow\b|\baware\b/i,
    'the description hint no longer says anything about agents being told');
});

test('CONTROL: the reader returns real text, and refuses an id that is not there', () => {
  assert.ok(hintText('pjs-name-hint').length > 20,
    'the reader returned almost nothing, so the assertions above would pass on an empty string');
  assert.throws(() => hintText('pjs-no-such-hint-id'),
    'the reader invents text for an id that does not exist, so it proves nothing');
});

test('CONTROL: the two hints are different sentences, not one copied twice', () => {
  assert.notEqual(hintText('pjs-name-hint'), hintText('pjs-desc-note'),
    'both fields carry the same sentence, so one of the two questions is unanswered');
});

test('#1305: the field announces BOTH facts, not just the one it points at', () => {
  /* ⚠️ THE SPLIT CREATED THIS OBLIGATION. Two visible paragraphs are two visible
     paragraphs; a screen reader gets only what `aria-describedby` names. Splitting
     them and pointing at one would have quietly halved the answer for the people
     least able to notice. */
  const m = PAGE.match(/<textarea[^>]*id="pjs-desc"[^>]*>/);
  assert.ok(m, 'the description textarea is gone from the page');
  const described = (m[0].match(/aria-describedby="([^"]*)"/) || [, ''])[1].split(/\s+/);
  assert.ok(described.includes('pjs-desc-hint'),
    'the field no longer announces the character limit');
  assert.ok(described.includes('pjs-desc-note'),
    'the field no longer announces that agents are not told');
});
