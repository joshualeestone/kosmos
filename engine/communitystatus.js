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
 * name in the request, so one agent never sees another's items. Only AGENT-authored rows (the sweep's own rule): a
 * person's site post stored under the same name is not this agent's and is never sent.
 *
 * Every word here must be true of what the send layer will do (review 1): an item the sweep will never send is never
 * called "queued" or "waiting".
 */
const fs = require('node:fs');
const communitystore = require('./communitystore');
const communitysend = require('./communitysend');

const SHOWN = 20;   // the newest items listed; the rest are counted

/* What each state means to the agent, in its words. A state without words reads "unknown (<state>)"; a test reads
   every state this file and the send layer can produce and asserts each has words. */
const POST_WORDS = Object.freeze({
  queued: 'queued: Kosmos sends it on its next pass, within a few minutes',
  capped: 'waiting: the community\'s daily limit for this agent is reached, so Kosmos sends it after the limit lifts',
  name_unclaimed: 'waiting: an earlier try made a community account under this agent\'s name and Kosmos never received its key, so it waits rather than go out under a second name',
  sent: 'in the community',
  sent_refused: 'in the community; the community has since refused this agent, so nothing more it writes is sent',
  taken_down: 'taken down by the community\'s moderators',
  unconfirmed: 'sent, but the community did not confirm it; it may already be there, so do not post it again',
  withheld: 'not sent: your person removed it before it went',
  refused: 'not sent: the community refused it',
  refused_empty: 'not sent: it had no text to send',
  unreadable: 'Kosmos cannot read its send records just now, so it cannot say; do not send it again, and look again shortly',
  paused: 'waiting: Kosmos is not sending to the community right now; do not send it again',
  address_refused: 'waiting: this board\'s community address is not one Kosmos sends to, so nothing goes until that is fixed',
  agent_refused: 'not sent: the community has refused this agent, so nothing it writes is sent',
  deleted: 'removed from the community by your person',
  not_sent: 'not sent: Kosmos was not sending to the community when it was made, and it will not go',
  held: 'held for your person to look at; it goes out only if they release it',
  before_on: 'not sent, and it will not be: the community was switched off before it went out; post it again once your person turns the community on',
});
const COMMENT_WORDS = Object.freeze(Object.assign({}, POST_WORDS, {
  sending: 'being sent now',
  unconfirmed: 'sent, but the community did not confirm it; it may already be there, so do not send it again',
}));

/* The send layer's files, read raw so a MISSING file (nothing recorded yet: empty) is told from a CORRUPT one (null:
   then nothing can be said, rather than calling every sent item "queued"). Review 2: per half, as the sweep's passes
   need them: a broken comment record costs the comments' answers, never the posts'; a broken post record costs both,
   because the sweep stops before its comment pass (review 3). */
function readRecord(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) { return err && err.code === 'ENOENT' ? {} : null; }
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}
function readRecords() {
  const p = communitysend._paths;
  const r = (f) => readRecord(f());
  const state = r(p.stateFile);
  const keys = r(p.keysFile);
  const shared = state !== null && keys !== null;
  return { state: state || {}, keys: keys || {},
    postsOk: shared && r(p.sentFile) !== null && r(p.deletesFile) !== null,
    // Review 3: the sweep stops before the comment pass when a POST record is unreadable, so comments need both halves.
    commentsOk: shared && r(p.sentFile) !== null && r(p.deletesFile) !== null
      && r(p.commentsSentFile) !== null && r(p.commentDeletesFile) !== null };
}

const madeAt = (x) => String(x.releasedAt || x.receivedAt || '');
const byAgent = (x, sessionName) => x && x.agent === sessionName && x.author && x.author.type === 'agent';

/**
 * One item's state. `rec` is the send layer's status for it (statuses() / commentRecords()), or undefined when the
 * layer has not met it yet. `ctx`: { on, since, key (this agent's keys entry, read only for its refusal and caps), now }.
 */
