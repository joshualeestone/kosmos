'use strict';

/**
 * kosmos#6362 slice 2: end the processes a test's child left running in the test's own temp folder.
 *
 * Measured on main: `codex exec` leaves its plugin sync (`git fetch --depth 1` into <CODEX_HOME>/.tmp/plugins-clone-*,
 * with index-pack under it, which names the dir too) running after it exits, reparented to init, in Codex's own process
 * group: the test's group in codexhooks-5812 (Codex is not detached there; measured, and review 9 watched a live sync),
 * Codex's detached group in orgchartcodex (reasoned from the same Codex: that leak was not reproduced here). tmpscope then sweeps the dir, the fetch writes again, and the dir "survives its sweep".
 *
 * killUnderScope(): for every process of this test's whose arguments name its tmpscope dir (as the whole path or a path
 * under it), SIGKILL its process group, or, when the group is this test's own, the process and its descendants; then
 * wait (up to `waitMs`) until nothing of them is still running (a zombie is not). Returns how many named processes it
 * found. It searches for this file's tmpscope dir only, read from tmpscope and never from a caller,
 * and acts only on a process that is this test's: its parent chain reaches the test, or it is an orphan tree rooted at
 * pid 1 whose every step names the dir. Not handled: a host that reparents orphans to a subreaper (a Linux systemd
 * --user, say) rather than pid 1; widening the rule to cover one would also take in another agent's shell whose parent
 * sits under pid 1, the worse failure (review 8).
 * Nothing on Windows (no ps); returns 0 when the file has no scope.
 */
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

function listing() {
  // -A, not -e: on a Mac -e adds each process's environment to its line, and a test's children carry TMPDIR=<scope>.
  // -ww: a Linux ps cuts args to an exported COLUMNS, which could cut the scope path off (review 3).
  const r = spawnSync('ps', ['-Awwo', 'pid=,ppid=,pgid=,stat=,args='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 || typeof r.stdout !== 'string') return [];
  const out = [];
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s(.*)$/);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), stat: m[4], args: m[5] });
  }
  return out;
}

/* The dir as a whole path, not part of another name: on either side, anything but a letter, digit, ".", "_" or "-"
   (so a space, tab, quote, colon in a PATH, "=" or "/" bounds it; review 2), and a one-letter option glued to the path
   (-C/path; review 5). Both spellings count, as /var/folders is /private/var/folders on a Mac and a process may carry
   either. */
const NAME_CHAR = /[A-Za-z0-9._-]/;
function names(args, spellings) {
  // Only an absolute path is ever a spelling: '' would loop forever and '.' would name every relative path (review 6).
  return spellings.some((d) => typeof d === 'string' && d.length > 1 && d.startsWith('/') && (() => {
    for (let i = args.indexOf(d); i !== -1; i = args.indexOf(d, i + 1)) {
      // An option glued to the path: -C/path, or combined short options, -xC/path (review 7).
      // Anchored to the start of the arguments or a non-name character, not of a slice (review 9: a dash and 15 letters
      // inside a word read as an option).
      const opt = /(?:^|[^A-Za-z0-9._-])-[A-Za-z]{1,15}$/.test(args.slice(0, i));
      const before = i === 0 || opt ? undefined : args[i - 1];
      const next = args[i + d.length];
      if ((before === undefined || !NAME_CHAR.test(before)) && (next === undefined || !NAME_CHAR.test(next))) return true;
    }
    return false;
  })());
}

/* A group with a process still running in it (a zombie is not running: on Linux it keeps kill(-g, 0) answering until
   its parent reaps it, and a test's own children are reaped only when its event loop runs again; review 2). */
function liveInGroup(g) {
  return listing().some((p) => p.pgid === g && !p.stat.startsWith('Z'));
}

/* The scope only if this file already loaded tmpscope: requiring it here would start one as a side effect (review 3). */
function currentScope() {
  const loaded = require.cache[require.resolve('./tmpscope')];
  return loaded ? loaded.exports.scopeDir() : null;
}

