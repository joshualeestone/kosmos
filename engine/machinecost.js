'use strict';
/**
 * #7978 item 1: what each agent's processes hold on this computer, for the board to show. Show only: nothing here stops
 * or changes a process. A leftover shell held about 6.5 GB and a full core for 14 days with nobody seeing it.
 *
 * Keyed by the RAW tmux session (angel-discord, or ava+qa in a named world), which is what the supervisor exports and tmux
 * lists. A status row's `sessionName` is that name with those parts stripped; its `session` is this key.
 *
 * WHICH PROCESSES ARE AN AGENT'S.
 *   1. Its pane's process tree. By tree and not by terminal: measured on a real board 11-04, an agent's tool children are
 *      mostly not on its terminal (1468 MB by tree, 405 MB by terminal).
 *   2. A process whose parent died, so it is in no tree, and whatever runs under it. That may be the very leak this exists
 *      for. It still carries KOSMOS_AGENT_SESSION from the pane it was born in (agent-supervisor.sh), which names the agent
 *      with no guessing. Only large ones are asked, by the whole subtree: a small wrapper can hold a large child.
 *      A process that names nobody is not an agent's (a browser, the person's own apps) and is never shown.
 *      🛑 NEVER KOSMOS ITSELF. The page names this process and asks whether it is still needed, so the board, anything above
 *      it, the tunnel and tmux are never candidates, and on a Mac neither is anything launchd runs (a supervisor, another
 *      Kosmos's board, a scheduled job): if that list cannot be read, the folder clue is not used. tmux above all: it is parentless and every pane is its child, so by subtree
 *      it is the largest "leftover" on the computer, and one agent would be charged for all of them. A subtree also stops
 *      at any pane's tree, for the same reason.
 *   3. 🛑 macOS HIDES THE ENVIRONMENT OF ITS OWN BINARIES. Measured 11-04: `ps -E` returned the variable for node and a
 *      Homebrew python and NOTHING for /bin/bash, /bin/zsh, /bin/sh and /bin/sleep. So a leftover SHELL, the case that
 *      prompted this, could never be named that way, and a table-driven test would not have seen it. ONLY when the
 *      environment is truly hidden, the clue is the working folder: inside exactly one agent's pane folder. An environment
 *      that reads and lacks the variable means not an agent's, wherever it sits: another Kosmos's board started from an
 *      agent's folder is exactly that. Weaker than a name, so it is marked (how: 'folder') per process. A shell that changed
 *      folder is not found: a stated limit. A pane in the home folder or above it is no clue, since it would claim everything.
 *      `comm` is argv0, so a path cannot tell hidden from not (measured: a bash from PATH reads `bash`): `ps -E` is compared
 *      with plain `ps`, and nothing past the arguments means hidden. That also stops an argument posing as the variable.
 *
 * 🔑 THE ENVIRONMENT IS READ FOR ONE NAME AND THEN DROPPED. An environment holds keys. Nothing else in it is kept, logged
 * or returned. `ps -E` prints the arguments first, so the LAST match is the environment's.
 *
 * 🔑 NEVER ON THE BOARD'S THREAD. Everything runs through async execFile on its own timer, and readers get the last
 * finished sample. A blocking `ps` here would be the stall #7693 measures. A status read never starts one.
 *
 * 🔑 THE LOCALE. ps gets LC_ALL=C, since some locales print its CPU figure with a comma. tmux must NOT: outside a pane,
 * without a UTF-8 locale, it turns the format's tabs into underscores (status.js says so; measured here too: 0 of 20
 * panes parsed), and from inside a pane it does not, so any run from a terminal looks fine. `-u` makes it hold anyway.
 *
 * Linux: orphans go to the nearest subreaper, so a parent that is `systemd --user` counts as no parent. pcpu there is a
 * lifetime average. Not on Windows: there is no tmux or ps, so `read` answers null and the page shows nothing.
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const SAMPLE_MS = 60000;
const CMD_TIMEOUT_MS = 10000;
// Large enough to ask a parentless process whose it is. Below this a leftover is not what anyone is looking for.
const LEFT_MIN_KB = 200 * 1024;
const LEFT_MIN_CPU = 25;
const LEFT_MAX_ASKED = 12;   // a child process or two each: a bound, on a machine that may already be struggling
const ASK_BUDGET_MS = 30000; // and a shared limit: a sample that takes minutes would outlive read's three rounds and blank every card
const SESSION_IN_ENV = /(?:^|\s)KOSMOS_AGENT_SESSION=(\S+)/g;
const NO_SERVER = /no server running|error connecting/i;   // not "server exited": with a socket on disk that is a version wall, not an empty server (status.js)
const PANE_LIST = '#{session_name}\t#{pane_pid}\t#{pane_current_path}';
const PS_ARGS = ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'rss=', '-o', 'pcpu=', '-o', 'etime=', '-o', 'comm='];

/* The columns in PS_ARGS. comm can hold spaces, so it is the last field. */
function parsePs(text) {
  const procs = new Map();
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    procs.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), cpu: Number(m[4]), etime: m[5], comm: m[6] });
  }
  return procs;
}

