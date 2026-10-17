'use strict';
/**
 * #6176 slice 3: a Grok subscription row in GET /api/accounts carries its usage as Grok last logged it in the account's
 * own folder (engine/groklimits.js); a subscription with no reading carries limits: null; an API-key row carries none.
 * Nothing here reaches xAI: the subscription check is answered by a fake fetcher.
 *
 *   node --test server.groklimits-6176.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-groklimits-6176-'));
const mkTemp = (p) => fs.mkdtempSync(nodePath.join(os.tmpdir(), p));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkTemp('srv-gl-workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mkTemp('srv-gl-projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mkTemp('srv-gl-launch-');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(SANDBOX, '.grok');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_GROK_CHECK_WAIT_MS = '200';

const DAY = 864e5;
const now = Date.now();
function account(dir, files) {
  fs.mkdirSync(nodePath.join(dir, 'logs'), { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(nodePath.join(dir, name), body);
}
const billingLine = (ts, pct, start, end) => JSON.stringify({ ts: new Date(ts).toISOString(), lvl: 'info', src: 'shell',
  msg: 'billing: fetched credits config', ctx: { config: { creditUsagePercent: pct, currentPeriod: {
    type: 'USAGE_PERIOD_TYPE_WEEKLY', start: new Date(start).toISOString(), end: new Date(end).toISOString() } }, subscriptionTier: 'SuperGrok' } });
// The default Grok account: a grok.com sign-in (the real auth shape: the key names the app's sign-in client, user_id the
// person), with a reading in the current period.
account(nodePath.join(SANDBOX, '.grok'), {
  'auth.json': JSON.stringify({ 'https://auth.x.ai::client-1': { email: 'sub@example.com', user_id: 'person-1', refresh_token: 'r' } }),
  'logs/unified.jsonl': billingLine(now - DAY, 58, now - 2 * DAY, now + 5 * DAY) + '\n',
});
// Signed in three days ago, before the reading (only readings since the current sign-in count: review 1).
{ const t = new Date(now - 3 * DAY); fs.utimesSync(nodePath.join(SANDBOX, '.grok', 'auth.json'), t, t); }
// A second sign-in with no log at all, and an API-key account.
account(nodePath.join(SANDBOX, '.grok-quiet'), { 'auth.json': JSON.stringify({ 'https://auth.x.ai::client-1': { email: 'quiet@example.com', user_id: 'person-2', refresh_token: 'r' } }) });
account(nodePath.join(SANDBOX, '.grok-key'), { '.kosmos-grok-apikey': 'xai-workingkeyworkingKEYX' });

const grokAccounts = require('./engine/grokaccounts');
grokAccounts.setFetcher(async () => ({ status: 401 }));   // never the real xAI
const { start, server } = require('./server');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  grokAccounts.setFetcher(null);
  try { server.close(); } catch { /* best effort */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('#6176: a Grok subscription row carries its logged usage; one with no reading carries null; a key row none', async () => {
  const res = await fetch(base + '/api/accounts');
  assert.equal(res.status, 200);
  const body = await res.json();
  const rows = (body.accounts || []).filter((a) => a && a.provider === 'xai');
  const byDir = (end) => rows.find((a) => String(a.dir || '').endsWith(end));
  const sub = byDir('/.grok'), quiet = byDir('/.grok-quiet'), key = byDir('/.grok-key');
  assert.ok(sub && quiet && key, 'CONTROL: all three Grok accounts are listed: ' + JSON.stringify(rows.map((a) => [a.dir, a.authMode])));
  assert.equal(sub.authMode, 'subscription');
  assert.ok(sub.limits && Array.isArray(sub.limits.windows), 'the subscription row carries no limits: ' + JSON.stringify(sub));
  assert.equal(sub.limits.windows[0].usedPct, 58);
  assert.equal(sub.limits.windows[0].windowMinutes, 7 * 1440);
  assert.equal(sub.limits.plan, 'SuperGrok');
  assert.ok('limits' in quiet && quiet.limits === null, 'a subscription with no reading did not say so: ' + JSON.stringify(quiet));
  assert.equal(key.authMode, 'apikey');
  assert.equal('limits' in key, false, 'an API-key row carried a limits field');
});
