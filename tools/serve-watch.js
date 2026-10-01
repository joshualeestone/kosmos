#!/usr/bin/env node
'use strict';

/* kosmos#4877: the serve watch. On 2026-09-30 the 0.7.14 staging tarball answered 404 for about an hour after a site
 * deploy (#4819) and nobody noticed until a failed update took Josh's laptop down (#4818). Agent1s already watched the
 * coordinator, the relay's certificate and drift, but nothing watched what people actually download or reach. This
 * does, every 15 minutes, READ-ONLY:
 *
 *   1. installkosmos.com: each live pointer (latest.json, latest-staging.json, latest-win.json,
 *      latest-win-staging.json) is served, every artifact it names answers 200 with the right content type, and its
 *      .sha256 sidecar (what the installers check) agrees with the pointer, every run; the served bytes hash to the
 *      pointer's sha256, re-read when the pointer or the file's headers change, after a failed read, and daily. The
 *      names must be the ones the installers derive from `version` (and `arch`). Also what every install fetches
 *      whatever the pointers say: /setup, the tmux bundle and the generic fallback tarball (each against its sidecar).
 *   2. community.installkosmos.com: /api/health answers {"ok":true}, and the public feed answers.
 *   3. The relay: a computer name that never exists answers with the relay's own "Mac not connected" page, so the relay
 *      process itself is checked, whatever computer is on (a person's computer as the canary would alarm every time it
 *      slept). Its build is NOT checked: the relay writes it only to its own journal (kosmos-relay: crates/relay/src/serve.rs), with
 *      no public route, and this holds no SSH.
 *
 * A NEGATIVE CONTROL guards the download checks: a file that never exists must answer 404 (and a second one of the
 * Windows zip shape, which the site redirects to the R2 host the Windows files live on, must answer 404 there). A site that answers 200 for
 * everything would pass every artifact check, so then the run is "could not tell", never "healthy". A download site
 * that does not answer at all is an alarm, unless nothing else answered either (this computer is offline). A request
 * that gets no answer or a 5xx is tried once more before it counts. A run can outlast its 15 minutes when several
 * builds are re-hashed at once (measured: about 40 s with every file hashed; the bound, every hash read timing out
 * twice, is near 50 minutes); launchd does not overlap runs, so the next one simply starts late.
 *
 * Where it posts, the same two places as tools/gap-alarm.js (whose alert loop this follows; review history there):
 *   - a pane by claude-msg (SERVE_WATCH_TO, default Splinter, who routes: the site and the relay have different
 *     owners), and
 *   - a comment on kosmos#4877.
 * It posts when an alarm starts or what is wrong changes, again every 6 h while it lasts, once when it clears, and
 * once every 6 h while it cannot tell, said only once that has lasted an hour. When it cannot keep state it checks once
 * a day, and says so in whatever it posts then; a day with nothing wrong posts nothing, so that mode shows only in its
 * log (~/Library/Logs/kosmos/serve-watch.log), as in gap-alarm. While healthy, the card alone gets one
 * "still watching" line a week, so a job that stopped running is visible. Each channel keeps its own clock, and a post
 * that failed is retried after an hour, not every run.
 *
 *   node tools/serve-watch.js           check, decide, post as above
 *   node tools/serve-watch.js --check   print the verdict as JSON and post nothing
 *   node tools/serve-watch.js --plist   print the LaunchAgent plist (every 15 minutes) for this checkout
 *   node tools/serve-watch.js --install write that plist to AGENT_WORKFORCE_LAUNCH (default ~/Library/LaunchAgents)
 *                                       and load it. From the MAIN checkout: a linked worktree is refused.
 *
 * Exit: 0 healthy, 1 alarm, 2 could not tell (including a sha or sidecar mismatch seen once, not yet twice).
 * EXIT 2 IS NOT A PASS.
 *
 * SEAMS (tests): SERVE_WATCH_SITE, SERVE_WATCH_DIST, SERVE_WATCH_COMMUNITY, SERVE_WATCH_RELAY (base URLs), SERVE_WATCH_NOW (epoch
 * seconds), SERVE_WATCH_STATE, SERVE_WATCH_MSG_CMD, SERVE_WATCH_TO, SERVE_WATCH_GH_CMD, SERVE_WATCH_ISSUE,
 * SERVE_WATCH_TIMEOUT_MS. Under the test runner it posts only through seams a test supplies.
 */

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const env = process.env;
const LABEL = 'com.kosmos.serve-watch';
const INTERVAL_S = 900;
const REPOST_S = 6 * 3600;
const RETRY_S = 3600;
const WATCHING_S = 7 * 24 * 3600;
const UNKNOWN_GRACE_S = 3600;
// A problem stays in the standing alarm until it has been gone this long, so one that comes and goes on any cycle
// shorter than this is one alarm, not a post each time it returns.
const HOLD_S = 3600;

const DIST = (env.SERVE_WATCH_DIST || 'https://installkosmos.com/dist').replace(/\/+$/, '');
const SITE = (env.SERVE_WATCH_SITE || 'https://installkosmos.com').replace(/\/+$/, '');
const COMMUNITY = (env.SERVE_WATCH_COMMUNITY || 'https://community.installkosmos.com').replace(/\/+$/, '');
/* A computer name that never exists: the relay's own listener answers it with its "Mac not connected" page
   (kosmos-relay: crates/relay/src/redirect.rs), whatever computer is or is not on, over plain http (no certificate involved). */
