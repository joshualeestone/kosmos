'use strict';

/**
 * kosmos#7152 slice 2 through the real server (in-process, every root sandboxed, dry run): usage auto-balance's
 * switch route and what /api/accounts adds. The switch reads on when never set; its PUT takes only a screen (an
 * Origin the board serves) and only true or false; /api/accounts puts the engine's bulkTargetable on every Claude row,
 * and the decision only when Settings asks for the agents (?agents=1).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-autobalance-route-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const statusline = require('./engine/kosmos-statusline');

let port = 0;
test.before(async () => { await start(0); port = server.address().port; });
test.after(() => {
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* node:http, so the Origin header is sent as written (fetch controls some request headers itself). */
function call(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch { j = null; } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const screen = () => ({ origin: `http://127.0.0.1:${port}` });

test('#7152 slice 2: the switch reads on when never set, and only a screen may change it, to true or false', async () => {
  const first = await call('GET', '/api/autobalance-setting');
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, { on: true, ok: true }, 'a person who never set it did not get it on');
  const noScreen = await call('PUT', '/api/autobalance-setting', { on: false });
  assert.equal(noScreen.status, 403, 'a caller that is not the screen changed it');
  const notBool = await call('PUT', '/api/autobalance-setting', { on: 'no' }, screen());
  assert.equal(notBool.status, 400, 'a value that is not true or false was taken');
  assert.deepEqual((await call('GET', '/api/autobalance-setting')).json, { on: true, ok: true }, 'a refused change was saved anyway');
  const off = await call('PUT', '/api/autobalance-setting', { on: false }, screen());
  assert.equal(off.status, 200, 'CONTROL: the screen can change it');
  assert.deepEqual(off.json, { on: false, ok: true });
  assert.deepEqual((await call('GET', '/api/autobalance-setting')).json, { on: false, ok: true }, 'turning it off did not stick');
  await call('PUT', '/api/autobalance-setting', { on: true }, screen());
});

test('#7152 slice 2: every Claude row carries bulkTargetable, and the decision comes only with ?agents=1', async () => {
  /* The default Claude account, as accounts.list finds it: <home>/.claude, signed in through <home>/.claude.json. */
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'person@example.test' } }));
  const plain = await call('GET', '/api/accounts');
  assert.equal(plain.status, 200);
  const claude = (plain.json.accounts || []).filter((a) => a.provider === 'anthropic');
  assert.ok(claude.length >= 1, 'CONTROL: the sandbox lists a Claude account');
  assert.ok(claude.every((a) => typeof a.bulkTargetable === 'boolean'), 'a Claude row went without the engine\'s answer');
  assert.equal('autobalance' in plain.json, false, 'the decision was worked out for a page that does not show it');
  const settings = await call('GET', '/api/accounts?agents=1');
  const ab = settings.json && settings.json.autobalance;
  assert.ok(ab && typeof ab.eligible === 'number' && Array.isArray(ab.moves), 'Settings was not given the decision');
  assert.equal(ab.on, true);
  assert.equal(ab.eligible, claude.filter((a) => !a.apiKey).length, 'the account count is not the Claude subscription rows');
  assert.equal(JSON.stringify(settings.json.autobalance).includes('@'), false, 'an email went into the decision');
});

test('#7152 review 3: with two accounts and one running out, the real route works out the decision and names it', async () => {
  const home = process.env.AGENT_WORKFORCE_HOME;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'person@example.test' } }));
  const second = path.join(home, '.claude-spare');
  fs.mkdirSync(second, { recursive: true });
  fs.writeFileSync(path.join(second, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'other@example.test' } }));
  const weekly = (dir, usedPct) => fs.writeFileSync(path.join(dir, statusline.FILE),
    JSON.stringify({ usedPct, resetsAt: Math.floor((Date.now() + 40 * 3600e3) / 1000), at: Date.now() - 60e3, history: [] }));
  weekly(path.join(home, '.claude'), 95);
  weekly(second, 10);
  const ab = (await call('GET', '/api/accounts?agents=1')).json.autobalance;
  assert.equal(ab.eligible, 2, 'CONTROL: the sandbox lists two Claude subscription accounts');
  assert.equal(ab.unreadable, undefined, 'the decision failed through the real route');
  assert.deepEqual(ab.atRisk.map((x) => x.from), [path.join(home, '.claude')], 'the account at 95% was not named as running out');
  assert.match(ab.atRisk[0].why, /95% of its weekly limit/);
  assert.equal(JSON.stringify(ab).includes('@'), false, 'an email went into the decision');
  weekly(path.join(home, '.claude'), 50);
  assert.deepEqual((await call('GET', '/api/accounts?agents=1')).json.autobalance.atRisk, [], 'CONTROL: at 50% nothing is running out');
});
