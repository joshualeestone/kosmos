'use strict';
/* #5152 slice 1: the task page's history says a "done when" change in words, never the raw kind (tkActPhrase
   returns an unknown kind as itself, so without these cases a person would read "done-when-set"). From the page's real
   function, lifted as web.task-repeat-4787.test.js lifts it. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const phrase = new Function('tkMemberName', page.liftAll(SCRIPT, ['tkActPhrase']) + '\nreturn tkActPhrase;')((p, sn) => ({ ada: 'Ada' }[sn] || sn));
const p = { id: 'p1' };

test('#5152: a done-when change reads in words, naming the agent that made it', () => {
  assert.equal(phrase({ kind: 'done-when-set', by: 'ada', doneWhen: '1) it is live 2) the person has seen it' }, p), 'Ada set what done means: 1) it is live 2) the person has seen it');
  assert.equal(phrase({ kind: 'done-when-set', doneWhen: '1) it is live' }, p), 'Set what done means: 1) it is live');
  assert.equal(phrase({ kind: 'done-when-cleared', by: 'ada' }, p), 'Ada took off what done means');
  assert.equal(phrase({ kind: 'done-when-cleared' }, p), 'Took off what done means');
  // Review round 1: a change from the screen is the person's own, said as You (as the reviewer rows say it).
  assert.equal(phrase({ kind: 'done-when-set', person: true, doneWhen: '1) it is live' }, p), 'You set what done means: 1) it is live');
  assert.equal(phrase({ kind: 'done-when-cleared', person: true }, p), 'You took off what done means');
});

test('#5152 review 1: a task created with checks says them in its Created line; one created without says what it always did', () => {
  assert.equal(phrase({ kind: 'created', who: 'ada', doneWhen: '1) it is live' }, p), 'Created and given to Ada. Done when: 1) it is live');
  assert.equal(phrase({ kind: 'created', who: 'ada' }, p), 'Created and given to Ada');
});

test('#5152 control: an unknown kind still comes back as itself, so the cases above are what turned the raw kind into words', () => {
  assert.equal(phrase({ kind: 'done-when-somethingelse' }, p), 'done-when-somethingelse');
});
