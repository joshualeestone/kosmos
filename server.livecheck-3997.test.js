'use strict';
/*
 * #3997 (Josh, 2026-09-26: "only some of these that are signed in are actually green"). The FREE live checks behind
 * the AI Models rows: a ChatGPT sign-in (codex's own handshake, faked through codexsigninlive.setRunner) and a Grok
 * subscription (the models listing, faked through grokaccounts.setFetcher). Nothing here reaches OpenAI or xAI.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-livecheck-3997-'));
const HOME = nodePath.join(SANDBOX, 'home');
for (const d of [HOME, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(HOME, '.grok');
process.env.AGENT_WORKFORCE_GEMINI_HOME = nodePath.join(HOME, '.gemini');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_GROK_CHECK_WAIT_MS = '200';   // round 7: how long the list waits on a Grok check
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const CODEX = nodePath.join(HOME, '.codex');
fs.mkdirSync(CODEX, { recursive: true });
const idPayload = Buffer.from(JSON.stringify({ email: 'sub@example.com' })).toString('base64url');
fs.writeFileSync(nodePath.join(CODEX, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'x.' + idPayload + '.y' } }));

// An API-KEY OpenAI account beside it: the ChatGPT Check now must refuse it (it is not a sign-in).
const CODEX_KEY = nodePath.join(HOME, '.codex-key');
fs.mkdirSync(CODEX_KEY, { recursive: true });
fs.writeFileSync(nodePath.join(CODEX_KEY, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-workingkeyworkingKEYX' }));

const GROK = nodePath.join(HOME, '.grok');
fs.mkdirSync(GROK, { recursive: true });
function grokSignIn(expiresInMs) {
  fs.writeFileSync(nodePath.join(GROK, 'auth.json'), JSON.stringify({ 'https://auth.x.ai::1': {
    key: 'sess', refresh_token: 'r', email: 'g@example.com', expires_at: new Date(Date.now() + expiresInMs).toISOString() } }));
}

const codexsigninlive = require('./engine/codexsigninlive');
const openaiAccounts = require('./engine/openaiaccounts');
const grokAccounts = require('./engine/grokaccounts');
const observed = require('./engine/observed');
const { start, server } = require('./server');

const DOC = (ws) => JSON.stringify({ checks: {
  'network.websocket_reachability': { status: ws },
  'network.provider_reachability': { status: 'ok', details: { 'reachability mode': 'ChatGPT auth' } },
} });

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  codexsigninlive.resetForTest(); grokAccounts.setFetcher(null); openaiAccounts.setFetcher(null);
  try { server.close(); } catch { /* best effort */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});
/* Round 10: the API-key account below is checked against OpenAI's models listing on every read; answer it here, so
   nothing in this file ever reaches OpenAI (it sent a fake key there before). */
test.beforeEach(() => { codexsigninlive.resetForTest(); grokAccounts.setFetcher(null); grokAccounts.resetSubscriptionLiveForTest(); observed._clearForTest(); openaiAccounts.setFetcher(async () => ({ status: 200, body: { object: 'list', data: [] } })); });

const accounts = async () => ((await (await fetch(base + '/api/accounts')).json()).accounts || []);
const post = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });

test('#3997 ChatGPT: opening the list STARTS the free check without waiting, says so, and the next read is green', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let runs = 0;
  codexsigninlive.setRunner(async () => { runs++; await gate; return { ok: true, stdout: DOC('ok') }; });
  grokSignIn(3 * 3600 * 1000);
  grokAccounts.setFetcher(async () => ({ status: 200 }));
  const first = (await accounts()).find((a) => a.provider === 'openai');
  assert.equal(runs, 1, 'opening the list did not start the ChatGPT check');
  assert.equal(first.connection.state, 'unknown', 'the read waited for the handshake (#1921: it must not)');
  assert.equal(first.connection.liveCheckPending, true);
  release();
  await new Promise((r) => setTimeout(r, 50));
  const second = (await accounts()).find((a) => a.provider === 'openai');
  assert.equal(second.connection.state, 'connected', JSON.stringify(second.connection));
  assert.ok(!second.connection.liveCheckPending, 'a warm row still says a check is under way');
  assert.equal(runs, 1, 'a warm row started another check');
});

test('#3997 ChatGPT: a check that FINISHED without an answer is not "checking" (review round 2)', async () => {
  codexsigninlive.setRunner(async () => ({ ok: false }));   // codex missing, a timeout: no report at all
  grokAccounts.setFetcher(async () => ({ status: 200 }));
  await accounts();
  await new Promise((r) => setTimeout(r, 50));
  const row = (await accounts()).find((a) => a.provider === 'openai');
  assert.equal(row.connection.state, 'unknown');
  assert.ok(!row.connection.liveCheckPending, 'a finished check still says it is under way');
});

