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
 * served pointers (latest-staging.json, latest.json) and their manifests' app.commit and built.at,
 * counts with git, and posts. Main's hours run from the OLDEST commit not yet in staging, read on
 * main's FIRST-PARENT line only: its committer time there is when the work landed on main, whether it
 * was squashed or merged with a merge commit (a side branch's own commits can be days older than their
 * merge, and would alarm the hour they land): how long merged work has waited for a cut. When a cut
 * went straight to prod and staging is behind it, main is measured against prod instead. Staging's
 * hours run from when the staging build was CUT (its manifest's built.at), while it
 * holds anything prod does not: how long a build has waited for a promote, which is gated on walks
 * and so is the step a person must take.
 *
 * Where it posts, both best effort:
 *   - the release owner's pane, by claude-msg (GAP_ALARM_TO, the person who can cut), and
 *   - a comment on kosmos#1050, so the figures keep their history where the decision lives.
 * It posts when an alarm starts or its reasons change, again every 24 h while it lasts, once when it
 * clears, and once a day while it cannot tell (a silent monitor and a healthy gap look alike); a
 * could-not-tell is said only once it has lasted 3 h. While clear, the card alone gets one "still
 * watching" line a week, so a job that stopped running is visible. Each channel keeps its own
 * clock, and a post that failed is retried after 3 h, not hourly.
 *
 *   node tools/gap-alarm.js           gather, decide, post as above
 *   node tools/gap-alarm.js --check   print the verdict as JSON and post nothing (it still fetches
 *                                     origin main into the checkout, as every run does)
 *   node tools/gap-alarm.js --plist   print the LaunchAgent plist (hourly) for this checkout
 *   node tools/gap-alarm.js --install write that plist to AGENT_WORKFORCE_LAUNCH (default
 *                                     ~/Library/LaunchAgents) and load it. Run it from the MAIN
 *                                     checkout: a linked worktree is refused, since it is removed
 *                                     after merge and the job would point at nothing.
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
/* A channel whose post FAILED retries the same message after this, not every hour: a message that
   reports failure can still have landed (claude-msg can be killed between the paste and the Enter,
   or report a delivery it could not confirm), and hourly retries would repeat it into a busy pane.
   A change in what there is to say is still sent at once. */
const RETRY_S = 3 * 3600;
/* A job that stopped running looks exactly like a clear gap (review 7): the pane and the card go
   quiet either way. So while it stays clear the CARD (never the pane) gets one "still watching"
   line a week, and every run records lastRunAt in the state file for anyone who looks. */
const WATCHING_S = 7 * 24 * 3600;
/* Could-not-tell is said only once it has lasted this long (review 9). A failure that comes and
   goes (a flaky route, a CDN challenge on some requests, a lock clash in the shared checkout)
   would otherwise flip the key every hour, and every flip posts to both channels. A debounced
   hour never becomes a posted key, so the next known verdict compares with what was last SAID. */
const UNKNOWN_GRACE_S = 3 * 3600;
const env = process.env;

/* The verdict, pure. `main` is main against staging: { ahead, oldestAt: committer time (s) of the
   oldest commit waiting }. `staging` is staging against prod: { ahead, builtAt: when the staging
   build was cut (s) }. */
function verdict({ main, staging, now, t = THRESHOLDS }) {
  const hours = (at) => (typeof at === 'number' ? (now - at) / 3600 : 0);
  const reasons = [];
  if (main.ahead > t.mainCommits) reasons.push('main-commits');
  if (main.ahead > 0 && hours(main.oldestAt) > t.mainHours) reasons.push('main-hours');
  if (staging.ahead > 0 && hours(staging.builtAt) > t.stagingHours) reasons.push('staging-hours');
  return {
    alarm: reasons.length > 0,
    reasons,
    main: { ahead: main.ahead, hours: Math.floor(hours(main.oldestAt)) },
    staging: { ahead: staging.ahead, hours: staging.ahead > 0 ? Math.floor(hours(staging.builtAt)) : 0 },
  };
}

/* Whether to post now, and what kind, from the verdict and the last post. Pure. */
function decidePost(v, last, now) {
  const key = v.unknown ? 'unknown' : v.alarm ? 'alarm:' + v.reasons.join(',') : 'clear';
  const due = !last || now - (last.at || 0) >= REPOST_S;
  // An all-clear only follows something this channel actually said (a first post that failed
  // leaves no key: there is nothing to clear).
  if (key === 'clear') return last && last.key && last.key !== 'clear' ? { post: 'cleared', key } : { post: null, key };
  if (!last || last.key !== key || due) return { post: v.unknown ? 'unknown' : 'alarm', key };
  return { post: null, key };
}

function message(kind, v) {
  if (kind === 'unknown') return 'gap alarm (kosmos#1050): could not tell (' + v.why + '). This is not a pass: the gap is unmeasured.';
  const line = v.prodAhead
    ? 'main is ' + v.main.ahead + ' commits past prod ' + v.prodVersion + ' (oldest waiting ' + v.main.hours + ' h); '
      + 'staging ' + v.stagingVersion + ' is behind prod (prod was cut straight to prod).'
    : 'main is ' + v.main.ahead + ' commits past staging ' + v.stagingVersion + ' (oldest waiting ' + v.main.hours + ' h); '
      + 'staging ' + v.stagingVersion + ' is ' + v.staging.ahead + ' commits past prod ' + v.prodVersion
      + (v.staging.ahead > 0 ? ' (cut ' + v.staging.hours + ' h ago).' : '.');
  if (kind === 'watching') return 'gap alarm (kosmos#1050): still watching, and under the limits. ' + line;
  if (kind === 'cleared') return 'gap alarm (kosmos#1050): ' + (v.after === 'unknown' ? 'measurable again, and under the limits. ' : 'back under the limits. ') + line;
  return 'gap alarm (kosmos#1050): ' + v.reasons.join(', ') + '. ' + line
    + ' Limits: main ' + THRESHOLDS.mainCommits + ' commits or ' + THRESHOLDS.mainHours + ' h past ' + (v.prodAhead ? 'prod' : 'staging') + '; staging '
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
  const builtAt = m && m.built && typeof m.built.at === 'string' ? Math.floor(Date.parse(m.built.at) / 1000) : NaN;
  if (!Number.isFinite(builtAt)) throw new Error('the ' + p.version + ' manifest has no built.at');
  return { version: p.version, sha, builtAt };
}

/* Every git call is bounded. An unbounded fetch on a box that has lost its route to GitHub
 * never returns, so the hourly run would go dark instead of saying it could not tell. No
 * prompt either: under launchd there is nobody to answer one. */
const GIT_TIMEOUT_MS = Number(env.GAP_ALARM_GIT_TIMEOUT_MS) || 60000;
function git(repo, args) {
  try {
    // gc.auto=0: the hourly fetch must never start a garbage collection in the shared checkout
    // (a timeout-killed fetch can leave a detached gc running).
    return execFileSync('git', ['-c', 'gc.auto=0', '-C', repo, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS,
      env: Object.assign({}, env, { GIT_TERMINAL_PROMPT: '0' }),
    }).trim();
  } catch (err) {
    if (err && err.code === 'ETIMEDOUT') throw new Error('git ' + args[0] + ' did not finish in ' + Math.round(GIT_TIMEOUT_MS / 1000) + 's');
    // git's own first stderr line says why (auth, a locked keychain, the network), not the command.
    const why = err && err.stderr ? String(err.stderr).trim().split('\n')[0] : '';
    if (why) throw new Error('git ' + args[0] + ': ' + why);
    throw err;
  }
}

/* Commits in `to` not in `from`, and the committer time of the oldest on `to`'s first-parent line
 * (when it landed there). The count stays all commits, as tools/shipped-gap.sh counts them. */
function waiting(repo, from, to) {
  const ahead = Number(git(repo, ['rev-list', '--count', from + '..' + to]));
  if (!Number.isFinite(ahead)) throw new Error('could not count ' + from + '..' + to);
  if (ahead === 0) return { ahead, oldestAt: null };
  const times = git(repo, ['log', '--first-parent', '--format=%ct', from + '..' + to]).split('\n').map(Number).filter(Number.isFinite);
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
    const st = waiting(repo, ptrs.prod.sha, ptrs.staging.sha);
    /* A cut straight to prod (tools/release.sh's default channel) leaves staging BEHIND prod: prod
       holds everything staging does and more. Main is then measured against prod, the newest build
       anyone has, or shipped work would be reported as waiting until someone cut staging just to
       quiet the alarm (review 13). Otherwise (staging at or ahead of prod) against staging. */
    let prodAhead = false;
    if (st.ahead === 0 && ptrs.prod.sha !== ptrs.staging.sha) {
      try { git(repo, ['merge-base', '--is-ancestor', ptrs.staging.sha, ptrs.prod.sha]); prodAhead = true; } catch { prodAhead = false; }
    }
    const mainBase = prodAhead ? ptrs.prod.sha : ptrs.staging.sha;
    const v = verdict({ main: waiting(repo, mainBase, 'origin/main'), staging: { ahead: st.ahead, builtAt: ptrs.staging.builtAt }, now });
    return Object.assign(v, { now, prodVersion: ptrs.prod.version, stagingVersion: ptrs.staging.version, prodAhead });
  } catch (err) {
    return { now, unknown: true, alarm: false, reasons: [], why: String((err && err.message) || err) };
  }
}

