'use strict';
/**
 * #7978 item 1: what each agent's processes hold on this computer, for the board to show. Show only: nothing here stops
 * or changes a process. A leftover shell held about 6.5 GB and a full core for 14 days with nobody seeing it.
 *
 * WHICH PROCESSES ARE AN AGENT'S.
 *   1. Its pane's process tree. By tree and not by terminal: measured on a real board 11-04, an agent's tool children are
 *      mostly not on its terminal (1468 MB by tree, 405 MB by terminal).
 *   2. A process left behind, whose parent died, so it hangs off init and is in no tree. That may be the very leak this
 *      exists for. It still carries KOSMOS_AGENT_SESSION from the pane it was born in (agent-supervisor.sh), which names
 *      the agent with no guessing. Only large ones are asked, since reading an environment costs a process each.
 *      A process with no such variable is not an agent's (a browser, the person's own apps) and is never shown.
 *   3. 🛑 EXCEPT THAT macOS HIDES THE ENVIRONMENT OF ITS OWN BINARIES. Measured 11-04: `ps -E` returned the variable for
 *      node and a Homebrew python and NOTHING for /bin/bash, /bin/zsh, /bin/sh and /bin/sleep. So a leftover SHELL, the
 *      case that prompted this, could never be named that way, and a table-driven test would not have seen it. For those
 *      alone (under /bin or /usr/bin) the clue is the process's working folder: inside exactly one agent's pane folder.
 *      Weaker than a name, so it is marked (how: 'folder'). A shell that changed folder is not found: a stated limit. A
 *      pane sitting in the home folder is no clue, since everything is under it.
 *
 * 🔑 THE ENVIRONMENT IS READ FOR ONE NAME AND THEN DROPPED. An environment holds keys. Nothing else in it is kept, logged
 * or returned, and the regex takes only that one variable's value.
 *
 * 🔑 NEVER ON THE BOARD'S THREAD. Everything runs through async execFile on its own timer, and readers get the last
 * finished sample. A blocking `ps` here would be the stall #7693 measures. A status read never starts one.
 *
 * Not on Windows: there is no tmux or ps there, so `read` answers null and the page shows nothing.
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const SAMPLE_MS = 60000;
const CMD_TIMEOUT_MS = 10000;
// Large enough to ask a parentless process whose it is. Below this a leftover is not what anyone is looking for.
const LEFT_MIN_KB = 200 * 1024;
const LEFT_MIN_CPU = 25;
const LEFT_MAX_ASKED = 12;   // one child process each: a bound, on a machine that may already be struggling
const SESSION_IN_ENV = /(?:^|\s)KOSMOS_AGENT_SESSION=([^\s]+)/;

/* `ps -axo pid=,ppid=,rss=,pcpu=,etime=,comm=`. comm can hold spaces, so it is the last field. */
function parsePs(text) {
  const procs = new Map();
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    procs.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), cpu: Number(m[4]), etime: m[5], comm: m[6] });
  }
  return procs;
}