test('#3997 ChatGPT Check now runs its OWN check, never the one opening the list started (review round 3)', async () => {
  // Opening the list starts a check against the sign-in as it was (it will answer dead); meanwhile the person signs in
  // again and presses Check now, which must ask afresh and answer from the new sign-in.
  let release;
  const gate = new Promise((r) => { release = r; });
  let runs = 0;
  codexsigninlive.setRunner(async () => { runs++; if (runs === 1) { await gate; return { ok: true, stdout: DOC('warning') }; } return { ok: true, stdout: DOC('ok') }; });
  grokAccounts.setFetcher(async () => ({ status: 200 }));
  await accounts();
  assert.equal(runs, 1);
  // Bounded: joined to the old check, Check now would wait on it (and its gate) forever, so time it out as a failure.
  const pressed = post('/api/accounts/openai/check', { dir: CODEX }).then((r) => r.json());
  const j = await Promise.race([pressed, new Promise((r) => setTimeout(() => r({ state: 'waited on the old check' }), 3000))]);
  release();
  assert.equal(j.state, 'connected', 'Check now answered from (or waited on) the check already running against the old sign-in');
  assert.equal(runs, 2);
});

test('#3997 round 4: a stale check never overwrites a newer answer, "no answer" never erases a green, a reset stops old runs', async () => {
  // A check started before the person signed in again (it will say dead) finishes AFTER Check now said live.
  let release;
  const gate = new Promise((r) => { release = r; });
  let n = 0;
  codexsigninlive.setRunner(async () => { n++; if (n === 1) { await gate; return { ok: true, stdout: DOC('warning') }; } return { ok: true, stdout: DOC('ok') }; });
  const stale = codexsigninlive.liveness(CODEX);
  await new Promise((r) => setTimeout(r, 10));   // the stale run starts its runner a tick later
  assert.equal(n, 1, 'CONTROL: the stale run is the one holding the gate');
  assert.equal(await codexsigninlive.livenessNow(CODEX), 'live');
  release();
  assert.equal(await stale, 'dead', 'CONTROL: the stale run did answer dead');
  assert.equal(codexsigninlive.livenessCached(CODEX).verdict, 'live', 'the stale run overwrote the newer Check now answer');
  // Check now with no answer leaves the fresh green as it was.
  codexsigninlive.setRunner(async () => ({ ok: false }));
  assert.equal(await codexsigninlive.livenessNow(CODEX), 'unknown');
  assert.equal(codexsigninlive.livenessCached(CODEX).verdict, 'live', 'a check with no answer erased a green');
  // Round 6: and an older run's REAL answer does replace a newer entry that said nothing.
  codexsigninlive.resetForTest();
  let release3;
  const gate3 = new Promise((r) => { release3 = r; });
  let m = 0;
  codexsigninlive.setRunner(async () => { m++; if (m === 1) { await gate3; return { ok: true, stdout: DOC('ok') }; } return { ok: false }; });
  const older = codexsigninlive.liveness(CODEX);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(await codexsigninlive.livenessNow(CODEX), 'unknown');
  release3();
  await older;
  assert.equal(codexsigninlive.livenessCached(CODEX).verdict, 'live', 'a newer "no answer" blocked an older run\'s real answer');
  // A run from before a reset writes nothing after it.
  codexsigninlive.resetForTest();
  let release2;
  const gate2 = new Promise((r) => { release2 = r; });
  codexsigninlive.setRunner(async () => { await gate2; return { ok: true, stdout: DOC('warning') }; });
  const old = codexsigninlive.liveness(CODEX);
  await new Promise((r) => setTimeout(r, 10));
  codexsigninlive.resetForTest();
  release2();
  await old;
  assert.equal(codexsigninlive.checkState(CODEX), 'cold', 'a run from before the reset wrote into the cache after it');
});

test('#3997 Grok subscription: a current key checked live on open reads working; an expired one stays unconfirmed with its reason', async () => {
  let calls = 0;
  grokAccounts.setFetcher(async () => { calls++; return { status: 200 }; });
  codexsigninlive.setRunner(async () => ({ ok: false }));
  grokSignIn(3 * 3600 * 1000);
  let row = (await accounts()).find((a) => a.provider === 'xai');
  assert.equal(calls, 1);
  assert.equal(row.connection.badge, 'working', JSON.stringify(row.connection));
  // An expired key is not sent anywhere, and the row says why it is not green.
  observed._clearForTest();   // forget that green, as a stale one would be
  grokSignIn(-60 * 1000);
  calls = 0;
  row = (await accounts()).find((a) => a.provider === 'xai');
  assert.equal(row.connection.badge, 'signed_in_unverified', JSON.stringify(row.connection));
  assert.match(row.connection.because, /renews this sign-in the next time it runs/);
  assert.equal(calls, 0, 'an expired Grok key was sent to Grok');
});

