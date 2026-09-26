'use strict';
/**
 * #3296/#3391 accounts slice: the /api/accounts routes for gemini/grok --
 *   POST /api/accounts/gemini/apikey  |  POST /api/accounts/grok/apikey  (store)
 *   DELETE /api/accounts/gemini        |  DELETE /api/accounts/grok        (forget/remove)
 *   GET  /api/accounts                 (the merge now carries gemini/grok rows)
 * Tests the ROUTING with the runner resolver MOCKED (never the machine's gemini/grok)
 * and the live check driven through setFetcher (never a real Google/xAI call). The
 * modules' own logic is covered by engine/{gemini,grok}accounts.test.js.
 *
 *   node --test server.provider-accounts-3296.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-provaccts-routes-3296-'));
const mkTemp = (p) => fs.mkdtempSync(nodePath.join(os.tmpdir(), p));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkTemp('aw-par-workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mkTemp('aw-par-projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mkTemp('aw-par-launch-');
process.env.AGENT_WORKFORCE_GEMINI_HOME = nodePath.join(SANDBOX, '.gemini');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(SANDBOX, '.grok');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const geminiAccounts = require('./engine/geminiaccounts');
const grokAccounts = require('./engine/grokaccounts');
const runners = require('./engine/runners');
const { start, server } = require('./server');

// Runner PRESENT so the store route reaches key validation (never the machine's gemini/grok).
const _origResolveBin = runners.resolveBin;
runners.resolveBin = (p) => ({ present: true, bin: `/mock/${p}` });

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  runners.resolveBin = _origResolveBin;
  geminiAccounts.setFetcher(null); grokAccounts.setFetcher(null);
  try { server.close(); } catch { /* best effort */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});
test.afterEach(() => { geminiAccounts.setFetcher(null); grokAccounts.setFetcher(null); });

const post = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const del = (p, obj) => fetch(base + p, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });

test('gemini store: a good key -> 200, connection state, and the response NEVER carries the key', async () => {
  geminiAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const r = await post('/api/accounts/gemini/apikey', { label: 'work-key', key: 'AIzaSy-goodkey-shouldnotappear-1234' });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.account.label, 'work-key');
  assert.equal(b.account.connection.state, geminiAccounts.STATE.CONNECTED);
  assert.ok(!JSON.stringify(b).includes('goodkey'), 'the response must never carry the key');
  // The key landed in a mode-600 file inside the account dir.
  const dir = nodePath.join(SANDBOX, '.gemini-work-key');
  const mode = fs.statSync(geminiAccounts.keyFile(dir)).mode & 0o777;
  assert.equal(mode, 0o600, 'the stored key file is owner-only');
});

test('grok store: a positively-rejected key is refused at ENTRY, and no account dir is left behind', async () => {
  grokAccounts.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  const r = await post('/api/accounts/grok/apikey', { label: 'bad-key', key: 'xai-deadkey-abcdefgh' });
  assert.equal(r.status, 400);
  const b = await r.json();
  assert.match(b.error, /did not accept this key/);
  assert.equal(fs.existsSync(grokAccounts.keyFile(nodePath.join(SANDBOX, '.grok-bad-key'))), false, 'a rejected grok key leaves no .kosmos-grok-apikey file');
});

test('grok store: an unreachable/ambiguous check is ACCEPTED (never block a good key on a non-confirming answer)', async () => {
  grokAccounts.setFetcher(async () => ({ status: 0, unreachable: true, because: 'we could not reach xAI to check whether this key still works' }));
  const r = await post('/api/accounts/grok/apikey', { label: 'maybe-key', key: 'xai-unconfirmed-key-1234' });
  assert.equal(r.status, 200, 'unreachable is not a positive rejection, so the add stands');
  assert.equal((await r.json()).account.connection.state, grokAccounts.STATE.UNKNOWN);
});

test('gemini store: a shape-bad key and a taken label are refused', async () => {
  const shape = await post('/api/accounts/gemini/apikey', { label: 'x', key: 'short' });
  assert.equal(shape.status, 400);
  assert.match((await shape.json()).error, /too short/);
  // "work-key" was taken by the first test.
  geminiAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const taken = await post('/api/accounts/gemini/apikey', { label: 'work-key', key: 'AIzaSy-anotherkey-000099998888' });
  assert.equal(taken.status, 400);
  assert.match((await taken.json()).error, /already a Gemini account by that name/);
});

