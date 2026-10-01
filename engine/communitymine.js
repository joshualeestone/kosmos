'use strict';
/**
 * #4313: the board's own view of what its agents put in the public Kosmos Community.
 *
 * One row per post the send layer (#4287) has a record for, joined to the board's own
 * published post for a title, the agent's name and when it was posted. The send layer's
 * record says what happened to it (sent, waiting, withheld, refused, deleted, taken down);
 * this module only reads, and the Delete button goes through communitysend.requestDelete
 * via POST /api/community/delete, so central is always asked with the owner's own key.
 *
 * No keys, no remote ids, no response bodies: the rows carry only what the owner's own
 * board already shows them.
 *
 * #4801: mineComments() does the same for the COMMENTS the agents published on community posts, read from
 * communitysend.commentRecords and the board's own comment rows; removal goes through the same route.
 */
const communitystore = require('./communitystore');
const communitysend = require('./communitysend');
const store = require('./store');

/* The states the owner can delete from, pinned by communitymine.test.js: sent, unconfirmed (no
   answer to the send, so it may be on the server) and pending (waiting for a retry; a delete
   withholds it). Not once a delete is asked for, a moderator took it down, or central refused
   the agent. */
const DELETABLE = Object.freeze(['sent', 'unconfirmed', 'pending']);

function canDelete(st) {
  return DELETABLE.includes(st.state) && st.deleteRequested !== true
    && st.takenDown !== true && st.agentRefused !== true;
}

/* The agent's own display name when it has one (what the owner calls it on this board),
   else the name the post carries. This view is the owner's own board, never public. */
function agentName(post) {
  /* post.agent is the authenticated trust key the send layer itself sends as; the author
     name is the fallback (normalizeAuthor sets it from the same key for agent posts). */
  const who = typeof post.agent === 'string' && post.agent ? post.agent
    : (post.author && typeof post.author.name === 'string' ? post.author.name : '');
  try {
    const p = who ? store.readProfile(who) : null;
    if (p && typeof p.displayName === 'string' && p.displayName.trim()) return p.displayName.trim();
  } catch { /* no profile: fall back to the post's own name */ }
  return who;
}

/** Newest first. A record whose board post is gone still shows, titled from nothing. */
function mine() {
  const statuses = communitysend.statuses();
  const ids = Object.keys(statuses);
  if (!ids.length) return [];
  const posts = new Map();
  for (const p of communitystore.publishedPosts()) {
    if (statuses[p.id]) posts.set(p.id, p);
  }
  const rows = ids.map((id) => {
    const rec = statuses[id];
    const post = posts.get(id) || null;
    return {
      id,
      title: post ? communitysend.titleFor(post) : '',
      agent: post ? agentName(post) : '',
      // A held post goes public when it is released, not when it came in (communitysend's sweep reads it the same way).
      postedAt: post ? (typeof post.releasedAt === 'string' ? post.releasedAt
        : typeof post.receivedAt === 'string' ? post.receivedAt : null) : null,
      state: rec.state,
      deleteRequested: rec.deleteRequested === true,
      takenDown: rec.takenDown === true,
      takeDownReason: rec.takeDownReason || null,
      agentRefused: rec.agentRefused === true,
      deleteRetrying: rec.deleteRequested === true && typeof rec.deleteStatus === 'number',
      // requestDelete refuses an id with no board post (404), so no Delete without one.
      canDelete: post !== null && canDelete(rec),
    };
  });
  rows.sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
  return rows;
}

/* #4801: a comment can be removed only while the service can be asked about it: sent with the id the service answered
   with, or pending (not tried yet; a removal withholds it). An unconfirmed comment (tried, no answer) or one sent with
   no id cannot: the service has no list of an agent's comments to find it in. Pinned by communitycommentmine-4801.test.js. */
function canDeleteComment(st) {
  return (st.traceable === true || st.state === 'pending') && st.deleteRequested !== true && st.agentRefused !== true;
}

/**
 * #4801: one row per comment the send layer has a record for (or the owner asked to remove), joined to the board's
 * own comment row for its text, agent and time. Newest first. The same no-remote-ids rule as mine() for the comment
 * itself: `untraceable` says only that the service never gave Kosmos a handle on it, so the page can say why there is
 * no Delete. The one service id carried is the POST's (`remotePostId`), which is public: the row links to the post
 * the comment is on, as the #4525 held list does. `traceUnknown`: keys.json could not be read, so whether the board
 * still holds the registration that sent it is not known (review 1).
 * Review 2: null when the comment records cannot be read (commentRecords is null): unknown, never "none".
 */
function mineComments() {
  const recs = communitysend.commentRecords();
  if (!recs) return null;
  const ids = Object.keys(recs);
  if (!ids.length) return [];
  const rows = new Map();
  for (const c of communitystore.serviceComments()) if (recs[c.id]) rows.set(c.id, c);
  const out = ids.map((id) => {
    const rec = recs[id];
    const c = rows.get(id) || null;
    return {
      id,
      kind: 'comment',
      // The first line, cut and scrubbed as a post's title is (titleFor reads a body with no topic that way).
      text: c ? communitysend.titleFor({ body: c.body }) : '',
      agent: c ? agentName(c) : '',
      postedAt: c ? (typeof c.releasedAt === 'string' ? c.releasedAt
        : typeof c.receivedAt === 'string' ? c.receivedAt : null) : null,
      // The post it is on, from the board's own comment row (feedpublish.publishServiceComment), for the page's link.
      remotePostId: c && typeof c.remotePostId === 'string' ? c.remotePostId : null,
      state: rec.state,
      deleteRequested: rec.deleteRequested === true,
      deleteRetrying: rec.deleteRetrying === true,
      agentRefused: rec.agentRefused === true,
      untraceable: rec.state === 'unconfirmed' || (rec.state === 'sent' && rec.traceable === false),
      traceUnknown: rec.state === 'sent' && rec.traceable === null,
      // requestDelete answers 404 for an id with no board comment, so no Delete without one.
      canDelete: c !== null && canDeleteComment(rec),
    };
  });
  out.sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
  return out;
}

module.exports = { mine, mineComments };
