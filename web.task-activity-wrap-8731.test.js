"use strict";
/**
 * #8731: on a task page, the activity row (.tkact .tkact-what) did not wrap one unbroken token, so a check report
 * or message holding a long path or a URL with a query ran off the page.
 *
 * This pins the rule that WINS among rules written with this exact selector (test-support/cascade, #1476), so a later
 * same-selector rule that put it back to normal goes red. It cannot see a more specific selector or a multi-line rule;
 * the rendered guard is docs/browser-checks/render-tasks.js, which sends a message with a long token and measures that
 * message's row against the activity list.
 *
 *   node --test web.task-activity-wrap-8731.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { effective } = require('./test-support/cascade');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('#8731: the task activity row wraps a long unbroken token', () => {
  assert.equal(effective(PAGE, '.tkact .tkact-what', 'overflow-wrap'), 'anywhere',
    'the activity row must wrap anywhere, or one long token in a report runs off the page (#8731)');
  // It still shrinks inside its flex row: overflow-wrap alone cannot help a box that will not get narrower.
  assert.equal(effective(PAGE, '.tkact .tkact-what', 'min-width'), '0');
});