const RELAY = env.SERVE_WATCH_RELAY || 'http://serve-watch-canary.kosmosplus.com/';
const RELAY_PAGE = '<title>Mac not connected - Kosmos</title>';
const TIMEOUT_MS = Number(env.SERVE_WATCH_TIMEOUT_MS) || 30000;
const CONTROL = 'serve-watch-control-never-published.json';
/* The Windows files are redirected to a second host (R2): a name of their shape that never exists must 404 THERE too. */
const WIN_CONTROL = 'kosmos-0.0.0-win-x64.zip';

/* The four live pointers. `kind` says which artifacts a pointer names; `alias` says whether this pointer owns the
   fixed-name Windows zip. Both Windows pointers name kosmos-win-x64.zip, but it serves the RELEASED bytes until a
   promote moves it (tools/lib/write-latest-win-pointer.js), so only latest-win.json is held to its bytes and sidecar;
   a staging pointer is held to its own versioned zip. */
const POINTERS = Object.freeze([
  { file: 'latest.json', kind: 'mac' },
  { file: 'latest-staging.json', kind: 'mac' },
  { file: 'latest-win.json', kind: 'win', alias: true },
  { file: 'latest-win-staging.json', kind: 'win', alias: false },
]);
/* What every install fetches whatever the pointers say (install/setup.sh): the curl-to-sh script, the tmux bundle, and
   the generic tarball it falls back to. Each tarball is held to its own .sha256 sidecar, and the fallback also to the
   release latest.json names (tools/deploy-site.sh: it "must track the CURRENT prod version"; a stale one is #1669),
   as the Windows fixed-name zip is held to latest-win.json. Also Kosmos.pkg, the home page's Mac download button
   (tools/deploy-site.sh refuses a deploy without it), against its sidecar. */
const INSTALLS = 'every install fetches it';
const FIXED = Object.freeze([
  { url: () => SITE + '/setup', name: 'the installer script (/setup)', type: 'script', need: INSTALLS },
  { url: () => DIST + '/tmux-arm64.tar.gz', name: 'tmux-arm64.tar.gz', type: 'tarball', bySidecar: true, need: INSTALLS },
  { url: () => DIST + '/kosmos-arm64.tar.gz', name: 'kosmos-arm64.tar.gz', type: 'tarball', bySidecar: true, tracks: 'latest.json', need: INSTALLS },
  { url: () => DIST + '/Kosmos.pkg', name: 'Kosmos.pkg', type: 'pkg', bySidecar: true, need: 'it is the home page\'s Mac download button' },
]);
const TYPES = Object.freeze({   // media types are case-insensitive (RFC 9110)
  script: /^(text\/plain|text\/x-shellscript|application\/x-sh|application\/octet-stream)\b/i,
  tarball: /^application\/(gzip|x-gzip|x-tar|octet-stream)\b/i,
  manifest: /^application\/json\b/i,
  zip: /^application\/(zip|x-zip-compressed|octet-stream)\b/i,
  pkg: /^application\/(octet-stream|x-newton-compatible-pkg|vnd\.apple\.installer\+xml)\b/i,
});
/* A pointer field must be a bare file name: a value with a slash or a dot-dot would make this fetch some other path. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const BODY_CAP = 1024 * 1024;   // a pointer, sidecar, health or feed answer; anything bigger is not one
const HASH_CAP = 512 * 1024 * 1024;   // a download read for its sha256; past this it is not one of ours
const REHASH_S = 24 * 3600;     // a file whose headers have not changed is still hashed once a day

/* The artifacts a pointer names: each with the content type it must have, whether its bytes are hashed against the
   pointer (`hashed`), and whether its .sha256 sidecar is read and compared (`sidecar`). null when the pointer does not
   name them the way the installers read them. */
function artifactsOf(p, pt) {
  if (!p || typeof p !== 'object') return null;
  const kind = typeof pt === 'string' ? pt : pt.kind;
  const owns = typeof pt === 'string' ? true : pt.alias !== false;
  const out = [];
  const ok = (name) => typeof name === 'string' && NAME_RE.test(name) && !name.includes('..');
  const add = (name, type, hashed, sidecar) => { if (ok(name)) out.push({ name, type, hashed, sidecar }); };
  const v = typeof p.version === 'string' && /^\d+\.\d+\.\d+$/.test(p.version) ? p.version : null;
  if (!v) return null;
  if (kind === 'mac') {
    // install/setup.sh builds the tarball's name from `version` (kosmos-<version>-arm64.tar.gz), not from `artifact`.
    if (p.artifact !== 'kosmos-' + v + '-arm64.tar.gz' || !ok(p.manifest)) return null;
    add(p.artifact, 'tarball', true, true);
    add(p.manifest, 'manifest', false, false);
  } else {
    // tools/windows/setup.ps1 requires versioned === kosmos-<version>-win-<arch>.zip; it treats the fixed-name zip as optional.
    const arch = typeof p.arch === 'string' && /^[a-z0-9]+$/.test(p.arch) ? p.arch : null;
    if (!arch || p.versioned !== 'kosmos-' + v + '-win-' + arch + '.zip') return null;
    add(p.versioned, 'zip', true, true);
    // The release pointer must name it (tools/lib/write-latest-win-pointer.js always does): it is the home page's
    // Windows download, and without it nothing here would watch that button.
    if (owns && p.artifact === undefined) return null;
    if (p.artifact !== undefined) { if (!ok(p.artifact)) return null; add(p.artifact, 'zip', owns, owns); }
  }
  return out;
}

