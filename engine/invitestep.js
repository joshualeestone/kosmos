'use strict';
/*
 * kosmos#6255: "Help Kosmos grow", the once-only step that hands a person their invite link.
 *
 * DARK: nothing happens unless KOSMOS_SHARE_STEP=1. Turning it on is a later call and not this file's.
 *
 * The rules, from the card (the 11-05 design and the 10-30 link call):
 *  - once, after a first agent has done something, never on a blocking path, with a quiet "Not now";
 *  - a link the person shares, no addresses typed in and no email from Kosmos+;
 *  - the words follow the reward's REAL state, read from the service. "A month free" appears only when the service
 *    answers reward: true. Anything else, the field missing included, gets the words with no promise in them.
 *
 * The board has no device session, so the link comes from the computer-signed POST /v1/mac/account-invite. Until that
 * answers ok (an old coordinator, not signed in, a company seat, a bad answer) there is no step at all: a step
 * that cannot hand over a link must not be offered.
 *
 * Never throws: every failure is { show: false }.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROUTE = '/v1/mac/account-invite';
const HEADLINE = 'Help Kosmos grow';
const LINE_REWARD = 'Invite someone, and when they start paying for Kosmos+, you get a month free.';
const LINE_PLAIN = 'Know someone who would use this? Send them your link.';
const FINE_REWARD = 'Share it however you like.';

function enabled(env) { return (env || process.env).KOSMOS_SHARE_STEP === '1'; }
function bookFile() { return path.join(require('./store').ROOT, 'invite-step.json'); }
function isDone() {
  try { return Boolean(JSON.parse(fs.readFileSync(bookFile(), 'utf8')).doneAt); } catch { return false; }
}
/* An answered step stays answered; a failed write only means it may be offered once more. */
function markDone(now) {
  try {
    fs.mkdirSync(path.dirname(bookFile()), { recursive: true });
    fs.writeFileSync(bookFile(), JSON.stringify({ doneAt: new Date(now || Date.now()).toISOString() }));
    return true;
  } catch { return false; }
}

/* Has any agent spoken to the person yet, or any task been built or closed? `sessions` is the board's agents' session names;
   `projects` the board's projects. An unreadable part counts as nothing, so the step waits rather than guessing. */
function firstAgentDidSomething(sessions, projects) {
  for (const p of Array.isArray(projects) ? projects : []) {
    for (const t of (p && Array.isArray(p.tasks)) ? p.tasks : []) if (t && (t.builtAt || t.closedAt)) return true;
  }
  const chat = require('./chat');
  for (const s of Array.isArray(sessions) ? sessions : []) {
    try { if (chat.readThread(chat.DIRECT, String(s)).messages.some((m) => m && m.from)) return true; } catch { /* the next one */ }
  }
  return false;
}

/* The coordinator's answer is not signed, so the link is only ever https on the Kosmos+ sign-in host's own sign-up door (a person's computer lives one label under the same domain, so a domain match would not do). */
function parseInvite(answer, host) {
  const a = answer && answer.data ? answer.data : answer;
  if (!a || typeof a.link !== 'string' || typeof host !== 'string' || !host) return null;
  let u;
  try { u = new URL(a.link); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (u.hostname !== host) return null;
  if (u.pathname !== '/signup' || !/^[A-Za-z0-9_-]{1,64}$/.test(u.searchParams.get('invite') || '')) return null;
  return { link: u.href, reward: a.reward === true };
}

function wordsFor(reward) {
  return reward === true
    ? { headline: HEADLINE, line: LINE_REWARD, fine: FINE_REWARD }
    : { headline: HEADLINE, line: LINE_PLAIN, fine: '' };
}

/* What the page and the phone ask. `o`: { env, roster, projects, remote } (tests inject; the board passes the real ones).
   wait: true means still worth asking again later (it is on, and a first agent has not done anything yet). */
async function stepFor(o) {
  const none = { show: false };
  try {
    const opts = o || {};
    if (!enabled(opts.env) || isDone()) return none;
    const roster = typeof opts.roster === 'function' ? opts.roster() : opts.roster;
    const projects = typeof opts.projects === 'function' ? opts.projects() : opts.projects;
    const sessions = (Array.isArray(roster) ? roster : []).map((c) => c && c.sessionName).filter(Boolean);
    if (!firstAgentDidSomething(sessions, projects)) return { show: false, wait: true };
    const remote = opts.remote || require('./remote');
    if (!remote.read().on || !remote.enrolled()) return none;
    let host = null;
    try { host = new URL(remote.COORDINATOR()).hostname; } catch { return none; }
    const r = await remote.macRequest('POST', ROUTE, {});
    if (!r || !r.ok) return none;
    const got = parseInvite(r, host);
    if (!got) return none;
    return { show: true, link: got.link, reward: got.reward, ...wordsFor(got.reward) };
  } catch { return none; }
}

module.exports = { ROUTE, HEADLINE, LINE_REWARD, LINE_PLAIN, enabled, isDone, markDone, firstAgentDidSomething, parseInvite, wordsFor, stepFor };
