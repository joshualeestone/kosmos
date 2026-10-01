#!/usr/bin/env node
'use strict';

/* kosmos#4877: the serve watch. On 2026-09-30 the 0.7.14 staging tarball answered 404 for about an hour after a site
 * deploy (#4819) and nobody noticed until a failed update took Josh's laptop down (#4818). Agent1s already watched the
 * coordinator, the relay's certificate and drift, but nothing watched what people actually download or reach. This
 * does, every 15 minutes, READ-ONLY:
 *
 *   1. installkosmos.com: each live pointer (latest.json, latest-staging.json, latest-win.json,
 *      latest-win-staging.json) is served, and every artifact it names answers 200 with the right content type
 *      (every run); the served bytes hash to the pointer's sha256 (at most hourly per artifact).
 *   2. community.installkosmos.com: /api/health answers {"ok":true}, and the public feed answers.
 *   3. The relay: the canary computer's address answers (through the system curl; see curlStatus). Its build is NOT checked: the relay writes it only to its own
 *      journal (crates/relay/src/serve.rs), with no public route, and this holds no SSH. If the canary's Mac is off
 *      the alarm says so as "the relay, or that computer": from outside the two look the same.
 *
 * Before any of that, a NEGATIVE CONTROL: a file that never exists must answer 404. A site that answers 200 for
 * everything would pass every artifact check, so then the run is "could not tell", never "healthy".
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
 * SEAMS (tests): SERVE_WATCH_DIST, SERVE_WATCH_COMMUNITY, SERVE_WATCH_RELAY (base URLs), SERVE_WATCH_NOW (epoch
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
const SHA_EVERY_S = 3600;
const REPOST_S = 6 * 3600;
const RETRY_S = 3600;
const WATCHING_S = 7 * 24 * 3600;
const UNKNOWN_GRACE_S = 3600;

const DIST = (env.SERVE_WATCH_DIST || 'https://installkosmos.com/dist').replace(/\/+$/, '');
const COMMUNITY = (env.SERVE_WATCH_COMMUNITY || 'https://community.installkosmos.com').replace(/\/+$/, '');
const RELAY = env.SERVE_WATCH_RELAY || 'https://pizzarama.kosmosplus.com/';
const TIMEOUT_MS = Number(env.SERVE_WATCH_TIMEOUT_MS) || 30000;
const CONTROL = 'serve-watch-control-never-published.json';

/* The four live pointers. `kind` says which artifacts a pointer names and what each must look like. */
const POINTERS = Object.freeze([
  { file: 'latest.json', kind: 'mac' },
  { file: 'latest-staging.json', kind: 'mac' },
  { file: 'latest-win.json', kind: 'win' },
  { file: 'latest-win-staging.json', kind: 'win' },
]);
const TYPES = Object.freeze({
  tarball: /^application\/(gzip|x-gzip|x-tar|octet-stream)\b/,
  manifest: /^application\/json\b/,
  sidecar: /^(text\/plain|application\/octet-stream)\b/,
  zip: /^application\/(zip|x-zip-compressed|octet-stream)\b/,
});
/* A pointer field must be a bare file name: a value with a slash or a dot-dot would make this fetch some other path. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

/* The artifacts a pointer names, with the content type each must have and whether its bytes hash to the pointer. */
function artifactsOf(p, kind) {
  if (!p || typeof p !== 'object') return null;
  const out = [];
  const add = (name, type, hashed) => { if (typeof name === 'string' && NAME_RE.test(name) && !name.includes('..')) out.push({ name, type, hashed }); };
  if (kind === 'mac') {
    add(p.artifact, 'tarball', true);
    add(p.manifest, 'manifest', false);
    if (typeof p.artifact === 'string') add(p.artifact + '.sha256', 'sidecar', false);
    if (out.length !== 3) return null;
  } else {
    add(p.artifact, 'zip', true);
    add(p.versioned, 'zip', true);
    if (out.length !== 2) return null;
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

async function getJson(url) {
  const r = await request(url);
  if (!r.res) return { status: 0, error: r.error };
  try {
    const text = await r.res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.res.status, type: r.res.headers.get('content-type') || '', json };
  } catch (err) {
    return { status: r.res.status, error: String((err && err.message) || err) };
  } finally { r.clear(); }
}

async function head(url) {
  const r = await request(url, { method: 'HEAD' });
  if (!r.res) return { status: 0, error: r.error };
  r.clear();
  return { status: r.res.status, type: r.res.headers.get('content-type') || '' };
}

/* The served bytes' sha256, streamed (a tarball is tens of megabytes). */
async function shaOf(url) {
  const r = await request(url, { timeoutMs: Math.max(TIMEOUT_MS, 300000) });
  if (!r.res) return { error: r.error };
  try {
    if (r.res.status !== 200) return { error: 'answered ' + r.res.status };
    const h = crypto.createHash('sha256');
    for await (const chunk of r.res.body) h.update(chunk);
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

/* Every check, one verdict. `prev` is the last run's state (its sha record); `now` is epoch seconds. */
async function gather(prev, now) {
  const problems = [];
  const sha = {};
  const prevSha = (prev && prev.sha && typeof prev.sha === 'object') ? prev.sha : {};
  // The negative control first: without it a catch-all 200 passes everything below.
  const control = await head(DIST + '/' + CONTROL);
  if (control.status === 0) return { now, unknown: true, why: 'installkosmos.com did not answer (' + control.error + ')', problems: [], sha: prevSha };
  if (control.status !== 404) return { now, unknown: true, why: 'installkosmos.com answered ' + control.status + ' for a file that does not exist, so its answers prove nothing', problems: [], sha: prevSha };

  const urls = new Map();   // one HEAD per artifact URL, even when two pointers name it
  for (const pt of POINTERS) {
    const g = await getJson(DIST + '/' + pt.file);
    if (g.status !== 200) { problems.push(pt.file + ' is not served (' + (g.status || g.error) + ')'); continue; }
    const arts = artifactsOf(g.json, pt.kind);
    if (!arts) { problems.push(pt.file + ' does not name its artifacts the way the app reads them'); continue; }
    for (const a of arts) {
      const url = DIST + '/' + a.name;
      const known = urls.get(url);
      if (known) { if (a.hashed && g.json.sha256) known.expect.add(String(g.json.sha256).toLowerCase()); continue; }
      urls.set(url, { a, from: pt.file, expect: new Set(a.hashed && g.json.sha256 ? [String(g.json.sha256).toLowerCase()] : []) });
    }
  }
  for (const [url, { a, from, expect }] of urls) {
    const h = await head(url);
    if (h.status !== 200) { problems.push(a.name + ' (named by ' + from + ') is not served (' + (h.status || h.error) + ')'); continue; }
    if (!TYPES[a.type].test(h.type)) { problems.push(a.name + ' (named by ' + from + ') is served as "' + (h.type || 'no type') + '", not a ' + a.type); continue; }
    if (!a.hashed || !expect.size) continue;
    if (expect.size > 1) { problems.push(a.name + ' is named by two pointers with different sha256s'); continue; }
    const want = [...expect][0];
    const was = prevSha[url];
    // At most hourly, and again at once when the pointer's sha changes; between hashes the last answer stands.
    const due = !was || was.expect !== want || !(Number(was.at) <= now) || now - Number(was.at) >= SHA_EVERY_S;
    let rec = was;
    if (due) {
      const s = await shaOf(url);
      rec = { at: now, expect: want, got: s.sha || null, error: s.error || null };
    }
    sha[url] = rec;
    if (rec.error) problems.push(a.name + ' could not be read whole to check its sha256 (' + rec.error + ')');
    else if (rec.got !== want) problems.push(a.name + ' does not match ' + from + ': served sha256 ' + String(rec.got).slice(0, 12) + ', pointer says ' + want.slice(0, 12));
  }

  const health = await getJson(COMMUNITY + '/api/health');
  if (!(health.status === 200 && health.json && health.json.ok === true)) problems.push('the community site\'s /api/health did not answer ok (' + (health.status || health.error) + ')');
  const feed = await getJson(COMMUNITY + '/api/posts/feed');
  if (!(feed.status === 200 && feed.json && typeof feed.json === 'object')) problems.push('the community feed did not answer (' + (feed.status || feed.error) + ')');

  const relay = curlStatus(RELAY);
  if (relay.status !== 200) problems.push('the relay, or the canary computer behind ' + RELAY + ', did not answer (' + (relay.status || relay.error) + ')');

  return { now, unknown: false, alarm: problems.length > 0, problems, artifacts: urls.size, sha };
}

/* Whether to post now, and what kind, from the verdict and this channel's last post. Pure. */
function decidePost(v, last, now) {
  const key = v.unknown ? 'unknown' : v.alarm ? 'alarm:' + v.problems.join(' | ') : 'clear';
  const due = !last || now - (last.at || 0) >= REPOST_S;
  if (key === 'clear') return last && last.key && last.key !== 'clear' ? { post: 'cleared', key } : { post: null, key };
  if (!last || last.key !== key || due) return { post: v.unknown ? 'unknown' : 'alarm', key };
  return { post: null, key };
}

function message(kind, v) {
  const head = 'serve watch (kosmos#4877): ';
  if (kind === 'unknown') return head + 'could not tell (' + v.why + '). This is not a pass: nothing was checked.';
  if (kind === 'watching') return head + 'still watching. Every live download (' + v.artifacts + ' artifacts), the community site and the relay answer.';
  if (kind === 'cleared') return head + (v.after === 'unknown' ? 'checking again, and ' : 'back to healthy: ') + 'every live download (' + v.artifacts + ' artifacts), the community site and the relay answer.';
  return head + v.problems.length + ' problem' + (v.problems.length === 1 ? '' : 's') + ':\n- ' + v.problems.join('\n- ')
    + '\nThis monitor only reads; nothing was changed. People updating or installing now get the failure above.';
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
  const noState = stateProblem();
  const state = noState ? null : readState();
  const v = await gather(state, now);
  const code = v.unknown ? 2 : v.alarm ? 1 : 0;
  if (argv.includes('--check')) { process.stdout.write(JSON.stringify(Object.assign({}, v, { sha: undefined })) + '\n'); return code; }
  /* No state to keep: say it at most once a day, in one fixed 15-minute window of the UTC day, as gap-alarm does. */
  if (noState && now % 86400 >= INTERVAL_S) {
    process.stderr.write('serve-watch: cannot keep state (' + noState + '); posting only in the first 15 minutes of the UTC day\n');
    return code;
  }
  const since = state ? Number(state.unknownSince) : NaN;
  const unknownSince = v.unknown ? (Number.isFinite(since) && since > 0 && since <= now ? since : now) : null;
  if (!noState && v.unknown && now - unknownSince < UNKNOWN_GRACE_S) {
    writeState({ pane: lastFor(state, 'pane', now), card: lastFor(state, 'card', now), lastRunAt: now, unknownSince, sha: v.sha });
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
  writeState({ pane: next.pane, card: next.card, lastRunAt: now, unknownSince, sha: v.sha });
  return code;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (err) => {
    process.stderr.write('serve-watch: ' + ((err && err.stack) || err) + '\n');
    process.exitCode = 2;
  });
}

module.exports = { gather, decidePost, message, artifactsOf, plist, main, POINTERS, LABEL, CONTROL };
