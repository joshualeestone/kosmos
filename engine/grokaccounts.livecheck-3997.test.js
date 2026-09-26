'use strict';
/**
 * #3997: a Grok subscription's FREE live check. Only a key that has not expired is asked about (Kosmos never renews
 * one: a renewal rotates the refresh token under a running grok), with the models listing grok itself reads.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-grok-live-3997-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
delete process.env.AGENT_WORKFORCE_GROK_HOME;
const grok = require('./grokaccounts');

test.after(() => { grok.setFetcher(null); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

let n = 0;
function signedIn(expiresInMs) {
  const dir = nodePath.join(SANDBOX, 'g' + (++n));
  fs.mkdirSync(dir, { recursive: true });
  const entry = { key: 'sess-key-' + n, refresh_token: 'r', email: 'a@b.c', expires_at: new Date(Date.now() + expiresInMs).toISOString() };
  fs.writeFileSync(grok.authFile(dir), JSON.stringify({ ['https://auth.x.ai::' + n]: entry }));
  return dir;
}
function answering(status) {
  const calls = [];
  grok.setFetcher(async (url, init) => { calls.push({ url, auth: init.headers.authorization }); if (status === 'throw') throw new Error('offline'); return { status }; });
  return calls;
}

test('#3997: a sign-in grok confirms is live, asked with its own key', async () => {
  const dir = signedIn(3 * 3600 * 1000);
  const calls = answering(200);
  const r = await grok.subscriptionLive(dir);
  assert.equal(r.verdict, 'live');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/models$/);
  assert.equal(calls[0].auth, 'Bearer sess-key-' + n);
});

test('#3997: a 401 or 403 is "refused" (not confirmed), never a verdict that the account is dead', async () => {
  for (const status of [401, 403]) {
    answering(status);
    const r = await grok.subscriptionLive(signedIn(3 * 3600 * 1000));
    assert.equal(r.verdict, 'refused', String(status));
    assert.match(r.because, /Signing in again/);
  }
});

test('#3997: an expired key is not checked at all (grok renews it on its next run, and Kosmos never does)', async () => {
  const calls = answering(200);
  for (const ms of [-60 * 1000, 30 * 1000]) {   // expired, and inside the one-minute margin
    const r = await grok.subscriptionLive(signedIn(ms));
    assert.equal(r.verdict, 'expired');
    assert.match(r.because, /renews this sign-in the next time it runs/);
  }
  assert.equal(calls.length, 0, 'an expired key was sent to Grok');
  // CONTROL: the same fetcher is asked once the key is current.
  await grok.subscriptionLive(signedIn(3 * 3600 * 1000));
  assert.equal(calls.length, 1);
});

test('#3997: no answer, an odd status, or an unreadable sign-in is "unknown", never a negative', async () => {
  answering('throw');
  assert.equal((await grok.subscriptionLive(signedIn(3 * 3600 * 1000))).verdict, 'unknown');
  answering(500);
  assert.equal((await grok.subscriptionLive(signedIn(3 * 3600 * 1000))).verdict, 'unknown');
  const bad = nodePath.join(SANDBOX, 'bad');
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(grok.authFile(bad), '{not json');
  assert.equal((await grok.subscriptionLive(bad)).verdict, 'unknown');
});

test('#3997 round 11: a slower, older check never overwrites or reports over a newer Check now, and a reset stops old runs', async () => {
  grok.resetSubscriptionLiveForTest();
  const dir = signedIn(3 * 3600 * 1000);
  const pending = [];
  grok.setFetcher((url, init) => new Promise((resolve) => pending.push(resolve)));
  const background = grok.subscriptionLive(dir);          // the list's check, started first
  await new Promise((r) => setTimeout(r, 5));
  const checkNow = grok.subscriptionLiveOnce(dir, { fresh: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(pending.length, 2, 'both checks asked (Check now does not join the list check)');
  pending[1]({ status: 401 });                            // Check now answers first: refused
  assert.equal((await checkNow).verdict, 'refused');
  pending[0]({ status: 200 });                            // the older check answers later: live
  assert.equal((await background).verdict, 'refused', 'the older check reports the newer answer, not its own');
  grok.setFetcher(async () => { throw new Error('must not ask again within 30s'); });
  assert.equal((await grok.subscriptionLive(dir)).verdict, 'refused', 'the kept answer is still the newer one');

  const dir2 = signedIn(3 * 3600 * 1000);
  const held = [];
  grok.setFetcher((url, init) => new Promise((resolve) => held.push(resolve)));
  const old = grok.subscriptionLive(dir2);
  await new Promise((r) => setImmediate(r));
  grok.resetSubscriptionLiveForTest();
  held[0]({ status: 200 });
  assert.equal((await old).verdict, 'live');
  const asked = answering(401);
  assert.equal((await grok.subscriptionLive(dir2)).verdict, 'refused', 'a run from before the reset kept nothing');
  assert.equal(asked.length, 1);
});

test('#3997 round 12: refusalIsNewer: a refusal newer than an agent success wins; an older one, a failure, or no answer does not', () => {
  const t = 1_000_000;
  assert.equal(grok.refusalIsNewer({ verdict: 'refused', at: t + 1 }, { outcome: 'ok', at: t }), true);
  assert.equal(grok.refusalIsNewer({ verdict: 'refused', at: t }, { outcome: 'ok', at: t + 1 }), false, 'an agent success after the refusal lost to it');
  assert.equal(grok.refusalIsNewer({ verdict: 'refused', at: t + 1 }, { outcome: '401', at: t }), false, 'an agent failure was dropped');
  assert.equal(grok.refusalIsNewer({ verdict: 'live', at: t + 1 }, { outcome: 'ok', at: t }), false, 'a live answer counted as a refusal');
  assert.equal(grok.refusalIsNewer({ verdict: 'unknown', because: 'x' }, { outcome: 'ok', at: t }), false);
  assert.equal(grok.refusalIsNewer({ verdict: 'refused' }, { outcome: 'ok', at: t }), false, 'a refusal with no time counted as newer');
  assert.equal(grok.refusalIsNewer(null, { outcome: 'ok', at: t }), false);
  assert.equal(grok.refusalIsNewer({ verdict: 'refused', at: t + 1 }, null), false);
});
