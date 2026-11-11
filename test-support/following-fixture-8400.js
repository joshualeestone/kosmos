'use strict';
/**
 * kosmos#8400: ONE Following feed fixture for the three places that count it (the nudge and home in
 * engine/communityhome-5212.test.js, read --following in engine/communityfollow.test.js), so all three are checked
 * against the same items and the same expected numbers.
 *
 * Relative to `now`: two new posts, one post from the last day the agent already commented on (seen), one post from the
 * last day with an id Kosmos cannot record (uncounted), one older post, three replies from the last day and one older
 * reply. EXPECTED is what communityhome.tallyFollowing must say for it; SEEN_POST is the post to record as commented on.
 */
const H = 60 * 60 * 1000;
const uuid = (n) => '84000000-0000-4000-8000-' + String(n).padStart(12, '0');

const SEEN_POST = uuid(3);
const EXPECTED = Object.freeze({ newPosts: 2, seenPosts: 1, uncounted: 1, olderPosts: 1, replies: 3, olderReplies: 1 });

function items(now) {
  const at = (h) => new Date(now - h * H).toISOString();
  const post = (n, h, id = uuid(n)) => ({ kind: 'post', id, agent: { name: 'Echo Two' }, created_at: at(h), channel: 'engineering', sub_channel: null,
    body: 'Post ' + n + ' body.', post: { id, title: 'Post ' + n, agent: { name: 'Echo Two' }, comment_count: 0 }, parent_id: null });
  const reply = (n, h, on) => ({ kind: 'reply', id: uuid(100 + n), agent: { name: 'quill' }, created_at: at(h), channel: 'engineering', sub_channel: null,
    body: 'Reply ' + n + '.', post: { id: on, title: 'Elsewhere ' + n, agent: { name: 'Echo Two' }, comment_count: 1 }, parent_id: null });
  // Newest first, as the service's feed is.
  return [
    reply(1, 0.5, uuid(50)),
    post(1, 1),
    reply(2, 1.5, uuid(51)),
    post(2, 2),
    reply(3, 2.5, uuid(52)),
    post(3, 3),                       // SEEN_POST: commented on from this board
    post(4, 4, 'not-a-uuid-8400'),    // an id no read can record
    reply(4, 30, uuid(53)),           // older than a day
    post(5, 30),                      // older than a day
  ];
}

/* A deeper feed, two pages of the read: ten replies on the newest page, then five new posts behind it, so the read
   shows POSTS_WANTED of them and leaves the rest behind. EXPECTED_DEEP is home's tally of the same items. */
const EXPECTED_DEEP = Object.freeze({ newPosts: 5, seenPosts: 0, uncounted: 0, olderPosts: 0, replies: 10, olderReplies: 0 });
function deepPages(now) {
  const at = (h) => new Date(now - h * H).toISOString();
  const reply = (n) => ({ kind: 'reply', id: uuid(200 + n), agent: { name: 'quill' }, created_at: at(n * 0.1), channel: 'engineering', sub_channel: null,
    body: 'Reply ' + n + '.', post: { id: uuid(300 + n), title: 'Elsewhere ' + n, agent: { name: 'Echo Two' }, comment_count: 1 }, parent_id: null });
  const post = (n) => ({ kind: 'post', id: uuid(400 + n), agent: { name: 'Echo Two' }, created_at: at(2 + n), channel: 'engineering', sub_channel: null,
    body: 'Deep post ' + n + '.', post: { id: uuid(400 + n), title: 'Deep ' + n, agent: { name: 'Echo Two' }, comment_count: 0 }, parent_id: null });
  return [Array.from({ length: 10 }, (_, i) => reply(i + 1)), Array.from({ length: 5 }, (_, i) => post(i + 1))];
}

module.exports = { items, EXPECTED, SEEN_POST, uuid, deepPages, EXPECTED_DEEP };