async function request(url, { method = 'GET', timeoutMs = TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': 'kosmos-serve-watch' } });
    return { res, error: null, clear: () => clearTimeout(timer) };
  } catch (err) {
    clearTimeout(timer);
    return { res: null, error: (err && err.name === 'AbortError') ? 'no answer in ' + Math.round(timeoutMs / 1000) + ' s' : String((err && err.cause && err.cause.code) || (err && err.message) || err) };
  }
}
/* One retry for a failure that is likely a blip (no answer, or a 5xx), so a single dropped request is not an alarm. */
async function twice(fn) {
  const a = await fn();
  if (a.status === 0 || a.status >= 500) return fn();
  return a;
}

async function readText(res) {
  const reader = res.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > BODY_CAP) { try { await reader.cancel(); } catch { /* gone */ } throw new Error('answer over ' + BODY_CAP + ' bytes'); }
    parts.push(value);
  }
  return Buffer.concat(parts).toString('utf8');
}
async function getText(url) {
  const r = await request(url);
  if (!r.res) return { status: 0, error: r.error };
  try {
    return { status: r.res.status, type: r.res.headers.get('content-type') || '', text: await readText(r.res) };
  } catch (err) {
    return { status: 0, error: String((err && err.message) || err) };
  } finally { r.clear(); }
}
/* A GET whose body is not read (only its status): for a route that may not answer HEAD. */
async function getStatusOnly(url) {
  const r = await request(url);
  if (!r.res) return { status: 0, error: r.error };
  try { await r.res.body.cancel(); } catch { /* gone */ }
  r.clear();
  return { status: r.res.status };
}
async function getJson(url) {
  const g = await twice(() => getText(url));
  let json = null;
  if (g.text != null) { try { json = JSON.parse(g.text); } catch { json = null; } }
  return Object.assign({}, g, { json });
}
async function head(url) {
  return twice(async () => {
    const r = await request(url, { method: 'HEAD' });
    if (!r.res) return { status: 0, error: r.error };
    r.clear();
    const h = r.res.headers;
    // '||' (no etag, last-modified or length) means a replaced file cannot be told from the old one: always re-hashed.
    return { status: r.res.status, type: h.get('content-type') || '', stamp: [h.get('etag'), h.get('last-modified'), h.get('content-length')].join('|') };
  });
}

/* The served bytes' sha256, streamed (a tarball is tens of megabytes). */
async function shaOf(url) {
  const r = await request(url, { timeoutMs: Math.max(TIMEOUT_MS, 300000) });
  if (!r.res) return { error: r.error };
  try {
    if (r.res.status !== 200) { try { await r.res.body.cancel(); } catch { /* gone */ } return { error: 'answered ' + r.res.status }; }
    const h = crypto.createHash('sha256');
    let n = 0;
    for await (const chunk of r.res.body) {
      n += chunk.length;
      if (n > HASH_CAP) { try { await r.res.body.cancel(); } catch { /* gone */ } return { error: 'over ' + Math.round(HASH_CAP / 1048576) + ' MB, so not one of ours' }; }
      h.update(chunk);
    }
    return { sha: h.digest('hex') };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  } finally { r.clear(); }
}

const why = (r) => String(r.status || r.error);
/* A server's own words, before they reach a pane as typed text: short, and no control characters. */
const shown = (t) => String(t || 'no type').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 60);

/* Every check, one verdict. Each problem is { key, text }: the KEY is the file and the class of failure only, so a
   failure whose error text changes (502 then 504, a timeout then a reset) is one standing alarm, not a new one every
   run; the TEXT says the detail. `prev` is the last run's state; `now` is epoch seconds. */
