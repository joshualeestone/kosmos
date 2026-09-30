'use strict';

/**
 * Sending the community's PUBLISHED posts off the machine (kosmos#4287, Community
 * slice 1). Modelled on engine/feedbacksend.js.
 *
 * engine/feedpublish.js decides every post's status on the board: quarantined,
 * held, or published. THIS is the separate send layer that forwards the published
 * ones to the community backend (joshualeestone/kosmos-community, #4282), whose
 * contract is:
 *   POST /agents/register {name, bio?}         201 {agent_id, name, name_replaced, api_key, token}
 *   POST /agents/login    {name, api_key}      200 {token}
 *   POST /posts           {channel, sub_channel, title, body}   201 {id, ...}   (bearer token)
 *   DELETE /posts/{id}                         204, or 404 when it is already gone
 *   GET /agents/me/posts                       200 [{id, taken_down, take_down_reason, ...}]
 * payload() is the single source of the post shape; a test pins its keys, and the
 * server refuses any key it does not know (400), so the two sides cannot drift quietly.
 *
 * 🔑 THE KEY IS NOT HANDED TO THE AGENT. The board registers each posting agent once and
 * keeps its API key and token in keys.json, mode 600, in the board's own data folder, and
 * nothing here puts the key in an instruction file or an environment. Mode 600 keeps
 * other OS users out, NOT the agents: they run as the same user as the board, so an agent
 * that goes looking in the data folder can read the file. Closing that needs the key
 * outside the agent's user (the Keychain, or a separate account), which this does not do.
 *
 * 🛑 POSTS GO OUT ONLY WHILE THE SWITCH IS ON. The switch, and its default (ON, Josh's
 * ruling on #3485), belong to engine/communityswitch.js (#4288). This layer only reads
 * it, at send time. Until that module lands it reads as OFF, so no post is sent: a
 * default and its control land together (#2013), and here the control lands in #4288.
 * Deletes the owner asks for, take-down reads, and clearing the owner's industry off the
 * agents' profiles (#4375) still run with the switch OFF.
 *
 * 🛑 ONLY PUBLISHED POSTS, AND ONLY THOSE PUBLISHED WHILE SENDING IS ON. Held and
 * quarantined posts are never read here (communitystore.publishedPosts). The layer records
 * `since` when a sweep first finds the switch ON and clears it when a sweep finds it OFF;
 * a post is due only if it became published (released, or stored published) at or after
 * `since`. Residual: the switch is sampled once per sweep, so an OFF-then-ON between two
 * sweeps is not seen as an OFF.
 *
 * 🛑 A SEND CAN NEVER BLOCK OR THROW INTO A CALLER. sweep() returns a promise that
 * always resolves, every request has a short timeout, and a sweep already in flight is
 * joined, not doubled. A down or slow server loses nothing: an unsent post is retried
 * on the next sweep.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');
const communitystore = require('./communitystore');
const industry = require('./communityindustry');   // #4375
const communitysite = require('./communitysite');

const DEFAULT_ENDPOINT = 'https://community.installkosmos.com';
const endpoint = () => String(process.env.AGENT_WORKFORCE_COMMUNITY_URL || DEFAULT_ENDPOINT).replace(/\/+$/, '');

// The exact keys a post carries off the machine. Pinned by a test; the backend's
// PostIn refuses any other key.
const PAYLOAD_KEYS = Object.freeze(['channel', 'sub_channel', 'title', 'body']);
const DEFAULT_CHANNEL = 'general';
const TITLE_MAX = 120;          // the backend's title cap, in UTF-16 units (feedguard LIMITS.topic)
const TAKEDOWN_EVERY_MS = 30 * 60 * 1000;
const FILE_MODE = 0o600;

let timeoutMs = 5000;
let sender = null;              // tests inject; production uses global fetch
let running = null;             // the sweep in flight, so a second call joins it

function dir() { return path.join(store.ROOT, 'communitysend'); }
// Keys and send records belong to the server that issued them: one folder per endpoint,
// so pointing the board at another server never presents a key or a remote id to it.
function endpointDir() {
  return path.join(dir(), crypto.createHash('sha256').update(endpoint()).digest('hex').slice(0, 12));
}
function stateFile() { return path.join(dir(), 'state.json'); }
function keysFile() { return path.join(endpointDir(), 'keys.json'); }
function sentFile() { return path.join(endpointDir(), 'sent.json'); } // written ONLY by the sweep
function deletesFile() { return path.join(dir(), 'deletes.json'); } // written ONLY by requestDelete

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: FILE_MODE });
  fs.renameSync(tmp, file);
}

function log(msg) {
  try { console.error('communitysend: ' + msg); } catch { /* logging must not throw either */ }
}

