#!/usr/bin/env node
'use strict';

/* kosmos#1050: the gap alarm. Merged work outran what reached anyone, five times on record (50, 167,
 * 9, 44, 89 commits; about 330 to prod on 2026-09-28), and each time a person noticed by hand.
 * PigeonPete's call (2026-09-28): a scheduled, READ-ONLY check that tells the release owner when
 *
 *   main    is more than 50 commits, or more than 24 h, past the STAGING build, or
 *   staging is more than 48 h past the PROD build.
 *
 * Cuts and promotes stay manual. This never cuts, promotes, or touches a pointer: it reads the two
 * served pointers (latest-staging.json, latest.json) and their manifests' app.commit, counts with
 * git, and posts. "Past" is measured from the OLDEST commit still waiting (its committer time, which
 * under squash merges is when it merged), so the hours say how long work has sat, not when a build
 * happened.
 *
 * Where it posts, both best effort:
 *   - the release owner's pane, by claude-msg (GAP_ALARM_TO, the person who can cut), and
 *   - a comment on kosmos#1050, so the figures keep their history where the decision lives.
 * It posts when an alarm starts or its reasons change, again every 24 h while it lasts, once when it
 * clears, and once a day while it cannot tell (a silent monitor and a healthy gap look alike).
 *
 *   node tools/gap-alarm.js           gather, decide, post as above
 *   node tools/gap-alarm.js --check   print the verdict as JSON and post nothing
 *   node tools/gap-alarm.js --plist   print the LaunchAgent plist (hourly) for this checkout
 *   node tools/gap-alarm.js --install write that plist to AGENT_WORKFORCE_LAUNCH (default
 *                                     ~/Library/LaunchAgents) and load it
 *
 * Exit: 0 no alarm, 1 alarm, 2 could not tell. EXIT 2 IS NOT A PASS.
 *
 * SEAMS (tests): GAP_ALARM_POINTERS (JSON {prod:{version,sha},staging:{version,sha}}, skips the
 * network), KOSMOS_DIST_BASE, KOSMOS_DIST_ARCH, KOSMOS_REPO_DIR, GAP_ALARM_NO_FETCH=1, GAP_ALARM_NOW
 * (epoch seconds), GAP_ALARM_STATE, GAP_ALARM_MSG_CMD, GAP_ALARM_TO, GAP_ALARM_GH_CMD,
 * GAP_ALARM_ISSUE. Under the test runner it posts only through seams a test supplies.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LABEL = 'com.kosmos.gap-alarm';
const THRESHOLDS = Object.freeze({ mainCommits: 50, mainHours: 24, stagingHours: 48 });
const REPOST_S = 24 * 3600;
const env = process.env;

/* The verdict, pure. `main` is main against staging, `staging` is staging against prod:
   { ahead: commits waiting, oldestAt: committer time (s) of the oldest one waiting, or null }. */
function verdict({ main, staging, now, t = THRESHOLDS }) {
  const hours = (at) => (typeof at === 'number' ? (now - at) / 3600 : 0);
  const reasons = [];
  if (main.ahead > t.mainCommits) reasons.push('main-commits');
  if (main.ahead > 0 && hours(main.oldestAt) > t.mainHours) reasons.push('main-hours');
  if (staging.ahead > 0 && hours(staging.oldestAt) > t.stagingHours) reasons.push('staging-hours');
  return {
    alarm: reasons.length > 0,
    reasons,
    main: { ahead: main.ahead, hours: Math.floor(hours(main.oldestAt)) },
    staging: { ahead: staging.ahead, hours: Math.floor(hours(staging.oldestAt)) },
  };
}

/* Whether to post now, and what kind, from the verdict and the last post. Pure. */
function decidePost(v, last, now) {
  const key = v.unknown ? 'unknown' : v.alarm ? 'alarm:' + v.reasons.join(',') : 'clear';
  const due = !last || now - (last.at || 0) >= REPOST_S;
  if (key === 'clear') return last && last.key !== 'clear' ? { post: 'cleared', key } : { post: null, key };
  if (!last || last.key !== key || due) return { post: v.unknown ? 'unknown' : 'alarm', key };
  return { post: null, key };
}

