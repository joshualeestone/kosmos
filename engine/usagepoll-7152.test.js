'use strict';
/* kosmos#7152 slice 1: engine/usagepoll.js reads each Claude account's usage from the usage endpoint, idle accounts
   included, and accountsweekly prefers the newer of that reading and the status line's. No real credential and no
   network: the Keychain reader and the HTTPS request are injected. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const usagepoll = require('./usagepoll');
const accountsweekly = require('./accountsweekly');
const loginexpiry = require('./loginexpiry');

const NOW = Date.parse('2026-10-25T22:00:00Z');
const TOKEN = 'sk-ant-oat01-TEST-TOKEN-must-never-be-written';
const cred = (o) => JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: NOW + 3600000, ...o } });
const BODY = JSON.stringify({
  five_hour: { utilization: 4.0, resets_at: '2026-10-26T01:20:00.447680+00:00' },
  seven_day: { utilization: 56.0, resets_at: '2026-10-30T14:00:00.447704+00:00' },
});

function tmpDir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'usagepoll-7152-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/* A fake https.request: records each call's options, answers { code, body } (or an error), and counts how many are
   in flight at once. */
function fakeRequest(answer, seen) {
  seen.calls = []; seen.inFlight = 0; seen.maxInFlight = 0;
  return (opts, cb) => {
    seen.calls.push(opts);
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => {
      seen.inFlight += 1; seen.maxInFlight = Math.max(seen.maxInFlight, seen.inFlight);
      setImmediate(() => {
        seen.inFlight -= 1;
        const a = typeof answer === 'function' ? answer(opts) : answer;
        if (a.error) { req.emit('error', new Error('network')); return; }
        const res = new EventEmitter();
        res.statusCode = a.code;
        res.setEncoding = () => {};
        cb(res);
        res.emit('data', a.body || '');
        res.emit('end');
      });
    };
    return req;
  };
}

test('#7152: the default account reads the bare Keychain entry and any other account its own folder\'s entry', async () => {
  const asked = [];
  const readCred = async (svc) => { asked.push(svc); return cred(); };
  await usagepoll.tokenStateFor({ dir: '/u/.claude', isDefault: true }, { now: NOW, platform: 'darwin', readCred });
  await usagepoll.tokenStateFor({ dir: '/u/.claude-account-d' }, { now: NOW, platform: 'darwin', readCred });
  assert.deepEqual(asked, [loginexpiry.DEFAULT_SERVICE, loginexpiry.serviceNameFor('/u/.claude-account-d')]);
  assert.notEqual(asked[1], loginexpiry.DEFAULT_SERVICE, 'CONTROL: a non-default account must not read the bare entry');
});

test('#7152: the token states: no credential, unreadable, no token, expired, and ok', async () => {
  const st = async (raw) => (await usagepoll.tokenStateFor({ dir: '/u/x' }, { now: NOW, platform: 'darwin', readCred: async () => raw })).state;
  assert.equal(await st(null), 'no-credential');
  assert.equal(await st('not json'), 'no-credential');
  assert.equal(await st(JSON.stringify({ claudeAiOauth: {} })), 'no-token');
  assert.equal(await st(cred({ expiresAt: NOW - 1 })), 'token-expired');
  assert.equal(await st(cred()), 'ok');
});

test('#7152: off macOS the folder\'s own .credentials.json is read', async (t) => {
  const d = tmpDir(t);
  assert.equal((await usagepoll.tokenStateFor({ dir: d }, { now: NOW, platform: 'linux' })).state, 'no-credential', 'CONTROL: no file yet');
  fs.writeFileSync(path.join(d, '.credentials.json'), cred());
  assert.equal((await usagepoll.tokenStateFor({ dir: d }, { now: NOW, platform: 'linux' })).state, 'ok');
});

