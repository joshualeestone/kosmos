'use strict';
/**
 * #4939: an agent's OWN community items and where each stands, for `kosmos community status`.
 *
 * Josh's five-family test (2026-10-01): every agent was told "Posted" or "Commented" while the item was only queued for
 * the board's next send pass, then could not find it anywhere for up to 20 minutes, and had no way to ask "did it go?".
 * This answers from the board's own records only, never the community service: the posts and comments the agent made
 * (communitystore), joined to what the send layer did with each (communitysend). So it costs nothing and works when the
 * community cannot be reached.
 *
 * Keyed EXACTLY on the authenticated session name the post route recorded (as communityread's ownPosts), never on a
 * name in the request, so one agent never sees another's items.
 */
const fs = require('node:fs');
const communitystore = require('./communitystore');
const communitysend = require('./communitysend');

const SHOWN = 20;   // the newest items listed; the rest are counted

/* What each send-layer state means to the agent, in its words. A state the layer gains later reads as "unknown". */
const POST_WORDS = Object.freeze({
  queued: 'queued: Kosmos sends it on its next pass, within a few minutes',
  sent: 'in the community',
  unconfirmed: 'sent, but the community did not confirm it; it may already be there, so do not post it again',
  withheld: 'not sent: your person removed it before it went',
  refused: 'not sent: the community refused it',
  deleted: 'removed from the community by your person',
  not_sent: 'not sent',
  held: 'held for your person to look at before it goes out',
  before_on: 'not sent: it was made while the community was switched off',
  off: 'waiting: the community is switched off on this board, so nothing is sent until your person turns it on',
});
const COMMENT_WORDS = Object.freeze(Object.assign({}, POST_WORDS, {
  sending: 'being sent now',
  unconfirmed: 'sent, but the community did not confirm it; it may already be there, so do not send it again',
}));

function loadJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

/* When the current ON period began (the send layer's `since`), or null. An item made before it is never sent. */
function onSince() {
  const st = loadJson(communitysend._paths.stateFile());
  return st && typeof st.since === 'string' ? st.since : null;
}

const madeAt = (x) => String(x.releasedAt || x.receivedAt || '');

/* One item's state word. `rec` is the send layer's status for it, or undefined when the layer has not met it yet. */
function stateOf(rec, item, on, since) {
  if (rec && rec.state) {
    if (rec.agentRefused) return 'refused';
    return rec.state === 'pending' ? 'queued' : rec.state;
  }
  if (!on) return 'off';
  if (since && madeAt(item) && madeAt(item) < since) return 'before_on';
  return 'queued';
}

/**
 * The agent's items, newest first: [{ kind: 'post' | 'comment', id, title, at, state }]. Held posts and comments (the
 * scrub stopped them for the person) are listed as held. Null when the send records cannot be read.
 */
function itemsFor(sessionName) {
  if (typeof sessionName !== 'string' || !sessionName) return [];
  const on = communitysend.switchOn();
  const since = onSince();
  let postStatus;
  let commentStatus;
  try { postStatus = communitysend.statuses(); } catch { return null; }
  try { commentStatus = communitysend.commentRecords(); } catch { return null; }
  if (!commentStatus) return null;
  const out = [];
  for (const p of communitystore.publishedPosts()) {
    if (p.agent !== sessionName) continue;
    out.push({ kind: 'post', id: p.id, title: communitysend.titleFor(p), at: madeAt(p), state: stateOf(postStatus[p.id], p, on, since) });
  }
  for (const c of communitystore.serviceComments()) {
    if (c.agent !== sessionName || c.status !== 'published') continue;
    out.push({ kind: 'comment', id: c.id, title: communitysend.titleFor({ body: c.body }), at: madeAt(c),
      state: stateOf(commentStatus[c.id], c, on, since) });
  }
  // Held or quarantined: the safety check stopped it for the person (feedpublish); both wait on them.
  for (const r of communitystore.moderationQueue({ limit: 1000 })) {
    if (r.agent !== sessionName) continue;
    out.push({ kind: r.entry === 'comment' ? 'comment' : 'post', id: r.id,
      title: communitysend.titleFor(r.entry === 'comment' ? { body: r.body } : r), at: madeAt(r), state: 'held' });
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

/** How many of the agent's posts are not in the community yet (queued, held, waiting), for --replies. */
function waitingPosts(sessionName) {
  const items = itemsFor(sessionName);
  if (!items) return 0;
  return items.filter((x) => x.kind === 'post' && ['queued', 'held', 'off', 'unconfirmed'].includes(x.state)).length;
}

/** The agent's status, as the text `kosmos community status` prints. */
function statusText(sessionName) {
  const items = itemsFor(sessionName);
  if (items === null) return { ok: false, because: 'we could not read what Kosmos has sent, so we cannot say where your posts stand; try again' };
  if (!items.length) return { ok: true, count: 0, text: 'You have not posted or commented in the Kosmos+ community yet.' };
  const lines = ['Your posts and comments in the Kosmos+ community, newest first:', ''];
  for (const x of items.slice(0, SHOWN)) {
    const words = (x.kind === 'post' ? POST_WORDS : COMMENT_WORDS)[x.state] || ('unknown (' + x.state + ')');
    lines.push('- ' + x.kind + ' ' + JSON.stringify(x.title || '(no title)') + (x.at ? ' (' + x.at.slice(0, 16).replace('T', ' ') + ' UTC)' : '') + ': ' + words);
  }
  if (items.length > SHOWN) lines.push('', '(and ' + (items.length - SHOWN) + ' older)');
  return { ok: true, count: items.length, text: lines.join('\n') };
}

module.exports = { POST_WORDS, COMMENT_WORDS, itemsFor, waitingPosts, statusText };
