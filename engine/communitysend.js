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
 * 🛑 ONLY WHILE THE SWITCH IS ON. The switch, and its default (ON, Josh's ruling on
 * #3485), belong to engine/communityswitch.js (#4288). This layer only reads it, at
 * send time. Until that module lands it reads as OFF, so nothing is sent: a default
 * and its control land together (#2013), and here the control lands in #4288.
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
function stateFile() { return path.join(dir(), 'state.json'); }
function keysFile() { return path.join(dir(), 'keys.json'); }
function sentFile() { return path.join(dir(), 'sent.json'); }     // written ONLY by the sweep
function deletesFile() { return path.join(dir(), 'deletes.json'); } // written ONLY by requestDelete

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: FILE_MODE });
  fs.renameSync(tmp, file);
}

function loadJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
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
function sinceForOnPeriod() {
  const st = loadJson(stateFile());
  if (typeof st.since === 'string') return st.since;
  const now = new Date().toISOString();
  try { saveJson(stateFile(), { ...st, since: now }); } catch { return null; }
  return now;
}

// A sweep that finds the switch OFF ends the ON period, so posts published while OFF
// are not due when it comes back ON.
function endOnPeriod() {
  const st = loadJson(stateFile());
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
    if (s.ok && s.name !== 'Anonymous') name = s.name;
  }
  const out = { name: name || handle() };
  if (typeof profile.role === 'string' && profile.role.trim()) {
    const r = communitysite.scrubAuthorName(profile.role);
    if (r.ok && r.name !== 'Anonymous') out.bio = r.name;
  }
  return out;
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
      method, headers, signal: ctl.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    const retry = res.headers && typeof res.headers.get === 'function' ? Number(res.headers.get('retry-after')) : NaN;
    return { status: res.status, json, retryAfter: Number.isFinite(retry) ? retry : null };
  } catch {
    return { status: 0, json: null, retryAfter: null };
  } finally {
    clearTimeout(timer);
  }
}

// The reason classes of a 422, and nothing else from the server's answer.
function refusalReasons(json) {
  const d = json && json.detail;
  const r = d && Array.isArray(d.reasons) ? d.reasons : [];
  return r.filter((x) => typeof x === 'string' && /^[a-z_]{1,40}$/.test(x));
}

async function ensureRegistered(agentKey, keys) {
  if (keys[agentKey] && keys[agentKey].apiKey) return keys[agentKey];
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
  const k = await ensureRegistered(agentKey, keys);
  if (!k || k.refused) return;
  const rec = sent[post.id] || { state: 'pending', agent: agentKey };
  let body = payload(post, rec.channel);
  if (!body.title || !body.body) { sent[post.id] = { ...rec, state: 'refused', reasons: ['empty'] }; return; }
  if (rec.attempted) {
    const found = await findExisting(agentKey, keys, body, sent);
    if (found === undefined) return;                  // cannot tell yet: try again next sweep
    if (found) { sent[post.id] = { ...rec, state: 'sent', remoteId: found, sentAt: new Date(now).toISOString() }; return; }
  }
  let r = await asAgent(agentKey, keys, 'POST', '/posts', body);
  const unknownChannel = (x) => x.status === 400 && x.json && /unknown (sub_)?channel/.test(String(x.json.detail || ''));
  if (unknownChannel(r) && body.channel !== DEFAULT_CHANNEL) {
    body = payload(post, DEFAULT_CHANNEL);
    rec.channel = DEFAULT_CHANNEL;
    r = await asAgent(agentKey, keys, 'POST', '/posts', body);
  }
  if (r.status === 201 && r.json && r.json.id) {
    sent[post.id] = { ...rec, state: 'sent', remoteId: String(r.json.id), sentAt: new Date(now).toISOString() };
  } else if (r.status === 201) {
    sent[post.id] = { ...rec, attempted: true };      // stored, but no id came back: adopt it next sweep
  } else if (r.status === 422) {
    sent[post.id] = { ...rec, state: 'refused', reasons: refusalReasons(r.json) };
  } else if (r.status === 400) {
    sent[post.id] = { ...rec, state: 'refused', reasons: ['rejected'] };
  } else if (r.status === 429) {
    // The daily cap: wait as long as the server says, and remember it across sweeps.
    k.retryAt = new Date(now + Math.max(60, r.retryAfter || 3600) * 1000).toISOString();
    saveJson(keysFile(), keys);
  } else if (r.status === 0 || r.status >= 500) {
    sent[post.id] = { ...rec, attempted: true };      // the server may have stored it
  }
}

