"use strict";
/**
 * #4873 (Josh, 2026-10-01): agents start a message with their own name ("Dario: ...") under a header that already
 * says Dario. The board drops that prefix when drawing a room post or an agent's DM row: only the sender's own name,
 * only at the very start. The rule is run as the page has it (sliced out of web/index.html), not as a copy.
 *
 *   node --test web.selfname-4873.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const at = PAGE.indexOf('function pjDropSelfName');
const SRC = PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 3);
// eslint-disable-next-line no-new-func
const drop = new Function(SRC + '\nreturn pjDropSelfName;')();

test('#4873: the sender\'s own name at the start is dropped, in the shapes agents write it', () => {
  assert.ok(at > 0, 'pjDropSelfName is not in the page');
  const who = ['Dario', 'dario-claude'];
  assert.equal(drop('Dario: Anthropic, running on Claude Code.', who), 'Anthropic, running on Claude Code.');
  assert.equal(drop('**Dario:** hello', who), 'hello');
  assert.equal(drop('**Dario**: hello', who), 'hello');
  assert.equal(drop('dario - hello', who), 'hello', 'case and a dash');
  assert.equal(drop('Dario – hello', who), 'hello', 'an en dash');
  assert.equal(drop('  Dario:hello', who), 'hello', 'leading space, no space after the colon');
  assert.equal(drop('dario-claude: hello', who), 'hello', 'the machine name counts too');
  assert.equal(drop('Dario: line one\nline two', who), 'line one\nline two', 'the rest of the message is kept whole');
});

test('#4873 CONTROLS: another name, a name later on, a bare name and a longer word are all left alone', () => {
  const who = ['Dario'];
  assert.equal(drop('Sam: hello', who), 'Sam: hello', 'another agent\'s name was dropped');
  assert.equal(drop('Thanks Dario: noted', who), 'Thanks Dario: noted', 'a name not at the start was dropped');
  assert.equal(drop('Dario:', who), 'Dario:', 'a message that is only the name was emptied');
  assert.equal(drop('Darios: hello', who), 'Darios: hello', 'a longer word starting with the name was cut');
  assert.equal(drop('Dario said: hello', who), 'Dario said: hello', 'a sentence starting with the name was cut');
  assert.equal(drop('**Dario** said hello', who), '**Dario** said hello');
  assert.equal(drop('Dario: hi', []), 'Dario: hi', 'no names, no change');
  assert.equal(drop('Dario-style answers: hi', who), 'Dario-style answers: hi', 'a hyphenated word starting with the name was cut');
  assert.equal(drop('dario-claude did it', ['Dario', 'dario-claude']), 'dario-claude did it', 'the machine name with no separator was cut');
  assert.equal(drop('Da.io: hi', ['Da.io']), 'hi', 'a name with a regex character is matched literally');
  assert.equal(drop('Daxio: hi', ['Da.io']), 'Daxio: hi', 'a regex character in a name matched something else');
});

test('#4873: the room and an agent\'s DM row both draw through it; the person\'s own rows do not', () => {
  const room = PAGE.slice(PAGE.indexOf('function pjRoomBody'), PAGE.indexOf('function pjRoomBody') + 900);
  assert.match(room, /if \(m && m\.operator !== true && m\.from\) \{\s*const keys = pjMentionKeys\(p\);\s*words = pjDropSelfName\(words, \[keys && keys\.get \? keys\.get\(m\.from\) : null, m\.from\]\);/,
    'a room post no longer drops its sender\'s name, or a person\'s post now does');
  assert.match(PAGE, /pjRich\(typeof pjDropSelfName === 'function' \? pjDropSelfName\(pjWords\(m\), \[shownFrom, m\.from\]\) : pjWords\(m\)\)/,
    'an agent\'s DM row no longer drops its own name');
  assert.equal((PAGE.match(/pjDropSelfName\(/g) || []).length, 3, 'pjDropSelfName is called from somewhere new, or lost a caller');
});
