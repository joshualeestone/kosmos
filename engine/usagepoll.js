'use strict';
/* kosmos#7152 slice 1: each Claude account's REAL weekly and five-hour usage, with reset times, for an IDLE account too.
 *
 * WHY NOT ONLY THE STATUS LINE: kosmos-statusline.js records an account's reading when an agent on it takes a turn, so an
 * account nobody is using right now is never measured, and that is exactly the spare account a person would move agents
 * onto. Measured on a build Mac 2026-10-25: a fleet sat for 11.5 hours with one account out of its week while another,
 * at 0%, had no reading at all.
 *
 * THE SOURCE: GET https://api.anthropic.com/api/oauth/usage, the endpoint behind Claude Code's /usage screen, with the
 * account's OAuth access token and `anthropic-beta: oauth-2025-04-20`. It returns `seven_day` and `five_hour`, each with
 * `utilization` (a percentage) and `resets_at` (ISO 8601). It is not a documented API, so this is a SECOND source next to
 * the status line, never a replacement: accountsweekly uses whichever reading is newer, and an account this module cannot
 * read keeps its status-line reading.
 *
 * 🛑 SECRET DISCIPLINE, as loginexpiry.js: the credential body is parsed in tokenStateFor and the token leaves it only to
 *    be put in one request header to api.anthropic.com. It is never logged, returned to a route, or written: the file
 *    this module writes holds numbers and a state word. (Clearing the local variables after use does not erase the
 *    token from memory; the guarantee is what is never logged, written or returned, not when memory is freed.)
 * 🛑 NEVER REFRESHES A TOKEN. Claude Code rotates the refresh token when it refreshes, and a second refresher can leave a
 *    live agent's login broken. An expired access token is recorded as `token-expired`: the account is NOT measured.
 *
 * WHICH CREDENTIAL: the one the account's agents read (loginexpiry.serviceNameFor). Kosmos starts a default-account
 * agent with CLAUDE_CONFIG_DIR unset, so the default account reads the bare entry; any other account reads the entry
 * for its own folder. On macOS that is the login Keychain; elsewhere it is the folder's `.credentials.json`.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const loginexpiry = require('./loginexpiry');
const statusline = require('./kosmos-statusline');

const FILE = 'kosmos-usage.json';
const HOST = 'api.anthropic.com';
const USAGE_PATH = '/api/oauth/usage';
const PROFILE_PATH = '/api/oauth/profile';
const BETA = 'oauth-2025-04-20';
/* Review 5: Node sends no User-Agent by default, and the real response was read with a client that sends one. Sending
   our own means the read does not depend on the endpoint accepting a request without one. */
const USER_AGENT = 'Kosmos usage reader';
const POLL_MS = 10 * 60 * 1000;   // the board's timer: often enough to see a week run down, rare enough to cost nothing
const FRESH_MS = 30 * 60 * 1000;  // older than three missed polls: the reading is not used
const TIMEOUT_MS = 15000;
/* Review 4: the endpoint computes a reset time with a fraction of a second, and the fraction moves between reads (measured
   2026-10-25: one account's weekly reset read 14:00:00.447, then 13:59:59.569, then 13:59:59.863). Two resets this
   close are the same window. The status line allows the same for the same reason (LATEST_SAME_RESET_SECONDS). */
const SAME_RESET_SECONDS = 60;
/* A token that runs out this soon is treated as expired: sent now it would come back refused, and the state would be
   a refusal rather than the expiry it is. */
const EXPIRY_MARGIN_MS = 60 * 1000;
/* Review 14: after a refusal (401, 403 or 429) the same token is not sent again for an hour. The token is the one
   Claude Code itself uses, so repeated refused requests must not put the operator's live agents at risk. */
const BACKOFF_MS = 60 * 60 * 1000;