test('#7152: a good answer gives weekly and five-hour usage with reset times in seconds, over the right request', async () => {
  const seen = {};
  const r = await usagepoll.readOne({ dir: '/u/x' }, {
    now: NOW, platform: 'darwin', readCred: async () => cred(), request: fakeRequest({ code: 200, body: BODY }, seen),
  });
  assert.deepEqual(r, {
    at: NOW, state: 'ok',
    weekly: { usedPct: 56, resetsAt: Math.floor(Date.parse('2026-10-30T14:00:00.447704Z') / 1000) },
    fiveHour: { usedPct: 4, resetsAt: Math.floor(Date.parse('2026-10-26T01:20:00.447680Z') / 1000) },
  });
  const o = seen.calls[0];
  assert.equal(o.host, 'api.anthropic.com');
  assert.equal(o.path, '/api/oauth/usage');
  assert.equal(o.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(o.headers['anthropic-beta'], 'oauth-2025-04-20');
});

test('#7152: a refused, failed or unreadable answer is a state, never a reading; an expired token sends no request', async () => {
  const read = (answer, raw = cred()) => {
    const seen = {};
    return usagepoll.readOne({ dir: '/u/x' }, { now: NOW, platform: 'darwin', readCred: async () => raw, request: fakeRequest(answer, seen) })
      .then((r) => ({ r, seen }));
  };
  assert.equal((await read({ code: 401, body: '{}' })).r.state, 'http-401');
  assert.equal((await read({ error: true })).r.state, 'unreachable');
  assert.equal((await read({ code: 200, body: 'not json' })).r.state, 'unreadable-response');
  assert.equal((await read({ code: 200, body: '{"five_hour":{}}' })).r.state, 'unreadable-response');
  const expired = await read({ code: 200, body: BODY }, cred({ expiresAt: NOW - 1 }));
  assert.equal(expired.r.state, 'token-expired');
  assert.equal(expired.seen.calls.length, 0, 'an expired token was sent anyway');
  assert.equal(await usagepoll.readOne({ dir: '/u/x', apiKey: true }, { now: NOW }), null, 'an API-key account has no weekly limit');
});

test('#7152: the recorded file holds the numbers and the state, never the token, and only this user can read it', async (t) => {
  const d = tmpDir(t);
  const n = await usagepoll.pollAll([{ dir: d }], {
    now: NOW, platform: 'darwin', readCred: async () => cred(), request: fakeRequest({ code: 200, body: BODY }, {}),
  });
  assert.equal(n, 1);
  const body = fs.readFileSync(path.join(d, usagepoll.FILE), 'utf8');
  assert.equal(body.includes(TOKEN), false, 'the token was written');
  assert.equal(body.includes('sk-ant'), false, 'part of the token was written');
  assert.equal(JSON.parse(body).weekly.usedPct, 56, 'CONTROL: the file does hold the reading');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(d, usagepoll.FILE)).mode & 0o777, 0o600);
});

test('#7152: a reading older than three missed polls, or from a finished week, is not used', (t) => {
  const d = tmpDir(t);
  const resetsAt = Math.floor((NOW + 86400000) / 1000);
  usagepoll.write(d, { at: NOW, state: 'ok', weekly: { usedPct: 40, resetsAt }, fiveHour: null });
  assert.equal(usagepoll.readUsage(d, NOW + 60000).weekly.usedPct, 40, 'CONTROL: a fresh reading is used');
  assert.equal(usagepoll.readUsage(d, NOW + usagepoll.FRESH_MS + 1), null, 'a stale reading was used');
  usagepoll.write(d, { at: resetsAt * 1000 + 5000, state: 'ok', weekly: { usedPct: 40, resetsAt }, fiveHour: null });
  assert.equal(usagepoll.readUsage(d, resetsAt * 1000 + 10000).weekly, null, 'a finished week\'s figure was used');
});

test('#7152: accountsweekly takes the newer of the status line\'s reading and the endpoint\'s, in the same shape', (t) => {
  const d = tmpDir(t);
  const resetsAt = Math.floor((NOW + 3 * 86400000) / 1000);
  const statusAt = NOW - 2 * 3600000;
  fs.writeFileSync(path.join(d, 'kosmos-weekly.json'), JSON.stringify({ usedPct: 30, resetsAt, at: statusAt, history: [] }));
  assert.deepEqual(accountsweekly.weeklyOf({ dir: d }, NOW), { usedPct: 30, resetsAt: resetsAt * 1000, at: statusAt }, 'CONTROL: the status line alone');
  usagepoll.write(d, { at: NOW - 60000, state: 'ok', weekly: { usedPct: 41, resetsAt }, fiveHour: null });
  assert.deepEqual(accountsweekly.weeklyOf({ dir: d }, NOW), { usedPct: 41, resetsAt: resetsAt * 1000, at: NOW - 60000 }, 'the newer endpoint reading was not used');
  fs.writeFileSync(path.join(d, 'kosmos-weekly.json'), JSON.stringify({ usedPct: 45, resetsAt, at: NOW - 1000, history: [] }));
  assert.equal(accountsweekly.weeklyOf({ dir: d }, NOW).usedPct, 45, 'an older endpoint reading beat a newer status line');
  usagepoll.write(d, { at: NOW - 60000, state: 'token-expired' });
  assert.equal(usagepoll.readUsage(d, NOW).state, 'token-expired', 'CONTROL: the unmeasured read was recorded');
  assert.equal(accountsweekly.weeklyOf({ dir: d }, NOW).usedPct, 45, 'an unmeasured read hid the status line\'s reading');
});

test('#7152: accounts are read one at a time, so a slow read never stacks requests', async (t) => {
  const seen = {};
  const list = [tmpDir(t), tmpDir(t), tmpDir(t)].map((dir) => ({ dir }));
  const n = await usagepoll.pollAll(list, {
    now: NOW, platform: 'darwin', readCred: async () => cred(), request: fakeRequest({ code: 200, body: BODY }, seen),
  });
  assert.equal(n, 3);
  assert.equal(seen.calls.length, 3, 'CONTROL: every account was read');
  assert.equal(seen.maxInFlight, 1, 'requests overlapped');
});
