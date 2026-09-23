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

test('#1629: the waiting-on-an-answer label carries the route\'s answerNote', () => {
  // #3419 removed the AGENT-PAGE "waiting on an answer" needs_you label (its
  // question is an ordinary thread bubble now, and the box carries the
  // folder-trust recovery label instead). Only the PROJECT ROOM still shows this
  // wording, so the answerNote-ternary pattern appears ONCE, not twice.
  const hits = PAGE.match(/is waiting on an answer'\s*\n\s*\+ \(body\.answerNote \? ', but not one typed here: ' \+ body\.answerNote : '\.'\)/g) || [];
  assert.equal(hits.length, 1, 'the project room, and no second copy (the agent page dropped this label in #3419)');
  // The #1629 guarantee on the AGENT page is now delivered through the
  // folder-trust recovery label, which still puts answerNote on screen as text.
  assert.match(PAGE, /qlab\.textContent = name \+ ' is stuck on a folder-trust prompt\. ' \+ body\.answerNote;/,
    'the agent page stopped surfacing answerNote to the person (via the folder-trust label)');
  // Control: the label site still exists (the regex can find its subject).
  assert.ok((PAGE.match(/is waiting on an answer/g) || []).length >= 2);
});

test('#1629: the note reaches the page as text, never markup', () => {
  // The project-room label joins the note through textContent on the line it sits on.
  const sites = PAGE.split('\n').filter((l) => /body\.answerNote \?/.test(l));
  assert.equal(sites.length, 1, 'the project room (the agent page dropped its waiting label in #3419)');
  const assigns = PAGE.split('\n').filter((l) => /(qlab|qLabel)\.textContent = name \+ ' is waiting on an answer'$/.test(l));
  assert.equal(assigns.length, 1, 'the note line follows a textContent assignment');
  // The agent page's answerNote also reaches the page as text, via the folder-trust
  // recovery label -- textContent, never innerHTML.
  assert.match(PAGE, /qlab\.textContent = name \+ ' is stuck on a folder-trust prompt\. ' \+ body\.answerNote;/,
    'the agent-page answerNote must reach the page through textContent, never markup');
});