test('store: a label whose account dir is a pre-planted symlink is refused (no write THROUGH into a real home)', async () => {
  const real = nodePath.join(SANDBOX, 'real-home-for-symlink');
  fs.mkdirSync(real, { recursive: true });
  const link = nodePath.join(SANDBOX, '.gemini-linky');
  try { fs.symlinkSync(real, link); } catch { /* symlinks unsupported */ }
  if (!(() => { try { return fs.lstatSync(link).isSymbolicLink(); } catch { return false; } })()) { console.log('# symlinks unsupported -- skipping'); return; }
  geminiAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const r = await post('/api/accounts/gemini/apikey', { label: 'linky', key: 'AIzaSy-symlink-key-11112222' });
  assert.equal(r.status, 400, 'a symlink account dir is refused before any write');
  assert.match((await r.json()).error, /not available/);
  assert.equal(fs.existsSync(nodePath.join(real, '.kosmos-gemini-apikey')), false, 'no key was written through the symlink into the real home');
  fs.rmSync(link, { force: true }); fs.rmSync(real, { recursive: true, force: true });
});

test('store: a missing runner answers needsRunner (never stores a key for a runner that is not installed)', async () => {
  runners.resolveBin = () => ({ present: false, bin: null });
  try {
    const r = await post('/api/accounts/grok/apikey', { label: 'norunner', key: 'xai-key-whatever-1234' });
    assert.equal(r.status, 400);
    const b = await r.json();
    assert.equal(b.needsRunner, true);
    assert.equal(b.provider, 'grok');
  } finally {
    runners.resolveBin = (p) => ({ present: true, bin: `/mock/${p}` });
  }
});

test('#3713 store: a runner still mid-install is not taken as there (its path can exist while it is being proved)', async () => {
  const was = runners.installing;
  for (const [route, label] of [['gemini', 'midinstall-g'], ['grok', 'midinstall-x']]) {
    runners.installing = (p) => p === route;
    try {
      const r = await post('/api/accounts/' + route + '/apikey', { label, key: route === 'gemini' ? 'AIzaSyMidInstall000000000000000000000' : 'xai-key-midinstall-1234' });
      assert.equal(r.status, 400, route + ': a key is not stored against a runner still installing');
      assert.equal((await r.json()).needsRunner, true);
    } finally {
      runners.installing = was;
    }
    // Control: the same request with no install running gets past the runner check.
    const ok = await post('/api/accounts/' + route + '/apikey', { label: label + '-ctl', key: 'x' });
    assert.notEqual((await ok.json()).needsRunner, true, route + ': control, the runner check passes with no install running');
  }
});

test('GET /api/accounts merges gemini/grok rows with provider + a live connection', async () => {
  // Ensure at least one of each exists (work-key gemini from test 1; add a grok one).
  grokAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  await post('/api/accounts/grok/apikey', { label: 'board-key', key: 'xai-board-key-77778888' });
  geminiAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  grokAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const r = await fetch(base + '/api/accounts');
  assert.equal(r.status, 200);
  const rows = (await r.json()).accounts;
  const gem = rows.find((a) => a.provider === 'google');
  const grk = rows.find((a) => a.provider === 'xai');
  assert.ok(gem, 'a gemini row appears in the merge');
  assert.ok(grk, 'a grok row appears in the merge');
  assert.equal(gem.providerName, 'Gemini');
  assert.equal(grk.providerName, 'Grok');
  assert.ok(gem.connection && typeof gem.connection.state === 'string', 'the gemini row carries a live connection');
});

test('DELETE gemini (forget): renames the account aside; DELETE with remove:true deletes it', async () => {
  geminiAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  await post('/api/accounts/gemini/apikey', { label: 'gone-soon', key: 'AIzaSy-gonesoon-key-44445555' });
  const dir = nodePath.join(SANDBOX, '.gemini-gone-soon');
  assert.ok(fs.existsSync(geminiAccounts.keyFile(dir)), 'account exists before forget');
  // forget (default): dir renamed aside, key preserved
  const f = await del('/api/accounts/gemini', { dir });
  assert.equal(f.status, 200);
  assert.equal((await f.json()).forgotten, true);
  assert.equal(fs.existsSync(dir), false, 'the account dir moved aside');

  // now a remove:true on a fresh account deletes it outright
  await post('/api/accounts/gemini/apikey', { label: 'delete-me', key: 'AIzaSy-deleteme-key-66667777' });
  const dir2 = nodePath.join(SANDBOX, '.gemini-delete-me');
  const rr = await del('/api/accounts/gemini', { dir: dir2, remove: true });
  assert.equal(rr.status, 200);
  assert.equal((await rr.json()).removed, true);
  assert.equal(fs.existsSync(dir2), false, 'the account dir and its key are gone');
});