/* PANE_LIST's output. A session can have several panes: all of them count. The folder is last, and can hold spaces. */
function parsePanes(text) {
  const panes = new Map();
  for (const line of String(text || '').split('\n')) {
    const m = /^([^\t]+)\t(\d+)(?:\t(.*))?$/.exec(line);
    if (!m) continue;
    if (!panes.has(m[1])) panes.set(m[1], []);
    panes.get(m[1]).push(Number(m[2]));
  }
  return panes;
}
/* session -> its panes' folders, leaving out the home folder and the root, which would claim everything. */
function parseFolders(text, home) {
  const folders = new Map();
  const h = String(home || '').replace(/\/+$/, '');
  const skips = (dir) => dir === '/' || dir === h || h.startsWith(dir + '/');   // the home folder or above it
  for (const line of String(text || '').split('\n')) {
    const m = /^([^\t]+)\t\d+\t(.+)$/.exec(line);
    if (!m) continue;
    const dir = m[2].replace(/\/+$/, '');
    if (!dir || skips(dir)) continue;
    if (!folders.has(m[1])) folders.set(m[1], new Set());
    folders.get(m[1]).add(dir);
  }
  return folders;
}
/* The one session whose folder holds this one, the deepest if nested. Two at that depth, or none: nobody, no guessing. */
function sessionForFolder(cwd, folders) {
  const c = String(cwd || '').replace(/\/+$/, '');
  if (!c) return null;
  let best = [];
  let bestLen = -1;
  for (const [session, dirs] of folders) {
    for (const dir of dirs) {
      if (c !== dir && !c.startsWith(dir + '/')) continue;
      if (dir.length > bestLen) { best = [session]; bestLen = dir.length; } else if (dir.length === bestLen && !best.includes(session)) best.push(session);
    }
  }
  return best.length === 1 ? best[0] : null;
}

/* ps's elapsed time, [[dd-]hh:]mm:ss, in whole days. Null when it is not that shape. */
function daysOf(etime) {
  const m = /^(?:(\d+)-)?(?:\d+:)?\d+:\d+$/.exec(String(etime || ''));
  return m ? Number(m[1] || 0) : null;
}

/* The program's name, without its folder: a path can name a person. */
function nameOf(comm) {
  const s = String(comm || '').replace(/^-/, '');
  return s.split('/').filter(Boolean).pop() || '';
}

function processKids(procs) {
  const kids = new Map();
  for (const p of procs.values()) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p.pid);
  }
  return kids;
}

/* Every process under these roots, each once, not going into `stop`. A table read in one shot can hold a recycled parent,
   so a cycle must end. */
function under(roots, procs, kids, stop) {
  const seen = new Set(stop || []);
  const out = [];
  const stack = [...roots];
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const p = procs.get(pid);
    if (p) out.push(p);
    for (const k of kids.get(pid) || []) stack.push(k);
  }
  return out;
}

