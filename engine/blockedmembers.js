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
  // The account is everything before the first colon (an account id, not a path list).
  const cut = member.indexOf(':');
  const acct = cut < 0 ? member : member.slice(0, cut);
  return ACCOUNT.test(acct) ? acct : null;
}

/* The record, or null when it exists but could not be read (a read error, or not JSON). Missing is an empty record. A
   reader treats null as no blocks (nothing is hidden by a fault); a writer refuses on null, so a failed read can never
   be saved over the person's whole list. */
/* The last good parse, kept by the file's modified time and size, so a flood of arriving messages (each asks isBlocked)
   costs a stat, not a read and a parse, while the file is unchanged. A copy is returned, so a caller's change never
   reaches the cache. */
let cached = null;   // { key, value }
function readOrNull() {
  let key = null;
  try { const st = fs.statSync(FILE()); key = st.mtimeMs + ':' + st.size; } catch (err) { if (err && err.code === 'ENOENT') { cached = null; return {}; } }
  if (key && cached && cached.key === key) return Object.assign({}, cached.value);
  let text;
  try { text = fs.readFileSync(FILE(), 'utf8'); } catch (err) { return err && err.code === 'ENOENT' ? {} : null; }
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  const out = {};
  const accounts = raw && typeof raw === 'object' && raw.accounts && typeof raw.accounts === 'object' ? raw.accounts : {};
  for (const [acct, e] of Object.entries(accounts)) {
    if (!ACCOUNT.test(acct)) continue;
    out[acct] = { at: e && typeof e.at === 'string' ? e.at : null, name: e && typeof e.name === 'string' ? e.name.slice(0, 80) : '' };
  }
  if (key) cached = { key, value: out };
  return Object.assign({}, out);
}
function read() { return readOrNull() || {}; }

function write(accounts) {
  try {
    const file = FILE();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, accounts }), { mode: 0o600 });
    try { fs.renameSync(tmp, file); } catch (err) { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } throw err; }
    cached = null;   // the next read sees this write, however coarse the file's time is
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
  const accounts = readOrNull();
  if (!accounts) return { ok: false, because: 'the block list could not be read, so nothing was changed' };
  if (!Object.prototype.hasOwnProperty.call(accounts, acct) && Object.keys(accounts).length >= MAX) {
    return { ok: false, full: true, because: 'the block list is full' };
  }
  accounts[acct] = { at: new Date().toISOString(), name: typeof name === 'string' ? name.slice(0, 80) : '' };
  const saved = write(accounts);
  return saved.ok ? { ok: true, account: acct } : saved;
}

function unblock(account) {
  if (typeof account !== 'string' || !ACCOUNT.test(account)) return { ok: false, because: 'that is not a blocked person' };
  const accounts = readOrNull();
  if (!accounts) return { ok: false, because: 'the block list could not be read, so nothing was changed' };
  if (!Object.prototype.hasOwnProperty.call(accounts, account)) return { ok: true, changed: false };
  delete accounts[account];
  const saved = write(accounts);
  return saved.ok ? { ok: true, changed: true } : saved;
}

/** The accounts the relay marked same_account on any kept outside row: the person's own, on their other computers. A
    row kept before that mark was stored carries none, so its account is found through any other row that does. */
function ownAccounts(rows) {
  const out = new Set();
  for (const m of rows || []) if (m && m.kind === 'external' && m.sameAccount === true) { const a = accountOf(m.member); if (a) out.add(a); }
  return out;
}
/** Is this outside row the person's own (marked itself, or its account marked on another row)? */
function isOwn(row, own) {
  return !!row && (row.sameAccount === true || (!!own && own.has(accountOf(row.member))));
}

/** The list for Settings: account, the name seen when blocking, and when. Newest first. */
function list() {
  return Object.entries(read()).map(([account, e]) => ({ account, name: e.name, at: e.at }))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

module.exports = { accountOf, isBlocked, blockedSet, hides, block, unblock, list, ownAccounts, isOwn, FILE };