test('DELETE grok: a name-shaped non-account is refused (defence in depth on a dir-renaming endpoint)', async () => {
  const bogus = nodePath.join(SANDBOX, '.grok-notanaccount');
  fs.mkdirSync(bogus, { recursive: true });
  const r = await del('/api/accounts/grok', { dir: bogus });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /not a Grok account/);
  assert.ok(fs.existsSync(bogus), 'the non-account folder is left untouched');
});

/* #3566: the Settings form sends no label (the person's optional words are the display
   `name`), so a blank label takes the next free work slot rather than being refused. */
test('#3566 store: no label -> the next free work slot, and the display name is kept', async () => {
  grokAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const r = await post('/api/accounts/grok/apikey', { key: 'xai-nolabel-key-12345678', name: 'Josh Grok' });
  assert.equal(r.status, 200, 'a label-less add must not be refused');
  const b = await r.json();
  assert.match(b.account.label, /^work\d+$/, 'a blank label takes a work slot: ' + b.account.label);
  assert.equal(b.account.dir, nodePath.join(SANDBOX, '.grok-' + b.account.label));
  assert.equal(grokAccounts.readName(b.account.dir), 'Josh Grok', 'the display name travels separately');
  // A second label-less add takes a DIFFERENT slot, never the same account.
  const r2 = await post('/api/accounts/grok/apikey', { key: 'xai-nolabel-key-87654321' });
  assert.equal(r2.status, 200);
  const b2 = await r2.json();
  assert.notEqual(b2.account.dir, b.account.dir, 'two label-less adds landed on one account');
});

test('#3566 store CONTROL: an explicit label is still validated (a blank-label fallback did not swallow it)', async () => {
  geminiAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const r = await post('/api/accounts/gemini/apikey', { label: 'default', key: 'AIzaSy-reserved-label-key-1234' });
  assert.equal(r.status, 400, '"default" is reserved and must still be refused');
});

test('#3566 store: two label-less adds IN FLIGHT AT ONCE claim two different slots (no key overwrite)', async () => {
  // The live check awaits; hold both requests inside it so they overlap for real.
  let release;
  const gate = new Promise((r) => { release = r; });
  let entered = 0;
  geminiAccounts.setFetcher(async () => { entered += 1; await gate; return { status: 200, body: {} }; });
  const p1 = post('/api/accounts/gemini/apikey', { key: 'AIzaSy-race-one-key-11112222' });
  const p2 = post('/api/accounts/gemini/apikey', { key: 'AIzaSy-race-two-key-33334444' });
  for (let i = 0; i < 100 && entered < 2; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal(entered, 2, 'CONTROL: both requests must be inside the live check at once, or this proves nothing');
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  const [b1, b2] = [await r1.json(), await r2.json()];
  assert.notEqual(b1.account.dir, b2.account.dir, 'two concurrent adds were given the same slot');
  const k1 = fs.readFileSync(geminiAccounts.keyFile(b1.account.dir), 'utf8');
  const k2 = fs.readFileSync(geminiAccounts.keyFile(b2.account.dir), 'utf8');
  assert.notEqual(k1, k2, 'one account key overwrote the other');
});

test('#3566 store: a rejected label-less add gives its claimed slot back', async () => {
  grokAccounts.setFetcher(async () => ({ status: 401, body: { error: { code: 'invalid_api_key' } } }));
  const before = fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.grok-')).sort();
  const r = await post('/api/accounts/grok/apikey', { key: 'xai-rejected-nolabel-99998888' });
  assert.equal(r.status, 400, 'CONTROL: the key must actually be refused for this arm to mean anything');
  const after = fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.grok-')).sort();
  assert.deepEqual(after, before, 'a refused add left a claimed, empty account dir behind');
});

test('#3566 DELETE: disconnect and delete each say what happened (the row reports `because`)', async () => {
  geminiAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const add = await (await post('/api/accounts/gemini/apikey', { key: 'AIzaSy-because-key-55556666' })).json();
  const f = await del('/api/accounts/gemini', { dir: add.account.dir });
  assert.equal(f.status, 200);
  const fb = await f.json();
  assert.equal(fb.forgotten, true);
  assert.match(fb.because || '', /nothing was deleted/, 'a disconnect must not read as a deletion: ' + JSON.stringify(fb));
  const add2 = await (await post('/api/accounts/gemini/apikey', { key: 'AIzaSy-because-key-77778888' })).json();
  const d = await del('/api/accounts/gemini', { dir: add2.account.dir, remove: true });
  const db = await d.json();
  assert.equal(db.removed, true);
  assert.match(db.because || '', /deleted/, 'a delete must say it deleted: ' + JSON.stringify(db));
});

test('#3566 store: a leftover EMPTY slot (a cancelled add) is reused, and no claim marker is left behind', async () => {
  geminiAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const spot = geminiAccounts.nextWorkDir();
  fs.mkdirSync(spot.dir, { recursive: true });   // the shape a cancelled add leaves
  assert.equal(fs.existsSync(geminiAccounts.keyFile(spot.dir)), false, 'CONTROL: the slot must start keyless');
  const r = await post('/api/accounts/gemini/apikey', { key: 'AIzaSy-reuse-slot-key-12121212' });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.account.dir, spot.dir, 'a free keyless slot was skipped instead of reused');
  assert.equal(fs.existsSync(nodePath.join(spot.dir, '.kosmos-claim')), false, 'the claim marker outlived the add');
});

