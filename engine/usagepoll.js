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
 *    this module writes holds numbers and a state word.
 * 🛑 NEVER REFRESHES A TOKEN. Claude Code rotates the refresh token when it refreshes, and a second refresher can leave a
 *    live agent's login broken. An expired access token is recorded as `token-expired`: the account is NOT measured.
 *
 * WHICH CREDENTIAL: the one the account's agents read (loginexpiry.serviceNameFor). Kosmos starts a default-account
 * agent with CLAUDE_CONFIG_DIR unset, so the default account reads the bare entry; any other account reads the entry
 * for its own folder. On macOS that is the login Keychain; elsewhere it is the folder's `.credentials.json`.
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const loginexpiry = require('./loginexpiry');

const FILE = 'kosmos-usage.json';
const HOST = 'api.anthropic.com';
const USAGE_PATH = '/api/oauth/usage';
const BETA = 'oauth-2025-04-20';
const POLL_MS = 10 * 60 * 1000;   // the board's timer: often enough to see a week run down, rare enough to cost nothing
const FRESH_MS = 30 * 60 * 1000;  // older than three missed polls: the reading is not used
const TIMEOUT_MS = 15000;

/* The CLAUDE_CONFIG_DIR value this account's agents run with: unset for the default account (see the header). */
function ccdFor(a) { return a && a.isDefault ? undefined : a && a.dir; }

/* The credential body for an account, or null. macOS: the Keychain entry its agents read. Elsewhere: the folder's own
   credentials file, which is where Claude Code keeps it off macOS. */
function readCredFor(a, { platform = process.platform, readCred = loginexpiry.readCredAsync } = {}) {
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
  raw = null;
  const oauth = o && o.claudeAiOauth;
  const token = oauth && typeof oauth.accessToken === 'string' ? oauth.accessToken : '';
  if (!token) return { state: 'no-token' };
  if (typeof oauth.expiresAt === 'number' && Number.isFinite(oauth.expiresAt) && oauth.expiresAt <= now) {
    return { state: 'token-expired' };
  }
  return { state: 'ok', token };
}

/* One GET of the usage endpoint. Resolves { code, body }; code 0 on a network error or a timeout. Never rejects. */
function getUsage(token, { request = https.request } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let req;
    try {
      req = request({
        host: HOST, path: USAGE_PATH, method: 'GET', timeout: TIMEOUT_MS,
        headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': BETA, Accept: 'application/json' },
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (body.length < 65536) body += c; });
        res.on('end', () => finish({ code: res.statusCode || 0, body }));
        res.on('error', () => finish({ code: 0, body: '' }));
      });
    } catch { finish({ code: 0, body: '' }); return; }
    req.on('timeout', () => { req.destroy(); finish({ code: 0, body: '' }); });
    req.on('error', () => finish({ code: 0, body: '' }));
    req.end();
  });
}

/* { usedPct, resetsAt (epoch SECONDS, as the status line's files) } from one window of the response, or null. */
function windowOf(w) {
  if (!w || typeof w !== 'object') return null;
  const pct = w.utilization;
  const at = typeof w.resets_at === 'string' ? Date.parse(w.resets_at) : NaN;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || !Number.isFinite(at)) return null;
  return { usedPct: pct, resetsAt: Math.floor(at / 1000) };
}

/* The record for one account: { at (ms), state, weekly?, fiveHour? }, or null for an API-key account (no weekly limit). */
async function readOne(a, { now = Date.now(), request, ...deps } = {}) {
  if (!a || typeof a.dir !== 'string' || !a.dir || a.apiKey) return null;
  const t = await tokenStateFor(a, { now, ...deps });
  if (t.state !== 'ok') return { at: now, state: t.state };
  const r = await getUsage(t.token, { request });
  t.token = null;
  if (r.code !== 200) return { at: now, state: r.code ? `http-${r.code}` : 'unreachable' };
  let j;
  try { j = JSON.parse(r.body); } catch { return { at: now, state: 'unreadable-response' }; }
  const weekly = windowOf(j && j.seven_day);
  if (!weekly) return { at: now, state: 'unreadable-response' };
  return { at: now, state: 'ok', weekly, fiveHour: windowOf(j && j.five_hour) };
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

/* Read every Claude account in `list` (accounts.list() rows), one after another, and record each. Resolves the count
   recorded. Accounts are read one at a time so a slow or hung read never stacks requests. */
async function pollAll(list, deps = {}) {
  let n = 0;
  for (const a of Array.isArray(list) ? list : []) {
    let rec = null;
    try { rec = await readOne(a, deps); } catch { rec = null; }
    if (rec && write(a.dir, rec)) n += 1;
  }
  return n;
}

/* The last record for an account folder, as { at, state, weekly, fiveHour }, or null when there is none to trust: no
   file, unreadable, older than FRESH_MS. A window whose reset has passed reads as null within an otherwise good record
   (a figure from a finished week is not this week's usage). */
function readUsage(dir, nowMs = Date.now()) {
  if (typeof dir !== 'string' || !dir) return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')); } catch { return null; }
  if (!j || typeof j !== 'object' || typeof j.at !== 'number' || !Number.isFinite(j.at)) return null;
  if (nowMs - j.at > FRESH_MS || j.at - nowMs > 60000) return null;
  const live = (w) => (w && typeof w.usedPct === 'number' && typeof w.resetsAt === 'number' && w.resetsAt * 1000 > nowMs
    ? { usedPct: w.usedPct, resetsAt: w.resetsAt } : null);
  return { at: j.at, state: typeof j.state === 'string' ? j.state : 'unknown', weekly: live(j.weekly), fiveHour: live(j.fiveHour) };
}

module.exports = {
  readOne, pollAll, readUsage, tokenStateFor, getUsage, windowOf, write, ccdFor,
  FILE, POLL_MS, FRESH_MS, HOST, USAGE_PATH, BETA,
};