function message(kind, v) {
  if (kind === 'unknown') return 'gap alarm (kosmos#1050): could not tell (' + v.why + '). This is not a pass: the gap is unmeasured.';
  const line = 'main is ' + v.main.ahead + ' commits past staging ' + v.stagingVersion + ' (oldest waiting ' + v.main.hours + ' h); '
    + 'staging ' + v.stagingVersion + ' is ' + v.staging.ahead + ' commits past prod ' + v.prodVersion + ' (oldest waiting ' + v.staging.hours + ' h).';
  if (kind === 'cleared') return 'gap alarm (kosmos#1050): back under the limits. ' + line;
  return 'gap alarm (kosmos#1050): ' + v.reasons.join(', ') + '. ' + line
    + ' Limits: main ' + THRESHOLDS.mainCommits + ' commits or ' + THRESHOLDS.mainHours + ' h past staging; staging '
    + THRESHOLDS.stagingHours + ' h past prod. Cuts are manual: cut or promote, or say on #1050 why not.';
}

async function readPointer(base, arch, file) {
  const get = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(url + ' answered ' + r.status);
    return r.json();
  };
  const p = await get(base + '/' + file);
  if (!p || typeof p.version !== 'string') throw new Error(file + ' has no version');
  const m = await get(base + '/' + (p.manifest || 'kosmos-' + p.version + '-' + arch + '.manifest.json'));
  const sha = m && m.app && typeof m.app.commit === 'string' ? m.app.commit : null;
  if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) throw new Error('the ' + p.version + ' manifest has no app.commit');
  return { version: p.version, sha };
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/* Commits in `to` not in `from`, and the committer time of the oldest. */
function waiting(repo, from, to) {
  const ahead = Number(git(repo, ['rev-list', '--count', from + '..' + to]));
  if (!Number.isFinite(ahead)) throw new Error('could not count ' + from + '..' + to);
  if (ahead === 0) return { ahead, oldestAt: null };
  const times = git(repo, ['log', '--format=%ct', from + '..' + to]).split('\n').map(Number).filter(Number.isFinite);
  return { ahead, oldestAt: times.length ? Math.min(...times) : null };
}

async function gather() {
  const now = Number(env.GAP_ALARM_NOW) || Math.floor(Date.now() / 1000);
  const repo = env.KOSMOS_REPO_DIR || path.join(__dirname, '..');
  try {
    let ptrs;
    if (env.GAP_ALARM_POINTERS) ptrs = JSON.parse(env.GAP_ALARM_POINTERS);
    else {
      const base = env.KOSMOS_DIST_BASE || 'https://installkosmos.com/dist';
      const arch = env.KOSMOS_DIST_ARCH || 'arm64';
      ptrs = { prod: await readPointer(base, arch, 'latest.json'), staging: await readPointer(base, arch, 'latest-staging.json') };
    }
    if (env.GAP_ALARM_NO_FETCH !== '1') git(repo, ['fetch', '-q', 'origin', 'main']);
    for (const k of ['prod', 'staging']) {
      try { git(repo, ['cat-file', '-e', ptrs[k].sha + '^{commit}']); } catch { throw new Error('the ' + k + ' build ' + ptrs[k].sha.slice(0, 8) + ' is not in ' + repo); }
    }
    const v = verdict({ main: waiting(repo, ptrs.staging.sha, 'origin/main'), staging: waiting(repo, ptrs.prod.sha, ptrs.staging.sha), now });
    return Object.assign(v, { now, prodVersion: ptrs.prod.version, stagingVersion: ptrs.staging.version });
  } catch (err) {
    return { now, unknown: true, alarm: false, reasons: [], why: String((err && err.message) || err) };
  }
}

function statePath() {
  return env.GAP_ALARM_STATE || path.join(os.homedir(), '.cache', 'kosmos-gap-alarm', 'state.json');
}
function readState() { try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return null; } }
function writeState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s) + '\n');
}