/* Review 22: the backoff as one rule, replacing the case-by-case additions of reviews 14 to 21.
   - A REFUSAL is every answer to a request that was sent, other than a reading, a server error (5xx) or no answer at
     all: any other status from either request (4xx, and a redirect, which is not followed), an answer that cannot be
     read as what this expects (review 23: the endpoint has changed shape), a profile naming no login (or no
     organization when the folder names one), and another login's token. Only a 5xx or no answer is read again on the
     next sweep. A state from a sweep that sent nothing (no credential, an expired token, no email listed) is not a
     refusal.
   - A refusal holds the account for an hour, for the login that was refused (a new login is read at once), and for
     the token that was refused (identified by its expiry time, not a secret), except a 429, which is the account's
     rate limit and holds across a renewed token.
   - A clock that steps back inside the hour still holds; a refusal stamped more than an hour away either way has
     expired (review 18).
   - The refusal is kept in memory as well as in the record, and the newer copy wins, so a folder that cannot be
     written, or a record that cannot be read, does not erase it, and every record that is not a reading carries a
     refusal still within its hour, so a restarted board keeps it too. While held, the record's state is the refusal. A reading with another token does not clear it:
     the refused token stays refused for its hour if it comes back. */
function isRefusal(state) {
  if (typeof state !== 'string') return false;
  if (/^(profile-)?http-5\d\d$/.test(state)) return false;
  return /^(profile-)?http-\d{3}$/.test(state)
    || ['unreadable-response', 'profile-unreadable', 'other-account'].includes(state);
}
const refusals = new Map();   // account folder -> its last refusal, the in-memory copy

function refusalOf(dir, rec, nowMs) {
  const fromFile = rec && typeof rec.refusedAt === 'number' && Number.isFinite(rec.refusedAt)
    && isRefusal(typeof rec.refusedState === 'string' ? rec.refusedState : rec.state)
    ? { refusedState: typeof rec.refusedState === 'string' ? rec.refusedState : rec.state, refusedAt: rec.refusedAt,
      refusedEmail: rec.refusedEmail, refusedExpiresAt: rec.refusedExpiresAt === undefined ? null : rec.refusedExpiresAt }
    : null;
  const inMemory = refusals.get(dir) || null;
  if (!fromFile) return inMemory;
  if (!inMemory) return fromFile;
  /* Review 23: a copy still within its hour beats one that is not, whichever is newer (a clock step can make the
     expired one look newer); between two live copies, the newer. */
  const liveFile = withinHour(fromFile, nowMs);
  const liveMemory = withinHour(inMemory, nowMs);
  if (liveFile !== liveMemory) return liveMemory ? inMemory : fromFile;
  return inMemory.refusedAt >= fromFile.refusedAt ? inMemory : fromFile;
}

function withinHour(ref, nowMs) { const age = nowMs - ref.refusedAt; return age < BACKOFF_MS && age > -BACKOFF_MS; }

/* Whether this account is held back now: a usable token that is the refused one (or any token after a 429), for the
   refused login, within the hour. A token that is not usable sends nothing anyway, so it is never "held". */
function holds(ref, a, t, nowMs) {
  if (!ref || !t || t.state !== 'ok' || !withinHour(ref, nowMs)) return false;
  if (typeof ref.refusedEmail !== 'string' || typeof a.email !== 'string' || ref.refusedEmail.toLowerCase() !== a.email.toLowerCase()) return false;
  return ref.refusedState.endsWith('429') || t.expiresAt === ref.refusedExpiresAt;
}
/* A week cannot reset further out than this; a reset beyond it is a bad answer, not a reading. */
const WEEK_MAX_AHEAD_SECONDS = 8 * 86400;

/* Review 5: whether the board's sweep may read real credentials at all. A server that a test spawns inherits the test
   process's environment, and live execution is armed there (no --test in its execArgv), so without this the sweep would
   read the operator's real logins and write into the real account folders from a test. NODE_TEST_CONTEXT is set by
   node's own test runner in every test process and by nothing else (the signal ping.js and feedbacksend.js settled
   on). Review 7: a board a harness boots outside node's runner (tools/browser-checks.sh, the shell tests,
   mobile-shots.js) does NOT carry it (tools.no-phone-home-4253.test.js records that), so AGENT_WORKFORCE_DRY_RUN=1,
   which those harnesses set, refuses too. Not every harness sets it, so readCredFor also reads the bare entry only for
   the real home's .claude, which covers every harness that sandboxes HOME or AGENT_WORKFORCE_HOME. A board started
   with the real home, no NODE_TEST_CONTEXT and no DRY_RUN is not covered: it reads the real logins exactly as the
   real board would, and writes the same accurate figures. AGENT_WORKFORCE_USAGE_POLL_OFF=1 is the operator's brake.
   Review 19: and it is OFF unless AGENT_WORKFORCE_USAGE_POLL=1. It sends each person's subscription token to an
   endpoint Anthropic has not documented, and if Anthropic objects the cost may fall on the account itself, which no
   backoff undoes. So nobody's board reads this way until it is switched on deliberately; the status line is
   unchanged either way. */
