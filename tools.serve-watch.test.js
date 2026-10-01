'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#4877: tools/serve-watch.js. One local HTTP server stands in for all three sites (the download site's
 * /dist, the community site, the relay canary) through the SERVE_WATCH_* seams, and the pane and card posts go to
 * stub commands that write to files, so no test reaches a real site, pane or card.
 *
 *   node --test tools.serve-watch.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const sw = require('./tools/serve-watch');

const SCRIPT = path.join(__dirname, 'tools', 'serve-watch.js');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const TAR = Buffer.from('a mac tarball\n');
const ZIP = Buffer.from('a windows zip\n');

/* A healthy site: four pointers and every artifact they name. `files` maps a /dist name to [type, body]; a test
   deletes or replaces entries to break it. Anything not listed answers 404 (so the negative control holds). */
function healthySite() {
  const files = new Map();
  const put = (name, type, body) => files.set(name, [type, Buffer.isBuffer(body) ? body : Buffer.from(body)]);
  put('latest.json', 'application/json', JSON.stringify({ version: '1.0.0', sha256: sha(TAR), artifact: 'kosmos-1.0.0-arm64.tar.gz', manifest: 'kosmos-1.0.0-arm64.manifest.json' }));
  put('latest-staging.json', 'application/json', JSON.stringify({ version: '1.0.0', sha256: sha(TAR), artifact: 'kosmos-1.0.0-arm64.tar.gz', manifest: 'kosmos-1.0.0-arm64.manifest.json' }));
  put('latest-win.json', 'application/json', JSON.stringify({ version: '1.0.0', sha256: sha(ZIP), artifact: 'kosmos-win-x64.zip', versioned: 'kosmos-1.0.0-win-x64.zip', arch: 'x64' }));
  put('latest-win-staging.json', 'application/json', JSON.stringify({ version: '1.0.0', sha256: sha(ZIP), artifact: 'kosmos-win-x64.zip', versioned: 'kosmos-1.0.0-win-x64.zip', arch: 'x64' }));
  put('kosmos-1.0.0-arm64.tar.gz', 'application/gzip', TAR);
  put('kosmos-1.0.0-arm64.manifest.json', 'application/json; charset=utf-8', '{}');
  put('kosmos-1.0.0-arm64.tar.gz.sha256', 'application/octet-stream', sha(TAR) + '\n');
  put('kosmos-win-x64.zip', 'application/zip', ZIP);
  put('kosmos-1.0.0-win-x64.zip', 'application/zip', ZIP);
  return { files, health: { ok: true }, feedStatus: 200, relayStatus: 200, catchAll: false, hits: [] };
}