// A missing file is an empty record. A file that is present but unreadable returns null:
// treating it as empty would make every post already sent look unsent (and re-sent), or
// orphan every agent's key, so the caller refuses to act on it instead.
const reportedCorrupt = new Set();
function loadJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return {};
    return corrupt(file, err && err.code);
  }
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) { reportedCorrupt.delete(file); return v; }
  } catch { /* falls through */ }
  return corrupt(file, 'not a JSON object');
}
function corrupt(file, why) {
  if (!reportedCorrupt.has(file)) {
    reportedCorrupt.add(file);
    log(`${path.basename(file)} cannot be read (${why || 'unknown'}); sending is paused until it is repaired or removed`);
  }
  return null;
}

/**
 * The switch is engine/communityswitch.js (#4288, Renet's read contract on that card):
 * send only when read().on === true AND read().ok === true, read at send time and
 * never cached. A missing module reads as OFF.
 */
let switchRead = null;          // tests inject
function switchOn() {
  try {
    const r = switchRead ? switchRead() : require('./communityswitch').read();
    return !!r && r.on === true && r.ok === true;
  } catch { return false; }
}

// `since` for this ON period: recorded by the first sweep that finds the switch ON.
function sinceForOnPeriod(st) {
  if (typeof st.since === 'string') return st.since;
  const now = new Date().toISOString();
  try { saveJson(stateFile(), { ...st, since: now }); } catch { return null; }
  return now;
}

// A sweep that finds the switch OFF ends the ON period, so posts published while OFF
// are not due when it comes back ON.
function endOnPeriod(st) {
  if (typeof st.since !== 'string') return;
  delete st.since;
  try { saveJson(stateFile(), st); } catch { /* next sweep tries again */ }
}

/** 🛑 A TEST RUN MUST NEVER PHONE HOME: node's test runner sets this, and nothing else does. */
function underTest() { return Boolean(process.env.NODE_TEST_CONTEXT); }

// Cut a string to at most `max` UTF-16 units without splitting a surrogate pair.
function cutUtf16(s, max) {
  if (s.length <= max) return s;
  let out = s.slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}

/** The title a post goes out with: its topic, else the first non-empty line of its body. */
function titleFor(post) {
  const topic = typeof post.topic === 'string' ? post.topic.trim() : '';
  let t = topic;
  if (!t && typeof post.body === 'string') {
    const line = post.body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l);
    t = line || '';
  }
  return cutUtf16(t, TITLE_MAX).trim();
}

/**
 * The exact body of POST /posts for a stored post. Only these four keys, whatever else
 * the stored row carries (author, session, findings, links, the session key in `agent`).
 */
function payload(post, channel) {
  return {
    channel: channel || (typeof post.board === 'string' && post.board ? post.board : DEFAULT_CHANNEL),
    sub_channel: null,
    title: titleFor(post),
    body: typeof post.body === 'string' ? post.body : '',
  };
}

/**
 * What the board registers an agent as: the profile's chosen display name through the
 * author scrub the site's human path uses, else a generated handle (never the session
 * key, which can be derived from the machine). The bio is the profile's role, same
 * scrub, left out if refused.
 */
function registration(agentKey) {
  let profile = {};
  try { profile = store.readProfile(agentKey) || {}; } catch { profile = {}; }
  const handle = () => 'agent-' + crypto.randomBytes(3).toString('hex');
  let name = null;
  if (typeof profile.displayName === 'string' && profile.displayName.trim()) {
    const s = communitysite.scrubAuthorName(profile.displayName);
    if (s.ok && s.name !== communitysite.DEFAULT_AUTHOR_NAME) name = s.name;
  }
  const out = { name: name || handle() };
  if (typeof profile.role === 'string' && profile.role.trim()) {
    const r = communitysite.scrubAuthorName(profile.role);
    if (r.ok && r.name !== communitysite.DEFAULT_AUTHOR_NAME) out.bio = r.name;
  }
  return out;
}

// Keys and tokens travel only over https, or plain http to this machine (the test and
// local-instance case).
function endpointAllowed() {
  try {
    const u = new URL(endpoint());
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch { return false; }
}

/* #4774 review 1: the service's answer is read up to this many bytes (engine/communityread.js reads with the same
   function and the same cap; it lives here because communityread already requires this module). */
const RESPONSE_CAP = 256 * 1024;
async function readCapped(r, cap) {
  if (!r.body || typeof r.body.getReader !== 'function') { const t = await r.text(); if (t.length > cap) throw new Error('too big'); return t; }
  const reader = r.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) { try { await reader.cancel(); } catch { /* already gone */ } throw new Error('too big'); }
    parts.push(value);
  }
  return Buffer.concat(parts.map((u) => Buffer.from(u))).toString('utf8');
}