/* A parent gone: init, or on Linux a user's systemd, which adopts orphans. Apps a person opened are not asked about. */
function parentless(p, procs) {
  if (p.ppid === 1) return true;
  const parent = procs.get(p.ppid);
  return Boolean(parent) && nameOf(parent.comm) === 'systemd';
}
function isSystemApp(comm) { return /^\/(?:System|Applications|Library)\//.test(String(comm || '')); }
/* tmux's server names itself "tmux: server" on some builds, so the first word decides. */
function isKosmosItself(p, selfChain) {
  if (selfChain.has(p.pid)) return true;
  const name = nameOf(p.comm).split(/[\s:]/)[0];
  return name === 'tmux' || name === 'kosmos-tunnel';
}
/* This process and everything above it. */
function chainOf(pid, procs) {
  const chain = new Set();
  let at = pid;
  while (at && !chain.has(at)) { chain.add(at); const p = procs.get(at); at = p ? p.ppid : 0; }
  return chain;
}

/* The parentless processes worth asking about, largest subtree first: nobody's tree holds them. Each carries its subtree's
   size, so a 2 MB shell wrapping a 6 GB child is asked about. */
function leftCandidates(procs, inTrees, selfPid = process.pid) {
  const kids = processKids(procs);
  const selfChain = chainOf(selfPid, procs);
  const out = [];
  for (const p of procs.values()) {
    if (p.pid === 1 || inTrees.has(p.pid) || !parentless(p, procs) || isSystemApp(p.comm) || nameOf(p.comm) === 'systemd' || isKosmosItself(p, selfChain)) continue;
    const rows = under([p.pid], procs, kids, inTrees);
    const kb = rows.reduce((n, r) => n + r.rssKb, 0);
    const cpu = rows.reduce((n, r) => n + r.cpu, 0);
    if (kb >= LEFT_MIN_KB || cpu >= LEFT_MIN_CPU) out.push({ pid: p.pid, comm: p.comm, kb, cpu });
  }
  return out.sort((a, b) => b.kb - a.kb).slice(0, LEFT_MAX_ASKED);
}

function brief(p, how) {
  return { name: nameOf(p.comm), memMb: Math.round(p.rssKb / 1024), cpuPct: Math.round(p.cpu), days: daysOf(p.etime), pid: p.pid, ...(how ? { how } : {}) };
}

/* One agent's numbers. `left` is the largest process left behind, given on its own because `top` can be something the
   agent is running now, and the page must name it either way. */
function summarize(rows, leftRows) {
  const largest = (list) => list.reduce((a, b) => (!a || b.p.rssKb > a.p.rssKb ? b : a), null);
  const top = largest(rows.map((p) => ({ p })));
  const left = largest(leftRows);
  return {
    memMb: Math.round(rows.reduce((n, p) => n + p.rssKb, 0) / 1024),
    cpuPct: Math.round(rows.reduce((n, p) => n + p.cpu, 0)),
    processes: rows.length,
    leftMemMb: Math.round(leftRows.reduce((n, r) => n + r.p.rssKb, 0) / 1024),
    top: top ? brief(top.p) : null,
    left: left ? brief(left.p, left.how) : null,
  };
}

/**
 * Pure: raw session -> numbers. `leftOwners` is pid -> { session, how } for the parentless processes that named one (how is
 * 'folder' when only the folder did). A left-behind process and whatever runs under it are that agent's too, counted once.
 */
function costBySession(panes, procs, leftOwners) {
  const kids = processKids(procs);
  const out = {};
  const owners = leftOwners || new Map();
  const inPanes = new Set(under([...panes.values()].flat(), procs, kids).map((p) => p.pid));
  const sessions = new Set([...panes.keys(), ...[...owners.values()].map((o) => o.session)]);
  for (const session of sessions) {
    const leftRows = [];
    const counted = new Set();
    for (const [pid, o] of owners) {
      if (o.session !== session) continue;
      for (const p of under([pid], procs, kids, inPanes)) {
        if (!counted.has(p.pid)) { counted.add(p.pid); leftRows.push({ p, how: o.how }); }
      }
    }
    const seen = new Set();
    const rows = [...under(panes.get(session) || [], procs, kids), ...leftRows.map((r) => r.p)].filter((p) => !seen.has(p.pid) && seen.add(p.pid));
    if (rows.length) out[session] = summarize(rows, leftRows);
  }
  return out;
}

/* A command's output, or null when it failed. Answers by its own timer too: execFile's callback waits for the pipes to
   close, so a child stuck on a dead mount could otherwise end sampling for good. */
function runDetail(cmd, args, execImpl, env) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => done({ out: null, err: 'timed out' }), CMD_TIMEOUT_MS + 2000);
    if (timer.unref) timer.unref();
    try {
      (execImpl || execFile)(cmd, args, { encoding: 'utf8', timeout: CMD_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, env: env || process.env },
        (err, stdout, stderr) => done(err ? { out: null, err: String(stderr || '') } : { out: String(stdout), err: '' }));
    } catch { done({ out: null, err: 'could not start' }); }
  });
}
const CENV = () => ({ ...process.env, LC_ALL: 'C' });

