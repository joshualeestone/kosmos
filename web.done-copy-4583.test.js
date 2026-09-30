'use strict';
// #4583 follow-up (Mona Lisa's design pass): the create form's done field asks a question, and its hint says
// what happens if you skip it, not how Kosmos records it. Keyed to the problem, not to one spelling of the fix:
// the label and aria-label must be the same question, and the hint must not name the row tag or the length cap
// (the length is said by the error line, when it matters).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function doneField() {
  const at = html.indexOf('id="pj-add-done"');
  assert.ok(at > 0, 'the create form has no #pj-add-done box');
  const start = html.lastIndexOf('<div class="field">', at);
  const end = html.indexOf('</div>', at);
  assert.ok(start > 0 && end > at, 'could not find the field around #pj-add-done');
  return html.slice(start, end);
}

test('#4583: the done field is labelled as one question, visibly and for a screen reader', () => {
  const f = doneField();
  const label = (f.match(/<span class="flabel">([^<]*)<\/span>/) || [])[1];
  const aria = (f.match(/aria-label="([^"]*)"/) || [])[1];
  assert.strictEqual(label, 'What does done look like?');
  assert.strictEqual(aria, label, 'the aria-label and the visible label say different things');
});

test('#4583: the done hint says what skipping does, and does not explain Kosmos\'s machinery', () => {
  const hint = (doneField().match(/<p class="fhint" id="pj-add-done-hint">([^<]*)<\/p>/) || [])[1];
  assert.ok(hint, 'the done field has no hint');
  assert.match(hint, /^Optional\./);
  assert.doesNotMatch(hint, /Done not set/i, 'the hint names the row tag again');
  assert.doesNotMatch(hint, /\d+ characters/i, 'the hint names the length cap again');
});