function statePath() {
  return env.GAP_ALARM_STATE || path.join(os.homedir(), '.cache', 'kosmos-gap-alarm', 'state.json');
}
function readState() { try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return null; } }
/* Atomic (a crash mid-write cannot leave a half file), and never fatal: the posts already went, so
   a state that cannot be recorded is said, not a crashed run. A one-off failure costs one repost; a
   lasting one is caught before posting by stateProblem() and posts at most once a day. */
function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    const tmp = statePath() + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s) + '\n');
    // A rename that fails must not leave the pid-named file behind: one per failed hour, forever.
    try { fs.renameSync(tmp, statePath()); } catch (err) { try { fs.unlinkSync(tmp); } catch { /* gone already */ } throw err; }
  } catch (err) {
    process.stderr.write('gap-alarm: posted, but could not record it (' + ((err && err.message) || err) + '); the next run may repost\n');
  }
}

/* The channels that are due, best effort; returns which of them went, per channel ({pane, card}).
   Each channel keeps its own clock (main), so one channel's delivery never counts as the other's:
   a failing card comment keeps retrying hourly even while the pane is told (review 4). PATH is the
   caller's (the plist sets it for launchd); it is never rewritten here, so whatever is first on PATH
   is what runs. Under the test runner only through seams a test supplies, so no test can message a
   real pane or comment on the real card. */