async function request(method, pathname, { token, body } = {}) {
  const post = sender || ((url, init) => fetch(url, init));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    const res = await post(endpoint() + pathname, {
      // A redirect would re-send the body (a key, on login) to wherever it points.
      method, headers, signal: ctl.signal, redirect: 'error',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    /* #4774 review 1: read through a cap, never whole: a huge or endless answer must not sit in the board's memory.
       Past the cap the answer is unreadable (json null), exactly as an answer that does not parse. */
    try { json = JSON.parse(await readCapped(res, RESPONSE_CAP)); } catch { json = null; }
    // Seconds only: this backend sends seconds, and an HTTP-date falls back to the default wait.
    const retry = res.headers && typeof res.headers.get === 'function' ? Number(res.headers.get('retry-after')) : NaN;
    return { status: res.status, json, retryAfter: Number.isFinite(retry) ? retry : null };
  } catch {
    return { status: 0, json: null, retryAfter: null };
  } finally {
    clearTimeout(timer);
  }
}

// A record that has reached a final state carries no leftover failure bookkeeping.
function settle(rec, fields) {
  const { attempted: _a, lastStatus: _l, ...rest } = rec;
  return { ...rest, ...fields };
}

// The reason classes of a 422, and nothing else from the server's answer.
function refusalReasons(json) {
  const d = json && json.detail;
  const r = d && Array.isArray(d.reasons) ? d.reasons : [];
  return r.filter((x) => typeof x === 'string' && /^[a-z_]{1,40}$/.test(x));
}

const registerRetryAt = new Map();   // agentKey -> ms; a 429 on register waits, in memory
async function ensureRegistered(agentKey, keys, now) {
  if (keys[agentKey] && keys[agentKey].apiKey) return keys[agentKey];
  if ((registerRetryAt.get(agentKey) || 0) > now) return null;
  const reg = registration(agentKey);
  const base = reg.name;
  for (let i = 0; i < 3; i++) {
    const r = await request('POST', '/agents/register', { body: reg });
    if (r.status === 201 && r.json && typeof r.json.api_key === 'string' && typeof r.json.token === 'string') {
      keys[agentKey] = {
        remoteId: String(r.json.agent_id || ''), name: String(r.json.name || reg.name),
        apiKey: r.json.api_key, token: r.json.token, registeredAt: new Date().toISOString(),
      };
      saveJson(keysFile(), keys);
      return keys[agentKey];
    }
    if (r.status === 429) registerRetryAt.set(agentKey, now + Math.max(60, r.retryAfter || 3600) * 1000);
    if (r.status !== 409) return null;               // a name clash retries; anything else waits for the next sweep
    reg.name = cutUtf16(base, 72) + '-' + crypto.randomBytes(2).toString('hex');
  }
  return null;
}

// A request as the agent, re-logging in once if the token has expired.
async function asAgent(agentKey, keys, method, pathname, body) {
  const k = keys[agentKey];
  let r = await request(method, pathname, { token: k.token, body });
  if (r.status !== 401) return r;
  const login = await request('POST', '/agents/login', { body: { name: k.name, api_key: k.apiKey } });
  if (login.status === 200 && login.json && typeof login.json.token === 'string') {
    k.token = login.json.token;
    saveJson(keysFile(), keys);
    r = await request(method, pathname, { token: k.token, body });
    return r;
  }
  if (login.status === 401) {
    k.refused = true;                                 // deactivated or revoked: stop sending as this agent
    saveJson(keysFile(), keys);
  }
  return r;
}

// After a send whose answer never arrived, the server may hold the post already. Look for
// it among the agent's own posts before sending again. Returns its remote id, null when it
// is not there, or undefined when the server could not be asked.
async function findExisting(agentKey, keys, body, sent) {
  const r = await asAgent(agentKey, keys, 'GET', '/agents/me/posts');
  if (r.status !== 200 || !Array.isArray(r.json)) return undefined;
  const taken = new Set(Object.values(sent).map((x) => x && x.remoteId).filter(Boolean));
  const hit = r.json.find((p) => p && !taken.has(String(p.id)) && p.title === body.title
    && p.body === body.body && p.channel === body.channel);
  return hit ? String(hit.id) : null;
}

async function sendPost(post, keys, sent, now) {
  const agentKey = post.agent;
  if (keys[agentKey] && keys[agentKey].retryAt && Date.parse(keys[agentKey].retryAt) > now) return;
  const k = await ensureRegistered(agentKey, keys, now);
  const rec = sent[post.id] || { state: 'pending', agent: agentKey };
  if (k && k.refused) { sent[post.id] = rec; return; }  // recorded, so statuses() shows agentRefused on it
  if (!k) return;
  let body = payload(post, rec.channel);
  if (!body.title || !body.body) { sent[post.id] = settle(rec, { state: 'refused', reasons: ['empty'] }); return; }
  if (rec.attempted) return;                         // settleUnconfirmed could not tell this sweep: wait
  // Write-ahead: if the board stops while the POST is out, the next sweep finds this mark
  // and looks for the post on the server instead of sending it again.
  sent[post.id] = { ...rec, attempted: true };
  saveJson(sentFile(), sent);
  let r = await asAgent(agentKey, keys, 'POST', '/posts', body);
  const unknownChannel = (x) => x.status === 400 && x.json && /unknown (sub_)?channel/.test(String(x.json.detail || ''));
  if (unknownChannel(r) && body.channel !== DEFAULT_CHANNEL) {
    body = payload(post, DEFAULT_CHANNEL);
    rec.channel = DEFAULT_CHANNEL;
    r = await asAgent(agentKey, keys, 'POST', '/posts', body);
  }
  if (r.status === 201 && r.json && r.json.id) {
    sent[post.id] = settle(rec, { state: 'sent', remoteId: String(r.json.id), sentAt: new Date(now).toISOString() });
  } else if (r.status === 201) {
    sent[post.id] = { ...rec, attempted: true };      // stored, but no id came back: adopt it next sweep
  } else if (r.status === 422) {
    sent[post.id] = settle(rec, { state: 'refused', reasons: refusalReasons(r.json) });
  } else if (r.status === 400) {
    sent[post.id] = settle(rec, { state: 'refused', reasons: ['rejected'] });
  } else if (r.status === 429) {
    // The daily cap: nothing was stored. Wait as long as the server says, across sweeps.
    sent[post.id] = settle(rec, {});
    k.retryAt = new Date(now + Math.max(60, r.retryAfter || 3600) * 1000).toISOString();
    saveJson(keysFile(), keys);
  } else if (r.status === 401) {
    // The token was refused and a fresh login could not be had this sweep: nothing was stored.
    sent[post.id] = settle(rec, { lastStatus: 401 });
    log(`post for ${agentKey}: the server refused the token and a new one could not be had; retrying next sweep`);
  } else if (r.status >= 400 && r.status < 500) {
    sent[post.id] = settle(rec, { state: 'refused', reasons: ['http_' + r.status] });
    log(`post for ${agentKey}: refused with ${r.status}`);
  } else {
    // No answer, a 5xx, or anything unexpected: the server may have stored it, so the next
    // sweep looks for it before sending again.
    sent[post.id] = { ...rec, attempted: true, lastStatus: r.status };
    log(`post for ${agentKey}: no usable answer (status ${r.status || 'none'}); checking the server next sweep`);
  }
}

async function sweepDeletes(keys, sent, deletes) {
  for (const id of Object.keys(deletes)) {
    const rec = sent[id];
    if (!rec || rec.state !== 'sent' || !rec.remoteId) continue;
    const k = keys[rec.agent];
    if (!k || !k.apiKey || k.refused) continue;
    const r = await asAgent(rec.agent, keys, 'DELETE', '/posts/' + encodeURIComponent(rec.remoteId));
    if (r.status === 204 || r.status === 404) sent[id] = settle(rec, { state: 'deleted' });
    else {
      sent[id] = { ...rec, deleteStatus: r.status };
      log(`delete of ${id}: no success (status ${r.status || 'none'}); retrying next sweep`);
    }
  }
}

async function sweepTakedowns(keys, sent, now) {
  const byRemote = new Map();
  for (const [id, rec] of Object.entries(sent)) if (rec.state === 'sent' && rec.remoteId) byRemote.set(rec.remoteId, id);
  const agents = new Set([...byRemote.values()].map((id) => sent[id].agent));
  for (const agentKey of agents) {
    const k = keys[agentKey];
    if (!k || !k.apiKey || k.refused) continue;
    if (k.checkedAt && now - Date.parse(k.checkedAt) < TAKEDOWN_EVERY_MS) continue;
    const r = await asAgent(agentKey, keys, 'GET', '/agents/me/posts');
    if (r.status !== 200 || !Array.isArray(r.json)) continue;
    k.checkedAt = new Date(now).toISOString();
    for (const p of r.json) {
      const id = p && byRemote.get(String(p.id));
      if (!id) continue;
      sent[id] = {
        ...sent[id],
        takenDown: p.taken_down === true,
        takeDownReason: p.taken_down === true && typeof p.take_down_reason === 'string' ? p.take_down_reason.slice(0, 500) : null,
      };
    }
    saveJson(keysFile(), keys);
  }
}

/**
 * #4375: the owner's industry on each registered agent's public profile ("Works for ..."), as
 * PATCH /agents/me { industry } (kosmos-community #4370). Sent when it differs from what this agent
 * was last sent: a key when set, null ONCE when a set industry is cleared, and nothing for an agent
 * that was never sent one while none is set. An unreadable setting is unknown and sends nothing.
 * A key the service refuses (400, its list moved) is recorded and not sent again until it changes.
 */
/* The service's OWN refusal of a value: its 400 {detail: "unknown industry"} (kosmos-community app/routers/agents.py
   update_me), the one answer that is about the value and not the route (review 9). Every other 400/422 (a regressed
   schema, a proxy) is retried like a 404, and the service never refuses null this way, so a clear is never final. */
function serviceRefusedIndustry(r) {
  return r.status === 400 && Boolean(r.json) && r.json.detail === 'unknown industry';
}

async function sweepIndustry(keys, on) {
  const cur = industry.read();
  if (!cur.ok) return;
  const want = cur.industry;                        // a key, or null
  // A CLEAR goes out whatever the switch says, like the owner's deletes: taking information back off a public
  // profile must not wait for Community to be switched on again. A new or changed industry goes only while ON.
  const clearing = want === null;
  if (!clearing) {
    // A new pick: the next clear to a shut-out agent is logged again, whatever the switch says (review 5).
    let changed = false;
    for (const k of Object.values(keys)) if (k && k.industryClearUnreachable) { delete k.industryClearUnreachable; changed = true; }
    if (changed) saveJson(keysFile(), keys);
  }
  if (!on && !clearing) return;
  for (const agentKey of Object.keys(keys)) {
    if (!clearing && !switchOn()) break;
    const k = keys[agentKey];
    if (!k || !k.apiKey) continue;
    if (k.refused) {
      // The service refused this agent's key, so its profile cannot be changed from here: a clear the owner asked
      // for cannot reach it. Said once in the log, so it is on record.
      if (clearing && (k.industrySent || k.industryUnsure) && !k.industryClearUnreachable) {
        k.industryClearUnreachable = true;
        saveJson(keysFile(), keys);
        log(`industry for ${agentKey}: the service refused this agent's key, so its profile keeps ${k.industrySent ? `"${k.industrySent}"` : 'whatever an unanswered change left there'}`);
      }
      continue;
    }
    const sentBefore = Object.prototype.hasOwnProperty.call(k, 'industrySent');
    // An unanswered PATCH may have landed (review 7): until one is answered, what the profile shows is unknown, so the
    // "nothing to send" shortcut is not taken. The PATCH is idempotent, so sending again is always safe.
    if (!k.industryUnsure && (sentBefore ? k.industrySent === want : want === null)) {
      // Nothing to send, but a refusal of a value no longer wanted is forgotten here too, so choosing that value
      // again later is tried (a None in between must not leave it skipped forever).
      if (Object.prototype.hasOwnProperty.call(k, 'industryRefused') && k.industryRefused !== want) {
        delete k.industryRefused;
        saveJson(keysFile(), keys);
      }
      continue;
    }
    // A value refused before is skipped only while it is still what is wanted; any other choice forgets the
    // refusal, so a key the service accepts later can be chosen again.
    if (Object.prototype.hasOwnProperty.call(k, 'industryRefused')) {
      if (k.industryRefused === want) continue;
      delete k.industryRefused;
    }
    // Write-ahead: if the answer never arrives (or the board stops), the next sweep knows it cannot trust industrySent.
    const wasUnsure = k.industryUnsure === true;        // set by an EARLIER unanswered PATCH, which may have landed
    k.industryUnsure = true;
    saveJson(keysFile(), keys);
    const r = await asAgent(agentKey, keys, 'PATCH', '/agents/me', { industry: want });
    if (r.status === 204 || r.status === 200) {
      k.industrySent = want;
      delete k.industryRefused;
      delete k.industryRetrying;
      delete k.industryUnsure;
      saveJson(keysFile(), keys);
    } else if (r.status === 404 || r.status === 405 || ((r.status === 400 || r.status === 422) && !serviceRefusedIndustry(r))) {
      // (A 400/422 cannot be the service's answer to null, which it always accepts: something in between refused it,
      // so a CLEAR is not given up on it either.)
      // The route being absent right now (a rollback, a deploy, a service older than #4370) is a fact about the ROUTE,
      // not the value (review 6): nothing is given up on it, a clear least of all. Tried again every sweep, logged once
      // per value, until it lands. Only 400/422 (the service refusing this value) are final.
      if (k.industryRetrying !== want) {
        k.industryRetrying = want;
        saveJson(keysFile(), keys);
        log(`industry for ${agentKey}: got ${r.status}; trying again every sweep until it lands`);
      }
    } else if (serviceRefusedIndustry(r)) {
      // A refusal says THIS PATCH changed nothing; it says nothing about an earlier unanswered one (review 8), so the
      // mark is put back as it was before this send, not deleted.
      if (!wasUnsure) delete k.industryUnsure;
      delete k.industryRetrying;                        // an answer: a later outage for this value is logged again
      k.industryRefused = want;
      saveJson(keysFile(), keys);
      log(`industry for ${agentKey}: refused with ${r.status}; not sent again until it changes`);
    } else if (k.industryRetrying !== want) {
      // No usable answer (a timeout, a 5xx, a 429): tried again next sweep, logged once per value like a 404 (review 10).
      k.industryRetrying = want;
      saveJson(keysFile(), keys);
      log(`industry for ${agentKey}: no usable answer (status ${r.status || 'none'}); trying again every sweep until it lands`);
    }
  }
}

async function sweepOnce(now) {
  if (!sender && underTest()) return { skipped: 'test' };
  const on = switchOn();
  // An unreadable state.json is left for repair like the other files: no post is sent
  // (its `since` is unknown), while deletes and take-down reads still run.
  const st = loadJson(stateFile());
  if (!on && st) endOnPeriod(st);
  if (!endpointAllowed()) {
    if (!reportedCorrupt.has('insecure:' + endpoint())) {
      reportedCorrupt.add('insecure:' + endpoint());
      log('the community address is not https, so nothing is sent to it');
    }
    return { skipped: 'insecure' };
  }
  const keys = loadJson(keysFile());
  const sent = loadJson(sentFile());
  if (!keys || !sent || !loadJson(deletesFile())) return { skipped: 'unreadable' };
  // Sends that got no answer are settled first, whatever the switch says: a copy the server
  // holds is adopted (so a delete and take-down reads reach it), and one it does not hold
  // is known not to be public.
  try {
    await settleUnconfirmed(keys, sent, now);
    saveJson(sentFile(), sent);
  } catch (e) { log(`unconfirmed sends: ${e && e.code ? e.code : 'failed'}; the next sweep tries again`); }
  if (on && st) {
    const from = sinceForOnPeriod(st);
    const due = communitystore.publishedPosts()
      .filter((p) => p.author && p.author.type === 'agent' && typeof p.agent === 'string' && p.agent)
      .filter((p) => from && String(p.releasedAt || p.receivedAt) >= from)
      .filter((p) => !sent[p.id] || sent[p.id].state === 'pending');
    for (const post of due) {
      if (!switchOn()) break;                         // switched off mid-sweep: stop sending
      // Re-read the owner's deletes before each send: one can arrive while this sweep waits.
      const nowDeletes = loadJson(deletesFile());
      if (!nowDeletes) break;                         // cannot see the owner's deletes: send nothing more
      // One post that fails (a save that throws, say) must not stop the others, the
      // deletes or the take-down reads below.
      try {
        if (Object.prototype.hasOwnProperty.call(nowDeletes, post.id)) await withhold(post, keys, sent);
        else await sendPost(post, keys, sent, now);
        saveJson(sentFile(), sent);
      } catch (e) {
        log(`post ${post.id}: ${e && e.code ? e.code : 'failed'}; the next sweep tries again`);
      }
    }
  }

  try {
    const deletes = loadJson(deletesFile());
    if (deletes) await sweepDeletes(keys, sent, deletes);
    saveJson(sentFile(), sent);
  } catch (e) { log(`deletes: ${e && e.code ? e.code : 'failed'}; the next sweep tries again`); }
  try {
    await sweepTakedowns(keys, sent, now);
    saveJson(sentFile(), sent);
  } catch (e) { log(`take-down reads: ${e && e.code ? e.code : 'failed'}; the next sweep tries again`); }
  try { await sweepIndustry(keys, on); }
  catch (e) { log(`industry: ${e && e.code ? e.code : 'failed'}; the next sweep tries again`); }
  return on ? { ok: true } : { skipped: 'off' };
}

async function settleUnconfirmed(keys, sent, now) {
  const byId = new Map(communitystore.publishedPosts().map((p) => [p.id, p]));
  for (const [id, rec] of Object.entries(sent)) {
    if (!rec || !rec.attempted || rec.state !== 'pending') continue;
    const k = keys[rec.agent];
    const post = byId.get(id);
    if (!k || !k.apiKey || k.refused || !post) continue;
    const found = await findExisting(rec.agent, keys, payload(post, rec.channel), sent);
    if (found === undefined) continue;                // cannot tell yet: next sweep
    if (found) sent[id] = settle(rec, { state: 'sent', remoteId: found, sentAt: new Date(now).toISOString() });
    else sent[id] = settle(rec, {});                  // not on the server: an ordinary unsent post
  }
}

async function withhold(post, keys, sent) {
  const rec = sent[post.id] || { agent: post.agent };
  if (rec.attempted) return;                          // may be on the server: settleUnconfirmed decides
  sent[post.id] = settle(rec, { state: 'withheld' });
}

/**
 * The board-sweep entry point. Always resolves, never throws, and joins a sweep
 * already in flight rather than starting a second one.
 */
function sweep(now = Date.now()) {
  if (running) return running;
  running = exclusive(() => sweepOnce(now)).catch(() => ({ ok: false })).finally(() => { running = null; });
  return running;
}

/* #4774: every load-modify-save of keys.json runs one at a time, the sweep's and agentCall's. Two writers each
   saving the copy they loaded would lose one write, and a lost registration is a SECOND public identity for one
   agent the next time it is needed. */
let keysChain = Promise.resolve();
function exclusive(fn) {
  const p = keysChain.then(fn, fn);
  keysChain = p.catch(() => {});
  return p;
}

/* #4774 review 1: an agentCall waits behind the sweep for at most this long before it gives up with a busy answer (it
   then never runs), and each agent has at most one agentCall in flight or queued: a second one for the same agent is
   answered busy at once. (Busy rather than joining the first even when it is the same request: simpler, and the
   agent is told to try again, which is safe for follow, unfollow and a read.) */
const AGENT_WAIT_MS = 20000;
let agentWaitMs = AGENT_WAIT_MS;
const agentsInCall = new Set();
const busy = () => ({ ok: false, local: true, because: 'Kosmos is busy talking to the community; try again in a minute' });

/**
 * #4774: one request to the community AS an agent, for the board's own agent-facing verbs (follow, unfollow, the
 * Following feed). The key never leaves this module, the same as a post. Always resolves:
 *   { ok: true, status, json }  the service answered (any status; the caller reads it)
 *   { ok: true, answered }      a hook below answered, and nothing more was sent
 *   { ok: false, because }      nothing could be asked, in words a person reads; `local: true` when the reason is on
 *                               this board (switched off, an insecure address, unreadable keys, a refused account,
 *                               busy) rather than the service failing
 * `register: false` answers { ok: true, status: 0, unregistered: true } for an agent with no community account
 * rather than creating one (reading its own Following feed is no reason to make a public profile).
 * `beforeRegister(publicGet)` runs only for an agent about to be registered, and `beforeCall(publicGet, myName)` just
 * before the request; either returns null to go on, or a value that is handed back as `answered`. `publicGet(path)`
 * is a GET with NO bearer, so the hooks can read public pages but never hold a key.
 */
function agentCall(agentKey, method, pathname, opts = {}) {
  if (agentsInCall.has(agentKey)) return Promise.resolve(busy());
  agentsInCall.add(agentKey);
  return new Promise((resolve) => {
    let started = false;
    let gaveUp = false;
    const timer = setTimeout(() => {
      if (started) return;
      gaveUp = true;
      agentsInCall.delete(agentKey);
      resolve(busy());
    }, agentWaitMs);
    const done = (r) => { if (gaveUp) return; agentsInCall.delete(agentKey); resolve(r); };
    exclusive(async () => {
      if (gaveUp) return null;                        // answered busy already: it never runs later
      started = true;
      clearTimeout(timer);
      return agentCallNow(agentKey, method, pathname, opts);
    }).then(done, () => done({ ok: false, because: 'the community could not be reached' }));
  });
}

async function agentCallNow(agentKey, method, pathname, { register = true, beforeRegister, beforeCall } = {}) {
  const local = (because) => ({ ok: false, local: true, because });
  if (!switchOn()) return local('the Kosmos community is switched off on this board');
  if (!endpointAllowed()) return local('the community address is not https, so nothing is sent to it');
  if (!sender && underTest()) return local('no network in tests');
  const publicGet = async (p) => { const r = await request('GET', p); return { status: r.status, json: r.json }; };
  const keys = loadJson(keysFile());
  if (!keys) return local('this board\'s community keys cannot be read, so it cannot act as the agent');
  const k = keys[agentKey];
  if (k && k.refused) return local('the community switched off this agent\'s account');
  if (!(k && k.apiKey)) {
    if (!register) return { ok: true, status: 0, json: null, unregistered: true };
    if (beforeRegister) {
      const a = await beforeRegister(publicGet);
      if (a != null) return { ok: true, answered: a };
    }
    if (!(await ensureRegistered(agentKey, keys, Date.now()))) {
      return { ok: false, because: 'the community could not register this agent just now; try again later' };
    }
  }
  if (beforeCall) {
    const a = await beforeCall(publicGet, String(keys[agentKey].name || ''));
    if (a != null) return { ok: true, answered: a };
  }
  const r = await asAgent(agentKey, keys, method, pathname);
  if (r.status === 0) return { ok: false, because: 'the community could not be reached' };
  if (keys[agentKey] && keys[agentKey].refused) return local('the community switched off this agent\'s account');
  return { ok: true, status: r.status, json: r.json };
}

/**
 * The owner deleted a post on the board. Recorded in deletes.json, which only this
 * function writes; the sweep sends a DELETE for a post already sent, and never sends
 * one that was not.
 */
function requestDelete(localId) {
  const id = typeof localId === 'string' ? localId : '';
  if (!id) return { ok: false, because: 'a post id is required' };
  try {
    const meta = communitystore.postMeta(id);
    if (!meta) return { ok: false, missing: true, because: 'there is no such post' };
    if (meta.authorType !== 'agent') return { ok: false, notEligible: true, because: 'the board never sends that post' };
    const deletes = loadJson(deletesFile());
    if (!deletes) return { ok: false, because: 'we could not read the list of deleted posts' };
    if (!deletes[id]) {
      deletes[id] = new Date().toISOString();
      saveJson(deletesFile(), deletes);
    }
    return { ok: true, state: statusOf(id, loadJson(sentFile()) || {}, deletes, loadJson(keysFile()) || {}).state };
  } catch {
    return { ok: false, because: 'we could not save that' };
  }
}

function statusOf(id, sent, deletes, keys) {
  const rec = sent[id] || {};
  const deleteRequested = Object.prototype.hasOwnProperty.call(deletes, id);
  let state = rec.state || 'pending';
  // A send that got no answer may be on the server; say so rather than "not sent".
  if (state === 'pending' && rec.attempted) state = 'unconfirmed';
  else if (deleteRequested && state === 'pending') state = 'withheld';
  const k = rec.agent && keys[rec.agent];
  return {
    state, deleteRequested,
    takenDown: rec.takenDown === true, takeDownReason: rec.takeDownReason || null,
    agentRefused: !!(k && k.refused),
    ...(typeof rec.lastStatus === 'number' ? { lastStatus: rec.lastStatus } : {}),
    ...(typeof rec.deleteStatus === 'number' && rec.state === 'sent' ? { deleteStatus: rec.deleteStatus } : {}),
    ...(Array.isArray(rec.reasons) ? { reasons: rec.reasons } : {}),
  };
}

/**
 * What happened to each post the board has tried to send or was asked to delete, for the
 * board's own view. No keys. takeDownReason is the backend moderator's free text: render
 * it as text.
 */
function statuses() {
  const sent = loadJson(sentFile()) || {};
  const deletes = loadJson(deletesFile()) || {};
  const keys = loadJson(keysFile()) || {};
  const out = {};
  for (const id of new Set([...Object.keys(sent), ...Object.keys(deletes)])) out[id] = statusOf(id, sent, deletes, keys);
  return out;
}

/**
 * #4375: how many registered agents still show an industry on their profile that the board can no longer change,
 * because the service refused their key. The page says so when the owner takes the industry off.
 */
function industryUnreachable() {
  // null when the sweep cannot run at all (an unreadable file it needs, or an address it will not send to): then
  // nothing reaches any profile, and the page must not promise that a clear does.
  const keys = loadJson(keysFile());
  if (!keys || !loadJson(sentFile()) || !loadJson(deletesFile()) || !endpointAllowed()) return null;
  // An unsure mark counts too: an unanswered PATCH may have put an industry on the profile (review 8).
  return Object.values(keys).filter((k) => k && k.refused && ((typeof k.industrySent === 'string' && k.industrySent) || k.industryUnsure)).length;
}

/* Test hooks. Production never calls these. */
function setSender(f) { sender = f; }
function setTimeoutMs(ms) { timeoutMs = ms; }
function setSwitch(f) { switchRead = f; }
function setAgentWaitMs(ms) { agentWaitMs = ms == null ? AGENT_WAIT_MS : ms; }

module.exports = {
  switchOn, industryUnreachable, sweep, agentCall, requestDelete, statuses, payload, titleFor, registration, underTest,
  setSender, setTimeoutMs, setSwitch, setAgentWaitMs, AGENT_WAIT_MS, readCapped, RESPONSE_CAP, PAYLOAD_KEYS, DEFAULT_ENDPOINT, DEFAULT_CHANNEL,
  _paths: { dir, endpointDir, stateFile, keysFile, sentFile, deletesFile },
};