async function gather(prev, now) {
  const problems = [];
  const add = (key, text) => problems.push({ key, text });
  const sha = {};
  const prevSha = (prev && prev.sha && typeof prev.sha === 'object') ? prev.sha : {};
  /* A sha or sidecar that disagrees with its pointer must be seen on two runs in a row: a promote writes the zip, its
     sidecar and the pointer as separate objects, and a run that lands between them sees one half-written moment. */
  const prevPending = Array.isArray(prev && prev.pending) ? prev.pending.filter((k) => typeof k === 'string') : [];
  const pending = [];
  /* Every run that still sees a mismatch keeps its key, so one that lasts stays an alarm (dropping it once said would
     flap: alarm, "healthy", alarm). With no state at all (prev.noState) nothing could be remembered: first sight. */
  const evaluated = new Set();   // the mismatch keys this run got as far as comparing, matching or not
  const mismatch = (key, text) => { pending.push(key); if (prevPending.includes(key) || (prev && prev.noState)) add(key, text); };

  // The community site and the relay first: they also tell whether THIS computer can reach the internet.
  const health = await getJson(COMMUNITY + '/api/health');
  const healthOk = health.status === 200 && health.json && health.json.ok === true;
  if (!healthOk) add('community-health', 'the community site\'s /api/health did not answer ok (' + why(health) + ')');
  // The status is the answer here: a healthy feed can grow past BODY_CAP, which getJson would read as no answer.
  // head() is tried twice itself; the live feed refuses HEAD (405), so its GET is the read that needs the second try.
  const feed = await head(COMMUNITY + '/api/posts/feed').then((h) => (h.status === 405 ? twice(() => getStatusOnly(COMMUNITY + '/api/posts/feed')) : h));
  if (feed.status !== 200) add('community-feed', 'the community feed did not answer (' + why(feed) + ')');
  // Its healthy answer IS a 503, so retried only when it is not the relay's page (twice() would retry every 5xx).
  const relayPage = (r) => r.status === 503 && typeof r.text === 'string' && r.text.includes(RELAY_PAGE);
  let relay = await getText(RELAY);
  if (!relayPage(relay)) relay = await getText(RELAY);
  const relayUp = relayPage(relay);
  if (!relayUp) add('relay', 'the relay did not answer with its own page at ' + RELAY + ' (' + why(relay) + '): no computer address can be reached');

  // The negative control: a file that never exists must answer 404. A 2xx means the site answers anything, so a PASS
  // below proves nothing; a failure (a 404, a wrong type, broken JSON, a sha that disagrees) is still evidence, so the
  // checks run and only their failures count (the end of this function). No answer, or a 5xx: the download site is
  // down, which is the outage this exists for, unless nothing else answered either: this computer is offline.
  const control = await head(DIST + '/' + CONTROL);
  const blind = control.status >= 200 && control.status < 300
    ? 'installkosmos.com answered ' + control.status + ' for a file that does not exist, so its answers prove nothing' : '';
  if (!blind && control.status !== 404) {
    if (control.status === 0 && health.status === 0 && relay.status === 0) {
      return { now, unknown: true, why: 'nothing answered (this computer may be offline: ' + why(control) + ')', problems: [], sha: prevSha, pending: prevPending };
    }
    add('dist-down', 'installkosmos.com is not answering (' + why(control) + '): no download or update can start');
    return { now, unknown: false, alarm: true, problems, artifacts: 0, sha: prevSha, pending: prevPending };
  }

  // Under a catch-all at /dist the Windows control answers 200 for the same reason, which says nothing more.
  const winControl = blind ? { status: 404 } : await head(DIST + '/' + WIN_CONTROL);
  if (winControl.status >= 200 && winControl.status < 300) add('win-unverifiable', 'the Windows downloads\' host answered ' + winControl.status + ' for a file that does not exist, so its answers prove nothing');
  let pointerFailed = false;
  const urls = new Map();   // one check per artifact URL, even when two pointers name it
  const owed = new Set();   // the mismatch keys this run owes a comparison, whether or not it got that far
  const pointerSha = {};   // each pointer read this run: the sha256 it names
  for (const pt of POINTERS) {
    const g = await getJson(DIST + '/' + pt.file);
    if (g.status !== 200) { pointerFailed = true; add('pointer:' + pt.file, pt.file + ' is not served (' + why(g) + ')'); continue; }
    if (!g.json) { pointerFailed = true; add('pointer-json:' + pt.file, pt.file + ' is served but is not valid JSON'); continue; }
    const arts = artifactsOf(g.json, pt);
    if (!arts) { pointerFailed = true; add('pointer-shape:' + pt.file, pt.file + ' does not name its artifacts the way the app reads them'); continue; }
    // Lowercase only, as the installers read it (setup.ps1 refuses any other form; setup.sh compares case-sensitively).
    const want = typeof g.json.sha256 === 'string' && /^[0-9a-f]{64}$/.test(g.json.sha256) ? g.json.sha256 : null;
    if (!want) add('pointer-sha:' + pt.file, pt.file + ' carries no sha256 in the lowercase form the installers read, so its download cannot be checked');
    else pointerSha[pt.file] = want;
    for (const a of arts) {
      const url = DIST + '/' + a.name;
      const e = urls.get(url) || { a: Object.assign({}, a, { hashed: false, sidecar: false }), from: [], expect: new Set() };
      e.from.push(pt.file);
      if (a.hashed && want) { e.a.hashed = true; e.expect.add(want); }
      if (a.sidecar && want) e.a.sidecar = true;
      urls.set(url, e);
    }
  }
  for (const [url, { a, from, expect }] of urls) {
    const by = ' (named by ' + from.join(' and ') + ')';
    const want0 = expect.size === 1 ? [...expect][0] : null;
    if (a.sidecar && want0) owed.add('sidecar-sha:' + a.name);
    if (a.hashed && want0) owed.add('sha:' + a.name);
    const h = await head(url);
    if (h.status !== 200) { add('missing:' + a.name, a.name + by + ' is not served (' + why(h) + ')'); continue; }
    if (!TYPES[a.type].test(h.type)) { add('type:' + a.name, a.name + by + ' is served as "' + shown(h.type) + '", not a ' + a.type); continue; }
    if (expect.size > 1) { add('two-shas:' + a.name, a.name + by + ' is held to two different sha256s'); continue; }
    const want = expect.size ? [...expect][0] : null;
    if (a.sidecar && want) {
      // What the installers compare against (install/setup.sh verify_download, setup.ps1): cheap, so every run.
      const s = await getJson(url + '.sha256');
      const said = s.status === 200 && s.text ? String(s.text).trim().split(/\s+/)[0] : null;
      if (s.status === 200 && said && /^[0-9a-f]{64}$/.test(said)) evaluated.add('sidecar-sha:' + a.name);
      if (s.status === 200 && !(said && /^[0-9a-f]{64}$/.test(said))) add('sidecar-missing:' + a.name, a.name + '.sha256' + by + ' is served but holds no sha256: installers refuse the download');
      else if (s.status !== 200) add('sidecar-missing:' + a.name, a.name + '.sha256' + by + ' is not served (' + why(s) + '): installers refuse the download without it');
      else if (said !== want) mismatch('sidecar-sha:' + a.name, a.name + '.sha256 says ' + shown(said).slice(0, 12) + ', the pointer says ' + want.slice(0, 12) + ': installers refuse the download');
    }
    if (!a.hashed || !want) continue;
    const was = prevSha[url];
    // Hashed again when the pointer's sha or the file's headers change, after a failed read, or once a day; otherwise
    // the last answer stands (a tarball is tens of megabytes, and an unchanged file hashes the same).
    // A mismatch not yet confirmed is read again on the next run, so its second sighting is a second read.
    const due = !was || was.expect !== want || h.stamp === '||' || was.stamp !== h.stamp || !!was.error || !(Number(was.at) <= now) || now - Number(was.at) >= REHASH_S
      || (was.got !== want && !was.confirmed);
    let rec = was;
    if (due) {
      let s = await shaOf(url);
      if (s.error) s = await shaOf(url);   // once more, as every other request here
      rec = { at: now, expect: want, stamp: h.stamp, got: s.sha || null, error: s.error || null };
      if (rec.got && rec.got !== want && prevPending.includes('sha:' + a.name)) rec.confirmed = true;   // its second read
    }
    sha[url] = rec;
    if (!rec.error) evaluated.add('sha:' + a.name);
    if (rec.error) add('unreadable:' + a.name, a.name + by + ' could not be read whole to check its sha256 (' + rec.error + ')');
    else if (rec.got !== want) mismatch('sha:' + a.name, a.name + by + ' does not match: served sha256 ' + String(rec.got).slice(0, 12) + ', pointer says ' + want.slice(0, 12));
  }
  for (const f of FIXED) {
    const url = f.url();
    if (f.bySidecar) owed.add('sha:' + f.name);
    if (f.tracks) owed.add('alias:' + f.name);
    const h = await head(url);
    if (h.status !== 200) { add('missing:' + f.name, f.name + ' is not served (' + why(h) + '): ' + f.need); continue; }
    if (!TYPES[f.type].test(h.type)) { add('type:' + f.name, f.name + ' is served as "' + shown(h.type) + '", not a ' + f.type); continue; }
    if (!f.bySidecar) continue;
    const s = await getJson(url + '.sha256');
    const want = s.status === 200 && s.text ? String(s.text).trim().split(/\s+/)[0] : null;
    if (!want || !/^[0-9a-f]{64}$/.test(want)) { add('sidecar-missing:' + f.name, f.name + '.sha256 is not served or not a sha256 (' + why(s) + '): installers refuse the download'); continue; }
    // Through mismatch(), so the moment mid-promote when the fallback and the pointer are written apart is not an alarm.
    const track = f.tracks && pointerSha[f.tracks];
    if (track) {
      evaluated.add('alias:' + f.name);
      if (want !== track) mismatch('alias:' + f.name, f.name + ' is not the release ' + f.tracks + ' names: its .sha256 says ' + want.slice(0, 12) + ', ' + f.tracks + ' says ' + track.slice(0, 12) + ' (installers that fall back to it get another build)');
    }
    const was = prevSha[url];
    const due = !was || was.expect !== want || h.stamp === '||' || was.stamp !== h.stamp || !!was.error || !(Number(was.at) <= now) || now - Number(was.at) >= REHASH_S
      || (was.got !== want && !was.confirmed);
    let rec = was;
    if (due) {
      let r = await shaOf(url);
      if (r.error) r = await shaOf(url);
      rec = { at: now, expect: want, stamp: h.stamp, got: r.sha || null, error: r.error || null };
      if (rec.got && rec.got !== want && prevPending.includes('sha:' + f.name)) rec.confirmed = true;
    }
    sha[url] = rec;
    if (!rec.error) evaluated.add('sha:' + f.name);
    if (rec.error) add('unreadable:' + f.name, f.name + ' could not be read whole to check its sha256 (' + rec.error + ')');
    else if (rec.got !== want) mismatch('sha:' + f.name, f.name + ' does not match its own .sha256: served ' + String(rec.got).slice(0, 12) + ', sidecar says ' + want.slice(0, 12));
  }
  /* What this run did not get as far as comparing (its HEAD or sidecar failed, its pointer was not served) keeps its
     earlier record: a mismatch still standing is not forgotten by one run that stopped short, and a hash is not
     downloaded again for it. */
  // A pending key is carried only while this run still owes that comparison: a file no pointer names any more (an old
  // version), or one still named but no longer held to a sha (the Windows zip named only by staging), is dropped, so
  // it cannot linger as pending forever and hold the exit at 2. A sha record is kept for any file still named.
  const namedUrls = new Set([...urls.keys(), ...FIXED.map((f) => f.url())]);
  // While a pointer could not be read, which files it names is unknown, so nothing earlier is dropped this run.
  for (const k of prevPending) if (!evaluated.has(k) && !pending.includes(k) && (pointerFailed || owed.has(k))) pending.push(k);
  for (const [url, rec] of Object.entries(prevSha)) if (!(url in sha) && (pointerFailed || namedUrls.has(url))) sha[url] = rec;
  if (blind) {
    // Nothing failed: every pass may be the catch-all answering, so could not tell. Anything failed: an alarm.
    // The hashes and first sightings made this run are kept: a real mismatch then alarms on its second sighting, and
    // the files are not downloaded again every run while the catch-all lasts.
    if (!problems.length) return { now, unknown: true, why: blind + '; the community site and the relay answer', problems: [], sha, pending };
    add('dist-unverifiable', 'the downloads that did pass could not be believed: ' + blind);
  }
  return { now, unknown: false, alarm: problems.length > 0, problems, artifacts: urls.size + FIXED.length, sha, pending };
}

