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
 */
const communitystore = require('./communitystore');
const communitysend = require('./communitysend');
const store = require('./store');

/* The one state the owner can delete from: a post already out (sent). withheld/refused
   never left, deleted is done, and a delete already asked for is on its way.
   Not 'pending': the send layer never SAVES a pending record (a send that fails on the
   network, a 5xx or a 429 is left with no record and retried), so a post waiting to go
   out is not in sent.json and never reaches this list. Offering Delete on a state
   production cannot produce would be a promise with nothing behind it. Letting the
   owner withhold a post before it goes out needs the send layer to expose its due list
   (the `since` cut is internal to it); that is a follow-up, not this card. */
const DELETABLE = Object.freeze(['sent']);

function canDelete(rec) {
  return DELETABLE.includes(rec.state) && rec.deleteRequested !== true && rec.takenDown !== true;
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
  for (const p of communitystore.publicFeed({ sort: 'newest', limit: Number.MAX_SAFE_INTEGER })) {
    if (statuses[p.id]) posts.set(p.id, p);
  }
  const rows = ids.map((id) => {
    const rec = statuses[id];
    const post = posts.get(id) || null;
    return {
      id,
      title: post ? communitysend.titleFor(post) : '',
      agent: post ? agentName(post) : '',
      postedAt: post && typeof post.receivedAt === 'string' ? post.receivedAt : null,
      state: rec.state,
      deleteRequested: rec.deleteRequested === true,
      takenDown: rec.takenDown === true,
      takeDownReason: rec.takeDownReason || null,
      canDelete: canDelete(rec),
    };
  });
  rows.sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
  return rows;
}

module.exports = { mine, canDelete, DELETABLE };
