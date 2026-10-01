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
 *   3. The relay: the canary computer's address answers (through the system curl; see curlStatus), and an alarm needs
 *      two missed runs in a row (the canary is a person's computer). Its build is NOT checked: the relay writes it only to its own
 *      journal (crates/relay/src/serve.rs), with no public route, and this holds no SSH. If the canary's Mac is off
 *      the alarm says so as "the relay, or that computer": from outside the two look the same.
 *
 * A NEGATIVE CONTROL guards the download checks: a file that never exists must answer 404. A site that answers 200 for
 * everything would pass every artifact check, so then the run is "could not tell", never "healthy". A download site
 * that does not answer at all is an alarm, unless nothing else answered either (this computer is offline). A request
 * that gets no answer or a 5xx is tried once more before it counts. A run can outlast its 15 minutes when several
 * builds are re-hashed at once; launchd does not overlap runs, so the next one simply starts late.
 *
 * Where it posts, the same two places as tools/gap-alarm.js (whose alert loop this follows; review history there):
 *   - a pane by claude-msg (SERVE_WATCH_TO, default Splinter, who routes: the site and the relay have different
 *     owners), and
 *   - a comment on kosmos#4877.
 * It posts when an alarm starts or what is wrong changes, again every 6 h while it lasts, once when it clears, and
 * once every 6 h while it cannot tell, said only once that has lasted an hour. While healthy, the card alone gets one
 * "still watching" line a week, so a job that stopped running is visible. Each channel keeps its own clock, and a post
 * that failed is retried after an hour, not every run.
 *
 *   node tools/serve-watch.js           check, decide, post as above
 *   node tools/serve-watch.js --check   print the verdict as JSON and post nothing
 *   node tools/serve-watch.js --plist   print the LaunchAgent plist (every 15 minutes) for this checkout
 *   node tools/serve-watch.js --install write that plist to AGENT_WORKFORCE_LAUNCH (default ~/Library/LaunchAgents)
 *                                       and load it. From the MAIN checkout: a linked worktree is refused.
 *
 * Exit: 0 healthy, 1 alarm, 2 could not tell. EXIT 2 IS NOT A PASS.
 *
 * SEAMS (tests): SERVE_WATCH_SITE, SERVE_WATCH_DIST, SERVE_WATCH_COMMUNITY, SERVE_WATCH_RELAY (base URLs), SERVE_WATCH_NOW (epoch
 * seconds), SERVE_WATCH_STATE, SERVE_WATCH_MSG_CMD, SERVE_WATCH_TO, SERVE_WATCH_GH_CMD, SERVE_WATCH_ISSUE,
 * SERVE_WATCH_TIMEOUT_MS, SERVE_WATCH_CURL. Under the test runner it posts only through seams a test supplies.
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

const DIST = (env.SERVE_WATCH_DIST || 'https://installkosmos.com/dist').replace(/\/+$/, '');
const SITE = (env.SERVE_WATCH_SITE || 'https://installkosmos.com').replace(/\/+$/, '');
const COMMUNITY = (env.SERVE_WATCH_COMMUNITY || 'https://community.installkosmos.com').replace(/\/+$/, '');
const RELAY = env.SERVE_WATCH_RELAY || 'https://pizzarama.kosmosplus.com/';
const TIMEOUT_MS = Number(env.SERVE_WATCH_TIMEOUT_MS) || 30000;
const CONTROL = 'serve-watch-control-never-published.json';

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
   the generic tarball it falls back to. Each tarball is held to its own .sha256 sidecar. */
const FIXED = Object.freeze([
  { url: () => SITE + '/setup', name: 'the installer script (/setup)', type: 'script' },
  { url: () => DIST + '/tmux-arm64.tar.gz', name: 'tmux-arm64.tar.gz', type: 'tarball', bySidecar: true },
  { url: () => DIST + '/kosmos-arm64.tar.gz', name: 'kosmos-arm64.tar.gz', type: 'tarball', bySidecar: true },
]);
const TYPES = Object.freeze({
  script: /^(text\/plain|text\/x-shellscript|application\/x-sh|application\/octet-stream)\b/,
  tarball: /^application\/(gzip|x-gzip|x-tar|octet-stream)\b/,
  manifest: /^application\/json\b/,
  sidecar: /^(text\/plain|application\/octet-stream)\b/,
  zip: /^application\/(zip|x-zip-compressed|octet-stream)\b/,
});
/* A pointer field must be a bare file name: a value with a slash or a dot-dot would make this fetch some other path. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const BODY_CAP = 1024 * 1024;   // a pointer, sidecar, health or feed answer; anything bigger is not one
const HASH_CAP = 512 * 1024 * 1024;   // a download read for its sha256; past this it is not one of ours
const REHASH_S = 24 * 3600;     // a file whose headers have not changed is still hashed once a day
const RELAY_FAILS_TO_ALARM = 2; // the canary is a person's computer: one missed run is not an outage

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
    // tools/windows/setup.ps1 requires versioned === kosmos-<version>-win-<arch>.zip; the fixed-name zip is optional.
    const arch = typeof p.arch === 'string' && /^[a-z0-9]+$/.test(p.arch) ? p.arch : null;
    if (!arch || p.versioned !== 'kosmos-' + v + '-win-' + arch + '.zip') return null;
    add(p.versioned, 'zip', true, true);
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
    return { status: r.res.status, type: h.get('content-type') || '', stamp: [h.get('etag'), h.get('last-modified'), h.get('content-length')].join('|') };
  });
}

/* The served bytes' sha256, streamed (a tarball is tens of megabytes). */
async function shaOf(url) {
  const r = await request(url, { timeoutMs: Math.max(TIMEOUT_MS, 300000) });
  if (!r.res) return { error: r.error };
  try {
    if (r.res.status !== 200) return { error: 'answered ' + r.res.status };
    const h = crypto.createHash('sha256');
    let n = 0;
    for await (const chunk of r.res.body) {
      n += chunk.length;
      if (n > HASH_CAP) return { error: 'over ' + Math.round(HASH_CAP / 1048576) + ' MB, so not one of ours' };
      h.update(chunk);
    }
    return { sha: h.digest('hex') };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  } finally { r.clear(); }
}

/* The relay canary through the system curl, not Node's fetch: on a Mac it uses Apple's TLS, which fetches a missing
   intermediate the way the app (WKWebView) and an iPhone do. A computer address serves its certificate without the
   intermediate today (#4878), which Node rejects, so a fetch here would alarm on every run for a defect that has its own
   card, and drown a real outage. What this asks is "does the relay answer the people who use it". */
function curlStatus(url) {
  try {
    const out = execFileSync(env.SERVE_WATCH_CURL || '/usr/bin/curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-m', String(Math.round(TIMEOUT_MS / 1000)), '-A', 'kosmos-serve-watch', url],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: TIMEOUT_MS + 5000 });
    const status = Number(String(out).trim());
    return Number.isInteger(status) && status > 0 ? { status } : { status: 0, error: 'no answer' };
  } catch (err) {
    return { status: 0, error: String((err && err.stderr && String(err.stderr).trim()) || (err && err.message) || err).split('\n')[0].slice(0, 160) };
  }
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

  // The community site and the relay first: they also tell whether THIS computer can reach the internet.
  const health = await getJson(COMMUNITY + '/api/health');
  const healthOk = health.status === 200 && health.json && health.json.ok === true;
  if (!healthOk) add('community-health', 'the community site\'s /api/health did not answer ok (' + why(health) + ')');
  const feed = await getJson(COMMUNITY + '/api/posts/feed');
  if (!(feed.status === 200 && feed.json && typeof feed.json === 'object')) add('community-feed', 'the community feed did not answer (' + why(feed) + ')');
  const relay = curlStatus(RELAY);
  const prevRelayFails = Number(prev && prev.relayFails) || 0;
  const relayFails = relay.status === 200 ? 0 : prevRelayFails + 1;
  if (relayFails >= RELAY_FAILS_TO_ALARM) add('relay', 'the relay, or the canary computer behind ' + RELAY + ', did not answer for ' + relayFails + ' runs in a row (' + why(relay) + ')');

  // The negative control: a file that never exists must answer 404. A 2xx means the site answers anything, so nothing
  // below can be believed: could not tell. No answer, or a 5xx: the download site is down, which is the outage this
  // exists for, unless nothing else answered either, in which case it is this computer that is offline.
  const control = await head(DIST + '/' + CONTROL);
  if (control.status >= 200 && control.status < 300) {
    const why2 = 'installkosmos.com answered ' + control.status + ' for a file that does not exist, so its answers prove nothing';
    // The community and relay answers above do not depend on the download site: a problem there is still an alarm.
    if (problems.length) {
      add('dist-unverifiable', 'the downloads could not be checked: ' + why2);
      return { now, unknown: false, alarm: true, problems, artifacts: 0, sha: prevSha, relayFails };
    }
    return { now, unknown: true, why: why2, problems: [], sha: prevSha, relayFails };
  }
  if (control.status !== 404) {
    if (control.status === 0 && health.status === 0 && relay.status === 0) {
      // Nothing reached anything, so this run says nothing about the canary either: its count is not advanced.
      return { now, unknown: true, why: 'nothing answered (this computer may be offline: ' + why(control) + ')', problems: [], sha: prevSha, relayFails: prevRelayFails };
    }
    add('dist-down', 'installkosmos.com is not answering (' + why(control) + '): no download or update can start');
    return { now, unknown: false, alarm: true, problems, artifacts: 0, sha: prevSha, relayFails };
  }

  const urls = new Map();   // one check per artifact URL, even when two pointers name it
  for (const pt of POINTERS) {
    const g = await getJson(DIST + '/' + pt.file);
    if (g.status !== 200) { add('pointer:' + pt.file, pt.file + ' is not served (' + why(g) + ')'); continue; }
    if (!g.json) { add('pointer-json:' + pt.file, pt.file + ' is served but is not valid JSON'); continue; }
    const arts = artifactsOf(g.json, pt);
    if (!arts) { add('pointer-shape:' + pt.file, pt.file + ' does not name its artifacts the way the app reads them'); continue; }
    const want = typeof g.json.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(g.json.sha256) ? g.json.sha256.toLowerCase() : null;
    if (!want) add('pointer-sha:' + pt.file, pt.file + ' carries no sha256, so its download cannot be checked');
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
    const h = await head(url);
    if (h.status !== 200) { add('missing:' + a.name, a.name + by + ' is not served (' + why(h) + ')'); continue; }
    if (!TYPES[a.type].test(h.type)) { add('type:' + a.name, a.name + by + ' is served as "' + shown(h.type) + '", not a ' + a.type); continue; }
    if (expect.size > 1) { add('two-shas:' + a.name, a.name + by + ' is held to two different sha256s'); continue; }
    const want = expect.size ? [...expect][0] : null;
    if (a.sidecar && want) {
      // What the installers compare against (install/setup.sh verify_download, setup.ps1): cheap, so every run.
      const s = await getJson(url + '.sha256');
      const said = s.status === 200 && s.text ? String(s.text).trim().split(/\s+/)[0].toLowerCase() : null;
      if (s.status !== 200) add('sidecar-missing:' + a.name, a.name + '.sha256' + by + ' is not served (' + why(s) + '): installers refuse the download without it');
      else if (said !== want) add('sidecar-sha:' + a.name, a.name + '.sha256 says ' + String(said).slice(0, 12) + ', the pointer says ' + want.slice(0, 12) + ': installers refuse the download');
    }
    if (!a.hashed || !want) continue;
    const was = prevSha[url];
    // Hashed again when the pointer's sha or the file's headers change, after a failed read, or once a day; otherwise
    // the last answer stands (a tarball is tens of megabytes, and an unchanged file hashes the same).
    const due = !was || was.expect !== want || was.stamp !== h.stamp || !!was.error || !(Number(was.at) <= now) || now - Number(was.at) >= REHASH_S;
    let rec = was;
    if (due) {
      let s = await shaOf(url);
      if (s.error) s = await shaOf(url);   // once more, as every other request here
      rec = { at: now, expect: want, stamp: h.stamp, got: s.sha || null, error: s.error || null };
    }
    sha[url] = rec;
    if (rec.error) add('unreadable:' + a.name, a.name + by + ' could not be read whole to check its sha256 (' + rec.error + ')');
    else if (rec.got !== want) add('sha:' + a.name, a.name + by + ' does not match: served sha256 ' + String(rec.got).slice(0, 12) + ', pointer says ' + want.slice(0, 12));
  }
  for (const f of FIXED) {
    const url = f.url();
    const h = await head(url);
    if (h.status !== 200) { add('missing:' + f.name, f.name + ' is not served (' + why(h) + '): every install fetches it'); continue; }
    if (!TYPES[f.type].test(h.type)) { add('type:' + f.name, f.name + ' is served as "' + shown(h.type) + '", not a ' + f.type); continue; }
    if (!f.bySidecar) continue;
    const s = await getJson(url + '.sha256');
    const want = s.status === 200 && s.text ? String(s.text).trim().split(/\s+/)[0].toLowerCase() : null;
    if (!want || !/^[0-9a-f]{64}$/.test(want)) { add('sidecar-missing:' + f.name, f.name + '.sha256 is not served or not a sha256 (' + why(s) + '): installers refuse the download'); continue; }
    const was = prevSha[url];
    const due = !was || was.expect !== want || was.stamp !== h.stamp || !!was.error || !(Number(was.at) <= now) || now - Number(was.at) >= REHASH_S;
    let rec = was;
    if (due) {
      let r = await shaOf(url);
      if (r.error) r = await shaOf(url);
      rec = { at: now, expect: want, stamp: h.stamp, got: r.sha || null, error: r.error || null };
    }
    sha[url] = rec;
    if (rec.error) add('unreadable:' + f.name, f.name + ' could not be read whole to check its sha256 (' + rec.error + ')');
    else if (rec.got !== want) add('sha:' + f.name, f.name + ' does not match its own .sha256: served ' + String(rec.got).slice(0, 12) + ', sidecar says ' + want.slice(0, 12));
  }
  return { now, unknown: false, alarm: problems.length > 0, problems, artifacts: urls.size + FIXED.length, sha, relayFails };
}

