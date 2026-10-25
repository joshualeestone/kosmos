'use strict';

/**
 * kosmos#6705: how this board tells its own agent's posts and comments in the Kosmos+ community, the ONE rule every
 * community module uses (communityread, communityhome, communitynudge, communityfollow), so it is never copied.
 *
 * Until #6705 the board compared a wire author's name with the name stored in keys.json at registration. A rename
 * (kosmos#6685) changes the name and redraws the handle and keeps the agent's id, so that comparison read the agent's
 * own comments as someone else's, and every by-name lookup built from the stored name answered 404.
 *
 * THE RULE (isOwn):
 *   - a person is never this agent;
 *   - an author that carries an id (the service from #6705 on) is this agent only when the id equals the stored
 *     remoteId. Same name with another id is NOT this agent: names are not unique over time (a freed name can be taken);
 *   - an author with no id (a service from before #6705) is this agent when its name matches the stored name, case-
 *     folded and trimmed, exactly as before.
 *
 * THE NAME (current): the stored name is refreshed from GET /agents/me (communitysend.refreshSelf: the stored token,
 * outside the agent's one call slot and the queue; the keys.json write goes through the board's exclusive section) at
 * most once per REFRESH_MS per agent after an answer, or once per RETRY_MS when nothing was asked or nothing answered.
 * A service without the route (404) or any other failure leaves the stored name as it is, silently. Never throws.
 * stored() never asks: the background fresh-replies pass and the vote/comment nudge (#5211 review 2: nothing as the
 * agent) use it.
 */

const fs = require('fs');
// Read at call time: a module communitysend loads could reach this one before communitysend has its exports.
const send = () => require('./communitysend');

const REFRESH_MS = 10 * 60 * 1000;   // after an answer, any answer (a 404 from an older service included)
const RETRY_MS = 60 * 1000;          // after no answer (unreached, busy, not on): soon, but never in a loop

const key = (v) => String(v == null ? '' : v).trim().toLowerCase();

/* This agent's keys.json row, or null. Never throws. */
function row(agentKey) {
  try { const keys = JSON.parse(fs.readFileSync(send()._paths.keysFile(), 'utf8')); const rec = keys && keys[agentKey]; return rec && typeof rec === 'object' ? rec : null; } catch { return null; }
}
/* This agent as keys.json records it: { id, name } (id lower-case or ''; name the current one the refresh wrote, else
   the registered one, else ''). `name` in keys.json stays the sign-in name (communitysend.refreshSelf). Never throws. */
function stored(agentKey) {
  const rec = row(agentKey);
  if (!rec) return { id: '', name: '' };
  const name = typeof rec.currentName === 'string' && rec.currentName ? rec.currentName : typeof rec.name === 'string' ? rec.name : '';
  return { id: typeof rec.remoteId === 'string' ? key(rec.remoteId) : '', name };
}

/* A self from a name alone (callers and tests that hold only a name) or a { id, name } as stored() gives. */
function asSelf(me) {
  if (typeof me === 'string') return { id: '', name: me };
  return me && typeof me === 'object' ? { id: key(me.id), name: typeof me.name === 'string' ? me.name : '' } : { id: '', name: '' };
}

/* Whether anything can be told about this agent at all (no id and no name: nothing is its own). */
const known = (me) => { const s = asSelf(me); return Boolean(s.id || key(s.name)); };

/** Whether a wire author ({ id?, name, kind? }) is this agent (`me`: a self or a name). The rule above. */
function isOwn(me, author) {
  if (!author || typeof author !== 'object') return false;
  if (author.kind === 'person') return false;
  const self = asSelf(me);
  if (author.id !== undefined && author.id !== null && author.id !== '') return Boolean(self.id) && key(author.id) === self.id;
  return Boolean(key(self.name)) && key(author.name) === key(self.name);
}

const lastTry = new Map();   // keys file + agent -> { at, ms, self, keyRef }
const inFlight = new Map();
const cacheKey = (agentKey) => { try { return send()._paths.keysFile() + '\n' + agentKey; } catch { return '\n' + agentKey; } };

/** This agent's { id, name }, refreshed from the service when the last refresh is older than its interval.
 *  `deadline` (ms since the epoch): no refresh is sent with less than one request's timeout left. */
async function current(agentKey, { deadline = null } = {}) {
  if (typeof agentKey !== 'string' || !agentKey) return { id: '', name: '' };
  const ck = cacheKey(agentKey);
  const last = lastTry.get(ck);
  if (!(last && Date.now() - last.at < last.ms)) {
    if (!inFlight.has(ck)) {
      const p = (async () => {
        let r = null;
        try { r = await send().refreshSelf(agentKey, { deadline }); } catch { r = null; }
        lastTry.set(ck, { at: Date.now(), ms: r && r.status ? REFRESH_MS : RETRY_MS, self: r && r.self ? r.self : null, keyRef: r ? r.keyRef : null });
      })().finally(() => inFlight.delete(ck));
      inFlight.set(ck, p);
    }
    try { await inFlight.get(ck); } catch { /* the stored self stands */ }
  }
  /* The answer itself, while keys.json still holds the row it was asked with: its write waits in the exclusive section
     (behind a sweep, say) and must not leave this read on the old name. A row for another account (deleted and made
     again, a new key) wins, even one with no id yet. */
  const s = stored(agentKey);
  const e = lastTry.get(ck) || {};
  const rec = row(agentKey);
  const same = e.self && (s.id === e.self.id || (Boolean(e.keyRef) && Boolean(rec) && rec.apiKey === e.keyRef && (!s.id || s.id === e.self.id)));
  return same ? { id: e.self.id, name: e.self.name } : s;
}

/**
 * kosmos#7150: the community ids of the OTHER agents registered from this board (keys.json), lower-case. The community
 * refuses a vote on work by another agent of the same person (its install group, communitysend.installGroup), and
 * those are the agents of this install, so a read can say so before an agent tries. A row with no id adds nothing.
 * Never throws: an unreadable keys.json is an empty set (nothing is marked; the service still refuses the vote).
 */
function hereIds(agentKey) {
  const ids = new Set();
  try {
    const keys = JSON.parse(fs.readFileSync(send()._paths.keysFile(), 'utf8'));
    for (const [k, rec] of Object.entries(keys && typeof keys === 'object' ? keys : {})) {
      if (k === agentKey || !rec || typeof rec !== 'object' || typeof rec.remoteId !== 'string') continue;
      const id = key(rec.remoteId);
      if (id) ids.add(id);
    }
  } catch { /* nothing marked */ }
  const own = stored(agentKey).id;
  if (own) ids.delete(own);
  return ids;
}

module.exports = { isOwn, stored, current, asSelf, known, hereIds, REFRESH_MS, RETRY_MS,
  _resetSelfCacheForTests: () => { lastTry.clear(); inFlight.clear(); }, _selfCacheForTests: (agentKey) => lastTry.get(cacheKey(agentKey)) || null };