/* Review 20: whether the reader is switched on at all, which also decides whether its records are shown, so a board
   switched off shows nothing it measured earlier. */
function enabled(env = process.env) { return env.AGENT_WORKFORCE_USAGE_POLL === '1' && env.AGENT_WORKFORCE_USAGE_POLL_OFF !== '1'; }

function liveAllowed(env = process.env) {
  return enabled(env)
    && !env.NODE_TEST_CONTEXT && env.AGENT_WORKFORCE_DRY_RUN !== '1' && env.AGENT_WORKFORCE_USAGE_POLL_OFF !== '1';
}

/* The CLAUDE_CONFIG_DIR value this account's agents run with: unset for the default account (see the header). */
function ccdFor(a) { return a && a.isDefault ? undefined : a && a.dir; }

/* Review 7: the home folder from the user database, not $HOME, so a harness that sandboxes HOME (or
   AGENT_WORKFORCE_HOME) still compares against the real one. */
function realHomeDir() { try { return os.userInfo().homedir; } catch { return null; } }

/* The credential body for an account, or null. macOS: the Keychain entry its agents read. Elsewhere: the folder's own
   credentials file, which is where Claude Code keeps it off macOS. */
function readCredFor(a, { platform = process.platform, readCred = loginexpiry.readCredAsync, realHome = realHomeDir() } = {}) {
  /* Review 14: on every platform, no folder outside the real home is read at all: a sandboxed board's folders are
     not the operator's, and a folder that is not under the real home cannot be one Kosmos made for its agents. */
  const rel = realHome ? path.relative(realHome, path.resolve(a.dir)) : '..';
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return Promise.resolve(null);
  /* Review 7: the bare entry is the operator's own login, and a sandboxed board lists ITS .claude as the default
     account. So the bare entry is read only for a default folder that IS the real home's .claude. */
  if (platform === 'darwin' && a.isDefault && (!realHome || path.resolve(a.dir) !== path.join(realHome, '.claude'))) {
    return Promise.resolve(null);
  }
  if (platform === 'darwin') return readCred(loginexpiry.serviceNameFor(ccdFor(a)));
  return new Promise((resolve) => {
    fs.readFile(path.join(a.dir, '.credentials.json'), 'utf8', (err, body) => resolve(err ? null : body));
  });
}

/* { state } with state 'ok' | 'no-credential' | 'no-token' | 'token-expired', and `token` only when 'ok'. */
async function tokenStateFor(a, { now = Date.now(), ...deps } = {}) {
  let raw;
  try { raw = await readCredFor(a, deps); } catch { raw = null; }
  if (!raw) return { state: 'no-credential' };
  let o;
  try { o = JSON.parse(raw); } catch { return { state: 'no-credential' }; }
  const oauth = o && o.claudeAiOauth;
  const token = oauth && typeof oauth.accessToken === 'string' ? oauth.accessToken : '';
  if (!token) return { state: 'no-token' };
  if (typeof oauth.expiresAt === 'number' && Number.isFinite(oauth.expiresAt) && oauth.expiresAt <= now + EXPIRY_MARGIN_MS) {
    return { state: 'token-expired' };
  }
  return { state: 'ok', token, expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null };
}

/* One GET of the usage endpoint. Resolves { code, body }; code 0 on a network error, an idle socket, or a request that
   is still not finished TIMEOUT_MS after it started (the socket timeout alone would let a peer that trickles bytes keep
   it open, and the poll reads one account at a time). Never rejects. */
function getUsage(token, { request = https.request, timeoutMs = TIMEOUT_MS, path: reqPath = USAGE_PATH } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let req;
    const deadline = setTimeout(() => { try { if (req) req.destroy(); } catch { /* already gone */ } finish({ code: 0, body: '' }); }, timeoutMs);
    if (typeof deadline.unref === 'function') deadline.unref();
    const finish = (v) => { if (!done) { done = true; clearTimeout(deadline); resolve(v); } };
    try {
      req = request({
        host: HOST, path: reqPath, method: 'GET', timeout: timeoutMs,
        headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': BETA, Accept: 'application/json', 'User-Agent': USER_AGENT },
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (body.length < 65536) body += c; });   // an answer past 64 KB is cut short, fails to parse, and reads as unreadable-response
        res.on('end', () => finish({ code: res.statusCode || 0, body }));
        res.on('error', () => finish({ code: 0, body: '' }));
      });
    } catch { finish({ code: 0, body: '' }); return; }
    req.on('timeout', () => { req.destroy(); finish({ code: 0, body: '' }); });
    req.on('error', () => finish({ code: 0, body: '' }));
    req.end();
  });
}

