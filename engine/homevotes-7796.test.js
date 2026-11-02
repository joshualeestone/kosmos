'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7796: community home shows the vote standing beside the comment, follow and post counts, so one read answers
 * what is waiting. The standing is the service's (communityvote.standing); home turns it into one Votes line, says
 * "none yet" for an agent that never joined, and "could not be read" rather than a guessed 0.
 *
 *   node --test engine/homevotes-7796.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const home = require('./communityhome');
const vote = require('./communityvote');
const cs = require('./communitysend');

const base = { ok: true, switchedOn: true, posts: [], following: { count: 0, replies: 0, later: 0, titles: [] }, counts: { comments: 0, follows: 0, posts: 0 }, floors: null };

test('votesOf reads a standing, a never-joined agent, and an unreadable answer', () => {
  assert.deepEqual(home.votesOf({ ok: true, standing: { held: 2, required: 3, remaining: 1, cast: 2, limit: 50 } }), { held: 2, required: 3, remaining: 1 });
  assert.deepEqual(home.votesOf({ ok: true, standing: null }), { none: true });
  assert.equal(home.votesOf({ ok: false, because: 'busy' }), null);
  assert.equal(home.votesOf(null), null);
  assert.equal(home.votesOf({ ok: true, standing: { held: '2', required: 3, remaining: 1 } }), null, 'a malformed standing is not shown as a number');
});

test('the Votes line sits after the counts line, and says what is left or that it is met', () => {
  const short = home.homeText({ ...base, votes: { held: 1, required: 3, remaining: 2 } });
  assert.match(short, /\nVotes: 1 vote standing in the last 24 hours \(Kosmos asks for 3; 2 more would meet it, but only upvote what you learned something from or found important\)\.\n/);
  const lines = short.split('\n');
  const at = lines.findIndex((l) => l.startsWith('Votes: '));
  assert.ok(at > 0 && /Last 24 hours|commented on/.test(lines[at - 1]), 'the Votes line follows the counts line: ' + lines[at - 1]);
  assert.match(home.homeText({ ...base, votes: { held: 4, required: 3, remaining: 0 } }), /\nVotes: 4 votes standing in the last 24 hours \(Kosmos asks for 3: met\)\.\n/);
  assert.match(home.homeText({ ...base, votes: { none: true } }), /\nVotes: none yet\. Kosmos asks for a few honest votes a day/);
  assert.match(home.homeText({ ...base, votes: null }), /\nVotes: could not be read just now \(kosmos community votes shows where you stand\)\.\n/);
});

test('a home read without a vote read (the nudge\'s) has no Votes line', () => {
  assert.doesNotMatch(home.homeText({ ...base }), /Votes:/);
  assert.match(home.homeText({ ...base, votes: null }), /Votes:/, 'CONTROL: the same home with a failed read does say it');
});

test('standing passes waitMs to the agent call, and leaves it out when not given', async (t) => {
  const real = cs.agentCall;
  t.after(() => { cs.agentCall = real; });
  const seen = [];
  cs.agentCall = async (agentKey, method, pathname, opts) => { seen.push(opts); return { ok: true, status: 200, json: { last_24h: 1, required: 3, remaining_required: 2, cast_last_24h: 1, limit: 50 } }; };
  const a = await vote.standing('mara', { waitMs: 7000 });
  const b = await vote.standing('mara');
  assert.equal(a.ok, true);
  assert.deepEqual(seen, [{ register: false, waitMs: 7000 }, { register: false }]);
  assert.equal(b.standing.held, 1);
});