function post(text, want = { pane: true, card: true }) {
  const underTest = !!env.NODE_TEST_CONTEXT;
  const went = { pane: false, card: false };
  const tried = { pane: false, card: false };
  const unsure = { pane: false, card: false };
  const to = env.GAP_ALARM_TO || 'barondraxum-discord:0.0';
  let paneFailed = null;
  let paneUnsure = null;
  const msgCmd = env.GAP_ALARM_MSG_CMD || (underTest ? null : path.join(os.homedir(), '.claude', 'scripts', 'claude-msg'));
  if (want.pane && msgCmd) {
    tried.pane = true;
    try {
      // claude-msg refuses without $TMUX, which a launchd job never has: point it at the default
      // tmux server socket, as the fleet's slack relay does (the other fields are unused by -t).
      const tmux = env.TMUX || (env.TMUX_TMPDIR || '/tmp') + '/tmux-' + process.getuid() + '/default,0,0';
      execFileSync(msgCmd, [to, '-'], {
        input: '=== HEADS-UP ===\nfrom: gap-alarm (launchd)\nto:   release owner\n\n' + text + '\n=== END HEADS-UP ===\n',
        // Above claude-msg's own worst case (a 30 s lock wait, then the paste and its checks), so it
        // is never killed between pasting and pressing Enter.
        stdio: ['pipe', 'ignore', 'pipe'], timeout: 90000,
        env: Object.assign({}, env, { TMUX: tmux }),
      });
      went.pane = true;
    } catch (err) {
      // Exit 8 is claude-msg's known false negative (#1909): the recipient was busy and the message
      // usually did land. Counted as told FOR THE PANE ONLY (the card keeps its own clock), and said
      // on the card as uncertain, never as "did not go", so a busy pane is not re-messaged every hour.
      // Exit 7 is the same class: delivered but the pane did not repaint, so it could not confirm.
      if (err && (err.status === 8 || err.status === 7)) {
        went.pane = true;
        unsure.pane = true;
        paneUnsure = 'claude-msg exit ' + err.status + ', which usually means the pane was busy and the message landed (#1909)';
        process.stderr.write('gap-alarm: the pane message to ' + to + ' may not have gone: ' + paneUnsure + '\n');
      } else {
        paneFailed = String((err && err.stderr && String(err.stderr).trim()) || (err && err.message) || err).split('\n')[0];
        process.stderr.write('gap-alarm: the pane message to ' + to + ' did not go: ' + paneFailed + '\n');
      }
    }
  }
  const ghCmd = env.GAP_ALARM_GH_CMD || (underTest ? null : 'gh');
  if (want.card && ghCmd) {
    tried.card = true;
    try {
      // A pane message that did not go is said on the card, so the one channel is never silently lost.
      const body = paneFailed ? text + '\n\n(The pane message to ' + to + ' did not go: ' + paneFailed + ')'
        : paneUnsure ? text + '\n\n(The pane message to ' + to + ' may not have gone: ' + paneUnsure + ')' : text;
      execFileSync(ghCmd, ['issue', 'comment', env.GAP_ALARM_ISSUE || '1050', '--repo', 'joshualeestone/kosmos', '--body', body], {
        stdio: ['ignore', 'ignore', 'pipe'], timeout: 30000,
      });
      went.card = true;
    } catch (err) {
      // gh's own first stderr line says why (auth, keychain, network); err.message would echo the body.
      const why = String((err && err.stderr && String(err.stderr).trim()) || (err && err.code) || 'exit ' + (err && err.status)).split('\n')[0];
      process.stderr.write('gap-alarm: the #1050 comment did not go: ' + why + '\n');
    }
  }
  return { went, tried, unsure };
}