/* Both channels best effort; true when at least one post went. PATH is the caller's (the plist sets
   it for launchd); it is never rewritten here, so whatever is first on PATH is what runs. Under the test runner only through
   seams a test supplies, so no test can message a real pane or comment on the real card. */
function post(text) {
  const underTest = !!env.NODE_TEST_CONTEXT;
  let sent = false;
  const msgCmd = env.GAP_ALARM_MSG_CMD || (underTest ? null : path.join(os.homedir(), '.claude', 'scripts', 'claude-msg'));
  if (msgCmd) {
    try {
      execFileSync(msgCmd, [env.GAP_ALARM_TO || 'barondraxum-discord:0.0', '-'], {
        input: '=== HEADS-UP ===\nfrom: gap-alarm (launchd)\nto:   release owner\n\n' + text + '\n=== END HEADS-UP ===\n',
        stdio: ['pipe', 'ignore', 'ignore'], timeout: 30000,
      });
      sent = true;
    } catch (err) { process.stderr.write('gap-alarm: the pane message did not go: ' + (err && err.message) + '\n'); }
  }
  const ghCmd = env.GAP_ALARM_GH_CMD || (underTest ? null : 'gh');
  if (ghCmd) {
    try {
      execFileSync(ghCmd, ['issue', 'comment', env.GAP_ALARM_ISSUE || '1050', '--repo', 'joshualeestone/kosmos', '--body', text], {
        stdio: ['ignore', 'ignore', 'ignore'], timeout: 30000,
      });
      sent = true;
    } catch (err) { process.stderr.write('gap-alarm: the #1050 comment did not go: ' + (err && err.message) + '\n'); }
  }
  return sent;
}

function xml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/* The LaunchAgent, hourly. An explicit node path, not /usr/bin/env: launchd's PATH is minimal and a
   bare interpreter is a different subject for macOS privacy grants. */
function plist({ node = process.execPath, script = path.resolve(__filename), home = os.homedir() } = {}) {
  const log = path.join(home, 'Library', 'Logs', 'kosmos', 'gap-alarm.log');
  const s = (v) => '<string>' + xml(v) + '</string>';
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">', '<dict>',
    '  <key>Label</key>' + s(LABEL),
    '  <key>ProgramArguments</key><array>' + s(node) + s(script) + '</array>',
    '  <key>EnvironmentVariables</key><dict><key>PATH</key>' + s('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin') + '</dict>',
    '  <key>StartInterval</key><integer>3600</integer>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>StandardOutPath</key>' + s(log),
    '  <key>StandardErrorPath</key>' + s(log),
    '</dict>', '</plist>', ''].join('\n');
}

function install() {
  const dir = env.AGENT_WORKFORCE_LAUNCH || path.join(os.homedir(), 'Library', 'LaunchAgents');
  if (env.NODE_TEST_CONTEXT && !env.AGENT_WORKFORCE_LAUNCH) throw new Error('refusing to install into the real LaunchAgents under test');
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
  const v = await gather();
  const code = v.unknown ? 2 : v.alarm ? 1 : 0;
  if (argv.includes('--check')) { process.stdout.write(JSON.stringify(v) + '\n'); return code; }
  const last = readState();
  const d = decidePost(v, last, v.now);
  if (d.post) {
    const text = message(d.post, v);
    process.stdout.write(new Date(v.now * 1000).toISOString() + ' ' + text + '\n');
    // The clock advances only on a post that went, or a dead channel would count as told.
    if (post(text)) writeState({ key: d.key, at: v.now });
  } else if (!last || last.key !== d.key) {
    writeState({ key: d.key, at: last && last.key === d.key ? last.at : v.now });
  }
  return code;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (err) => {
    process.stderr.write('gap-alarm: ' + ((err && err.stack) || err) + '\n');
    process.exitCode = 2;
  });
}

module.exports = { verdict, decidePost, message, plist, waiting, gather, main, THRESHOLDS, LABEL };
