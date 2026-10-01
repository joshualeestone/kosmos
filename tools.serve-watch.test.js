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
const TMUX = Buffer.from('a tmux bundle\n');

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
  put('kosmos-win-x64.zip.sha256', 'text/plain; charset=utf-8', sha(ZIP) + '  kosmos-win-x64.zip\n');
  put('kosmos-1.0.0-win-x64.zip', 'application/zip', ZIP);
  put('kosmos-1.0.0-win-x64.zip.sha256', 'text/plain; charset=utf-8', sha(ZIP) + '  kosmos-1.0.0-win-x64.zip\n');
  put('tmux-arm64.tar.gz', 'application/gzip', TMUX);
  put('tmux-arm64.tar.gz.sha256', 'application/octet-stream', sha(TMUX) + '  tmux-arm64.tar.gz\n');
  put('kosmos-arm64.tar.gz', 'application/gzip', TAR);
  put('kosmos-arm64.tar.gz.sha256', 'application/octet-stream', sha(TAR) + '  kosmos-arm64.tar.gz\n');
  return { files, setup: true, health: { ok: true }, feedStatus: 200, relayUp: true, relayStatus: 502, catchAll: false, distDown: 0, failOnce: new Set(), failGet: new Map(), hits: [] };
}

function serve(site) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    site.hits.push(req.method + ' ' + u.pathname);
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(req.method === 'HEAD' ? undefined : body); };
    if (site.failOnce.has(u.pathname)) { site.failOnce.delete(u.pathname); return send(502, 'text/plain', 'bad gateway'); }
    if (u.pathname.startsWith('/dist/')) {
      if (site.distDown) return send(site.distDown, 'text/plain', 'down');
      const f = site.files.get(u.pathname.slice('/dist/'.length));
      if (f && req.method === 'GET' && site.failGet.get(u.pathname) > 0) { site.failGet.set(u.pathname, site.failGet.get(u.pathname) - 1); return send(500, 'text/plain', 'read failed'); }
      // As a real host does: the length and an etag of the bytes, so a file replaced behind the same name looks changed.
      if (f) { res.writeHead(200, { 'content-type': f[0], 'content-length': f[1].length, etag: '"' + sha(f[1]).slice(0, 16) + '"' }); return res.end(req.method === 'HEAD' ? undefined : f[1]); }
      if (site.catchAll) return send(200, 'text/html', '<html>the home page</html>');
      return send(404, 'text/plain', 'not found');
    }
    if (u.pathname === '/site/setup') return site.setup ? send(200, 'text/plain; charset=utf-8', '#!/bin/sh\n') : send(404, 'text/html', 'not found');
    if (u.pathname === '/community/api/health') return send(site.health ? 200 : 503, 'application/json', JSON.stringify(site.health || { ok: false }));
    if (u.pathname === '/community/api/posts/feed') return send(site.feedStatus, 'application/json', JSON.stringify({ items: [] }));
    // The relay's own answer for a computer that is not connected (crates/relay/src/redirect.rs).
    if (u.pathname === '/relay/') return site.relayUp ? send(503, 'text/html; charset=utf-8', '<!doctype html><title>Mac not connected - Kosmos</title>') : send(site.relayStatus, 'text/html', 'a proxy error page');
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
      SERVE_WATCH_SITE: base + '/site', SERVE_WATCH_DIST: base + '/dist', SERVE_WATCH_COMMUNITY: base + '/community', SERVE_WATCH_RELAY: base + '/relay/',
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
  for (const name of ['kosmos-1.0.0-arm64.tar.gz', 'kosmos-1.0.0-arm64.manifest.json', 'kosmos-win-x64.zip', 'kosmos-1.0.0-win-x64.zip']) {
    assert.ok(site.hits.includes('HEAD /dist/' + name), name + ' was not checked');
  }
  for (const name of ['kosmos-1.0.0-arm64.tar.gz.sha256', 'kosmos-win-x64.zip.sha256', 'kosmos-1.0.0-win-x64.zip.sha256']) {
    assert.ok(site.hits.includes('GET /dist/' + name), name + ' (what the installers check) was not read');
  }
  assert.ok(site.hits.includes('HEAD /dist/' + sw.CONTROL), 'the negative control was not asked');
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.equal(Object.keys(state.sha).length, 5, 'the tarball, both zips, tmux and the fallback tarball are hashed: ' + JSON.stringify(state.sha));
  assert.ok(site.hits.includes('HEAD /site/setup'), 'the installer script was not checked');
}));

