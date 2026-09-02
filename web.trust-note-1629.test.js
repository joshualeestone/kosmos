'use strict';
/**
 * kosmos#1629 point 3: the two "waiting on an answer" labels read the route's
 * `answerNote`, so a person on Claude Code's trust dialog is told the answer
 * belongs in the terminal BEFORE they type, not after a 409. Static, because
 * the browser gate was held by another agent when this shipped; the browser
 * walk is recorded as owed in the plan.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('#1629: both waiting-on-an-answer labels carry the route\'s answerNote', () => {
  const hits = PAGE.match(/is waiting on an answer'\s*\n\s*\+ \(body\.answerNote \? ', but not one typed here: ' \+ body\.answerNote : '\.'\)/g) || [];
  assert.equal(hits.length, 2, 'the agent page and the project room, and no third copy');
  // Control: the label sites still exist as sites (the regex can find its subject).
  assert.ok((PAGE.match(/is waiting on an answer/g) || []).length >= 4);
});

test('#1629: the note reaches the page as text, never markup', () => {
  // Both labels are assigned through textContent on the line the note joins.
  const sites = PAGE.split('\n').filter((l) => /body\.answerNote \?/.test(l));
  assert.equal(sites.length, 2);
  const assigns = PAGE.split('\n').filter((l) => /(qlab|qLabel)\.textContent = name \+ ' is waiting on an answer'$/.test(l));
  assert.equal(assigns.length, 2, 'each note line follows a textContent assignment');
});