/* Whether to post now, and what kind, from the verdict and this channel's last post. Pure.
   The alarm is every problem seen within HOLD_S (v.held, from the state), not only this run's. It posts when a problem
   appears that the last post did not carry, or when the alarm is due again; a set that only shrinks updates the key
   quietly; the all-clear comes once every problem has been gone HOLD_S. So a problem coming and going on any cycle
   shorter than an hour, alone or beside another, is one post, and one problem replacing another is one post. */
function decidePost(v, last, now) {
  const due = !last || now - (last.at || 0) >= REPOST_S;
  if (v.unknown) return (!last || last.key !== 'unknown' || due) ? { post: 'unknown', key: 'unknown' } : { post: null, key: 'unknown' };
  const all = new Set([...(v.alarm ? v.problems.map((p) => p.key) : []), ...(Array.isArray(v.held) ? v.held : [])]);
  if (!all.size) {
    // A first sighting still to confirm is not healthy (that run exits 2): no all-clear yet, and the key stands.
    if (Array.isArray(v.pending) && v.pending.length) return { post: null, key: (last && last.key) || 'clear' };
    return (last && last.key && last.key !== 'clear') ? { post: 'cleared', key: 'clear' } : { post: null, key: 'clear' };
  }
  const key = 'alarm:' + [...all].sort().join(',');
  const lastKeys = last && typeof last.key === 'string' && last.key.startsWith('alarm:') ? last.key.slice('alarm:'.length).split(',') : [];
  const fresh = [...all].some((k) => !lastKeys.includes(k));
  // Only with a problem in hand this run: a post that lists none would say nothing.
  if (v.alarm && (fresh || due)) return { post: 'alarm', key };
  // Fresh with nothing in hand: the key stays as it was, even none (a failed first post), so the retry still fires.
  return { post: null, key: fresh ? (last ? last.key : key) : key };
}

