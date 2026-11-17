'use strict';
/**
 * #8625 (App Store guideline 1.2): the people from outside this Kosmos that the person has blocked.
 *
 * A message from outside carries the poster's room member as the RELAY stamps it (engine/messages.js EXTERNAL_MEMBER):
 * an account id, or "<account>:<computer>" for an owner's computer. A block is kept by the ACCOUNT, so it covers the
 * person in every shared room and on every one of their computers.
 *
 * What a block does, and nothing more: a blocked account's new messages are not kept on this computer (so nothing is
 * shown or pushed for them), and rows already kept are left out of the room as it is read. It does not remove them
 * from the room for anyone else; an owner who wants that removes them (/api/federation/remove).
 *
 * The record holds account ids and the display name seen when blocking, never message text. One writer: the board.
 * It never throws: an unreadable record reads as no blocks (so nothing is hidden by a fault), and a failed write says so.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const FILE = () => path.join(store.ROOT, 'blocked-members.json');
const ACCOUNT = /^[A-Za-z0-9_-]{1,80}$/;
const MAX = 500;   // a bound on the record, far above any person's list

/** The account part of a stamped member ("acct" or "acct:computer"), or null when it is not well shaped. */
function accountOf(member) {
  if (typeof member !== 'string') return null;
  const acct = member.split(':')[0];
  return ACCOUNT.test(acct) ? acct : null;
}

function read() {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return {}; }
  const out = {};
  const accounts = raw && typeof raw === 'object' && raw.accounts && typeof raw.accounts === 'object' ? raw.accounts : {};
  for (const [acct, e] of Object.entries(accounts)) {
    if (!ACCOUNT.test(acct)) continue;
    out[acct] = { at: e && typeof e.at === 'string' ? e.at : null, name: e && typeof e.name === 'string' ? e.name.slice(0, 80) : '' };
  }
  return out;
}

function write(accounts) {
  try {
    const file = FILE();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, accounts }), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (err) {
    return { ok: false, because: 'the block list could not be saved', code: (err && err.code) || null };
  }
}

/** Is the poster of this stamped member blocked? False for anything unstamped or malformed. */
function isBlocked(member) {
  const acct = accountOf(member);
  return !!acct && Object.prototype.hasOwnProperty.call(read(), acct);
}

/** A reader's filter: the set of blocked accounts, read once per request. */
function blockedSet() {
  return new Set(Object.keys(read()));
}

/** Is this room row hidden by a block? Only an outside row with a stamp can be. */
function hides(row, set) {
  return !!row && row.kind === 'external' && !!set && set.size > 0 && set.has(accountOf(row.member));
}

function block(member, name) {
  const acct = accountOf(member);
  if (!acct) return { ok: false, because: 'that message has no sender Kosmos can block' };
  const accounts = read();
  if (!Object.prototype.hasOwnProperty.call(accounts, acct) && Object.keys(accounts).length >= MAX) {
    return { ok: false, because: 'the block list is full' };
  }
  accounts[acct] = { at: new Date().toISOString(), name: typeof name === 'string' ? name.slice(0, 80) : '' };
  const saved = write(accounts);
  return saved.ok ? { ok: true, account: acct } : saved;
}

function unblock(account) {
  if (typeof account !== 'string' || !ACCOUNT.test(account)) return { ok: false, because: 'that is not a blocked person' };
  const accounts = read();
  if (!Object.prototype.hasOwnProperty.call(accounts, account)) return { ok: true, changed: false };
  delete accounts[account];
  const saved = write(accounts);
  return saved.ok ? { ok: true, changed: true } : saved;
}

/** The list for Settings: account, the name seen when blocking, and when. Newest first. */
function list() {
  return Object.entries(read()).map(([account, e]) => ({ account, name: e.name, at: e.at }))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

module.exports = { accountOf, isBlocked, blockedSet, hides, block, unblock, list, FILE };