/* What a process's environment says: { session, hidden }. session is the one variable or null, and nothing else leaves this
   function. hidden: the environment could not be read at all, which is the only case the folder clue is for. */
async function askEnv(pid, deps) {
  const d = deps || {};
  const platform = d.platform || process.platform;
  try {
    if (platform !== 'linux') {
      const [plain, withEnv] = await Promise.all([
        runDetail('ps', ['-ww', '-o', 'command=', '-p', String(pid)], d.exec, CENV()),
        runDetail('ps', ['-Eww', '-o', 'command=', '-p', String(pid)], d.exec, CENV()),
      ]);
      const a = String(plain.out || '').replace(/\s+$/, '');
      const b = String(withEnv.out || '').replace(/\s+$/, '');
      // No read, or the process changed between the two: nothing is known, so nobody is named and no folder is guessed.
      if (!a || !b.startsWith(a)) return { session: null, hidden: false };
      const env = b.slice(a.length);
      if (!env.trim()) return { session: null, hidden: true };
      const all = [...env.matchAll(SESSION_IN_ENV)];
      return { session: all.length ? all[all.length - 1][1] : null, hidden: false };
    }
    return { session: await sessionOfPid(pid, d), hidden: false };
  } catch { return { session: null, hidden: false }; }
}

/* The variable alone. Linux reads it from /proc, where every process of this user's can be read. */
async function sessionOfPid(pid, deps) {
  const d = deps || {};
  const platform = d.platform || process.platform;
  if (platform !== 'linux') return (await askEnv(pid, d)).session;
  try {
    const read1 = (d.readFile || fs.promises.readFile)(`/proc/${pid}/environ`, 'utf8');
    let cap;
    const text = await Promise.race([read1, new Promise((r) => { cap = setTimeout(() => r(''), CMD_TIMEOUT_MS); if (cap.unref) cap.unref(); })]);
    clearTimeout(cap);
    const m = /(?:^|\0)KOSMOS_AGENT_SESSION=([^\0]+)/.exec(text);
    return m ? m[1] : null;
  } catch { return null; }
}

/* The pids launchd runs on a Mac, or null when the list could not be read. `launchctl list`: pid, status, label. */
async function launchdPids(deps) {
  const { out } = await runDetail('launchctl', ['list'], (deps || {}).exec, CENV());
  if (out === null) return null;
  const pids = new Set();
  for (const line of out.split('\n')) {
    const m = /^(\d+)\s/.exec(line);
    if (m) pids.add(Number(m[1]));
  }
  return pids;
}

