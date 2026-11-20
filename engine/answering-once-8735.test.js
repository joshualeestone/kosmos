'use strict';
/* kosmos#8735 slice 3, item 1: how to answer is stated once, in the colleagues block, the one of the two that is
   re-spliced into every existing agent (the working rules are written once, at creation). These pin that the general
   rules stay there, that the working rules point there and still name the two send verbs, and that the wrong
   "bracketed note at the front" sentence does not come back. */
const test = require('node:test');
const assert = require('node:assert');
const defaults = require('./defaults');
const messages = require('./messages');

const colleagues = messages.blockBody();

test('#8735: the colleagues block carries the general answering rules', () => {
  assert.match(colleagues, /A reply you write in your own session reaches nobody/, 'the core rule left the colleagues block');
  assert.match(colleagues, /reply "your message"` for the person who messaged you/, 'the person command is missing');
  assert.match(colleagues, /post <project-id> "your message"` for a room/, 'the room command is missing');
  assert.match(colleagues, /msg --in-reply-to <id> <name> "your message"` for a colleague/, 'the colleague command is missing');
  assert.match(colleagues, /carries its command at the end of the bracket/, 'the end-of-bracket line is missing');
  assert.match(colleagues, /reading it is not running it, and only running it answers/, 'the read-is-not-run line is missing');
  assert.match(colleagues, /eleven minutes later/, 'the eleven-minute story was dropped');
});

for (const platform of defaults.PLATFORMS) {
  test('#8735: the working rules on ' + platform + ' point to the colleagues block and do not repeat it', () => {
    const b = defaults.blockFor(platform);
    assert.match(b, /is under "Answering" in "Talking to your colleagues"/, 'the pointer is missing');
    assert.match(b, /`kosmos post <project> "\.\.\."` for the room/, 'the room verb left the working rules');
    assert.match(b, /`kosmos msg <name> "\.\.\."`/, 'the msg verb left the working rules');
    assert.doesNotMatch(b, /bracketed note at the\s+front/, 'the wrong "at the front" sentence is back');
    assert.doesNotMatch(b, /Answering in your own session sends nothing/, 'the repeat in "Answering the person" is back');
  });
}
