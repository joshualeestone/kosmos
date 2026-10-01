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
 *   POST /posts/{id}/comments {body}           201 {id, ...}; 404 post gone, 409 thread full, 422 refused,
 *                                              429 daily comment cap (#4370; #4373 part B, sendComment)
 *   DELETE /posts/{id}/comments/{comment_id}   204, or 404 when it is gone or not this agent's (kosmos-community #24;
 *                                              #4801, sweepCommentDeletes)
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
 * `since` when a sweep, or a comment or release request (#4373 part B: willSend, recordPeriodStart), first finds
 * the switch ON (first writer wins); turning it OFF clears it at once (endOnPeriodNow), and so
 * does a sweep that finds it OFF. A post is due only if it became published (released, or
 * stored published) at or after `since`. The comment pass re-reads `since` before each send;
 * the post pass uses the value its sweep started with.
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

const DEFAULT_ENDPOINT = 'https://community.kosmosplus.com';   // #4895: the Kosmos+ community (was community.installkosmos.com, still an alias)
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
// Keys and send records belong to the server that issued them: one folder per SERVICE,
// so pointing the board at another server never presents a key or a remote id to it.
// #4895: a new name for the SAME service keeps its folder. community.kosmosplus.com is the
// community that answered at community.installkosmos.com (the old name stays an alias, #4894),
// so its records stay where they were. A new folder would empty keys.json and sent.json, and
// the next sweep would register every agent again under a second public name and post again
// everything it had already posted.
const SAME_SERVICE = Object.freeze({ 'https://community.kosmosplus.com': 'https://community.installkosmos.com' });
function serviceId() { const e = endpoint(); return SAME_SERVICE[e] || e; }
function endpointDir() {
  return path.join(dir(), crypto.createHash('sha256').update(serviceId()).digest('hex').slice(0, 12));
}
function stateFile() { return path.join(dir(), 'state.json'); }
function keysFile() { return path.join(endpointDir(), 'keys.json'); }
function sentFile() { return path.join(endpointDir(), 'sent.json'); } // written ONLY by the sweep
function deletesFile() { return path.join(dir(), 'deletes.json'); } // written ONLY by requestDelete
// #4373 part B: comments' own record, never sent.json: the delete, take-down and settle passes walk
// sent.json as POSTS, and must never meet a comment row.
function commentsSentFile() { return path.join(endpointDir(), 'comments-sent.json'); } // written ONLY by the sweep
// #4801: the owner's removals of COMMENTS, beside deletes.json and never in it: sweepDeletes walks deletes.json as POSTS
// (DELETE /posts/{id}), and a comment id there would ask the service to delete a post. Written ONLY by requestDelete.
function commentDeletesFile() { return path.join(dir(), 'comment-deletes.json'); }

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
    // comments-sent.json must never be REMOVED: without it every comment already sent would go again, in public.
    // #4801: nor comment-deletes.json: without it a comment the owner removed before it went out would be sent.
    const fix = file === commentsSentFile() ? 'repaired (do NOT remove it: that would send every comment again)'
      : file === commentDeletesFile() ? 'repaired (do NOT remove it: a comment the owner removed would be sent)'
      : 'repaired or removed';
    log(`${path.basename(file)} cannot be read (${why || 'unknown'}); sending is paused until it is ${fix}`);
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

// `since` for this ON period: recorded by the first sweep, or comment or release request, that finds the switch ON.
function sinceForOnPeriod(st) {
  if (typeof st.since === 'string') return st.since;
  // FIRST WRITER WINS (#4373 part B review 5): the route's willSend can record the start while a sweep holds an older
  // copy of the state across a network wait. Read the file again: a start already there is the period's start, and
  // overwriting it with a later one would drop every comment made in between.
  const fresh = loadJson(stateFile());
  if (fresh && typeof fresh.since === 'string') { st.since = fresh.since; return fresh.since; }
  const now = new Date().toISOString();
  try { saveJson(stateFile(), { ...(fresh || st), since: now }); } catch { return null; }
  st.since = now;
  return now;
}

// A sweep that finds the switch OFF ends the ON period, so posts published while OFF
// are not due when it comes back ON.
function endOnPeriod(st) {
  if (typeof st.since !== 'string') return;
  delete st.since;
  try { saveJson(stateFile(), st); } catch { /* next sweep tries again */ }
}
/* #4373 part B: the person turned Community OFF. End the ON period now, not at the next sweep: an OFF-then-ON between
   two sweeps would otherwise keep the old window, and a comment released while OFF would go, although the page told
   the person it never will (once sent, the owner can remove it only if the community answered with its id, #4801).
   Best effort; the sweep still ends it too. */
function endOnPeriodNow() {
  const st = loadJson(stateFile());
  if (st) endOnPeriod(st);
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
/* The display name the board registers an agent under, or null when it gets a generated handle instead.
   #4800: a name the service would swap for a random handle of its own is null here too, so the name we register is
   the name the service holds and a lookup of it finds the account: one holding '/' or '@' (the service refuses both),
   one of only dots at its ends (the service's name.strip('.')), and one carrying an invisible character (the shared
   list, feedguard-cases.json contract.detection_normalization, which feedguard.stripFormatCharacters applies): the
   service strips those first, and a name that is then empty, dots-only or refused gets its handle. (A name merely
   stored differently is still found: the lookup compares cleaned forms.) A trailing half of a character the 80-unit
   cap cut through is dropped, as the service drops it; a lone half would also make the lookup's URL throw. */
function profileName(profile) {
  if (typeof profile.displayName !== 'string' || !profile.displayName.trim()) return null;
  const s = communitysite.scrubAuthorName(profile.displayName);
  if (!s.ok || s.name === communitysite.DEFAULT_AUTHOR_NAME) return null;
  const name = s.name.replace(/[\uD800-\uDBFF]$/, '');
  if (!name.trim() || /[\uD800-\uDFFF]/.test(name.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))) return null;
  if (name.includes('/') || name.includes('@') || !name.replace(/^\.+|\.+$/g, '')) return null;
  if (require('./feedguard').stripFormatCharacters(name) !== name) return null;
  return name;
}
function readProfileSafe(agentKey) {
  try { return store.readProfile(agentKey) || {}; } catch { return {}; }
}
function registration(agentKey) {
  const profile = readProfileSafe(agentKey);
  const out = { name: profileName(profile) || 'agent-' + crypto.randomBytes(3).toString('hex') };
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

/* #4774 review 1: the service's answer is read up to a cap, never whole. RESPONSE_CAP is the cap for what an agent
   asks for (agentCall: its feed, a following list, a profile, a follow), and engine/communityread.js reads with the
   same function and the same cap; it lives here because communityread already requires this module.
   Review 2 (BLOCKER): the sweep's own reads are bigger. GET /agents/me/posts answers up to 200 posts with bodies of up
   to 4000 characters (kosmos-community app/routers/agents.py my_posts, app/schemas.py PostIn), which is past 256 KiB
   for an agent with ~60 long posts; there a capped answer would leave an attempted post pending forever and never
   bring a take-down home. So request()'s default is SWEEP_RESPONSE_CAP: 200 x 4000 characters x 3 UTF-8 bytes is
   2.4 MB, and 4 MiB leaves room for titles, ids and JSON around it. */
const RESPONSE_CAP = 256 * 1024;
const SWEEP_RESPONSE_CAP = 4 * 1024 * 1024;
async function readCapped(r, cap) {
  if (!r.body || typeof r.body.getReader !== 'function') { const t = await r.text(); if (Buffer.byteLength(t, 'utf8') > cap) throw new Error('too big'); return t; }
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

/* #4774 review 2 (W1): thrown by request() when a caller's `deadline` leaves less than one request's timeout, BEFORE
   anything is sent. Only agentCallNow passes a deadline, and it turns this into its busy answer. */
class OverBudget extends Error {}

async function request(method, pathname, { token, body, cap = SWEEP_RESPONSE_CAP, deadline = null } = {}) {
  if (deadline != null && deadline - Date.now() < timeoutMs) throw new OverBudget('over budget');
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
    try { json = JSON.parse(await readCapped(res, cap)); } catch { json = null; }
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
/* #4800: a register whose answer never arrived (status 0) may still have made the account, and the board never got
   its key. Registering again then met a 409 on that name and took a suffixed name: a SECOND public identity for the
   same agent, the first one keyless for good. (With no display name it was worse: registration() makes a new random
   handle each call, so the second try did not even clash.) So each attempt is written ahead: the name goes into the
   agent's keys entry as `registering` before the POST, and only a 201 replaces it. A later attempt that finds the mark
   looks the name up publicly first:
   - 404 (no active agent has it): register again, reusing a generated handle (a nameless agent got a new random
     one each call) or the agent's display name as it is now (a deactivated holder keeps its name, so that register
     409s and the loop takes a suffix, as before);
   - 200, made within a clock margin either side of our try: very likely ours with no key. Register nothing: the agent
     does not post until the name is free again (asked hourly), the log says so once, and its posts show
     agentNameUnclaimed. Made well before or well after our try: somebody else's; drop the mark and register as
     before (suffix);
   - anything else (no answer, a 5xx): wait for the next sweep.
   The mark is cleared only by an answer that proves nothing was made, a 4xx. A 5xx (a gateway can answer 504 after
   the service committed) or a 2xx without a usable body (request() returns the status even when the body never
   arrives) keeps it. The name looked up is the name sent: the service cleans both the same way, and registration()
   sends a generated handle for every name the service would swap for its own (profileName). A mark outlives a
   rename on purpose for the 200 case (the account may exist under the old name); after a 404 a display name is
   taken as it is now. An entry with no apiKey is skipped by every other loop here. */
const REGISTER_LOST_RECHECK_MS = 60 * 60 * 1000;
const REGISTER_CLOCK_SKEW_MS = 10 * 60 * 1000;
async function ensureRegistered(agentKey, keys, now, ctx = {}) {
  if (keys[agentKey] && keys[agentKey].apiKey) return keys[agentKey];
  if ((registerRetryAt.get(agentKey) || 0) > now) return null;
  const reg = registration(agentKey);
  const mark = keys[agentKey] && keys[agentKey].registering;
  if (mark && typeof mark.name === 'string' && mark.name) {
    let lookPath;
    try { lookPath = '/agents/by-name/' + encodeURIComponent(mark.name); } catch { lookPath = null; }
    if (!lookPath) {                                   // a mark from before the half-character rule: drop it, start again
      delete keys[agentKey];
      saveJson(keysFile(), keys);
      return null;
    }
    const look = await request('GET', lookPath);
    /* Review 2: an account made well BEFORE our first try is somebody else's (a common name another install holds,
       and our try was lost before it reached the service). Then the mark is not ours: drop it and register as
       before, where the 409 takes a suffix. The margin allows for our clock and the service's to disagree. */
    const madeAt = look.status === 200 && look.json ? Date.parse(look.json.registered_at) : NaN;
    const triedAt = Date.parse(mark.at);
    // Review 5: nor is one made well AFTER it. A lost POST commits within seconds of the try (the client gives up at
    // timeoutMs), so an account made later is somebody's who took the name while ours sat unanswered (a week off, a
    // sleeping Mac, a run of 5xx lookups). Only an account made within the margin either side is taken as ours.
    // A missing or unreadable registered_at cannot say "not ours", so the name is held: no twin, the safe side.
    const notOurs = Number.isFinite(madeAt) && Number.isFinite(triedAt)
      && (madeAt < triedAt - REGISTER_CLOCK_SKEW_MS || madeAt > triedAt + REGISTER_CLOCK_SKEW_MS);
    if (look.status === 200 && notOurs) {
      delete keys[agentKey];
      saveJson(keysFile(), keys);
    } else if (look.status === 200) {
      if (!mark.taken) {
        keys[agentKey] = { registering: { ...mark, taken: true } };
        saveJson(keysFile(), keys);
        log(`register for ${agentKey}: "${mark.name}" exists on the community, very likely from an earlier try whose answer was lost, and the board has no key for it; not registering a second identity. Checked again hourly; it registers once the name is free.`);
      }
      registerRetryAt.set(agentKey, now + REGISTER_LOST_RECHECK_MS);
      return null;
    } else if (look.status !== 404) {
      return null;                                    // could not tell: the next sweep asks again
    } else {
      // Nothing live under it. With no usable display name now, the marked name is reused (a nameless agent got a new
      // random handle each call, which made the old retry a twin under another name; if the owner has since cleared
      // the display name, the marked one is still used, the name it tried last). A usable display name is taken as it
      // is NOW (review 3: a renamed agent must not register its old one).
      if (profileName(readProfileSafe(agentKey)) === null) reg.name = mark.name;
    }
  }
  const base = reg.name;
  for (let i = 0; i < 3; i++) {
    // The wall clock at the POST, not the sweep's `now` (review 6): a sweep working through a slow backlog can reach
    // this register many minutes after it began, and the age check compares this time with the account's.
    keys[agentKey] = { registering: { name: reg.name, at: new Date().toISOString() } };
    saveJson(keysFile(), keys);                       // written ahead, so a lost answer is looked up, not repeated
    const r = await request('POST', '/agents/register', { ...ctx, body: reg });
    if (r.status === 201 && r.json && typeof r.json.api_key === 'string' && typeof r.json.token === 'string') {
      keys[agentKey] = {
        remoteId: String(r.json.agent_id || ''), name: String(r.json.name || reg.name),
        apiKey: r.json.api_key, token: r.json.token, registeredAt: new Date().toISOString(),
      };
      saveJson(keysFile(), keys);
      return keys[agentKey];
    }
    // Only a 4xx proves nothing was made. No answer, a 5xx, or a 2xx we could not read: the mark stays, and the next
    // try looks the name up first.
    if (!(r.status >= 400 && r.status < 500)) return null;
    delete keys[agentKey];
    saveJson(keysFile(), keys);
    if (r.status === 429) registerRetryAt.set(agentKey, now + Math.max(60, r.retryAfter || 3600) * 1000);
    if (r.status !== 409) return null;               // a name clash retries; anything else waits for the next sweep
    reg.name = cutUtf16(base, 72) + '-' + crypto.randomBytes(2).toString('hex');
  }
  return null;
}

// A request as the agent, re-logging in once if the token has expired.
async function asAgent(agentKey, keys, method, pathname, body, ctx = {}) {
  const k = keys[agentKey];
  let r = await request(method, pathname, { ...ctx, token: k.token, body });
  if (r.status !== 401) return r;
  const login = await request('POST', '/agents/login', { ...ctx, body: { name: k.name, api_key: k.apiKey } });
  if (login.status === 200 && login.json && typeof login.json.token === 'string') {
    k.token = login.json.token;
    saveJson(keysFile(), keys);
    r = await request(method, pathname, { ...ctx, token: k.token, body });
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
  // #4800: held because an account under this agent's name exists with no key here: recorded, so statuses() says so.
  if (!k && keys[agentKey] && keys[agentKey].registering && keys[agentKey].registering.taken && !sent[post.id]) {
    sent[post.id] = rec;
    saveJson(sentFile(), sent);
  }
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
 * #4373 part B: send one published comment on a SERVICE post, as its registered agent.
 * POST /posts/{remotePostId}/comments { body, parent_id? } (kosmos-community #15; parent_id for a reply, #4833). The service holds
 * nothing back (holding is the board's job, already done: only published rows get here).
 * AT MOST ONCE: the service has no "my comments" route to look a comment up by, so a send
 * that got no answer is recorded `unconfirmed` and never sent again. A doubled public
 * comment is the worse failure; the record says what happened.
 */
const commentsInFlight = new Set();   // #4801 review 1: comment ids whose POST this process has out right now
async function sendComment(c, keys, csent, now) {
  const agentKey = c.agent;
  // Comments wait on their OWN cap: the service counts posts (3 a day) and comments (20 a day) apart, so a
  // post's 429 must not hold this agent's comments back for a day, nor a comment's its posts.
  if (keys[agentKey] && keys[agentKey].commentRetryAt && Date.parse(keys[agentKey].commentRetryAt) > now) return;
  const k = await ensureRegistered(agentKey, keys, now);
  const parent = typeof c.remoteParentId === 'string' && c.remoteParentId ? c.remoteParentId : null;
  const rec = csent[c.id] || { state: 'pending', agent: agentKey, post: c.remotePostId };
  if (k && k.refused) { csent[c.id] = rec; return; }
  if (!k) {
    // Not registered with the service yet (a failure other than a refusal): recorded, so /sent shows why it has not
    // gone, and left pending without an attempted mark, so the next sweep tries again.
    if (!(csent[c.id] && Array.isArray(csent[c.id].reasons) && csent[c.id].reasons.includes('not_registered'))) {
      csent[c.id] = { ...rec, state: 'pending', reasons: ['not_registered'] };
      log(`a comment waits: agent ${agentKey} is not registered with the community yet; it is tried again on the next pass`);
    }
    return;
  }
  // #4801 review 1: a removal can arrive while ensureRegistered was on the network (the agent's first registration),
  // after sweepComments' own read. Read again, as late as possible before the write-ahead: removed, it never goes.
  // Unreadable, send nothing (left as it was, so the next sweep decides).
  const cdel = loadJson(commentDeletesFile());
  if (!cdel) return;
  if (Object.prototype.hasOwnProperty.call(cdel, c.id)) { csent[c.id] = settle(rec, { state: 'withheld' }); return; }
  const body = { body: String(c.body || '') };
  // #4833: a reply goes into the thread of the comment it answers. Never dropped: a reply sent without its parent
  // would land as a top-level comment answering nobody, so a reply either goes as a reply or is refused there.
  if (parent) body.parent_id = parent;
  if (!body.body.trim()) { csent[c.id] = settle(rec, { state: 'refused', reasons: ['empty'] }); return; }
  // Write-ahead: a board that stops while the POST is out finds this mark and does not send again.
  csent[c.id] = { ...rec, attempted: true };
  saveJson(commentsSentFile(), csent);
  // #4801 review 1: while the POST is out the owner's list says "Sending" and a removal is refused as busy, not as
  // "never learned whether it arrived": in a minute it has an answer. In memory on purpose: a board that stopped
  // mid-POST has nothing in flight, and its mark reads as unconfirmed, as before.
  commentsInFlight.add(c.id);
  let r;
  try { r = await asAgent(agentKey, keys, 'POST', '/posts/' + encodeURIComponent(c.remotePostId) + '/comments', body); }
  finally { commentsInFlight.delete(c.id); }
  if (r.status === 201) {
    // #4801: which service agent stored it (agentId), so a removal is only ever asked by that same agent: after keys.json is
    // lost and the agent registers afresh, the service answers 404 "not yours", which would read as removed.
    csent[c.id] = settle(rec, { state: 'sent', sentAt: new Date(now).toISOString(), ...(r.json && r.json.id ? { remoteId: String(r.json.id) } : {}), ...(k.remoteId ? { agentId: k.remoteId } : {}) });
  } else if (r.status === 404) {
    // #4833: the service answers a reply whose comment is gone (removed, its author deactivated, or not on this post)
    // with 404 "comment not found", and a missing post with 404 "post not found": the post may be fine.
    const commentGone = parent && r.json && r.json.detail === 'comment not found';
    csent[c.id] = settle(rec, { state: 'refused', reasons: [commentGone ? 'comment_gone' : 'post_gone'] });
  } else if (r.status === 409) {
    // Only a reply can meet a full thread (kosmos-community answers 409 thread_full on parent_id): recorded, not retried.
    csent[c.id] = settle(rec, { state: 'refused', reasons: ['thread_full'] });
  } else if (r.status === 422) {
    const why = refusalReasons(r.json);
    const err = r.json && r.json.detail && typeof r.json.detail.error === 'string' && /^[a-z_]{1,40}$/.test(r.json.detail.error) ? [r.json.detail.error] : [];
    // The service's validation answer is a LIST under detail (its RequestValidationError handler): a fixed class,
    // never the server's own text.
    const invalid = r.json && Array.isArray(r.json.detail) ? ['invalid_text'] : [];
    csent[c.id] = settle(rec, { state: 'refused', reasons: why.length ? why : (err.length ? err : (invalid.length ? invalid : ['rejected'])) });
  } else if (r.status === 429) {
    // The daily comment cap: nothing was stored. Wait as long as the server says, across sweeps.
    csent[c.id] = settle(rec, {});
    k.commentRetryAt = new Date(now + Math.max(60, r.retryAfter || 3600) * 1000).toISOString();
    saveJson(keysFile(), keys);
  } else if (r.status === 401) {
    csent[c.id] = settle(rec, { lastStatus: 401 });
    log(`comment for ${agentKey}: the server refused the token and a new one could not be had; retrying next sweep`);
  } else if (r.status >= 400 && r.status < 500) {
    csent[c.id] = settle(rec, { state: 'refused', reasons: ['http_' + r.status] });
    log(`comment for ${agentKey}: refused with ${r.status}`);
  } else {
    csent[c.id] = settle(rec, { state: 'unconfirmed', ...(r.status ? { lastStatus: r.status } : {}) });
    log(`comment for ${agentKey}: no usable answer (status ${r.status || 'none'}); it may be on the server, so it is not sent again`);
  }
}

async function sweepComments(keys, from, now) {
  const csent = loadJson(commentsSentFile());
  if (!csent) {
    // Unreadable: send no comment rather than re-send one. NOT safely removable: without it every comment already sent
    // in this ON period looks unsent and would go again (review 6), so it has to be repaired, not deleted.
    if (!reportedCorrupt.has('comments-sent-not-removable')) {
      reportedCorrupt.add('comments-sent-not-removable');
      log('comments-sent.json cannot be read: comments are not sent until it is REPAIRED; removing it would send again every comment already sent');
    }
    return;
  }
  const due = communitystore.publishedServiceComments()
    .filter((c) => c.author && c.author.type === 'agent' && typeof c.agent === 'string' && c.agent)
    .filter((c) => from && String(c.releasedAt || c.receivedAt) >= from)
    .filter((c) => !csent[c.id] || (csent[c.id].state === 'pending' && !csent[c.id].attempted));
  for (const c of due) {
    if (!switchOn()) break;
    // Still the ON period this sweep began in? An OFF (which ends the period at once, endOnPeriodNow) and an ON while
    // this sweep was on the network leave a new start, or none yet, and the old window no longer holds (review).
    const cur = loadJson(stateFile());
    if (!cur || cur.since !== from) break;
    // #4801: re-read the owner's comment removals before each send, as the post pass does: one can arrive while this
    // sweep waits. Unreadable, send nothing more: a comment the owner removed must never go out.
    const cdel = loadJson(commentDeletesFile());
    if (!cdel) break;
    try {
      if (Object.prototype.hasOwnProperty.call(cdel, c.id)) {
        // Removed before it was sent: withheld, never sent (due only lists comments never attempted).
        csent[c.id] = settle(csent[c.id] || { agent: c.agent, post: c.remotePostId }, { state: 'withheld' });
      } else {
        await sendComment(c, keys, csent, now);
      }
      saveJson(commentsSentFile(), csent);
    } catch (e) {
      log(`comment ${c.id}: ${e && e.code ? e.code : 'failed'}; the next sweep tries again`);
    }
  }
}

/**
 * #4801: the owner removed a comment that went out. DELETE /posts/{post}/comments/{remoteId} as the agent that sent it
 * (kosmos-community #24: the service lets only the comment's own agent remove it). 204, or 404 (already gone), settles
 * it as deleted; anything else keeps deleteStatus and is tried again next sweep, like sweepDeletes. Only a comment the
 * service answered with its id can be found: an unconfirmed one, or a sent one with no id, is never asked about, since
 * the service has no list of an agent's comments to look it up in. Runs whatever the switch says.
 */
async function sweepCommentDeletes(keys) {
  const cdel = loadJson(commentDeletesFile());
  if (!cdel) return;
  const first = loadJson(commentsSentFile());
  if (!first) return;
  for (const id of Object.keys(cdel)) {
    const rec = first[id];
    if (!rec || rec.state !== 'sent' || !rec.remoteId || !rec.post) continue;
    const k = keys[rec.agent];
    if (!k || !k.apiKey || k.refused) continue;
    if (!sameServiceAgent(rec, k)) continue;          // another registration: its 404 would not mean "gone"
    const r = await asAgent(rec.agent, keys, 'DELETE',
      '/posts/' + encodeURIComponent(rec.post) + '/comments/' + encodeURIComponent(rec.remoteId));
    // Saved against a fresh read, so a "will not go" record markNotSent added while this DELETE was out is kept.
    const csent = loadJson(commentsSentFile());
    if (!csent || !csent[id] || csent[id].state !== 'sent') continue;
    if (r.status === 204 || r.status === 404) {
      const { deleteStatus: _d, ...rest } = csent[id];
      csent[id] = settle(rest, { state: 'deleted' });
    } else {
      csent[id] = { ...csent[id], deleteStatus: r.status };
      log(`removal of comment ${id}: no success (status ${r.status || 'none'}); retrying next sweep`);
    }
    saveJson(commentsSentFile(), csent);
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
  let from = null;
  if (on && st) {
    from = sinceForOnPeriod(st);
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
  try { await sweepCommentDeletes(keys); }   // #4801
  catch (e) { log(`comment removals: ${e && e.code ? e.code : 'failed'}; the next sweep tries again`); }
  try {
    await sweepTakedowns(keys, sent, now);
    saveJson(sentFile(), sent);
  } catch (e) { log(`take-down reads: ${e && e.code ? e.code : 'failed'}; the next sweep tries again`); }
  try { await sweepIndustry(keys, on); }
  catch (e) { log(`industry: ${e && e.code ? e.code : 'failed'}; the next sweep tries again`); }
  // #4373 part B: comments go after the owner's deletes, the take-down reads and the industry pass, so a slow comment
  // pass (each can take a POST, a login and a re-POST) never holds back taking something off the public site.
  if (on && st && from) {
    try { await sweepComments(keys, from, now); }
    catch (e) { log(`comments: ${e && e.code ? e.code : 'failed'}; the next sweep tries again`); }
  }
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
/* #4774 review 2 (W1): the wait above bounds only the START. A started call can make several requests (a profile
   lookup, up to 3 registrations, the following list, the call, a re-login and the call again), each up to timeoutMs,
   and both CLIs give up at 30 s. So the whole call, from the moment it was queued, has AGENT_BUDGET_MS: before each
   request, if less than one request's timeout is left, it stops and answers busy without starting that request. */
const AGENT_BUDGET_MS = 25000;
let agentBudgetMs = AGENT_BUDGET_MS;
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
 * `beforeRegister(publicGet, budget)` runs only for an agent about to be registered, and
 * `beforeCall(publicGet, myName, budget)` just before the request; either returns null to go on, or a value that is
 * handed back as `answered`. `publicGet(path)` is a GET with NO bearer, so the hooks can read public pages but never
 * hold a key. `budget` is { remainingMs, requestMs }: the time left of AGENT_BUDGET_MS when the hook is called, and one
 * request's timeout, so a hook doing optional work can skip it when the time is short.
 * Review 2 (BLOCKER): every answer here is read up to RESPONSE_CAP (256 KiB), not the sweep's larger default.
 */
function agentCall(agentKey, method, pathname, opts = {}) {
  if (agentsInCall.has(agentKey)) return Promise.resolve(busy());
  agentsInCall.add(agentKey);
  const deadline = Date.now() + agentBudgetMs;         // review 2 (W1): measured from queue time
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
      return agentCallNow(agentKey, method, pathname, { ...opts, deadline });
    }).then(done, () => done({ ok: false, because: 'the community could not be reached' }));
  });
}

async function agentCallNow(agentKey, method, pathname, opts = {}) {
  try { return await agentCallSteps(agentKey, method, pathname, opts); } catch (e) {
    if (e instanceof OverBudget) return busy();      // review 2 (W1): nothing was started past the budget
    throw e;
  }
}

async function agentCallSteps(agentKey, method, pathname, { register = true, beforeRegister, beforeCall, deadline = null } = {}) {
  const local = (because) => ({ ok: false, local: true, because });
  const ctx = { cap: RESPONSE_CAP, deadline };
  const budget = () => ({ remainingMs: deadline == null ? Infinity : deadline - Date.now(), requestMs: timeoutMs });
  if (!switchOn()) return local('the Kosmos community is switched off on this board');
  if (!endpointAllowed()) return local('the community address is not https, so nothing is sent to it');
  if (!sender && underTest()) return local('no network in tests');
  const publicGet = async (p) => { const r = await request('GET', p, ctx); return { status: r.status, json: r.json }; };
  const keys = loadJson(keysFile());
  if (!keys) return local('this board\'s community keys cannot be read, so it cannot act as the agent');
  const k = keys[agentKey];
  if (k && k.refused) return local('the community switched off this agent\'s account');
  if (!(k && k.apiKey)) {
    if (!register) return { ok: true, status: 0, json: null, unregistered: true };
    if (beforeRegister) {
      const a = await beforeRegister(publicGet, budget());
      if (a != null) return { ok: true, answered: a };
    }
    if (!(await ensureRegistered(agentKey, keys, Date.now(), ctx))) {
      return { ok: false, because: 'the community could not register this agent just now; try again later' };
    }
  }
  if (beforeCall) {
    const a = await beforeCall(publicGet, String(keys[agentKey].name || ''), budget());
    if (a != null) return { ok: true, answered: a };
  }
  const r = await asAgent(agentKey, keys, method, pathname, undefined, ctx);
  if (r.status === 0) return { ok: false, because: 'the community could not be reached' };
  if (keys[agentKey] && keys[agentKey].refused) return local('the community switched off this agent\'s account');
  return { ok: true, status: r.status, json: r.json };
}

/**
 * The owner deleted a post on the board. Recorded in deletes.json, which only this
 * function writes; the sweep sends a DELETE for a post already sent, and never sends
 * one that was not.
 * #4801: or a comment on a service post, recorded in comment-deletes.json instead (never deletes.json). The id is
 * looked up as a post first, then as a service comment.
 */
function requestDelete(localId) {
  const id = typeof localId === 'string' ? localId : '';
  if (!id) return { ok: false, because: 'a post id is required' };
  try {
    const meta = communitystore.postMeta(id);
    if (!meta) return requestCommentDelete(id);
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

function requestCommentDelete(id) {
  const meta = communitystore.commentMeta(id);
  if (!meta) return { ok: false, missing: true, because: 'there is no such post or comment' };
  if (meta.authorType !== 'agent') return { ok: false, notEligible: true, because: 'the board never sends that comment' };
  const cdel = loadJson(commentDeletesFile());
  if (!cdel) return { ok: false, because: 'we could not read the list of removed comments' };
  // A comment that may be out but cannot be found again is refused rather than recorded: recorded, the owner's list
  // would say "coming down" forever, since sweepCommentDeletes has no id to ask the service about.
  const recs = commentRecords();
  // #4801 review 2: comments-sent.json unreadable: what happened to this comment is unknown, so nothing is recorded.
  if (!recs) return { ok: false, retryable: true, because: 'Kosmos could not read its record of sent comments just now' };
  const before = recs[id];
  // #4801 review 3: refused up front, in plain words, for every comment the owner's list never offers a removal for:
  // nothing is recorded, so no row can say "Removing" for something that is not out or cannot be taken down.
  if (before) {
    const no = (because) => ({ ok: false, notEligible: true, because });
    if (before.state === 'refused') return no('The community did not accept this comment, so there is nothing to remove');
    if (before.state === 'deleted') return no('This comment has already been removed from the community');
    if (before.state === 'withheld') return no('This comment was removed before it was sent');
    if (before.state === 'not_sent') return no('This comment was never sent, so there is nothing to remove');
    if (before.state === 'sent' && before.agentRefused) return no('The community refused this agent, so Kosmos cannot remove its comments');
  }
  // #4801 review 1: out on the network right now. Not "never learned": it has an answer within a minute.
  if (before && !cdel[id] && before.state === 'sending') {
    return { ok: false, busy: true, because: 'It is being sent right now; try again in a minute' };
  }
  // #4801 review 1: keys.json unreadable: whether this is the registration that sent it is unknown, not "another".
  if (before && !cdel[id] && before.state === 'sent' && before.traceable === null) {
    return { ok: false, retryable: true, because: 'Kosmos could not read its community registrations just now' };
  }
  if (before && !cdel[id] && (before.state === 'unconfirmed' || (before.state === 'sent' && !before.traceable))) {
    return { ok: false, notEligible: true, because: before.state === 'unconfirmed'
      ? 'Kosmos never learned whether this comment arrived, so it cannot remove it'
      : before.untraceableReason === 'other-registration'
        ? 'Kosmos no longer holds the registration that sent this comment, so it cannot remove it'
        : before.untraceableReason === 'registration-unknown'
          ? 'Kosmos cannot tell whether the registration it holds sent this comment, so it cannot remove it'
        : 'Kosmos has no way to find this comment again, so it cannot remove it' };
  }
  if (!cdel[id]) {
    cdel[id] = new Date().toISOString();
    saveJson(commentDeletesFile(), cdel);
  }
  const after = commentRecords();
  const rec = after && after[id];
  return { ok: true, state: rec ? rec.state : 'withheld' };
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
    // #4800: only when true, so every other status keeps its shape.
    ...(k && !k.apiKey && k.registering && k.registering.taken ? { agentNameUnclaimed: true } : {}),
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
 * #4373 part B: will a comment published NOW go to the community? True only if the switch is on, the send state is
 * readable, the ON period has a start at or before now (recorded here if a sweep has not yet, so a comment made in
 * the minutes before the first sweep of this ON period is inside the window and not silently skipped), the address
 * is one the layer sends to, and this agent's key has not been refused. Called by the route BEFORE it stores.
 */
function willSend(agentKey, now = Date.now()) {
  const no = { sends: false, later: false };
  if (!switchOn() || !endpointAllowed()) return no;
  const st = loadJson(stateFile());
  const keys = loadJson(keysFile());
  // Every file the sweep refuses to run without (review 6): with any of them unreadable nothing is sent, so the agent
  // is not told "next pass". Checked BEFORE recording anything.
  if (!st || !keys || !loadJson(sentFile()) || !loadJson(deletesFile()) || !loadJson(commentsSentFile())
    || !loadJson(commentDeletesFile())) return no;   // #4801: unreadable, sweepComments sends nothing
  const k = agentKey && keys[agentKey];
  if (k && k.refused) return no;
  if (!sinceForOnPeriod(st)) return no;
  // Past the service's daily comment cap: it goes, but not on the next pass.
  const later = Boolean(k && k.commentRetryAt && Date.parse(k.commentRetryAt) > now);
  return { sends: true, later };
}

/**
 * #4373 part B review 7: record the ON period's start NOW if Community is on and no sweep has yet, so something made
 * public from a request (a release) in the minutes before the first sweep is inside the window and not silently
 * skipped. The same first-writer-wins record as willSend. Nothing happens while off or with an unreadable state.
 */
function recordPeriodStart() {
  if (!switchOn() || !endpointAllowed()) return false;   // as the sweep: no start for an address it will not send to
  const st = loadJson(stateFile());
  if (!st) return false;
  return Boolean(sinceForOnPeriod(st));
}

/**
 * #4373 part B review 5/6: a PUBLISHED comment the agent was told "will not go" must then never go, or a resend by the
 * agent doubles it in public. The AUTHORITATIVE mark is on the comment row (communitystore.markServiceCommentNotSent),
 * which the sweep only reads, so a sweep in flight cannot lose it, and it holds for every address. A record in
 * comments-sent.json is added as well, best effort, so /sent shows it; losing that one loses nothing that matters.
 */
function markNotSent(commentId, agentKey, remotePostId) {
  if (!communitystore.markServiceCommentNotSent(commentId)) return false;
  try {
    const csent = loadJson(commentsSentFile());
    if (csent && !csent[commentId]) {
      csent[commentId] = { state: 'not_sent', agent: agentKey, post: remotePostId || null, reasons: ['not_sending'] };
      saveJson(commentsSentFile(), csent);
    }
  } catch { /* the row's mark is what keeps it home */ }
  return true;
}

/** #4373 part B: what happened to each comment the board has tried to send, and those marked never to send. No keys. */
function commentStatuses() {
  const csent = loadJson(commentsSentFile()) || {};
  const keys = loadJson(keysFile()) || {};
  const out = {};
  for (const [id, rec] of Object.entries(csent)) {
    let state = rec.state || 'pending';
    if (state === 'pending' && rec.attempted) state = 'unconfirmed';
    const k = rec.agent && keys[rec.agent];
    out[id] = { state, agent: rec.agent || null, post: rec.post || null, agentRefused: !!(k && k.refused), ...(Array.isArray(rec.reasons) ? { reasons: rec.reasons } : {}), ...(typeof rec.lastStatus === 'number' ? { lastStatus: rec.lastStatus } : {}) };
  }
  return out;
}

/**
 * #4801: each comment the board has a record for or the owner asked to remove, for the owner's own list
 * (engine/communitymine.js). No keys and no remote ids: `traceable` says only whether the service answered with the
 * comment's id, which is what a removal needs. A pending comment the owner removed reads withheld, as a post does.
 * #4801 review 2: null when comments-sent.json or comment-deletes.json is unreadable. Read as empty, a removed comment
 * would be offered Delete again, or every comment would vanish into a false "none".
 */
function sameServiceAgent(rec, k) {
  if (rec.agentId) return Boolean(k && k.remoteId === rec.agentId);
  // #4801 review 1: a record with no agentId (sent before agentId was recorded) is this registration's only when the
  // registration is no newer than the send: one made after it is a fresh service agent, whose 404 means "not mine".
  return Boolean(k && typeof k.registeredAt === 'string' && typeof rec.sentAt === 'string' && k.registeredAt <= rec.sentAt);
}
/* #4801 review 4: why a sent comment with an id is not this registration's, or null when it is. 'other-registration'
   only when that is KNOWN: the record names a service agent that is not the one held, or no registration is held at
   all. A record with no agentId (every board on main writes those) whose registration is newer than its sentAt is
   'registration-unknown': sentAt is the sweep's START, and a registration made inside that same sweep is newer than
   it, so the comparison cannot tell a fresh registration from the one that sent it. No time tolerance on purpose:
   a re-registration shortly after a send would then ask for a delete as the wrong service agent, get a 404, and mark
   the comment Removed while it is still public. */
function registrationMismatch(rec, k) {
  if (!k) return 'other-registration';
  if (rec.agentId) return k.remoteId === rec.agentId ? null : 'other-registration';
  return sameServiceAgent(rec, k) ? null : 'registration-unknown';
}
function commentRecords() {
  const csent = loadJson(commentsSentFile());
  const cdel = loadJson(commentDeletesFile());
  if (!csent || !cdel) return null;
  // #4801 review 1: unreadable keys.json is NOT "no registrations": traceability is then unknown (null), never false.
  const keysRead = loadJson(keysFile());
  const keys = keysRead || {};
  const out = {};
  for (const id of new Set([...Object.keys(csent), ...Object.keys(cdel)])) {
    const rec = csent[id] || {};
    const deleteRequested = Object.prototype.hasOwnProperty.call(cdel, id);
    let state = rec.state || 'pending';
    if (state === 'pending' && rec.attempted) state = commentsInFlight.has(id) ? 'sending' : 'unconfirmed';
    else if (deleteRequested && state === 'pending') state = 'withheld';
    const k = rec.agent && keys[rec.agent];
    const hasHandle = state === 'sent' && typeof rec.remoteId === 'string' && rec.remoteId !== '' && Boolean(rec.post);
    out[id] = {
      state, deleteRequested,
      deleteRetrying: deleteRequested && state === 'sent' && typeof rec.deleteStatus === 'number',
      agentRefused: !!(k && k.refused),
      // Sent, with the id the service answered, by the registration this board still holds (sameServiceAgent);
      // null when that cannot be told because keys.json is unreadable.
      traceable: hasHandle && !keysRead ? null : hasHandle && sameServiceAgent(rec, k),
      // #4801 review 3: why a sent comment cannot be found again, without any id: the service gave no id ('no-id'),
      // or the registration that sent it is not the one this board holds now ('other-registration'), or (review 4)
      // whether it is cannot be told from a record with no agentId ('registration-unknown'). Null otherwise.
      untraceableReason: state !== 'sent' ? null : !hasHandle ? 'no-id'
        : keysRead ? registrationMismatch(rec, k) : null,
    };
  }
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
function setAgentBudgetMs(ms) { agentBudgetMs = ms == null ? AGENT_BUDGET_MS : ms; }

module.exports = {
  switchOn, willSend, markNotSent, recordPeriodStart, endOnPeriodNow, industryUnreachable, sweep, agentCall, requestDelete,
  statuses, commentStatuses, commentRecords, payload, titleFor, registration, underTest,
  setSender, setTimeoutMs, setSwitch, setAgentWaitMs, AGENT_WAIT_MS, setAgentBudgetMs, AGENT_BUDGET_MS, readCapped,
  RESPONSE_CAP, SWEEP_RESPONSE_CAP, PAYLOAD_KEYS, DEFAULT_ENDPOINT, DEFAULT_CHANNEL,
  _paths: { dir, endpointDir, stateFile, keysFile, sentFile, deletesFile, commentsSentFile, commentDeletesFile },
};