/* { usedPct, resetsAt (epoch SECONDS, as the status line's files) } from one window of the response, or null when the
   usage is not a number. A window with usage but no reset time yet (`resets_at: null`, which a window nobody has used
   can carry) keeps its usage with resetsAt null, so the record still says the account was measured. accountsweekly does not show
   such a window (the /api/status shape carries a reset time); it is kept for slice 2. Measured 2026-10-25: no readable
   account had a null reset, even at 0%, so this is a defensive branch.
   maxAheadSeconds refuses a reset further out than the window can be, as the status line's five-hour reader does. */
function windowOf(w, { nowMs = Date.now(), maxAheadSeconds = null } = {}) {
  if (!w || typeof w !== 'object') return null;
  const pct = w.utilization;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0) return null;
  if (w.resets_at === null || w.resets_at === undefined) return { usedPct: pct, resetsAt: null };
  const at = typeof w.resets_at === 'string' ? Date.parse(w.resets_at) : NaN;
  if (!Number.isFinite(at)) return null;
  const resetsAt = Math.floor(at / 1000);
  if (maxAheadSeconds !== null && resetsAt > nowMs / 1000 + maxAheadSeconds) return null;
  return { usedPct: pct, resetsAt };
}

/* The record for one account: { at (ms), state, weekly?, fiveHour? }, or null for an API-key account (no weekly limit). */
async function readOne(a, { now = Date.now(), request, timeoutMs, identityOf = (dir) => require('./accounts').identityOf(dir), tokenState, ...deps } = {}) {
  if (!a || typeof a.dir !== 'string' || !a.dir || a.apiKey) return null;
  const t = tokenState || await tokenStateFor(a, { now, ...deps });   // review 17: pollAll reads it once and passes it
  if (t.state !== 'ok') return { at: now, state: t.state };
  /* Review 8: with no email listed there is nothing to check the token's login against (see review 6 below), so a
     credential holding another login would put that login's figure here. Not measured, and no request is sent. */
  if (!a.email) return { at: now, state: 'identity-unknown' };
  const r = await getUsage(t.token, { request, ...(timeoutMs ? { timeoutMs } : {}) });
  if (r.code !== 200) return { at: now, state: r.code ? `http-${r.code}` : 'unreachable' };
  let j;
  try { j = JSON.parse(r.body); } catch { return { at: now, state: 'unreadable-response' }; }
  const weekly = windowOf(j && j.seven_day, { nowMs: now, maxAheadSeconds: WEEK_MAX_AHEAD_SECONDS });
  if (!weekly) return { at: now, state: 'unreadable-response' };
  /* Review 6: the credential carries no account, and the one an account's agents read can belong to another login
     (measured on a build Mac: the bare entry and the default folder's entry were two different accounts). So the
     profile behind the same token is checked against the account Kosmos lists: a clear mismatch is not this account's
     reading. Review 7: a profile that cannot be read is not a pass either, since one failed profile read would let
     another login's figure in, and the higher-figure rule would keep it on screen. So it is a failed read, and
     pollAll keeps the last good figures as it does for any other. */
  const p = await getUsage(t.token, { request, path: PROFILE_PATH, ...(timeoutMs ? { timeoutMs } : {}) });
  /* Review 15: a refused profile request is a refusal of the same token (review 22: any 4xx). A server error or no
     answer is not, and is not a reading either. */
  if (p.code === 0 || (p.code >= 500 && p.code < 600)) return { at: now, state: 'profile-unreachable' };
  if (p.code !== 200) return { at: now, state: `profile-http-${p.code}` };
  let email = null;
  let org = null;
  try {
    const pj = p.code === 200 ? JSON.parse(p.body) : null;
    email = pj ? (pj.account || {}).email : null;
    org = pj ? (pj.organization || {}).uuid : null;
  } catch { email = null; }
  if (typeof email !== 'string' || !email) return { at: now, state: 'profile-unreadable' };
  if (email.toLowerCase() !== String(a.email).toLowerCase()) return { at: now, state: 'other-account' };
  /* Review 9: one email can sign in to two organizations (a personal plan and a team), each its own weekly limit. So
     when both sides name the organization, they must agree too. */
  let want = null;
  try { const who = identityOf(a.dir); want = who && who.organizationUuid; } catch { want = null; }
  if (typeof want === 'string' && want) {
    /* Review 10: a profile that names no organization cannot be checked against one, so it is unreadable, as review 7
       made an unreadable email. */
    if (typeof org !== 'string' || !org) return { at: now, state: 'profile-unreadable' };
    if (want !== org) return { at: now, state: 'other-account' };
  }
  const fiveHour = windowOf(j && j.five_hour, { nowMs: now, maxAheadSeconds: statusline.FIVE_HOUR_MAX_AHEAD_SECONDS });
  /* Review 13: the organization the profile answered for, which the record keeps (see pollAll). */
  return { at: now, state: 'ok', weekly, fiveHour, ...(typeof org === 'string' && org ? { org } : {}) };
}