test('#3997 round 6: a kept Grok answer is recorded at the time it was learned, not re-dated on every read', async () => {
  codexsigninlive.setRunner(async () => ({ ok: false }));
  grokSignIn(3 * 3600 * 1000);
  grokAccounts.setFetcher(async () => ({ status: 200 }));
  await accounts();
  const first = observed.readDir(observed.PROVIDER.XAI, GROK);
  assert.ok(first, 'CONTROL: the first read recorded the answer');
  await new Promise((r) => setTimeout(r, 60));
  grokAccounts.setFetcher(async () => { throw new Error('asked again inside the 30s'); });
  await accounts();   // served from the kept answer
  assert.equal(observed.readDir(observed.PROVIDER.XAI, GROK).at, first.at, 'a kept answer was recorded as newer than it is');
});

test('#3997 round 7: a slow Grok check does not hold the list; the row says it is checking and the next read has it', async () => {
  codexsigninlive.setRunner(async () => ({ ok: false }));
  grokSignIn(3 * 3600 * 1000);
  let calls = 0;
  grokAccounts.setFetcher(async () => { calls++; await new Promise((r) => setTimeout(r, 700)); return { status: 200 }; });
  const t0 = Date.now();
  const first = (await accounts()).find((a) => a.provider === 'xai');
  const took = Date.now() - t0;
  assert.ok(took < 600, 'the list waited on the slow Grok check (' + took + 'ms)');
  assert.equal(first.connection.liveCheckPending, true);
  assert.equal(first.connection.badge, 'signed_in_unverified');
  await new Promise((r) => setTimeout(r, 800));
  const next = (await accounts()).find((a) => a.provider === 'xai');
  assert.equal(next.connection.badge, 'working', 'the check that finished meanwhile did not reach the next read');
  assert.equal(calls, 1, 'the next read asked xAI again instead of using the answer it got');
});

test('#3997 round 8: a Grok answer that arrives DURING the wait makes the very first read green', async () => {
  codexsigninlive.setRunner(async () => ({ ok: false }));
  grokSignIn(3 * 3600 * 1000);
  for (const delay of [0, 60, 120]) {   // all inside the 200ms wait this file sets
    grokAccounts.resetSubscriptionLiveForTest();
    observed._clearForTest();
    grokAccounts.setFetcher(async () => { await new Promise((r) => setTimeout(r, delay)); return { status: 200 }; });
    const row = (await accounts()).find((a) => a.provider === 'xai');
    assert.equal(row.connection.badge, 'working', 'an answer after ' + delay + 'ms did not turn the first read green: ' + JSON.stringify(row.connection));
  }
});

test('#3997 round 9: a row that is green AND still being checked keeps saying it is checking, so the page reads again', async () => {
  codexsigninlive.setRunner(async () => ({ ok: false }));
  grokSignIn(3 * 3600 * 1000);
  observed.sawDir(observed.PROVIDER.XAI, GROK, observed.OUTCOME.OK);   // an earlier green, still fresh
  grokAccounts.setFetcher(async () => { await new Promise((r) => setTimeout(r, 700)); return { status: 200 }; });
  const row = (await accounts()).find((a) => a.provider === 'xai');
  assert.equal(row.connection.badge, 'working', 'CONTROL: the fresh earlier green shows');
  assert.equal(row.connection.liveCheckPending, true, 'a green row lost its "still checking" flag, so the page would not read again');
  await new Promise((r) => setTimeout(r, 800));   // let the slow check land before the next test
});

test('#3997 round 7: deadIsNewer: a dead answer newer than an agent success wins, an older one or a live one does not', async () => {
  codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC('warning') }));
  const before = Date.now() - 1000;
  assert.equal(await codexsigninlive.livenessNow(CODEX), 'dead');
  assert.equal(codexsigninlive.deadIsNewer(CODEX, before), true);
  assert.equal(codexsigninlive.deadIsNewer(CODEX, Date.now() + 1000), false, 'an agent success after the dead answer lost to it');
  codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC('ok') }));
  await codexsigninlive.livenessNow(CODEX);
  assert.equal(codexsigninlive.deadIsNewer(CODEX, before), false, 'a live answer counted as dead');
});

test('#3997 round 7: the OpenAI overlay asks deadIsNewer before letting an agent success paint a row green', () => {
  // The route test cannot tie an observed agent to an account (no created agent), so the WIRING is pinned in the
  // source, comments stripped so a description of the call cannot satisfy it. The rule itself is tested above.
  const code = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const overlay = code.slice(code.indexOf('const openai = openaiRows.map('), code.indexOf('const openai = openaiRows.map(') + 2500);
  assert.match(overlay, /if \(a\.connection && a\.connection\.state === 'none' && codexsigninlive\.deadIsNewer\(a\.dir, obs\.at\)\) return base;/);
  assert.ok(overlay.indexOf('deadIsNewer') < overlay.indexOf("badge !== 'working'"), 'the rule must run before the green decision');
});