/* The last post per channel. A state file from before per-channel clocks ({key, at}) is read as both
   channels, so an installed alarm does not repost everything on its first run after an upgrade. */
const CHANNELS = ['pane', 'card'];
function lastFor(state, ch, now) {
  if (!state || typeof state !== 'object') return null;
  let last = null;
  if (state[ch] && typeof state[ch] === 'object') last = state[ch];
  else if (typeof state.key === 'string') last = { key: state.key, at: state.at };
  if (!last) return null;
  /* A stored time in the future (a clock that ran fast when it was written), zero or junk counts as
     long ago, so the channel is due now: otherwise now - at stays negative and a standing alarm, a
     retry or the weekly line is silent until the wall clock catches up (review 11). */
  const sane = (t) => (Number.isFinite(Number(t)) && Number(t) > 0 && Number(t) <= now ? Number(t) : 0);
  const out = Object.assign({}, last);
  if ('at' in out) out.at = sane(out.at);
  if ('failedAt' in out) out.failedAt = sane(out.failedAt);
  return out;
}

/* Can this run keep its state? A state that cannot be written makes every run a first run (a post
   every hour) and restarts every could-not-tell spell (never said) (review 11). null when it can,
   else the reason. The probe writes beside the state file, as writeState does. */
function stateProblem() {
  try {
    const p = statePath();
    if (fs.existsSync(p) && !fs.statSync(p).isFile()) return p + ' is not a file';
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const probe = p + '.probe.' + process.pid;
    fs.writeFileSync(probe, '');
    // Only a failed WRITE means the state cannot be kept; a failed cleanup is not that (review 12).
    try { fs.unlinkSync(probe); } catch { /* removed already, or locked for a moment */ }
    return null;
  } catch (err) { return String((err && err.message) || err); }
}

function xml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/* The node the job runs: an explicit path (launchd's PATH is minimal, and a bare interpreter is a
   different subject for macOS privacy grants), preferring the stable Homebrew link over the running
   binary's Cellar path, which an upgrade deletes. */