/* Write the record into the account folder, atomically, readable by this user only. Never throws. */
function write(dir, rec) {
  const target = path.join(dir, FILE);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
    fs.renameSync(tmp, target);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing to remove */ }
    return false;
  }
}

/* The file as written, without the freshness rules readUsage applies, or null. */
function readRaw(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch { return null; }
}

/* Read every Claude account in `list` (accounts.list() rows), one after another, and record each. Accounts are read
   one at a time so a slow or hung read never stacks requests. A failed read keeps the last good figures and the moment
   they were measured (`measuredAt`) beside its own state, so one refused or rate-limited read does not throw away a
   reading that is still fresh. Resolves the number of accounts MEASURED this time (state ok). */
/* Review 11: whether a record was written for the login an account has now. The email must match, and so must the
   organization when both name one, since one email can sign in to two organizations (review 9). */
function sameLogin(prev, a, org) {   // exported for accountsweekly, which shows a record only for the same login
  if (!prev || typeof prev.email !== 'string' || typeof a.email !== 'string') return false;
  if (prev.email.toLowerCase() !== a.email.toLowerCase()) return false;
  return !(typeof prev.org === 'string' && prev.org && typeof org === 'string' && org && prev.org !== org);
}

async function pollAll(list, deps = {}) {
  const identityOf = deps.identityOf || ((dir) => require('./accounts').identityOf(dir));
  let measured = 0;
  for (const a of Array.isArray(list) ? list : []) {
    const before = a && typeof a.dir === 'string' ? readRaw(a.dir) : null;
    const nowMs = typeof deps.now === 'number' ? deps.now : Date.now();
    /* Review 17: the token is read once per account per sweep, and that one read decides the backoff, is the token
       sent, and keys a refusal. Review 22: the backoff rule is above isRefusal. */
    let t = null;
    if (a && typeof a.dir === 'string' && a.dir && !a.apiKey) {
      try { t = await tokenStateFor(a, deps); } catch { t = { state: 'no-credential' }; }
    }
    const ref = a && typeof a.dir === 'string' ? refusalOf(a.dir, before, nowMs) : null;
    if (holds(ref, a, t, nowMs)) {
      /* While it waits, the record's `at` moves on so its state (why it is not measured) stays shown; kept figures
         still age out by measuredAt. */
      write(a.dir, { ...(before || {}), ...ref, state: ref.refusedState, at: nowMs });   // review 23: its state is the refusal
      continue;
    }
    let rec = null;
    try { rec = await readOne(a, { ...deps, ...(t ? { tokenState: t } : {}) }); } catch { rec = null; }
    if (!rec) continue;
    let org = null;
    try { const who = identityOf(a.dir); org = who && who.organizationUuid; } catch { org = null; }
    if (rec.state === 'ok') {
      rec.measuredAt = rec.at;
      rec.email = a.email;   // review 9: whose figures these are, so a later failed read keeps them only for the same login
      if (!rec.org && typeof org === 'string' && org) rec.org = org;   // review 11: and in which organization (review 13: the profile's first)
      /* Review 3: each window carries when its figure last CHANGED, as the status line's `at` means (it is written
         only when the figure moves). A read that finds the same figure and reset keeps the earlier changedAt, so an
         idle account does not claim a fresh change every ten minutes, and accountsweekly compares like with like. */
      const prev = readRaw(a.dir);
      for (const key of ['weekly', 'fiveHour']) {
        const w = rec[key];
        if (!w) continue;
        const p = prev && prev[key];
        const same = p && p.usedPct === w.usedPct && typeof p.changedAt === 'number'
          && sameLogin(prev, a, rec.org || org)   // review 17: the organization this read answered for
          && (p.resetsAt === w.resetsAt || (typeof p.resetsAt === 'number' && typeof w.resetsAt === 'number'
            && Math.abs(p.resetsAt - w.resetsAt) <= SAME_RESET_SECONDS));
        w.changedAt = same ? p.changedAt : rec.at;
      }
    } else {
      const prev = readRaw(a.dir);
      if (isRefusal(rec.state)) {
        const fresh = { refusedState: rec.state, refusedAt: rec.at, refusedEmail: a.email, refusedExpiresAt: t && t.state === 'ok' ? t.expiresAt : null };
        refusals.set(a.dir, fresh);
        Object.assign(rec, fresh);
      } else if (ref && withinHour(ref, nowMs)) {
        Object.assign(rec, ref);   // review 21/22: not a reading, so a refusal still within its hour is kept
      }
      const prevAt = prev && (typeof prev.measuredAt === 'number' ? prev.measuredAt : (prev.state === 'ok' ? prev.at : null));
      /* Review 9: a folder signed in again as another login must not show the old login's figures under the new one. */
      if (sameLogin(prev, a, org) && typeof prevAt === 'number' && Number.isFinite(prevAt)) {
        rec.email = prev.email;   // review 10: so a second failed read in a row still knows whose figures these are
        if (typeof prev.org === 'string') rec.org = prev.org;
        rec.measuredAt = prevAt;
        rec.weekly = prev.weekly || null;
        rec.fiveHour = prev.fiveHour || null;
      }
    }
    if (write(a.dir, rec) && rec.state === 'ok') measured += 1;
  }
  return measured;
}