/* This file's own scope, the only dir it ever searches for: nothing is taken from a caller (reviews 5 and 6 each found
   a way past a check on a dir the caller passed, so there is no such dir any more). */
function killUnderScope({ waitMs = 5000 } = {}) {
  const scope = currentScope();
  if (process.platform === 'win32' || !scope || !scope.startsWith('/')) return 0;
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const spellings = [...new Set([scope, real(scope)])];
  const groups = new Set();
  const pids = new Set();
  const counted = new Set();
  /* Repeated until a pass finds nothing new: a process in our own group can fork between the listing and the kill
     (review 7 measured 152 children left by one pass). Five passes at most. */
  for (let pass = 0; pass < 5; pass += 1) {
    const all = listing();
    const own = all.find((p) => p.pid === process.pid);
    if (!own) break;   // without our own group a group kill could reach it
    const byPid = new Map(all.map((p) => [p.pid, p]));
    const named = (p) => names(p.args, spellings);
    /* Ours: its parent chain reaches this test, or it is an orphan tree rooted at init whose every step names the dir
       (the measured git survivors). Not another agent's shell that merely mentions the path while still attached: its
       chain runs through a process that names nothing, up to its own Claude (review 7). One orphaned to init (a nohup'd
       command naming this test's random dir) cannot be told from ours and is treated as ours (review 11). */
    const ours = (p) => {
      // Up the whole chain (review 12: one unnamed hop was the limit): reaching this test counts whatever lies between;
      // reaching init counts only if every step named the dir (an orphan tree of ours, not someone's shell).
      let allNamed = true;
      for (let q = p, hops = 0; q && hops < 64; q = byPid.get(q.ppid), hops += 1) {
        if (q.pid === process.pid || q.ppid === process.pid) return true;
        if (!named(q)) allNamed = false;
        if (q.ppid === 1) return allNamed;
      }
      return false;
    };
    const found = all.filter((p) => p.pid !== process.pid && !counted.has(p.pid) && named(p) && ours(p));
    let fresh = 0;
    for (const p of found) {
      counted.add(p.pid);
      if (p.pgid > 1 && p.pgid !== own.pgid) {
        if (!groups.has(p.pgid)) fresh += 1;
        groups.add(p.pgid); try { process.kill(-p.pgid, 'SIGKILL'); } catch { /* gone */ }
      }
    }
    /* In our own group a group kill would end this test, so the named processes and their descendants, by parent. Each
       is stopped first (SIGSTOP: a stopped process cannot fork), and the tree is listed again until no new descendant
       appears; only then is it killed, so a child forked between a listing and its parent's death cannot be orphaned
       out of reach (review 10 left one that way in three runs). */
    const tree = found.filter((p) => !(p.pgid > 1 && p.pgid !== own.pgid)).map((p) => p.pid);
    if (tree.length) {
      const inTree = new Set(tree);
      for (const pid of tree) { try { process.kill(pid, 'SIGSTOP'); } catch { /* gone */ } }
      for (let round = 0; round < 20; round += 1) {
        let grew = false;
        const now = listing();
        for (let k = 0; k < tree.length; k += 1) {
          for (const c of now) {
            if (c.ppid === tree[k] && c.pid !== process.pid && !inTree.has(c.pid)) {
              inTree.add(c.pid); tree.push(c.pid); grew = true;
              try { process.kill(c.pid, 'SIGSTOP'); } catch { /* gone */ }
            }
          }
        }
        if (!grew) break;
      }
      for (const pid of tree) {
        if (!pids.has(pid)) fresh += 1;
        pids.add(pid); try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
        try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }   // never left stopped, should the kill not land
      }
    }
    if (!fresh) break;
  }
  const running = () => listing().some((p) => !p.stat.startsWith('Z') && (groups.has(p.pgid) || pids.has(p.pid)));
  const until = Date.now() + waitMs;
  while ((groups.size || pids.size) && running() && Date.now() < until) spawnSync('sleep', ['0.05']);
  return counted.size;
}

module.exports = { killUnderScope, names, liveInGroup };
