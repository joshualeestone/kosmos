'use strict';
/**
 * #8159: a Grok subscription sign-in that grok has not renewed for days read as "signed in" (Kosmos's record) for 18
 * days after its refresh token had died. grok renews its short key every run, so a key that expired days ago means
 * nothing has renewed or used the sign-in since. It now reads "not confirmed since <date>", never "expired" (a
 * long-unused refresh token can still work, and Kosmos will not spend one to find out, #3391).
 *
 *   node --test engine/grokaccounts.stale-8159.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* Review 2: a timezone west of UTC, so the 02:00 UTC test below can tell a UTC date from this computer's own day.
   Set before any Date is made. */
process.env.TZ = 'America/Chicago';
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-grok-stale-8159-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
delete process.env.AGENT_WORKFORCE_GROK_HOME;
const grok = require('./grokaccounts');
const { accountLine } = require('./accountline');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const DAY = 24 * 60 * 60 * 1000;
/* The shape of the card's real file (grok 1.0.41): one auth.x.ai entry with a refresh token and the key's expiry. */
function signIn(name, expiresAt) {
  const d = nodePath.join(SANDBOX, name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  const entry = { email: 'person@example.com', auth_mode: 'oidc', refresh_token: 'r', key: 'k' };
  if (expiresAt !== undefined) entry.expires_at = expiresAt;
  fs.writeFileSync(nodePath.join(d, 'auth.json'), JSON.stringify({ 'https://auth.x.ai::0000-uuid': entry }), { mode: 0o600 });
  return d;
}

test('#8159: THE CARD\'S CASE: a key 18 days past its expiry is not confirmed since then, and still connected', async () => {
  const at = new Date(Date.now() - 18 * DAY);
  const v = await grok.checkLive(signIn('.grok-18d', at.toISOString()));
  assert.equal(v.state, 'connected', 'it must not claim the sign-in is gone: the refresh token may still work');
  assert.equal(v.notConfirmedSince, at.getTime());
  assert.ok(v.because.includes('since its key ran out on ' + grok.sinceWords(at.getTime())), v.because);
  assert.match(v.because, /sign in again/);
  assert.doesNotMatch(v.because, /expired/i, '"expired" would claim more than Kosmos knows');
});

test('#8159: CONTROL: a key that expired two hours ago (grok renews it on its next run) reads as before', async () => {
  const v = await grok.checkLive(signIn('.grok-2h', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()));
  assert.equal(v.state, 'connected');
  assert.equal(v.notConfirmedSince, undefined);
  assert.equal(v.because, 'signed in with your Grok subscription');
});

test('#8159: the line is three days: just inside reads as before, just past reads not confirmed', async () => {
  assert.equal((await grok.checkLive(signIn('.grok-in', new Date(Date.now() - 3 * DAY + 60 * 1000).toISOString()))).notConfirmedSince, undefined);
  assert.ok(Number.isFinite((await grok.checkLive(signIn('.grok-out', new Date(Date.now() - 3 * DAY - 60 * 1000).toISOString()))).notConfirmedSince));
});

test('#8159: a key still valid, or no expiry at all, says nothing new', async () => {
  assert.equal((await grok.checkLive(signIn('.grok-ahead', new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()))).notConfirmedSince, undefined);
  assert.equal((await grok.checkLive(signIn('.grok-noexp'))).notConfirmedSince, undefined);
  assert.equal((await grok.checkLive(signIn('.grok-bad', 'not a date'))).notConfirmedSince, undefined);
});

test('#8159: kosmos accounts says since when, and the plain unconfirmed line is unchanged', () => {
  const row = (connection) => ({ provider: 'xai', providerName: 'Grok', email: 'p@example.com', authMode: 'subscription', connection });
  const since = new Date(2026, 9, 19, 12).getTime();   // noon local: Oct 19 in every timezone
  assert.equal(accountLine(row({ state: 'connected', badge: 'signed_in_unverified', notConfirmedSince: since })),
    'Grok: p@example.com (subscription): not confirmed since Oct 19, 2026; if its agents stop at a sign-in screen, the person signs in again in Settings > AI Models');
  assert.equal(accountLine(row({ state: 'connected', badge: 'signed_in_unverified' })),
    'Grok: p@example.com (subscription): signed in by Kosmos\'s record, not yet confirmed by a real request');
  // A row seen working is "signed in" whatever an old date says: the badge decides first.
  assert.equal(accountLine(row({ state: 'connected', badge: 'working', notConfirmedSince: since })), 'Grok: p@example.com (subscription): signed in');
});

test('#8159: the page draws the date in the pill, and the server keeps the reason over the live check\'s', () => {
  const page = fs.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.match(page, /badge === 'signed_in_unverified' && a\.connection && Number\.isFinite\(a\.connection\.notConfirmedSince\)/);
  assert.match(page, /Not confirmed since ' \+ esc\(since\)/);
  // It sits before the plain unverified pill, or that one ("Signed in") would always win.
  assert.ok(page.indexOf('Not confirmed since \' + esc(since)') < page.indexOf("} else if (badge === 'signed_in_unverified') {\n      connBadge = '<span class=\"acct-unverified\" title=\"' + esc(unverifiedTitle"));
  const server = fs.readFileSync(nodePath.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /const because = grokAccounts\.subscriptionReason\(a\.connection, r\);/, 'the overlay no longer uses the tested reason');
});

test('#8159 review 1: a stale row keeps its since-when over the live check\'s words; a fresh row takes the check\'s', () => {
  const stale = { state: 'connected', notConfirmedSince: Date.now() - 18 * DAY, because: 'Grok has not renewed this sign-in since X' };
  for (const verdict of ['expired', 'pending', 'refused', 'unknown', 'live']) {
    assert.equal(grok.subscriptionReason(stale, { verdict, because: 'the check said ' + verdict }), stale.because, verdict);
  }
  const fresh = { state: 'connected', because: 'signed in with your Grok subscription' };
  assert.equal(grok.subscriptionReason(fresh, { verdict: 'refused', because: 'Grok did not accept this sign-in just now' }), 'Grok did not accept this sign-in just now');
  assert.equal(grok.subscriptionReason(fresh, null), fresh.because, 'no check: the verdict\'s own reason');
});

test('#8159 review 1: the reason and kosmos accounts name the same day, even at 02:00 UTC', () => {
  const at = Date.UTC(2026, 9, 19, 2);   // Oct 18 in the Americas, Oct 19 in UTC
  const line = accountLine({ provider: 'xai', providerName: 'Grok', email: 'p@example.com', authMode: 'subscription',
    connection: { state: 'connected', badge: 'signed_in_unverified', notConfirmedSince: at } });
  assert.ok(line.includes('not confirmed since ' + grok.sinceWords(at) + ';'), line + ' vs ' + grok.sinceWords(at));
});

test('#8159 review 2: the board summary never counts a not-confirmed sign-in as thinking for your agents', () => {
  const page = fs.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const at = page.indexOf("const notConfirmed = list.filter((a) => a.connection && a.connection.badge === 'signed_in_unverified' && Number.isFinite(a.connection.notConfirmedSince)).length;");
  assert.ok(at > 0, 'the summary no longer counts not-confirmed sign-ins apart');
  const block = page.slice(at, page.indexOf("el.append(what + ': ');", at) + 30);
  /* Run the shipped words for every mix of good and not-confirmed sign-ins, the rows first through the page's own
     acctUsableLogin (review 3: a stale row must still pass it, or the box would say "Nothing is connected yet"). */
  const fnAt = page.indexOf('function acctUsableLogin(a) {');
  assert.ok(fnAt > 0, 'acctUsableLogin moved');
  const usable = new Function(page.slice(fnAt, page.indexOf('\n}\n', fnAt) + 2) + '\nreturn acctUsableLogin;')();
  const rows = (good, nc, extra = []) => [...Array(good)].map(() => ({ connection: { badge: 'working' } }))
    .concat([...Array(nc)].map(() => ({ connection: { state: 'connected', badge: 'signed_in_unverified', notConfirmedSince: 1 } })), extra);
  const say = (good, nc, extra) => {
    const all = rows(good, nc, extra);
    const list = all.filter((a) => usable(a));
    assert.equal(list.length, all.length, 'a row fell out of the usable list');
    return new Function('list', block.replace("el.append(what + ': ');", 'return what;'))(list);
  };
  assert.equal(say(0, 1), 'One sign-in is not confirmed and may need signing in again');
  assert.equal(say(1, 1), 'One account is connected and thinking for your agents, and one sign-in is not confirmed');
  assert.equal(say(2, 0), '2 accounts are connected and thinking for your agents');
  assert.equal(say(1, 0), 'One account is connected and thinking for your agents');
  assert.equal(say(0, 2), '2 sign-ins are not confirmed and may need signing in again');
  // Review 3: a row seen working keeps its old date in the connection, but it is green on its pill and counts as working.
  assert.equal(say(0, 0, [{ connection: { badge: 'working', notConfirmedSince: 1 } }]), 'One account is connected and thinking for your agents');
});

test('#8159 review 4: the automatic move cannot reach a Grok row at all (Claude accounts only), so it needs no guard', () => {
  const src = fs.readFileSync(nodePath.join(__dirname, 'autobalance.js'), 'utf8');
  // If autobalance ever takes another provider, this fails and the not-confirmed rule must be added there.
  assert.ok((src.match(/provider === 'anthropic'/g) || []).length >= 2, 'autobalance no longer keeps to Claude rows: decide what a not-confirmed sign-in means there');
  assert.doesNotMatch(src, /xai|grok/i);
});

test('#8159 review 4: no Check now on a not-confirmed Grok row (it could only say "renews when Grok runs")', () => {
  const page = fs.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.match(page, /a\.connection\.state === 'connected'\n\s+&& \(a\.connection\.badge === 'working' \|\| !Number\.isFinite\(a\.connection\.notConfirmedSince\)\)\) \? 'grok'/);
});

test('#8159 review 5: the create picker labels a not-confirmed sign-in in place; others read as before', () => {
  const page = fs.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const at = page.indexOf('  const ncOf = (x) => {');
  assert.ok(at > 0, 'the picker no longer labels a not-confirmed sign-in');
  const src = page.slice(at, page.indexOf('\n', page.indexOf('  const labelOf = (x) =>', at)) + 1);
  const labelOf = new Function('acctUnknownLive', 'esc', 'nameOf', src + 'return labelOf;')(
    (x) => !!x.unknown, (t) => String(t), (x) => x.name);
  const since = new Date(2026, 9, 19, 12).getTime();
  const wantDay = new Date(since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  assert.equal(labelOf({ name: 'g@example.com', connection: { badge: 'signed_in_unverified', notConfirmedSince: since } }), 'g@example.com (not confirmed since ' + wantDay + ')');
  assert.equal(labelOf({ name: 'g@example.com', connection: { badge: 'signed_in_unverified' } }), 'g@example.com');
  assert.equal(labelOf({ name: 'g@example.com', connection: { badge: 'working', notConfirmedSince: since } }), 'g@example.com', 'seen working wins');
  assert.equal(labelOf({ name: 'g@example.com', unknown: true, connection: {} }), 'g@example.com (could not check just now)');
});

test('#8159 review 4: the CLI and the reason use the same words for the date, and the no-email row is told to add it again', () => {
  const noon = new Date(2026, 9, 19, 12).getTime();
  assert.equal(grok.sinceWords(noon), 'Oct 19, 2026');
  const line = accountLine({ provider: 'xai', providerName: 'Grok', authMode: 'subscription',
    connection: { state: 'connected', badge: 'signed_in_unverified', notConfirmedSince: noon } });
  assert.ok(line.includes('not confirmed since Oct 19, 2026; if its agents stop at a sign-in screen, the person adds the Grok account again in Settings > AI Models'), line);
});