/* The last record for an account folder, as { at, measuredAt, state, weekly, fiveHour }, or null when there is none:
   no file, unreadable, or the last read itself older than FRESH_MS. `state` is the last read's; the figures are from
   `measuredAt`, the last read that worked, and are null once that is older than FRESH_MS. A window whose reset has
   passed reads as null too (a figure from a finished week is not this week's usage). A window with no reset time yet
   keeps resetsAt null (see windowOf). */
function readUsage(dir, nowMs = Date.now()) {
  if (typeof dir !== 'string' || !dir) return null;
  const j = readRaw(dir);
  if (!j || typeof j.at !== 'number' || !Number.isFinite(j.at)) return null;
  if (nowMs - j.at > FRESH_MS || j.at - nowMs > 60000) return null;
  const measuredAt = typeof j.measuredAt === 'number' && Number.isFinite(j.measuredAt) ? j.measuredAt
    : (j.state === 'ok' ? j.at : null);   // a record from a read that worked was measured when it was read
  const fresh = measuredAt !== null && nowMs - measuredAt <= FRESH_MS && measuredAt - nowMs <= 60000;   // review 11: not from the future either
  const live = (w) => {
    if (!fresh || !w || typeof w.usedPct !== 'number') return null;
    const changedAt = typeof w.changedAt === 'number' && Number.isFinite(w.changedAt) ? w.changedAt : measuredAt;
    if (w.resetsAt === null) return { usedPct: w.usedPct, resetsAt: null, changedAt };
    return typeof w.resetsAt === 'number' && w.resetsAt * 1000 > nowMs ? { usedPct: w.usedPct, resetsAt: w.resetsAt, changedAt } : null;
  };
  return { at: j.at, measuredAt, state: typeof j.state === 'string' ? j.state : 'unknown', weekly: live(j.weekly), fiveHour: live(j.fiveHour),
    email: typeof j.email === 'string' ? j.email : null, org: typeof j.org === 'string' ? j.org : null };
}

module.exports = {
  enabled, liveAllowed, readOne, pollAll, readUsage, sameLogin, tokenStateFor, getUsage, windowOf, write, ccdFor,
  FILE, POLL_MS, FRESH_MS, HOST, USAGE_PATH, BETA,
};