function stateOf(kind, rec, item, ctx) {
  if (kind === 'comment' && item.notSent === true) return 'not_sent';   // the route told the agent it will not go
  const st = rec && rec.state;
  if (st && st !== 'pending') {
    if (rec.takenDown) return 'taken_down';
    if (st === 'sent' && rec.agentRefused) return 'sent_refused';
    if (st === 'refused' && Array.isArray(rec.reasons) && rec.reasons.includes('empty')) return 'refused_empty';
    return st;
  }
  // Not sent yet. Each check below is one the sweep makes before sending (communitysend sendPost / sendComment).
  if ((rec && rec.agentRefused) || (ctx.key && ctx.key.refused)) return 'agent_refused';
  // OFF ends the ON period at once and the next ON starts a new one from that moment, so an unsent item is never sent.
  // Review 2: unless the period's start is still recorded (ending it is best effort, and an unreadable switch reads OFF
  // without ending it): then it goes if sending resumes first, so it is waiting, never "post it again".
  if (!ctx.on) return ctx.since && madeAt(item) >= ctx.since ? 'paused' : 'before_on';
  // The sweep sends only items made at or after the ON period's recorded start (`since`). The post and comment routes
  // record it before they store, so an item with no start before it was made before the person turned it on.
  if (!ctx.since || madeAt(item) < ctx.since) return 'before_on';
  if (!ctx.addressOk) return 'address_refused';   // the sweep sends nothing to an address that is not https (or local)
  // Review 2: from the key itself, so a post the sweep has not met yet, and every comment, read it too (#4800).
  if ((rec && rec.agentNameUnclaimed) || (ctx.key && !ctx.key.apiKey && ctx.key.registering && ctx.key.registering.taken)) return 'name_unclaimed';
  const cap = ctx.key && (kind === 'post' ? ctx.key.retryAt : ctx.key.commentRetryAt);
  if (typeof cap === 'string' && Date.parse(cap) > ctx.now) return 'capped';
  return 'queued';
}

/**
 * The agent's items, newest first: [{ kind: 'post' | 'comment', id, title, at, state }]. Held and quarantined rows (the
 * safety check stopped them for the person) are listed as held. An item whose send records cannot be read is
 * 'unreadable'. Null only if reading throws.
 */
function itemsFor(sessionName, now = Date.now()) {
  if (typeof sessionName !== 'string' || !sessionName) return [];
  const recs = readRecords();
  let postStatus = null;
  let commentStatus = null;
  try {
    if (recs.postsOk) postStatus = communitysend.statuses();
    if (recs.commentsOk) commentStatus = communitysend.commentRecords();
  } catch { return null; }
  const ctx = { on: communitysend.switchOn(), since: typeof recs.state.since === 'string' ? recs.state.since : null,
    key: recs.keys[sessionName] || null, now, addressOk: communitysend.endpointAllowed() };
  const out = [];
  for (const p of communitystore.publishedPosts()) {
    if (!byAgent(p, sessionName)) continue;
    out.push({ kind: 'post', id: p.id, title: communitysend.titleFor(p), at: madeAt(p),
      state: postStatus ? stateOf('post', postStatus[p.id], p, ctx) : 'unreadable' });
  }
  for (const c of communitystore.serviceComments()) {
    if (!byAgent(c, sessionName) || c.status !== 'published') continue;
    out.push({ kind: 'comment', id: c.id, title: communitysend.titleFor({ body: c.body }), at: madeAt(c),
      state: commentStatus ? stateOf('comment', commentStatus[c.id], c, ctx) : 'unreadable' });
  }
  // Held or quarantined: the safety check stopped it for the person (feedpublish). Every row, not a capped page. Both
  // read "held", as the post route tells the submitter (which one is never said: not a scrubber oracle). Review 2: a
  // held comment is listed only when it is on a community post; one on this board's own posts is never sent there.
  for (const r of communitystore.moderationQueue({ limit: Infinity })) {
    if (!byAgent(r, sessionName) || (r.entry === 'comment' && !r.remotePostId)) continue;
    out.push({ kind: r.entry === 'comment' ? 'comment' : 'post', id: r.id,
      title: communitysend.titleFor(r.entry === 'comment' ? { body: r.body } : r), at: madeAt(r), state: 'held' });
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

/* Posts that will still go out on their own (or once the person releases them). Not "unconfirmed": that may be there. */
const WAITING = new Set(['queued', 'capped', 'name_unclaimed', 'held', 'paused']);

/** How many of the agent's posts are on their way to the community, for --replies. */
function waitingPosts(sessionName) {
  const items = itemsFor(sessionName);
  if (!items) return 0;
  return items.filter((x) => x.kind === 'post' && WAITING.has(x.state)).length;
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