test('#3997 round 12: the Grok overlay drops an agent success older than this read\'s refusal before judging the row', () => {
  // As for deadIsNewer: the route test cannot tie an agent to an account, so the wiring is pinned in the source with
  // comments stripped. The rule itself is tested in engine/grokaccounts.livecheck-3997.test.js.
  const code = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const start = code.indexOf('const grok = grokRows.map(');
  assert.ok(start > 0, 'the Grok overlay was not found');
  const overlay = code.slice(start, start + 2500);
  assert.match(overlay, /const agentObs = grokAccounts\.refusalIsNewer\(thisCheck, agentSeen\) \? null : agentSeen;/);
  assert.ok(overlay.indexOf('refusalIsNewer') < overlay.indexOf('const obs = '), 'the rule must run before the newest observation is picked');
});

test('#3997 Check now routes: connected, none and unknown, and a wrong kind of account is refused', async () => {
  let runs = 0;
  codexsigninlive.setRunner(async () => { runs++; return { ok: true, stdout: DOC('ok') }; });
  let j = await (await post('/api/accounts/openai/check', { dir: CODEX })).json();
  assert.equal(j.state, 'connected');
  // "Right now": a second press asks again rather than serving the answer from a moment ago.
  await post('/api/accounts/openai/check', { dir: CODEX });
  assert.equal(runs, 2, 'Check now served a cached answer');
  codexsigninlive.resetForTest();
  codexsigninlive.setRunner(async () => ({ ok: true, stdout: DOC('warning') }));
  j = await (await post('/api/accounts/openai/check', { dir: CODEX })).json();
  assert.equal(j.state, 'none');
  grokSignIn(3 * 3600 * 1000);
  grokSignIn(-60 * 1000);
  j = await (await post('/api/accounts/grok/check', { dir: GROK })).json();
  assert.equal(j.state, 'expired', 'an expired key is its own answer, not "try again"');
  grokSignIn(3 * 3600 * 1000);
  grokAccounts.setFetcher(async () => ({ status: 401 }));
  j = await (await post('/api/accounts/grok/check', { dir: GROK })).json();
  assert.equal(j.state, 'refused', 'a 401 is its own answer: not confirmed, and not a negative');
  assert.match(j.because, /Signing in again/);
  observed._clearForTest();
  grokAccounts.setFetcher(async () => ({ status: 200 }));
  j = await (await post('/api/accounts/grok/check', { dir: GROK })).json();
  assert.equal(j.state, 'connected');
  // The list read below cannot confirm anything itself (Grok answers 500), so only Check now's answer can green it.
  grokAccounts.setFetcher(async () => ({ status: 500 }));
  const row = (await accounts()).find((a) => a.provider === 'xai');
  assert.equal(row.connection.badge, 'working', 'Check now did not turn the row green');
  // Within 30s the list reuses Check now's answer rather than asking again (round 4):
  grokAccounts.setFetcher(async () => { throw new Error('asked again inside the 30s'); });
  assert.equal((await accounts()).find((a) => a.provider === 'xai').connection.badge, 'working');
  // But once that has run out, Grok REFUSING it on the next read outranks that green (it is what the new answer is about).
  grokAccounts.resetSubscriptionLiveForTest();   // the 30s have passed
  grokAccounts.setFetcher(async () => ({ status: 401 }));
  const refused = (await accounts()).find((a) => a.provider === 'xai');
  assert.equal(refused.connection.badge, 'signed_in_unverified', 'a refused sign-in still shows an earlier green');
  assert.match(refused.connection.because, /Signing in again/);
  // And the NEXT read, which cannot ask (the key has since expired), does not bring the refused green back.
  grokSignIn(-60 * 1000);
  const later = (await accounts()).find((a) => a.provider === 'xai');
  assert.equal(later.connection.badge, 'signed_in_unverified', 'an earlier green came back after Grok refused the sign-in');
  grokSignIn(3 * 3600 * 1000);
  // A ChatGPT dir asked on the Grok route (and a stranger's folder) is not an account of that kind.
  assert.equal((await post('/api/accounts/grok/check', { dir: CODEX })).status, 404);
  assert.ok((await accounts()).some((a) => a.dir === CODEX_KEY), 'CONTROL: the api-key account is a listed OpenAI account');
  assert.equal((await post('/api/accounts/openai/check', { dir: CODEX_KEY })).status, 404, 'an api-key account was checked as a ChatGPT sign-in');
  assert.equal((await post('/api/accounts/openai/check', { dir: nodePath.join(SANDBOX, 'nope') })).status, 404);
  assert.equal((await post('/api/accounts/openai/check', {})).status, 400);
});
