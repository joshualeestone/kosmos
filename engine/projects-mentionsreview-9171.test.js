'use strict';
require('../test-support/tmpscope'); // required first in every suite file (#9104)
/* kosmos#9171: mentionsReview says whether a role NAMES review or QA, so `kosmos project role` can say when such a role
 * still gets Assigner tasks (reviewOnlyHere false). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mentionsReview, reviewOnlyHere } = require('./projects');

const only = (role) => reviewOnlyHere({ rolesHere: { a: role } }, 'a');

test('#9171: roles that name review or QA but are not review only', () => {
  for (const role of ['QA only on mobile', 'reviews the builders\' work', 'builds and reviews', 'Reviewer and docs', 'not QA only', 'code reviewing, then building'])
    assert.ok(mentionsReview(role) && !only(role), role);
});

test('#9171: a role that rules review OUT is still flagged (accepted: the line it gets is conditional advice)', () => {
  for (const role of ['not a reviewer', 'never reviews, only builds']) assert.ok(mentionsReview(role) && !only(role), role);
});

test('#9171: the review-only forms name review too (the route sends only reviewOnly for them)', () => {
  for (const role of ['QA only', 'Review only', 'reviewer', 'code reviewer', 'only reviews']) assert.ok(mentionsReview(role) && only(role), role);
});

test('#9171: roles that name neither, and non-strings, are not flagged', () => {
  for (const role of ['Builder', 'Docs and copy', 'quality lead', 'Qatar desk', 'preview builds', '', null, undefined, 42]) assert.equal(mentionsReview(role), false, String(role));
});