test('a pointer naming a missing artifact alarms within one run, on the pane and the card, and names the file', () => withSite(async ({ site, base, dir, st }) => {
  assert.equal((await run(base, dir, st, { now: T0 })).code, 0, 'CONTROL: healthy first');
  site.files.delete('kosmos-1.0.0-arm64.tar.gz');   // the 0.7.14 outage: the pointer names a file the site dropped
  const r = await run(base, dir, st, { now: T0 + 900 });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(st.pane(), /kosmos-1\.0\.0-arm64\.tar\.gz \(named by latest\.json and latest-staging\.json\) is not served \(404\)/);
  assert.match(st.card(), /kosmos-1\.0\.0-arm64\.tar\.gz \(named by latest\.json and latest-staging\.json\) is not served \(404\)/);
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
  const r0 = await run(base, dir, st, { now: T0 });
  assert.equal(r0.code, 1, r0.out + r0.err);
  assert.doesNotMatch(st.card(), /does not match/, 'a mismatch alarmed on its first sight (a promote writes the parts one by one)');
  const r = await run(base, dir, st, { now: T0 + 900 });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(st.card(), /kosmos-1\.0\.0-win-x64\.zip \(named by latest-win\.json and latest-win-staging\.json\) does not match: served sha256 [0-9a-f]{12}, pointer says [0-9a-f]{12}/);
  assert.match(st.card(), /kosmos-1\.0\.0-arm64\.manifest\.json \(named by latest\.json and latest-staging\.json\) is served as "text\/html", not a manifest/);
}));

test('the bytes are hashed once, again only when the pointer changes, after a failed read, or a day later', () => withSite(async ({ site, base, dir, st }) => {
  assert.equal((await run(base, dir, st, { now: T0 })).code, 0);
  const gets = () => site.hits.filter((h) => h === 'GET /dist/kosmos-1.0.0-arm64.tar.gz').length;
  assert.equal(gets(), 1, 'the tarball was not hashed once');
  await run(base, dir, st, { now: T0 + 900 });
  await run(base, dir, st, { now: T0 + 3 * 3600 });
  assert.equal(gets(), 1, 'an unchanged tarball was hashed again within the day');
  await run(base, dir, st, { now: T0 + 24 * 3600 });
  assert.equal(gets(), 2, 'the tarball was not hashed again after a day');
  // A new build behind the same name: the pointer's sha changes, so it is hashed at once.
  const NEW = Buffer.from('a new build\n');
  site.files.set('kosmos-1.0.0-arm64.tar.gz', ['application/gzip', NEW]);
  site.files.set('kosmos-1.0.0-arm64.tar.gz.sha256', ['application/octet-stream', sha(NEW) + '\n']);
  for (const p of ['latest.json', 'latest-staging.json']) {
    const j = JSON.parse(site.files.get(p)[1]); j.sha256 = sha(NEW); site.files.set(p, ['application/json', JSON.stringify(j)]);
  }
  assert.equal((await run(base, dir, st, { now: T0 + 24 * 3600 + 900 })).code, 0);
  assert.equal(gets(), 3, 'a changed pointer sha was not re-checked at once');
}));

test('a failed whole-file read is retried on the next run, not held for a day', () => withSite(async ({ site, base, dir, st }) => {
  site.failGet.set('/dist/kosmos-1.0.0-arm64.tar.gz', 2);   // both tries of the hash read fail this run
  assert.equal((await run(base, dir, st, { now: T0 })).code, 1);
  assert.match(st.card(), /kosmos-1\.0\.0-arm64\.tar\.gz \(named by latest\.json and latest-staging\.json\) could not be read whole/);
  const gets = () => site.hits.filter((h) => h === 'GET /dist/kosmos-1.0.0-arm64.tar.gz').length;
  const first = gets();
  assert.equal((await run(base, dir, st, { now: T0 + 900 })).code, 0, 'the next run did not read it again and clear');
  assert.ok(gets() > first, 'a read that failed was not tried again on the next run');
}));