function message(kind, v) {
  const head = 'serve watch (kosmos#4877): ';
  const all = 'every live download (' + v.artifacts + ' files), the community site and the relay answer.';
  if (kind === 'unknown') return head + 'could not tell (' + v.why + '). This is not a pass: the downloads were not checked.';
  if (kind === 'watching') return head + 'still watching: ' + all;
  if (kind === 'cleared') return head + (v.after === 'unknown' ? 'able to check again: ' : 'back to healthy: ') + all;
  const downloads = v.problems.some((p) => !/^(community-|relay|dist-unverifiable|win-unverifiable)/.test(p.key));
  return head + v.problems.length + ' problem' + (v.problems.length === 1 ? '' : 's') + ':\n- ' + v.problems.map((p) => p.text).join('\n- ')
    + '\nThis monitor only reads; nothing was changed.' + (downloads ? ' People installing or updating now get the download failure above.' : '');
}

function statePath() {
  return env.SERVE_WATCH_STATE || path.join(os.homedir(), '.cache', 'kosmos-serve-watch', 'state.json');
}
function readState() { try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return null; } }
/* Atomic, and never fatal: the posts already went. As tools/gap-alarm.js. */
function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    const tmp = statePath() + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s) + '\n');
    try { fs.renameSync(tmp, statePath()); } catch (err) { try { fs.unlinkSync(tmp); } catch { /* gone already */ } throw err; }
  } catch (err) {
    process.stderr.write('serve-watch: posted, but could not record it (' + ((err && err.message) || err) + '); the next run may repost\n');
  }
}
function stateProblem() {
  try {
    const p = statePath();
    if (fs.existsSync(p) && !fs.statSync(p).isFile()) return p + ' is not a file';
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const probe = p + '.probe.' + process.pid;
    fs.writeFileSync(probe, '');
    try { fs.unlinkSync(probe); } catch { /* removed already */ }
    return null;
  } catch (err) { return String((err && err.message) || err); }
}

/* The channels that are due, best effort, as tools/gap-alarm.js post(): each channel's own result, and a pane that did
   not go (or may not have) is said on the card. Under the test runner only through seams a test supplies. */