function stableNode() {
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return process.execPath;
}
/* The LaunchAgent, hourly. */
function plist({ node = stableNode(), script = path.resolve(__filename), home = os.homedir() } = {}) {
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
  // A linked worktree is removed after merge, and the job would then point at nothing.
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
  const v = await gather();
  const code = v.unknown ? 2 : v.alarm ? 1 : 0;
  if (argv.includes('--check')) { process.stdout.write(JSON.stringify(v) + '\n'); return code; }
  /* No state to keep: say it at most once a day, in one fixed hour of the UTC day, and name the
     problem, rather than every hour (and rather than never, for a could-not-tell). With no state a
     wall-clock gate is the only memory left. The job runs every 3600 s from when it loaded, so
     exactly one run falls in any one-hour window while the Mac is awake; a Mac asleep through that
     hour misses that day, and a wake that runs a missed interval at once can land two runs in it.
     Accepted: this is a degraded mode that exists to be noticed and fixed (review 12). */
  const noState = stateProblem();
  if (noState && v.now % 86400 >= 3600) {
    process.stderr.write('gap-alarm: cannot keep state (' + noState + '); posting only in the first hour of the UTC day\n');
    return code;
  }
  const state = noState ? null : readState();
  // A stamp in the future (a clock that jumped when the spell began) or junk is a fresh spell:
  // otherwise v.now - unknownSince stays negative and could-not-tell is never said (review 10).
  const since = state ? Number(state.unknownSince) : NaN;
  const unknownSince = v.unknown ? (Number.isFinite(since) && since > 0 && since <= v.now ? since : v.now) : null;
  if (!noState && v.unknown && v.now - unknownSince < UNKNOWN_GRACE_S) {
    // Not yet: record the run and when this spell began, and say nothing.
    writeState({ pane: lastFor(state, 'pane', v.now), card: lastFor(state, 'card', v.now), lastRunAt: v.now, unknownSince });
    return code;
  }
  const next = {};
  const due = {};
  for (const ch of CHANNELS) {
    const last = lastFor(state, ch, v.now);
    next[ch] = last;
    const d = decidePost(v, last, v.now);
    due[ch] = d;
    // Nothing to say, but a new resting key (clear after clear, say) is recorded without a post.
    if (!d.post && (!last || last.key !== d.key)) { next[ch] = { key: d.key, at: v.now }; }
  }
  // Proof of life on the card: clear, and the card last said something a week or more ago.
  const cardLast = next.card;
  if (!due.card.post && due.card.key === 'clear' && cardLast && cardLast.key === 'clear' && v.now - (cardLast.at || 0) >= WATCHING_S) {
    due.card = { post: 'watching', key: 'clear' };
  }
  /* One text for both channels when they agree on what to say (the usual case); otherwise each its
     own, since what a channel says depends on what IT last said (an all-clear after its own unknown). */
  const texts = {};
  for (const ch of CHANNELS) {
    if (!due[ch].post) continue;
    const last = lastFor(state, ch, v.now);
    // Backoff: the same message failed on this channel less than RETRY_S ago.
    if (last && last.failedKey === due[ch].key && v.now - (last.failedAt || 0) < RETRY_S) continue;
    texts[ch] = message(due[ch].post, Object.assign({}, v, { after: last && last.key }))
      + (noState ? ' (The alarm cannot keep its state at ' + statePath() + ': ' + noState + '. It says this once a day until that is fixed.)' : '');
  }
  const sendAt = [...new Set(Object.values(texts))];
  for (const text of sendAt) {
    const want = { pane: texts.pane === text, card: texts.card === text };
    const { went, tried, unsure } = post(text, want);
    for (const ch of CHANNELS) {
      if (!want[ch]) continue;
      // A channel's clock advances only on its OWN post that went, or a dead channel would count as
      // told. A post that was TRIED and failed records the failure (for the backoff) and keeps the
      // last success; a channel with no command was not tried and records nothing.
      if (went[ch]) { next[ch] = { key: due[ch].key, at: v.now }; }
      else if (tried[ch]) {
        const keep = next[ch] ? { key: next[ch].key, at: next[ch].at } : {};
        next[ch] = Object.assign(keep, { failedKey: due[ch].key, failedAt: v.now });
      }
    }
    // The log says what went, after it went.
    const sentTo = CHANNELS.filter((ch) => want[ch] && went[ch]).map((ch) => (unsure[ch] ? ch + ' (unconfirmed)' : ch));
    process.stdout.write(new Date(v.now * 1000).toISOString() + ' ' + (sentTo.length ? 'posted to ' + sentTo.join(' and ') : 'posted NOWHERE') + ': ' + text + '\n');
  }
  // Every run writes, so lastRunAt shows the job is alive (review 7).
  writeState({ pane: next.pane, card: next.card, lastRunAt: v.now, unknownSince });
  return code;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (err) => {
    process.stderr.write('gap-alarm: ' + ((err && err.stack) || err) + '\n');
    process.exitCode = 2;
  });
}

module.exports = { verdict, decidePost, message, plist, waiting, gather, main, THRESHOLDS, LABEL };