/* `tmux list-panes -a -F PANE_LIST`. A session can have several panes: all of them count. The folder is last, and can hold spaces. */
const PANE_LIST = '#{session_name}\t#{pane_pid}\t#{pane_current_path}';
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
  const skip = new Set(['/', String(home || '').replace(/\/+$/, '')]);
  for (const line of String(text || '').split('\n')) {
    const m = /^([^\t]+)\t\d+\t(.+)$/.exec(line);
    if (!m) continue;
    const dir = m[2].replace(/\/+$/, '');
    if (!dir || skip.has(dir)) continue;
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
/* A binary macOS hides the environment of. */
function envHidden(comm, platform) { return platform === 'darwin' && /^\/(?:usr\/)?bin\//.test(String(comm || '')); }

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

/* Every process under these roots, each once. A table read in one shot can hold a recycled parent, so a cycle must end. */
function under(roots, procs, kids) {
  const seen = new Set();
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

/* The parentless processes worth asking about, largest first: nobody's tree holds them. */
function leftCandidates(procs, inTrees) {
  return [...procs.values()]
    .filter((p) => p.ppid === 1 && !inTrees.has(p.pid) && (p.rssKb >= LEFT_MIN_KB || p.cpu >= LEFT_MIN_CPU))
    .sort((a, b) => b.rssKb - a.rssKb)
    .slice(0, LEFT_MAX_ASKED);
}

/* One agent's numbers. `left` is the set of pids that were left behind. */
function summarize(rows, left, how) {
  let kb = 0;
  let cpu = 0;
  let leftKb = 0;
  let top = null;
  for (const p of rows) {
    kb += p.rssKb;
    cpu += p.cpu;
    if (left.has(p.pid)) leftKb += p.rssKb;
    if (!top || p.rssKb > top.rssKb) top = p;
  }
  return {
    memMb: Math.round(kb / 1024),
    cpuPct: Math.round(cpu),
    processes: rows.length,
    leftMemMb: Math.round(leftKb / 1024),
    top: top ? { name: nameOf(top.comm), memMb: Math.round(top.rssKb / 1024), cpuPct: Math.round(top.cpu), days: daysOf(top.etime), left: left.has(top.pid), pid: top.pid, ...(left.has(top.pid) && how === 'folder' ? { how } : {}) } : null,
  };
}

/**
 * Pure: session name -> numbers. `leftOwners` is pid -> session for the parentless processes whose environment named one.
 * A left-behind process and whatever runs under it are that agent's too, counted once however they are reached.
 */
function costBySession(panes, procs, leftOwners, leftHow) {
  const kids = processKids(procs);
  const out = {};
  const owners = leftOwners || new Map();
  const sessions = new Set([...panes.keys(), ...owners.values()]);
  for (const session of sessions) {
    const roots = panes.get(session) || [];
    const lefts = [...owners].filter(([, s]) => s === session).map(([pid]) => pid);
    const leftRows = under(lefts, procs, kids);
    const leftPids = new Set(leftRows.map((p) => p.pid));
    const rows = under([...roots, ...lefts], procs, kids);
    const byFolder = lefts.length > 0 && lefts.every((pid) => leftHow && leftHow.get(pid) === 'folder');
    if (rows.length) out[session] = summarize(rows, leftPids, byFolder ? 'folder' : null);
  }
  return out;
}

function run(cmd, args, execImpl) {
  return new Promise((resolve) => {
    // LC_ALL=C: some locales print ps's CPU figure with a comma, which would parse as nothing.
    (execImpl || execFile)(cmd, args, { encoding: 'utf8', timeout: CMD_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

/* The one variable, from one process's environment, or null. Nothing else leaves this function. */
async function sessionOfPid(pid, deps) {
  const d = deps || {};
  const platform = d.platform || process.platform;
  try {
    if (platform === 'linux') {
      const text = await (d.readFile || fs.promises.readFile)(`/proc/${pid}/environ`, 'utf8');
      const m = /(?:^|\0)KOSMOS_AGENT_SESSION=([^\0]+)/.exec(text);
      return m ? m[1] : null;
    }
    const text = await run('ps', ['-Eww', '-o', 'command=', '-p', String(pid)], d.exec);
    const m = text ? SESSION_IN_ENV.exec(text) : null;
    return m ? m[1] : null;
  } catch { return null; }
}

/* A process's working folder, or null. */
async function cwdOfPid(pid, deps) {
  const text = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], (deps || {}).exec);
  const m = text ? /^n(.+)$/m.exec(text) : null;
  return m ? m[1] : null;
}

/* One sample: session -> numbers, or null when it could not be read (a reading that failed is not "using nothing"). */
async function sample(deps) {
  const d = deps || {};
  const platform = d.platform || process.platform;
  const panesText = await run(d.tmuxBin || process.env.AGENT_WORKFORCE_TMUX_BIN || 'tmux', ['list-panes', '-a', '-F', PANE_LIST], d.exec);
  const psText = await run('ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,etime=,comm='], d.exec);
  if (psText === null) return null;
  const panes = parsePanes(panesText);
  const procs = parsePs(psText);
  const kids = processKids(procs);
  const inTrees = new Set(under([...panes.values()].flat(), procs, kids).map((p) => p.pid));
  const folders = parseFolders(panesText, d.home === undefined ? os.homedir() : d.home);
  const leftOwners = new Map();
  const leftHow = new Map();
  for (const p of leftCandidates(procs, inTrees)) {
    if (envHidden(p.comm, platform)) {
      const session = sessionForFolder(await cwdOfPid(p.pid, d), folders);
      if (session) { leftOwners.set(p.pid, session); leftHow.set(p.pid, 'folder'); }
      continue;
    }
    const session = await sessionOfPid(p.pid, d);
    if (session) leftOwners.set(p.pid, session);
  }
  return costBySession(panes, procs, leftOwners, leftHow);
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

/* What the page gets for one agent: the last sample, or null. A sample older than three rounds is not offered as now. */
function read(session, now) {
  if (!last || (now === undefined ? Date.now() : now) - lastAt > 3 * SAMPLE_MS) return null;
  return Object.prototype.hasOwnProperty.call(last, session) ? last[session] : null;
}

function resetForTest() { last = null; lastAt = 0; running = false; }

module.exports = { PANE_LIST, parseFolders, sessionForFolder, envHidden, cwdOfPid, parsePs, parsePanes, daysOf, nameOf, leftCandidates, costBySession, sessionOfPid, sample, tick, start, read, resetForTest, SAMPLE_MS, LEFT_MIN_KB, LEFT_MIN_CPU, LEFT_MAX_ASKED };