function serve(site) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    site.hits.push(req.method + ' ' + u.pathname);
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(req.method === 'HEAD' ? undefined : body); };
    if (u.pathname.startsWith('/dist/')) {
      const f = site.files.get(u.pathname.slice('/dist/'.length));
      if (f) return send(200, f[0], f[1]);
      if (site.catchAll) return send(200, 'text/html', '<html>the home page</html>');
      return send(404, 'text/plain', 'not found');
    }
    if (u.pathname === '/community/api/health') return send(site.health ? 200 : 503, 'application/json', JSON.stringify(site.health || { ok: false }));
    if (u.pathname === '/community/api/posts/feed') return send(site.feedStatus, 'application/json', JSON.stringify({ items: [] }));
    if (u.pathname === '/relay/') return send(site.relayStatus, 'text/html', '<title>Kosmos+</title>');
    return send(404, 'text/plain', 'not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* Stub pane and card commands that record what they were given. */
function stubs(dir) {
  const msgLog = path.join(dir, 'pane.log');
  const ghLog = path.join(dir, 'card.log');
  const msg = path.join(dir, 'msg.sh');
  const gh = path.join(dir, 'gh.sh');
  fs.writeFileSync(msg, '#!/bin/sh\ncat >> "' + msgLog + '"\nprintf "\\n---\\n" >> "' + msgLog + '"\n');
  fs.writeFileSync(gh, '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done >> "' + ghLog + '"\nprintf -- "---\\n" >> "' + ghLog + '"\n');
  fs.chmodSync(msg, 0o755); fs.chmodSync(gh, 0o755);
  return { msg, gh, pane: () => (fs.existsSync(msgLog) ? fs.readFileSync(msgLog, 'utf8') : ''), card: () => (fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf8') : '') };
}

/* Run the real script once, as launchd would, against the local site. */
function run(base, dir, st, { now, args = [] } = {}) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, {
      SERVE_WATCH_DIST: base + '/dist', SERVE_WATCH_COMMUNITY: base + '/community', SERVE_WATCH_RELAY: base + '/relay/',
      SERVE_WATCH_STATE: path.join(dir, 'state.json'), SERVE_WATCH_MSG_CMD: st.msg, SERVE_WATCH_GH_CMD: st.gh,
      SERVE_WATCH_TO: 'test-pane', SERVE_WATCH_ISSUE: '999999', SERVE_WATCH_NOW: String(now), SERVE_WATCH_TIMEOUT_MS: '5000',
    });
    const child = spawn(process.execPath, [SCRIPT, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

async function withSite(fn) {
  const site = healthySite();
  const server = await serve(site);
  const base = 'http://127.0.0.1:' + server.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-watch-'));
  try { await fn({ site, base, dir, st: stubs(dir) }); } finally { server.close(); }
}

const T0 = 1790000000;

test('a healthy site is silent, every artifact is checked and hashed, and the state records the hashes', () => withSite(async ({ site, base, dir, st }) => {
  const r = await run(base, dir, st, { now: T0 });
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(st.pane() + st.card(), '', 'a healthy run posted');
  for (const name of ['latest.json', 'latest-staging.json', 'latest-win.json', 'latest-win-staging.json']) assert.ok(site.hits.includes('GET /dist/' + name), name + ' was not read');
  for (const name of ['kosmos-1.0.0-arm64.tar.gz', 'kosmos-1.0.0-arm64.manifest.json', 'kosmos-1.0.0-arm64.tar.gz.sha256', 'kosmos-win-x64.zip', 'kosmos-1.0.0-win-x64.zip']) {
    assert.ok(site.hits.includes('HEAD /dist/' + name), name + ' was not checked');
  }
  assert.ok(site.hits.includes('HEAD /dist/' + sw.CONTROL), 'the negative control was not asked');
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.equal(Object.keys(state.sha).length, 3, 'the tarball and both zips are hashed: ' + JSON.stringify(state.sha));
}));

test('a pointer naming a missing artifact alarms within one run, on the pane and the card, and names the file', () => withSite(async ({ site, base, dir, st }) => {
  assert.equal((await run(base, dir, st, { now: T0 })).code, 0, 'CONTROL: healthy first');
  site.files.delete('kosmos-1.0.0-arm64.tar.gz');   // the 0.7.14 outage: the pointer names a file the site dropped
  const r = await run(base, dir, st, { now: T0 + 900 });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(st.pane(), /kosmos-1\.0\.0-arm64\.tar\.gz \(named by latest\.json\) is not served \(404\)/);
  assert.match(st.card(), /kosmos-1\.0\.0-arm64\.tar\.gz \(named by latest\.json\) is not served \(404\)/);
  assert.match(st.card(), /^999999$/m, 'the card comment went to another issue');
  // The next run, same problem: silent (it reposts only after 6 h).
  const before = st.card();
  assert.equal((await run(base, dir, st, { now: T0 + 1800 })).code, 1);
  assert.equal(st.card(), before, 'the same alarm was reposted within the hour');
  // Put back: one all-clear, then silence.
  site.files.set('kosmos-1.0.0-arm64.tar.gz', ['application/gzip', TAR]);
  assert.equal((await run(base, dir, st, { now: T0 + 2700 })).code, 0);
  assert.match(st.card(), /back to healthy/);
  const after = st.card();
  assert.equal((await run(base, dir, st, { now: T0 + 3600 })).code, 0);
  assert.equal(st.card(), after, 'the all-clear was repeated');
}));

test('a site that answers 200 for everything is "could not tell", never healthy, and is said only after an hour', () => withSite(async ({ site, base, dir, st }) => {
  site.catchAll = true;
  site.files.delete('kosmos-win-x64.zip');   // would pass as 200 through the catch-all
  const r = await run(base, dir, st, { now: T0 });
  assert.equal(r.code, 2, r.out + r.err);
  assert.equal(st.card(), '', 'could-not-tell was said before its grace');
  assert.equal((await run(base, dir, st, { now: T0 + 3600 })).code, 2);
  assert.match(st.card(), /could not tell \(installkosmos\.com answered 200 for a file that does not exist/);
}));

test('a served file whose bytes do not match the pointer alarms; a wrong content type alarms', () => withSite(async ({ site, base, dir, st }) => {
  site.files.set('kosmos-1.0.0-win-x64.zip', ['application/zip', Buffer.from('different bytes')]);
  site.files.set('kosmos-1.0.0-arm64.manifest.json', ['text/html', '<html>a 404 page served as 200</html>']);
  const r = await run(base, dir, st, { now: T0 });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(st.card(), /kosmos-1\.0\.0-win-x64\.zip does not match latest-win\.json: served sha256 [0-9a-f]{12}, pointer says [0-9a-f]{12}/);
  assert.match(st.card(), /kosmos-1\.0\.0-arm64\.manifest\.json \(named by latest\.json\) is served as "text\/html", not a manifest/);
}));

test('the sha is re-read at most hourly, and at once when the pointer changes', () => withSite(async ({ site, base, dir, st }) => {
  assert.equal((await run(base, dir, st, { now: T0 })).code, 0);
  const gets = () => site.hits.filter((h) => h === 'GET /dist/kosmos-1.0.0-arm64.tar.gz').length;
  const first = gets();
  assert.equal(first, 1, 'the tarball was not hashed once');
  await run(base, dir, st, { now: T0 + 900 });
  assert.equal(gets(), first, 'the tarball was hashed again within the hour');
  await run(base, dir, st, { now: T0 + 3600 });
  assert.equal(gets(), first + 1, 'the tarball was not hashed again after an hour');
  // A new build behind the same name: the pointer's sha changes, so it is hashed at once.
  const NEW = Buffer.from('a new build\n');
  site.files.set('kosmos-1.0.0-arm64.tar.gz', ['application/gzip', NEW]);
  for (const p of ['latest.json', 'latest-staging.json']) {
    const j = JSON.parse(site.files.get(p)[1]); j.sha256 = sha(NEW); site.files.set(p, ['application/json', JSON.stringify(j)]);
  }
  assert.equal((await run(base, dir, st, { now: T0 + 3700 })).code, 0);
  assert.equal(gets(), first + 2, 'a changed pointer sha was not re-checked at once');
}));

test('the community site and the relay canary are watched too', () => withSite(async ({ site, base, dir, st }) => {
  site.health = null;
  site.feedStatus = 500;
  site.relayStatus = 502;
  const r = await run(base, dir, st, { now: T0 });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(st.card(), /the community site's \/api\/health did not answer ok \(503\)/);
  assert.match(st.card(), /the community feed did not answer \(500\)/);
  assert.match(st.card(), /the relay, or the canary computer behind .*\/relay\/, did not answer \(502\)/);
}));

test('a pointer naming a path outside /dist, or missing a field, is refused, not fetched', () => withSite(async ({ site, base, dir, st }) => {
  site.files.set('latest-win-staging.json', ['application/json', JSON.stringify({ version: '1', sha256: sha(ZIP), artifact: '../secret.zip', versioned: 'kosmos-1.0.0-win-x64.zip' })]);
  site.files.set('latest-staging.json', ['application/json', JSON.stringify({ version: '1', sha256: sha(TAR), artifact: 'kosmos-1.0.0-arm64.tar.gz' })]);
  const r = await run(base, dir, st, { now: T0 });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(st.card(), /latest-win-staging\.json does not name its artifacts the way the app reads them/);
  assert.match(st.card(), /latest-staging\.json does not name its artifacts the way the app reads them/);
  assert.ok(!site.hits.some((h) => h.includes('secret')), 'a ../ name was fetched');
}));

test('a healthy week brings one "still watching" line on the card, and no pane message', () => withSite(async ({ base, dir, st }) => {
  // A fresh state records the clear without a post; a week later the card hears from it.
  assert.equal((await run(base, dir, st, { now: T0 })).code, 0);
  assert.equal(st.card(), '');
  assert.equal((await run(base, dir, st, { now: T0 + 7 * 24 * 3600 })).code, 0);
  assert.match(st.card(), /still watching/);
  assert.equal(st.pane(), '', 'the weekly line went to a pane');
}));

test('--check prints the verdict and posts nothing; --plist runs every 15 minutes under its own label', () => withSite(async ({ site, base, dir, st }) => {
  site.files.delete('kosmos-win-x64.zip');
  const r = await run(base, dir, st, { now: T0, args: ['--check'] });
  assert.equal(r.code, 1);
  const v = JSON.parse(r.out);
  assert.equal(v.alarm, true);
  assert.ok(v.problems.some((p) => p.startsWith('kosmos-win-x64.zip')), r.out);
  assert.equal(st.pane() + st.card(), '', '--check posted');
  const pl = sw.plist({ node: '/opt/homebrew/bin/node', script: '/x/tools/serve-watch.js', home: '/Users/person' });
  assert.match(pl, /<key>Label<\/key><string>com\.kosmos\.serve-watch<\/string>/);
  assert.match(pl, /<key>StartInterval<\/key><integer>900<\/integer>/);
  assert.match(pl, /\/Users\/person\/Library\/Logs\/kosmos\/serve-watch\.log/);
}));

test('the pointers watched are the four the app reads', () => {
  assert.deepEqual(sw.POINTERS.map((p) => p.file), ['latest.json', 'latest-staging.json', 'latest-win.json', 'latest-win-staging.json']);
  assert.equal(sw.artifactsOf({ artifact: 'a.tar.gz', manifest: 'a.manifest.json' }, 'mac').length, 3);
  assert.equal(sw.artifactsOf({ artifact: 'a.zip', versioned: 'a-1-win-x64.zip' }, 'win').length, 2);
  assert.equal(sw.artifactsOf({ artifact: 'a/b.zip', versioned: 'x.zip' }, 'win'), null);
});
