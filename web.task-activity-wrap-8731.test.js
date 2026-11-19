"use strict";
/**
 * #8731: on a task page, the activity row (.tkact .tkact-what) did not wrap one unbroken token, so a check report
 * or message holding a long path or a URL with a query ran off the page. Measured on served 0.8.10: a 392-character
 * token gave the row a scrollWidth of 2539 in a 689px box, while the check row (.why) wrapped the same report.
 *
 * This pins the rule that WINS (test-support/cascade, #1476), not the first one written, so a later same-selector
 * rule that put it back to normal goes red. The rendered proof is docs/browser-checks/render-tasks.js, which sends a
 * message with a long token and measures every activity row.
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
