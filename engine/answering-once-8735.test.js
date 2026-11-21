'use strict';
/* kosmos#8735 slice 3, item 1: "Answering the person who messaged you" no longer repeats an earlier section. Neither
   the colleagues block nor the working rules is in every agent's file (the colleagues block is added only to agents made
   from a role template), so each must still state how to answer on its own. These pin that, and that the two repeats
   do not come back. */
const test = require('node:test');
const assert = require('node:assert');
const defaults = require('./defaults');
const doctrine = require('./doctrine');
const messages = require('./messages');

test('#8735: the colleagues block still states how to answer on its own', () => {
  const c = messages.blockBody();
  assert.match(c, /A reply you write in your own session reaches nobody/, 'the core rule left the colleagues block');
  assert.match(c, /msg --in-reply-to <id> <name> "your message"` for a colleague/, 'the colleague command is missing');
  assert.match(c, /carries its command at the end of the bracket/, 'the end-of-bracket line is missing');
  // kosmos#8735 slice 6 (Mona Lisa's read): the eleven-minute story went; "Can you check X?" is the picture that stays.
  assert.match(c, /"Can you check X\?" does not look like an instruction/, 'the picture of the failure was dropped');
});

for (const platform of defaults.PLATFORMS) {
  test('#8735: the working rules on ' + platform + ' state how to answer, the repeats gone', () => {
    const b = defaults.blockFor(platform);
    assert.match(b, /Answering in your own session is answering where nobody can see you/, 'the core rule left the working rules');
    assert.match(b, /the command at the end of its bracket:\s+`kosmos msg --in-reply-to <id> <name> "\.\.\."`/, 'the reply-to command left the working rules');
    assert.match(b, /Reading that command is not\s+running it, and only running it answers/, 'the read-is-not-run rule left the working rules');
    assert.match(b, /When your operator messages you, answer with `kosmos reply "\.\.\."`/, 'the person command left the working rules');
    assert.match(b, /wrote to you, and nor does an answer left in your own session\./, 'the operator case lost the own-session rule');
    assert.doesNotMatch(b, /The message tells you which command to use/, 'the second repeat in "Answering the person" is back');
    assert.doesNotMatch(b, /Answering in your own session sends nothing/, 'the repeat in "Answering the person" is back');
  });
}

test('#8735: an agent made from a person\'s own words, which gets no colleagues block, still learns how to answer', () => {
  const born = doctrine.atBirth('# You are Custom\n\nDo my job.\n', Date.parse('2026-11-20T07:00:00Z'));
  assert.ok(!born.includes('## Talking to your colleagues'), 'fixture: a custom agent now gets the colleagues block, so this test no longer covers the case');
  assert.match(born, /Answering in your own session is answering where nobody can see you/);
  assert.match(born, /`kosmos msg --in-reply-to <id> <name> "\.\.\."`/);
  assert.match(born, /answer with `kosmos reply "\.\.\."`/);
});