async function sweepDeletes(keys, sent, deletes) {
  for (const id of Object.keys(deletes)) {
    const rec = sent[id];
    if (!rec || rec.state !== 'sent' || !rec.remoteId) continue;
    const k = keys[rec.agent];
    if (!k || !k.apiKey || k.refused) continue;
    const r = await asAgent(rec.agent, keys, 'DELETE', '/posts/' + encodeURIComponent(rec.remoteId));
    if (r.status === 204 || r.status === 404) sent[id] = { ...rec, state: 'deleted' };
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

async function sweepOnce(now) {
  if (!sender && underTest()) return { skipped: 'test' };
  if (!switchOn()) { endOnPeriod(); return { skipped: 'off' }; }
  const from = sinceForOnPeriod();
  const keys = loadJson(keysFile());
  const sent = loadJson(sentFile());
  await sweepDeletes(keys, sent, loadJson(deletesFile()));
  saveJson(sentFile(), sent);
  const due = communitystore.publishedPosts()
    .filter((p) => p.author && p.author.type === 'agent' && typeof p.agent === 'string' && p.agent)
    .filter((p) => from && String(p.releasedAt || p.receivedAt) >= from)
    .filter((p) => !sent[p.id] || sent[p.id].state === 'pending');
  for (const post of due) {
    if (!switchOn()) break;                           // switched off mid-sweep: stop
    // Re-read the owner's deletes before each send: one can arrive while this sweep waits.
    if (Object.prototype.hasOwnProperty.call(loadJson(deletesFile()), post.id)) {
      sent[post.id] = { ...(sent[post.id] || { agent: post.agent }), state: 'withheld' };
    } else {
      await sendPost(post, keys, sent, now);
    }
    saveJson(sentFile(), sent);
  }
  await sweepTakedowns(keys, sent, now);
  saveJson(sentFile(), sent);
  return { ok: true };
}

/**
 * The board-sweep entry point. Always resolves, never throws, and joins a sweep
 * already in flight rather than starting a second one.
 */
function sweep(now = Date.now()) {
  if (running) return running;
  running = sweepOnce(now).catch(() => ({ ok: false })).finally(() => { running = null; });
  return running;
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
    if (!communitystore.hasPost(id)) return { ok: false, missing: true, because: 'there is no such post' };
    const deletes = loadJson(deletesFile());
    if (!deletes[id]) {
      deletes[id] = new Date().toISOString();
      saveJson(deletesFile(), deletes);
    }
    return { ok: true, state: statusOf(id, loadJson(sentFile()), deletes, loadJson(keysFile())).state };
  } catch {
    return { ok: false, because: 'we could not save that' };
  }
}

function statusOf(id, sent, deletes, keys) {
  const rec = sent[id] || {};
  const deleteRequested = Object.prototype.hasOwnProperty.call(deletes, id);
  let state = rec.state || 'pending';
  if (deleteRequested && (state === 'pending' || !rec.state)) state = 'withheld';
  const k = rec.agent && keys[rec.agent];
  return {
    state, deleteRequested,
    takenDown: rec.takenDown === true, takeDownReason: rec.takeDownReason || null,
    agentRefused: !!(k && k.refused),
    ...(Array.isArray(rec.reasons) ? { reasons: rec.reasons } : {}),
  };
}

/**
 * What happened to each post the board has tried to send or was asked to delete, for the
 * board's own view. No keys. takeDownReason is the backend moderator's free text: render
 * it as text.
 */
function statuses() {
  const sent = loadJson(sentFile());
  const deletes = loadJson(deletesFile());
  const keys = loadJson(keysFile());
  const out = {};
  for (const id of new Set([...Object.keys(sent), ...Object.keys(deletes)])) out[id] = statusOf(id, sent, deletes, keys);
  return out;
}

/* Test hooks. Production never calls these. */
function setSender(f) { sender = f; }
function setTimeoutMs(ms) { timeoutMs = ms; }
function setSwitch(f) { switchRead = f; }

module.exports = {
  switchOn, sweep, requestDelete, statuses, payload, titleFor, registration, underTest,
  setSender, setTimeoutMs, setSwitch, PAYLOAD_KEYS, DEFAULT_ENDPOINT, DEFAULT_CHANNEL,
  _paths: { dir, stateFile, keysFile, sentFile, deletesFile },
};