/* A process's working folder, or null. */
async function cwdOfPid(pid, deps) {
  const { out } = await runDetail('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], (deps || {}).exec, CENV());
  const m = out ? /^n(.+)$/m.exec(out) : null;
  return m ? m[1] : null;
}

/* One sample: raw session -> numbers, or null when it could not be read: a reading that failed is not "using nothing", and
   a failed tmux must not replace a good sample with one that has no panes. A tmux with no server is a true empty. */
async function sample(deps) {
  const d = deps || {};
  const platform = d.platform || process.platform;
  const tmux = await runDetail(d.tmuxBin || process.env.AGENT_WORKFORCE_TMUX_BIN || 'tmux', ['-u', 'list-panes', '-a', '-F', PANE_LIST], d.exec);
  if (tmux.out === null && !NO_SERVER.test(tmux.err)) return null;
  const ps = await runDetail('ps', PS_ARGS, d.exec, CENV());
  if (ps.out === null) return null;
  const panes = parsePanes(tmux.out);
  const procs = parsePs(ps.out);
  const inTrees = new Set(under([...panes.values()].flat(), procs, processKids(procs)).map((p) => p.pid));
  const folders = parseFolders(tmux.out, d.home === undefined ? os.homedir() : d.home);
  const leftOwners = new Map();
  const askUntil = Date.now() + (d.askBudgetMs || ASK_BUDGET_MS);
  const jobs = platform === 'darwin' ? await launchdPids(d) : null;
  for (const c of leftCandidates(procs, inTrees, d.selfPid)) {
    if (Date.now() > askUntil) break;   // the largest were asked first; the rest wait for the next sample
    if (jobs && jobs.has(c.pid)) continue;
    const said = await askEnv(c.pid, d);
    if (said.session) { leftOwners.set(c.pid, { session: said.session, how: null }); continue; }
    if (!said.hidden || platform !== 'darwin' || !jobs) continue;
    const inFolder = sessionForFolder(await cwdOfPid(c.pid, d), folders);
    if (inFolder) leftOwners.set(c.pid, { session: inFolder, how: 'folder' });
  }
  return costBySession(panes, procs, leftOwners);
}

let last = null;
let lastAt = 0;
let running = false;

async function tick(deps) {
  if (running) return;   // never two at once: on a struggling machine a sample can outlast the interval
  running = true;
  try {
    const got = await sample(deps);
    if (got) { last = got; lastAt = (deps && deps.now ? deps.now() : Date.now()); }
  } catch { /* a missed sample costs a line on a card */ } finally { running = false; }
}

/* The board only (server.js). unref'd, so it never keeps a stopping board alive. */
function start(deps) {
  if ((deps && deps.platform || process.platform) === 'win32') return null;
  tick(deps);
  const timer = setInterval(() => { tick(deps); }, SAMPLE_MS);
  if (timer.unref) timer.unref();
  return timer;
}

/* What the page gets for one agent, by its raw session: the last sample, or null. Older than three rounds is not now. */
function read(session, now) {
  if (!last || (now === undefined ? Date.now() : now) - lastAt > 3 * SAMPLE_MS) return null;
  return Object.prototype.hasOwnProperty.call(last, session) ? last[session] : null;
}

/* The same for an agent with no session (a not-running row has only its name): what it left behind, if anything. nameOf
   is launchidentity.agentNameFromSession bound to this board's world, so another Kosmos's same-named agent is not it. */
function readAgent(name, sessionToName, now) {
  if (!last) return null;
  for (const session of Object.keys(last)) {
    if (sessionToName(session) === name) return read(session, now);
  }
  return null;
}

function resetForTest() { last = null; lastAt = 0; running = false; }

module.exports = { PANE_LIST, PS_ARGS, parseFolders, sessionForFolder, cwdOfPid, askEnv, launchdPids, parsePs, parsePanes, daysOf, nameOf, leftCandidates, costBySession, sessionOfPid, sample, tick, start, read, readAgent, resetForTest, SAMPLE_MS, LEFT_MIN_KB, LEFT_MIN_CPU, LEFT_MAX_ASKED };
