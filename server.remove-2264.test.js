'use strict';
/**
 * #2264: the DELETE /api/accounts/<provider> route with `remove:true` DELETES
 * the account instead of disconnecting it. The engine guards are covered by
 * engine/*.remove-2264.test.js; this drives the flag THROUGH the real HTTP
 * route to confirm remove reaches removeAccount and the account is gone from
 * disk (and that WITHOUT the flag the route still only disconnects).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;

// Boot a sandboxed board, seed it, and DELETE /api/accounts/<provider> with a
// body computed from the sandbox home (so the dir matches what seed created).
function call(provider, makeBody, seed) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-remove-2264-'));
  const home = nodePath.join(sb, 'home');
  const bin = nodePath.join(sb, 'bin');
  for (const d of [home, bin]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  seed(home);
  const body = JSON.stringify(makeBody(home));

  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    srv.listen(0, '127.0.0.1', () => {
      const body = process.env.BODY;
      const req = http.request({ host: '127.0.0.1', port: srv.address().port,
        path: '/api/accounts/' + process.env.PROVIDER, method: 'DELETE',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      }, (res) => { let s=''; res.on('data',(d)=>{s+=d;}); res.on('end',()=>{
        process.stdout.write(JSON.stringify({ code: res.statusCode, body: s.slice(0, 900) }));
        srv.close(); process.exit(0); }); });
      req.on('error', (e) => { process.stdout.write(JSON.stringify({ code: null, body: String(e.message) })); process.exit(0); });
      req.end(body);
    });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PROVIDER: provider,
      BODY: body,
      AGENT_WORKFORCE_DRY_RUN: '1',
      AGENT_WORKFORCE_HOME: home,
      AGENT_WORKFORCE_DATA: nodePath.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: nodePath.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: nodePath.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: nodePath.join(sb, 'projects'),
      AGENT_WORKFORCE_TMUX_BIN: nodePath.join(bin, 'tmux'),
    },
  });
  return { res: JSON.parse(out), home };
}

function seedClaude(home, label) {
  const dir = nodePath.join(home, '.claude-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: label + '@example.com' } }));
  return dir;
}

function seedOpenai(home, label) {
  const dir = nodePath.join(home, '.codex-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-' + label + 'testtesttesttest' }));
  return dir;
}

test('#2264: DELETE claude with remove:true deletes the account directory', () => {
  const { res, home } = call('claude',
    (h) => ({ dir: nodePath.join(h, '.claude-gone'), remove: true }),
    (h) => seedClaude(h, 'gone'));
  assert.equal(res.code, 200, 'remove:true should succeed: ' + res.body);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.removed, true, 'the route reports removed:true');
  assert.match(parsed.because, /deleted from this computer/);
  assert.ok(!fs.existsSync(nodePath.join(home, '.claude-gone')), 'the account directory is deleted');
  // A delete must not leave a renamed-aside copy (that would be disconnect).
  assert.deepEqual(fs.readdirSync(home).filter((n) => n.startsWith('.removed-')), [],
    'delete must not leave a .removed-* copy');
});

test('#2264: DELETE claude WITHOUT remove only disconnects (renamed aside, not deleted)', () => {
  const { res, home } = call('claude',
    (h) => ({ dir: nodePath.join(h, '.claude-keep') }),
    (h) => seedClaude(h, 'keep'));
  assert.equal(res.code, 200, res.body);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.forgotten, true, 'without remove it disconnects (forgets), not deletes');
  assert.ok(!fs.existsSync(nodePath.join(home, '.claude-keep')), 'the account is off the list');
  assert.ok(fs.readdirSync(home).some((n) => n.startsWith('.removed-')),
    'disconnect keeps the credential under a renamed folder');
});

test('#2264: DELETE openai with remove:true deletes the account directory (route wiring symmetry)', () => {
  const { res, home } = call('openai',
    (h) => ({ dir: nodePath.join(h, '.codex-gone'), remove: true }),
    (h) => seedOpenai(h, 'gone'));
  assert.equal(res.code, 200, 'openai remove:true should succeed: ' + res.body);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.removed, true, 'the openai route reports removed:true');
  assert.match(parsed.because, /deleted from this computer/);
  assert.ok(!fs.existsSync(nodePath.join(home, '.codex-gone')), 'the openai account directory is deleted');
  assert.deepEqual(fs.readdirSync(home).filter((n) => n.startsWith('.removed-codex-')), [],
    'delete must not leave a .removed-codex-* copy');
});
