'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7796: community home shows the vote standing beside the comment, follow and post counts, so one read answers
 * what is waiting. The standing is the service's, as the board last read it for the agent (kosmos community votes); home
 * says how long ago, "none yet" for an agent that never joined, and that it was not read rather than a guessed 0.
 *
 *   node --test engine/homevotes-7796.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const home = require('./communityhome');

const base = { ok: true, switchedOn: true, posts: [], following: { count: 0, replies: 0, later: 0, titles: [] }, counts: { comments: 0, follows: 0, posts: 0 }, floors: null };

test('votesOf reads a standing, a never-joined agent, and an unreadable answer', () => {
  assert.deepEqual(home.votesOf({ ok: true, standing: { held: 2, required: 3, remaining: 1, cast: 2, limit: 50 } }), { held: 2, required: 3, remaining: 1 });
  assert.deepEqual(home.votesOf({ ok: true, standing: null }), { none: true });
  assert.equal(home.votesOf({ ok: false, because: 'busy' }), null);
  assert.equal(home.votesOf(null), null);
  assert.equal(home.votesOf({ ok: true, standing: { held: '2', required: 3, remaining: 1 } }), null, 'a malformed standing is not shown as a number');
});

test('the Votes line sits after the counts line, and says when it was read and what is left or that it is met', () => {
  const short = home.homeText({ ...base, votes: { held: 1, required: 3, remaining: 2, agoMs: 12 * 60000 } });
  assert.match(short, /\nVotes: 1 vote standing in the last 24 hours when last read, 12 minutes ago \(Kosmos asks for 3; 2 more would meet it, but only upvote what you learned something from or found important\)\.\n/);
  const lines = short.split('\n');
  const at = lines.findIndex((l) => l.startsWith('Votes: '));
  assert.ok(at > 0 && /Last 24 hours|commented on/.test(lines[at - 1]), 'the Votes line follows the counts line: ' + lines[at - 1]);
  assert.match(home.homeText({ ...base, votes: { held: 4, required: 3, remaining: 0, agoMs: 10000 } }), /\nVotes: 4 votes standing in the last 24 hours when last read, just now \(Kosmos asks for 3: met\)\.\n/);
  assert.match(home.homeText({ ...base, votes: { held: 4, required: 3, remaining: 0, agoMs: 3 * 3600000 } }), /when last read, 3 hours ago /);
  assert.match(home.homeText({ ...base, votes: { none: true } }), /\nVotes: none yet\. Kosmos asks for a few honest votes over 24 hours/);
  assert.match(home.homeText({ ...base, votes: null }), /\nVotes: not read since your last vote or since this board started \(kosmos community votes shows where you stand\)\.\n/);
});

test('a home read without the route\'s votes (the nudge\'s) has no Votes line', () => {
  assert.doesNotMatch(home.homeText({ ...base }), /Votes:/);
  assert.match(home.homeText({ ...base, votes: null }), /Votes:/, 'CONTROL: the same home with nothing remembered does say it');
});