function post(text, want = { pane: true, card: true }) {
  const underTest = !!env.NODE_TEST_CONTEXT;
  const went = { pane: false, card: false };
  const tried = { pane: false, card: false };
  const unsure = { pane: false, card: false };
  const to = env.SERVE_WATCH_TO || 'claudebot-discord:0.0';
  let paneFailed = null;
  let paneUnsure = null;
  const msgCmd = env.SERVE_WATCH_MSG_CMD || (underTest ? null : path.join(os.homedir(), '.claude', 'scripts', 'claude-msg'));
  if (want.pane && msgCmd) {
    tried.pane = true;
    try {
      // claude-msg refuses without $TMUX, which a launchd job never has: the default tmux server socket.
      const tmux = env.TMUX || (env.TMUX_TMPDIR || '/tmp') + '/tmux-' + process.getuid() + '/default,0,0';
      execFileSync(msgCmd, [to, '-'], {
        input: '=== HEADS-UP ===\nfrom: serve-watch (launchd)\nto:   whoever routes the site and the relay\n\n' + text + '\n=== END HEADS-UP ===\n',
        stdio: ['pipe', 'ignore', 'pipe'], timeout: 90000,
        env: Object.assign({}, env, { TMUX: tmux }),
      });
      went.pane = true;
    } catch (err) {
      /* Exit 7 is claude-msg's "the message is in the composer, unsubmitted" (#1909): counted as told, since sending
         again would paste it twice; the card says the pane may not have gone. Exit 8 is a possible loss (claude-msg's
         own table: "may not have landed", part of it, or a prompt was open), so it is a failure, retried in an hour. */
      if (err && err.status === 7) {
        went.pane = true;
        unsure.pane = true;
        paneUnsure = 'claude-msg exit 7: the message is in the pane\'s composer, not yet submitted (look at the composer, then one Enter sends it)';
      } else {
        paneFailed = String((err && err.stderr && String(err.stderr).trim()) || (err && err.message) || err).split('\n')[0];
        process.stderr.write('serve-watch: the pane message to ' + to + ' did not go: ' + paneFailed + '\n');
      }
    }
  }
  const ghCmd = env.SERVE_WATCH_GH_CMD || (underTest ? null : 'gh');
  if (want.card && ghCmd) {
    tried.card = true;
    try {
      const body = paneFailed ? text + '\n\n(The pane message to ' + to + ' did not go: ' + paneFailed + ')'
        : paneUnsure ? text + '\n\n(The pane message to ' + to + ' may not have gone: ' + paneUnsure + ')' : text;
      execFileSync(ghCmd, ['issue', 'comment', env.SERVE_WATCH_ISSUE || '4877', '--repo', 'joshualeestone/kosmos', '--body', body], {
        stdio: ['ignore', 'ignore', 'pipe'], timeout: 30000,
      });
      went.card = true;
    } catch (err) {
      const why = String((err && err.stderr && String(err.stderr).trim()) || (err && err.code) || 'exit ' + (err && err.status)).split('\n')[0];
      process.stderr.write('serve-watch: the #4877 comment did not go: ' + why + '\n');
    }
  }
  return { went, tried, unsure };
}

const CHANNELS = ['pane', 'card'];
function lastFor(state, ch, now) {
  if (!state || typeof state !== 'object' || !state[ch] || typeof state[ch] !== 'object') return null;
  // A stored time in the future, zero or junk counts as long ago, so the channel is due now (gap-alarm review 11).
  const sane = (t) => (Number.isFinite(Number(t)) && Number(t) > 0 && Number(t) <= now ? Number(t) : 0);
  const out = Object.assign({}, state[ch]);
  if ('at' in out) out.at = sane(out.at);
  if ('failedAt' in out) out.failedAt = sane(out.failedAt);
  return out;
}

function xml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function stableNode() {
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    try { const st = fs.statSync(p); if (st.isFile() && (st.mode & 0o111)) return p; } catch { /* next */ }
  }
  return process.execPath;
}
/* The LaunchAgent, every 15 minutes, beside coordinator-monitor. */
function plist({ node = stableNode(), script = path.resolve(__filename), home = os.homedir() } = {}) {
  const log = path.join(home, 'Library', 'Logs', 'kosmos', 'serve-watch.log');
  const s = (v) => '<string>' + xml(v) + '</string>';
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">', '<dict>',
    '  <key>Label</key>' + s(LABEL),
    '  <key>ProgramArguments</key><array>' + s(node) + s(script) + '</array>',
    '  <key>EnvironmentVariables</key><dict><key>PATH</key>' + s('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin') + '</dict>',
    '  <key>StartInterval</key><integer>' + INTERVAL_S + '</integer>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>StandardOutPath</key>' + s(log),
    '  <key>StandardErrorPath</key>' + s(log),
    '</dict>', '</plist>', ''].join('\n');
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
}
function install() {
  const dir = env.AGENT_WORKFORCE_LAUNCH || path.join(os.homedir(), 'Library', 'LaunchAgents');
  if (env.NODE_TEST_CONTEXT && !env.AGENT_WORKFORCE_LAUNCH) throw new Error('refusing to install into the real LaunchAgents under test');
  const here = path.join(__dirname, '..');
  const gitDir = git(here, ['rev-parse', '--absolute-git-dir']);
  const common = path.resolve(here, git(here, ['rev-parse', '--git-common-dir']));
  if (gitDir !== common) throw new Error('refusing to install from a linked worktree (' + here + '); run it from the main checkout');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, LABEL + '.plist');
  fs.writeFileSync(file, plist());
  if (env.AGENT_WORKFORCE_LAUNCH) return file;   // a sandbox: written, not loaded
  fs.mkdirSync(path.join(os.homedir(), 'Library', 'Logs', 'kosmos'), { recursive: true });
  const uid = String(process.getuid());
  try { execFileSync('launchctl', ['bootout', 'gui/' + uid + '/' + LABEL], { stdio: 'ignore' }); } catch { /* not loaded yet */ }
  execFileSync('launchctl', ['bootstrap', 'gui/' + uid, file], { stdio: 'inherit' });
  return file;
}

