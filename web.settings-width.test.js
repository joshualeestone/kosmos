"use strict";
/**
 * #770: Settings is one content column of one width, centred with the nav
 * beside it; the You tab is Your Profile with one-size picture buttons, no
 * disclaimer, a short name field and a yellow Save.
 *
 *   node --test web.settings-width.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('the settings body is the nav and one 34rem column, centred; narrow windows get the fluid column back', () => {
  assert.match(PAGE, /#panel-settings \.dbody \{ grid-template-columns: 176px 34rem; justify-content: center; \}/);
  assert.match(PAGE, /@media \(max-width: 60rem\) \{ #panel-settings \.dbody \{ grid-template-columns: 176px minmax\(0, 1fr\); justify-content: stretch; \} \}/);
});

test('You is Your Profile: one-size picture buttons, no disclaimer by default, a short name field, a yellow Save', () => {
  const body = PAGE.replace(/<!--[\s\S]*?-->/g, '');
  assert.match(body, /data-go="you" aria-controls="s-sec-you" class="on" aria-current="true">Your Profile<\/button>/);
  assert.match(body, /id="s-sec-you" data-sec="you" tabindex="-1" aria-label="Your Profile"/);
  assert.match(body, /<h3 class="dlab">Your Profile<\/h3>/);
  assert.match(body, /<button class="btn sav-btn" type="button" id="you-file-btn">Change picture<\/button>\s*<button class="btn" id="you-remove" type="button" hidden>Remove<\/button>/);
  assert.match(body, /<p class="dhint" id="you-msg" role="status" style="margin:10px 0 0;"><\/p>/, 'the disclaimer is back as the default text');
  assert.doesNotMatch(body, /It appears wherever Kosmos shows you/);
  assert.match(PAGE, /#you-name \{ flex: 0 1 14rem; min-width: 10rem; \}/);
  assert.match(body, /<button class="btn uprime" type="button" id="you-name-save" aria-label="Save your name" disabled>Save<\/button>/);
});