test('#3566 store: a whitespace-only label is still REFUSED (only an absent label takes a slot)', async () => {
  grokAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const r = await post('/api/accounts/grok/apikey', { label: '   ', key: 'xai-whitespace-label-key-1234' });
  assert.equal(r.status, 400, 'a whitespace label was quietly turned into a work slot');
});

test('#3566 store: a STALE claim left by a dead add does not block its slot forever', async () => {
  grokAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const spot = grokAccounts.nextWorkDir();
  fs.mkdirSync(spot.dir, { recursive: true });
  const claim = nodePath.join(spot.dir, '.kosmos-claim');
  fs.writeFileSync(claim, '');
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(claim, old, old);
  const r = await post('/api/accounts/grok/apikey', { key: 'xai-stale-claim-key-56565656' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).account.dir, spot.dir, 'a slot with an hour-old claim was skipped');
});

test('#3566 store CONTROL: a FRESH claim (an add in flight) is respected, the next slot is taken', async () => {
  grokAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const spot = grokAccounts.nextWorkDir();
  fs.mkdirSync(spot.dir, { recursive: true });
  fs.writeFileSync(nodePath.join(spot.dir, '.kosmos-claim'), '');
  const r = await post('/api/accounts/grok/apikey', { key: 'xai-fresh-claim-key-78787878' });
  assert.equal(r.status, 200);
  assert.notEqual((await r.json()).account.dir, spot.dir, 'an in-flight claim was taken over');
});

test('#3566 store: a reused slot does not hand the new account an earlier account\'s display name', async () => {
  geminiAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const spot = geminiAccounts.nextWorkDir();
  fs.mkdirSync(spot.dir, { recursive: true });
  fs.writeFileSync(nodePath.join(spot.dir, '.kosmos-name'), 'Somebody Else');
  const r = await post('/api/accounts/gemini/apikey', { key: 'AIzaSy-reused-name-key-34343434' });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.account.dir, spot.dir, 'CONTROL: the reused slot must be the one taken, or this proves nothing');
  assert.equal(geminiAccounts.readName(b.account.dir), null, 'the new account inherited an old name');
});