async function main(argv) {
  if (argv.includes('--plist')) { process.stdout.write(plist()); return 0; }
  if (argv.includes('--install')) { process.stdout.write('installed ' + install() + '\n'); return 0; }
  const now = Number(env.SERVE_WATCH_NOW) || Math.floor(Date.now() / 1000);
  if (argv.includes('--check')) {   // read-only: no state written, nothing created
    // One run: a sha or sidecar mismatch seen for the first time is listed under `pending`, not yet an alarm.
    const v = await gather(readState(), now);
    process.stdout.write(JSON.stringify(Object.assign({}, v, { sha: undefined })) + '\n');
    if (v.alarm) return 1;
    return v.unknown || (v.pending && v.pending.length) ? 2 : 0;   // a first sighting is not yet healthy
  }
  const noState = stateProblem();
  /* No state to keep: run (and download) at most once or twice a day, in the first 30 minutes of the UTC day, as
     gap-alarm posts. Checked BEFORE gathering: with no record every file looks due for a re-hash, and running every
     15 minutes would download every build each time. */
  if (noState && now % 86400 >= 2 * INTERVAL_S) {   // twice the interval, so a drifting run never misses a day
    process.stderr.write('serve-watch: cannot keep state (' + noState + '); checking only in the first 30 minutes of the UTC day\n');
    return 2;
  }
  const state = noState ? { noState: true } : readState();
  let v;
  try { v = await gather(state, now); } catch (err) {
    /* A fault in the checks is "could not tell", posted after the grace like any other: an exception that silenced
       the watch would look exactly like a healthy site. As tools/gap-alarm.js turns a measurement error into unknown. */
    process.stderr.write('serve-watch: the checks failed: ' + ((err && err.stack) || err) + '\n');
    const prev = state || {};
    v = { now, unknown: true, why: 'the serve watch itself failed: ' + String((err && err.message) || err).split('\n')[0].slice(0, 200), problems: [], sha: prev.sha || {}, pending: Array.isArray(prev.pending) ? prev.pending : [] };
  }
  // A first sighting (pending) is not yet healthy: exit 2, the same as --check.
  const code = v.unknown ? 2 : v.alarm ? 1 : (v.pending && v.pending.length) ? 2 : 0;
  /* When each problem was last seen (epoch seconds), kept for HOLD_S. A run that could not look adds nothing. */
  const seen = {};
  const was = state && state.seen && typeof state.seen === 'object' && !Array.isArray(state.seen) ? state.seen : {};
  for (const [k, at] of Object.entries(was)) if (Number(at) <= now && now - Number(at) < HOLD_S) seen[k] = Number(at);
  if (!v.unknown) for (const p of v.problems) seen[p.key] = now;
  v.held = Object.keys(seen);
  const since = state ? Number(state.unknownSince) : NaN;
  const unknownSince = v.unknown ? (Number.isFinite(since) && since > 0 && since <= now ? since : now) : null;
  if (!noState && v.unknown && now - unknownSince < UNKNOWN_GRACE_S) {
    // A problem whose hold ran out while this could not look leaves the posted key, so its return is said again.
    const aged = (l) => {
      if (!l || !/^alarm:/.test(l.key || '')) return l;
      const ks = l.key.slice('alarm:'.length).split(',').filter((k) => k in seen);
      return ks.length ? Object.assign({}, l, { key: 'alarm:' + ks.sort().join(',') }) : l;
    };
    writeState({ pane: aged(lastFor(state, 'pane', now)), card: aged(lastFor(state, 'card', now)), lastRunAt: now, unknownSince, sha: v.sha, pending: v.pending, seen });
    return code;
  }
  const next = {};
  const due = {};
  for (const ch of CHANNELS) {
    const last = lastFor(state, ch, now);
    next[ch] = last;
    const d = decidePost(v, last, now);
    due[ch] = d;
    // A quiet change of key (a shrinking alarm) keeps the time of the last post, so the 6-hour repost is not pushed back.
    if (!d.post && (!last || last.key !== d.key)) next[ch] = { key: d.key, at: last && /^alarm:/.test(last.key || '') && /^alarm:/.test(d.key) ? last.at : now };
  }
  const cardLast = next.card;
  if (!due.card.post && due.card.key === 'clear' && !(v.pending && v.pending.length) && cardLast && cardLast.key === 'clear' && now - (cardLast.at || 0) >= WATCHING_S) {
    due.card = { post: 'watching', key: 'clear' };
  }
  const texts = {};
  for (const ch of CHANNELS) {
    if (!due[ch].post) continue;
    const last = lastFor(state, ch, now);
    if (last && last.failedKey === due[ch].key && now - (last.failedAt || 0) < RETRY_S) continue;
    texts[ch] = message(due[ch].post, Object.assign({}, v, { after: last && last.key }))
      + (noState ? ' (The serve watch cannot keep its state at ' + statePath() + ': ' + noState + '. It says this once or twice a day until that is fixed.)' : '');
  }
  for (const text of [...new Set(Object.values(texts))]) {
    const want = { pane: texts.pane === text, card: texts.card === text };
    const { went, tried, unsure } = post(text, want);
    for (const ch of CHANNELS) {
      if (!want[ch]) continue;
      if (went[ch]) next[ch] = { key: due[ch].key, at: now };
      else if (tried[ch]) {
        const keep = next[ch] ? { key: next[ch].key, at: next[ch].at } : {};
        next[ch] = Object.assign(keep, { failedKey: due[ch].key, failedAt: now });
      }
    }
    const sentTo = CHANNELS.filter((ch) => want[ch] && went[ch]).map((ch) => (unsure[ch] ? ch + ' (unconfirmed)' : ch));
    process.stdout.write(new Date(now * 1000).toISOString() + ' ' + (sentTo.length ? 'posted to ' + sentTo.join(' and ') : 'posted NOWHERE') + ': ' + text + '\n');
  }
  // With no usable state there is nothing to write (and the attempt would log a false "posted" line every day).
  if (!noState) writeState({ pane: next.pane, card: next.card, lastRunAt: now, unknownSince, sha: v.sha, pending: v.pending, seen });
  return code;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (err) => {
    process.stderr.write('serve-watch: ' + ((err && err.stack) || err) + '\n');
    process.exitCode = 2;
  });
}

module.exports = { gather, decidePost, message, artifactsOf, plist, main, POINTERS, LABEL, CONTROL };
