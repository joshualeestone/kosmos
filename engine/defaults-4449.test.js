'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4449: agents are told the installed Kosmos is not theirs to edit, in a section of its OWN, so an agent that
 * already exists is offered it too (defaults.missingFrom matches by heading). A tester's board on prod went stale
 * after an agent edited a file inside the installed app.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const defaults = require('./defaults');

const HEADING = '### Kosmos itself is not yours to edit';

test('#4449: the section says where, why, and what to do instead', () => {
  const s = defaults.sections().find((x) => x.heading === HEADING);
  assert.ok(s, 'the section is gone');
  const text = s.text.replace(/\s+/g, ' ');
  assert.match(text, /~\/\.local\/share\/kosmos/, 'it no longer names the folder an agent would recognise');
  assert.match(text, /every agent on this computer/, 'it no longer says why: the board is shared');
  assert.match(text, /say so and describe it/, 'it no longer says what to do instead');
  assert.match(text, /wherever it is installed/, 'it names only the Mac folder, so a Windows agent has nothing to go on');
  assert.match(text, /Updating Kosmos with its own update or its install line is fine/,
    'an agent asked to update Kosmos would read this as a refusal');
  assert.doesNotMatch(s.text, /—/, 'an em dash in agent-facing copy');
});

test('#4449: an agent created before this section exists is offered it (a new heading, not an edit inside one)', () => {
  const before = defaults.sections().filter((x) => x.heading !== HEADING).map((x) => x.text).join('\n');
  const missing = defaults.missingFrom(before).map((x) => x.heading);
  assert.deepEqual(missing, [HEADING], 'an existing agent would not be offered the section');
  assert.deepEqual(defaults.missingFrom(defaults.block()), [], 'CONTROL: a full block is missing nothing');
});