test('the community site and the relay canary are watched too', () => withSite(async ({ site, base, dir, st }) => {
  site.health = null;
  site.feedStatus = 500;
  site.relayUp = false;
  const r = await run(base, dir, st, { now: T0 });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(st.card(), /the community site's \/api\/health did not answer ok \(503\)/);
  assert.match(st.card(), /the community feed did not answer \(500\)/);
  assert.match(st.card(), /the relay did not answer with its own page at .*\/relay\/ \(502\): no computer address can be reached/);
  assert.doesNotMatch(st.card(), /People installing or updating/, 'a community or relay problem was called a download failure');
}));

test('a pointer naming a path outside /dist, or missing a field, is refused, not fetched', () => withSite(async ({ site, base, dir, st }) => {
  // A valid version and arch, so the NAME guard is what refuses them (not an earlier field check).
  site.files.set('latest-win-staging.json', ['application/json', JSON.stringify({ version: '1.0.0', arch: 'x64', sha256: sha(ZIP), artifact: '../secret.zip', versioned: 'kosmos-1.0.0-win-x64.zip' })]);
  site.files.set('latest-staging.json', ['application/json', JSON.stringify({ version: '1.0.0', sha256: sha(TAR), artifact: 'kosmos-1.0.0-arm64.tar.gz' })]);
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
  assert.ok(v.problems.some((p) => p.key === 'missing:kosmos-win-x64.zip' && p.text.startsWith('kosmos-win-x64.zip')), r.out);
  assert.equal(st.pane() + st.card(), '', '--check posted');
  const pl = sw.plist({ node: '/opt/homebrew/bin/node', script: '/x/tools/serve-watch.js', home: '/Users/person' });
  assert.match(pl, /<key>Label<\/key><string>com\.kosmos\.serve-watch<\/string>/);
  assert.match(pl, /<key>StartInterval<\/key><integer>900<\/integer>/);
  assert.match(pl, /\/Users\/person\/Library\/Logs\/kosmos\/serve-watch\.log/);
}));

test('the pointers watched are the four the app reads', () => {
  assert.deepEqual(sw.POINTERS.map((p) => p.file), ['latest.json', 'latest-staging.json', 'latest-win.json', 'latest-win-staging.json']);
  assert.equal(sw.artifactsOf({ version: '1.2.3', artifact: 'kosmos-1.2.3-arm64.tar.gz', manifest: 'm.json' }, 'mac').length, 2);
  assert.equal(sw.artifactsOf({ version: '1.2.3', arch: 'x64', artifact: 'a.zip', versioned: 'kosmos-1.2.3-win-x64.zip' }, 'win').length, 2);
  assert.equal(sw.artifactsOf({ version: '1.2.3', arch: 'x64', versioned: 'kosmos-1.2.3-win-x64.zip' }, 'win').length, 1, 'the fixed-name zip is optional (setup.ps1 never fetches it)');
  assert.equal(sw.artifactsOf({ version: '1.2.3', arch: 'x64', artifact: 'a/b.zip', versioned: 'kosmos-1.2.3-win-x64.zip' }, 'win'), null);
  // The names the installers derive from version (and arch): a pointer that disagrees is refused.
  assert.equal(sw.artifactsOf({ version: '1.2.4', artifact: 'kosmos-1.2.3-arm64.tar.gz', manifest: 'm.json' }, 'mac'), null);
  assert.equal(sw.artifactsOf({ version: '1.2.3', arch: 'arm64', versioned: 'kosmos-1.2.3-win-x64.zip' }, 'win'), null);
  // Only the released Windows pointer is held to the fixed-name zip's bytes and sidecar.
  const staging = sw.artifactsOf({ version: '2.0.0', arch: 'x64', artifact: 'a.zip', versioned: 'kosmos-2.0.0-win-x64.zip' }, sw.POINTERS[3]);
  assert.deepEqual(staging.map((a) => [a.name, a.hashed, a.sidecar]), [['kosmos-2.0.0-win-x64.zip', true, true], ['a.zip', false, false]]);
});

test('Windows staging ahead of release is healthy: the fixed-name zip still holds the released bytes', () => withSite(async ({ site, base, dir, st }) => {
  const NEXT = Buffer.from('the next windows build\n');
  site.files.set('kosmos-2.0.0-win-x64.zip', ['application/zip', NEXT]);
  site.files.set('kosmos-2.0.0-win-x64.zip.sha256', ['text/plain', sha(NEXT) + '  kosmos-2.0.0-win-x64.zip\n']);
  site.files.set('latest-win-staging.json', ['application/json', JSON.stringify({ version: '2.0.0', sha256: sha(NEXT), artifact: 'kosmos-win-x64.zip', versioned: 'kosmos-2.0.0-win-x64.zip', arch: 'x64' })]);
  const r = await run(base, dir, st, { now: T0 });
  assert.equal(r.code, 0, 'a normal staging window alarmed: ' + r.out + r.err + st.card());
  // CONTROL: staging's own versioned zip IS held to its pointer.
  site.files.set('kosmos-2.0.0-win-x64.zip', ['application/zip', Buffer.from('wrong')]);
  await run(base, dir, st, { now: T0 + 3600 });
  assert.equal((await run(base, dir, st, { now: T0 + 4500 })).code, 1);
  assert.match(st.card(), /kosmos-2\.0\.0-win-x64\.zip \(named by latest-win-staging\.json\) does not match/);
}));

test('the download site down while the rest answers is an alarm at once, not "could not tell"', () => withSite(async ({ site, base, dir, st }) => {
  site.distDown = 503;
  const r = await run(base, dir, st, { now: T0 });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(st.card(), /installkosmos\.com is not answering \(503\): no download or update can start/);
}));

test('one dropped request is tried again, so a blip is not an alarm', () => withSite(async ({ site, base, dir, st }) => {
  site.failOnce.add('/dist/latest.json');
  site.failOnce.add('/community/api/health');
  const r = await run(base, dir, st, { now: T0 });
  assert.equal(r.code, 0, 'a single 502 alarmed: ' + r.out + r.err + st.card());
  assert.equal(st.card(), '');
}));

test('a sidecar that disagrees with its pointer alarms (the installers would refuse the download)', () => withSite(async ({ site, base, dir, st }) => {
  site.files.set('kosmos-1.0.0-win-x64.zip.sha256', ['text/plain', '0'.repeat(64) + '  kosmos-1.0.0-win-x64.zip\n']);
  site.files.delete('kosmos-1.0.0-arm64.tar.gz.sha256');
  await run(base, dir, st, { now: T0 });
  const r = await run(base, dir, st, { now: T0 + 900 });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(st.card(), /kosmos-1\.0\.0-win-x64\.zip\.sha256 says 000000000000, the pointer says [0-9a-f]{12}: installers refuse the download/);
  assert.match(st.card(), /kosmos-1\.0\.0-arm64\.tar\.gz\.sha256 \(named by latest\.json and latest-staging\.json\) is not served \(404\)/);
}));

test('a card post that fails is retried after an hour, not every run; a busy pane (claude-msg exit 8) counts as told', () => withSite(async ({ site, base, dir, st }) => {
  const failGh = path.join(dir, 'gh-fail.sh');
  fs.writeFileSync(failGh, '#!/bin/sh\necho "HTTP 401" >&2\nexit 1\n'); fs.chmodSync(failGh, 0o755);
  const busyMsg = path.join(dir, 'msg-busy.sh');
  fs.writeFileSync(busyMsg, '#!/bin/sh\ncat > /dev/null\nexit 8\n'); fs.chmodSync(busyMsg, 0o755);
  site.files.delete('kosmos-win-x64.zip');
  const broken = { msg: busyMsg, gh: failGh, pane: st.pane, card: st.card };
  assert.equal((await run(base, dir, broken, { now: T0 })).code, 1);
  const state1 = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.ok(state1.card.failedAt === T0 && state1.card.failedKey, 'the failed card post was not recorded: ' + JSON.stringify(state1.card));
  assert.ok(state1.pane.key && state1.pane.at === T0, 'an exit-8 pane was not counted as told: ' + JSON.stringify(state1.pane));
  // Within the hour: the card is not retried (the stub would fail again; nothing new recorded).
  await run(base, dir, broken, { now: T0 + 900 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).card.failedAt, T0, 'the card was retried within the hour');
  // An hour on, with a working card and the pane still busy: it goes, and says the pane may not have.
  assert.equal((await run(base, dir, { msg: busyMsg, gh: st.gh, pane: st.pane, card: st.card }, { now: T0 + 3600 })).code, 1);
  assert.match(st.card(), /kosmos-win-x64\.zip/);
}));

test('after "could not tell", the all-clear says it is able to check again', () => withSite(async ({ site, base, dir, st }) => {
  site.catchAll = true;
  await run(base, dir, st, { now: T0 });
  await run(base, dir, st, { now: T0 + 3600 });
  assert.match(st.card(), /could not tell/);
  site.catchAll = false;
  assert.equal((await run(base, dir, st, { now: T0 + 4500 })).code, 0);
  assert.match(st.card(), /able to check again: every live download/);
}));

test('what every install fetches is watched too: /setup, the tmux bundle and the fallback tarball against its sidecar', () => withSite(async ({ site, base, dir, st }) => {
  site.setup = false;
  site.files.delete('tmux-arm64.tar.gz');
  site.files.set('kosmos-arm64.tar.gz', ['application/gzip', Buffer.from('stale fallback bytes')]);
  await run(base, dir, st, { now: T0 });
  const r = await run(base, dir, st, { now: T0 + 900 });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(st.card(), /the installer script \(\/setup\) is not served \(404\): every install fetches it/);
  assert.match(st.card(), /tmux-arm64\.tar\.gz is not served \(404\): every install fetches it/);
  assert.match(st.card(), /kosmos-arm64\.tar\.gz does not match its own \.sha256/);
}));

test('a pointer whose names disagree with its version is refused (the installers derive the names)', () => withSite(async ({ site, base, dir, st }) => {
  const j = JSON.parse(site.files.get('latest.json')[1]); j.version = '1.0.1'; site.files.set('latest.json', ['application/json', JSON.stringify(j)]);
  assert.equal((await run(base, dir, st, { now: T0 })).code, 1);
  assert.match(st.card(), /latest\.json does not name its artifacts the way the app reads them/);
}));

test('a catch-all download site still reports a relay outage, not only "could not tell"', () => withSite(async ({ site, base, dir, st }) => {
  site.catchAll = true;
  site.relayUp = false;
  const r = await run(base, dir, st, { now: T0 });
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(st.card(), /the relay did not answer with its own page/);
  assert.doesNotMatch(st.card(), /People installing or updating/, 'an unchecked download was called a failure');
  assert.match(st.card(), /the downloads could not be checked: installkosmos\.com answered 200 for a file that does not exist/);
}));

test('the relay check is the relay\'s own page: any other answer (a proxy, a parked domain) is an alarm', () => withSite(async ({ site, base, dir, st }) => {
  site.relayUp = false;
  site.relayStatus = 200;   // something answered, but not the relay
  assert.equal((await run(base, dir, st, { now: T0 })).code, 1);
  assert.match(st.card(), /the relay did not answer with its own page .* \(200\)/);
  site.relayUp = true;
  assert.equal((await run(base, dir, st, { now: T0 + 900 })).code, 0, 'CONTROL: the relay\'s own page is healthy');
}));

test('nothing answering at all is "could not tell" (this computer is offline), not an alarm', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-watch-off-'));
  const st = stubs(dir);
  const dead = 'http://127.0.0.1:9';   // the discard port: nothing listens
  const r = await run(dead, dir, st, { now: T0 });
  assert.equal(r.code, 2, r.out + r.err);
  assert.equal(st.card() + st.pane(), '', 'an offline computer posted before the grace');
});

test('a mismatch that lasts stays an alarm: no "back to healthy" between sightings', () => withSite(async ({ site, base, dir, st }) => {
  site.files.set('kosmos-1.0.0-win-x64.zip.sha256', ['text/plain', '0'.repeat(64) + '  kosmos-1.0.0-win-x64.zip\n']);
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await run(base, dir, st, { now: T0 + i * 900 })).code);
  assert.deepEqual(codes, [0, 1, 1, 1], 'a standing mismatch flapped');
  assert.doesNotMatch(st.card(), /back to healthy/, 'a standing mismatch posted an all-clear');
}));