test('#3566 store: an explicitly-labelled add cannot take a slot an unnamed add has claimed and is still checking', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  let entered = 0;
  grokAccounts.setFetcher(async () => { entered += 1; await gate; return { status: 200, body: {} }; });
  const claimedBefore = new Set(fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.grok-work')
    && fs.existsSync(nodePath.join(SANDBOX, n, '.kosmos-claim'))));
  const p1 = post('/api/accounts/grok/apikey', { key: 'xai-unnamed-inflight-key-1111' });
  for (let i = 0; i < 100 && entered < 1; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal(entered, 1, 'CONTROL: the unnamed add must be inside its live check');
  // The slot it ACTUALLY claimed: the one whose claim appeared since (earlier arms leave claims).
  const mine = fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.grok-work')
    && fs.existsSync(nodePath.join(SANDBOX, n, '.kosmos-claim')) && !claimedBefore.has(n));
  assert.equal(mine.length, 1, 'CONTROL: exactly one new claim must exist: ' + JSON.stringify(mine));
  const spot = { label: mine[0].replace(/^\.grok-/, ''), dir: nodePath.join(SANDBOX, mine[0]) };
  const r2 = await post('/api/accounts/grok/apikey', { label: spot.label, key: 'xai-named-racer-key-2222' });
  assert.equal(r2.status, 400, 'the named add was let into a claimed slot');
  assert.match((await r2.json()).error, /being added under that name right now/);
  release();
  const r1 = await p1;
  assert.equal(r1.status, 200);
  const b1 = await r1.json();
  assert.equal(b1.account.dir, spot.dir);
  assert.equal(fs.readFileSync(grokAccounts.keyFile(spot.dir), 'utf8'), 'xai-unnamed-inflight-key-1111', 'the unnamed add\'s key was overwritten');
});

/* #3391: a NAMED grok key add refuses a folder that already holds an auth.json of ANY shape,
   even one identityOf cannot describe (two entries), so a key is never stacked on someone's
   unrecognised sign-in. The same file-presence rule the named sign-in uses. */
test('grok store: a named key add refuses a folder holding an undescribable auth.json', async () => {
  const dir = nodePath.join(SANDBOX, '.grok-hassignin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'), JSON.stringify({ 'https://auth.x.ai::a': { email: 'a@x' }, 'https://auth.x.ai::b': { email: 'b@x' } }), { mode: 0o600 });
  assert.equal(grokAccounts.identityOf(dir), null, 'CONTROL: identityOf cannot describe it');
  grokAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const r = await post('/api/accounts/grok/apikey', { label: 'hassignin', key: 'xai-stack-attempt-1234567890' });
  assert.equal(r.status, 400, 'refused');
  assert.match((await r.json()).error, /already a Grok account by that name/);
  assert.equal(fs.existsSync(grokAccounts.keyFile(dir)), false, 'no key was written beside the sign-in');
  fs.rmSync(dir, { recursive: true, force: true });
});

/* #3658: first run's Connect PROBES this route with an empty body before it opens the key
   box, and relies on the probe changing nothing. Runner present: the empty key is refused
   by keyProblem before any slot is claimed or any file written. Runner missing: needsRunner,
   also before anything is written. Pinned here so a refactor that claims a slot earlier
   cannot turn every Connect click into a new account directory. */
test('#3658: an empty-body probe of the gemini/grok key routes writes nothing, runner present or not', async () => {
  const snapshot = () => fs.readdirSync(SANDBOX).sort().join('|');
  for (const route of ['gemini', 'grok']) {
    const before = snapshot();
    const present = await post('/api/accounts/' + route + '/apikey', {});
    assert.equal(present.status, 400, route + ': an empty key must be refused');
    const pb = await present.json();
    assert.notEqual(pb.needsRunner, true, route + ': the runner is present in this test');
    assert.equal(snapshot(), before, route + ': the probe (runner present) created something');
    runners.resolveBin = () => ({ present: false, bin: null });
    try {
      const missing = await post('/api/accounts/' + route + '/apikey', {});
      assert.equal(missing.status, 400);
      assert.equal((await missing.json()).needsRunner, true, route + ': a missing runner must answer needsRunner to an empty probe');
      assert.equal(snapshot(), before, route + ': the probe (runner missing) created something');
    } finally {
      runners.resolveBin = (p) => ({ present: true, bin: `/mock/${p}` });
    }
  }
  // CONTROL: the snapshot can see a write. A real add changes it, so the equalities above mean something.
  const before = snapshot();
  geminiAccounts.setFetcher(async () => ({ status: 200, body: {} }));
  const real = await post('/api/accounts/gemini/apikey', { key: 'AIzaSy-probe-control-12345678' });
  assert.equal(real.status, 200, 'the control add failed, so it proves nothing');
  assert.notEqual(snapshot(), before, 'a real add did not change the snapshot, so the probe equalities prove nothing');
});