/* Whether to post now, and what kind, from the verdict and this channel's last post. Pure. */
function decidePost(v, last, now) {
  const key = v.unknown ? 'unknown' : v.alarm ? 'alarm:' + v.problems.map((p) => p.key).sort().join(',') : 'clear';
  const due = !last || now - (last.at || 0) >= REPOST_S;
  if (key === 'clear') return last && last.key && last.key !== 'clear' ? { post: 'cleared', key } : { post: null, key };
  if (!last || last.key !== key || due) return { post: v.unknown ? 'unknown' : 'alarm', key };
  return { post: null, key };
}

function message(kind, v) {
  const head = 'serve watch (kosmos#4877): ';
  const all = 'every live download (' + v.artifacts + ' files), the community site and the relay answer.';
  if (kind === 'unknown') return head + 'could not tell (' + v.why + '). This is not a pass: nothing was checked.';
  if (kind === 'watching') return head + 'still watching: ' + all;
  if (kind === 'cleared') return head + (v.after === 'unknown' ? 'able to check again: ' : 'back to healthy: ') + all;
  const downloads = v.problems.some((p) => !/^(community-|relay)/.test(p.key));
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
      // Exit 7 and 8 are claude-msg's "delivered but could not confirm" (#1909): counted as told for the pane only.
      if (err && (err.status === 8 || err.status === 7)) {
        went.pane = true;
        unsure.pane = true;
        paneUnsure = 'claude-msg exit ' + err.status + ', which usually means the pane was busy and the message landed (#1909)';
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
    const v = await gather(readState(), now);
    process.stdout.write(JSON.stringify(Object.assign({}, v, { sha: undefined })) + '\n');
    return v.unknown ? 2 : v.alarm ? 1 : 0;
  }
  const noState = stateProblem();
  const state = noState ? null : readState();
  const v = await gather(state, now);
  const code = v.unknown ? 2 : v.alarm ? 1 : 0;
  /* No state to keep: say it at most once a day, in one fixed 15-minute window of the UTC day, as gap-alarm does. */
  if (noState && now % 86400 >= INTERVAL_S) {
    process.stderr.write('serve-watch: cannot keep state (' + noState + '); posting only in the first 15 minutes of the UTC day\n');
    return code;
  }
  const since = state ? Number(state.unknownSince) : NaN;
  const unknownSince = v.unknown ? (Number.isFinite(since) && since > 0 && since <= now ? since : now) : null;
  if (!noState && v.unknown && now - unknownSince < UNKNOWN_GRACE_S) {
    writeState({ pane: lastFor(state, 'pane', now), card: lastFor(state, 'card', now), lastRunAt: now, unknownSince, sha: v.sha, relayFails: v.relayFails });
    return code;
  }
  const next = {};
  const due = {};
  for (const ch of CHANNELS) {
    const last = lastFor(state, ch, now);
    next[ch] = last;
    const d = decidePost(v, last, now);
    due[ch] = d;
    if (!d.post && (!last || last.key !== d.key)) next[ch] = { key: d.key, at: now };
  }
  const cardLast = next.card;
  if (!due.card.post && due.card.key === 'clear' && cardLast && cardLast.key === 'clear' && now - (cardLast.at || 0) >= WATCHING_S) {
    due.card = { post: 'watching', key: 'clear' };
  }
  const texts = {};
  for (const ch of CHANNELS) {
    if (!due[ch].post) continue;
    const last = lastFor(state, ch, now);
    if (last && last.failedKey === due[ch].key && now - (last.failedAt || 0) < RETRY_S) continue;
    texts[ch] = message(due[ch].post, Object.assign({}, v, { after: last && last.key }))
      + (noState ? ' (The serve watch cannot keep its state at ' + statePath() + ': ' + noState + '. It says this once a day until that is fixed.)' : '');
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
  writeState({ pane: next.pane, card: next.card, lastRunAt: now, unknownSince, sha: v.sha, relayFails: v.relayFails });
  return code;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (err) => {
    process.stderr.write('serve-watch: ' + ((err && err.stack) || err) + '\n');
    process.exitCode = 2;
  });
}

module.exports = { gather, decidePost, message, artifactsOf, plist, main, POINTERS, LABEL, CONTROL };
