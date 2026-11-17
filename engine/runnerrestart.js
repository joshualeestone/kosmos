'use strict';
/*
 * kosmos#8598: restart a running managed Codex agent, at its next idle point, when the runner upgrade (kosmos#8593,
 * server.js runnerUpgradeTick) swapped the managed tree under it and the agent can no longer use code mode.
 *
 * WHY (measured on the card, darwin-arm64, 0.149.1 -> 0.169.0): Codex starts its code-mode host LAZILY, at the first
 * code-mode call, by path from its own install tree. A 0.149.1 process that starts its host AFTER the swap gets the
 * 0.169.0 host, and every code-mode call fails ("unknown field `result_buffered_for_ns`") until the agent restarts. A
 * process whose host was already running before the swap keeps working (its host stays mapped). A swap to the same
 * version works, so the failure is the version mismatch, not the swap. Live model catalogs carry
 * tool_mode code_mode_only on most models (Liu Kang m7607), so code mode is in real use.
 *
 * WHO IS RESTARTED, and only them, because a restart starts the conversation over (remove.restart does not resume):
 *   1. the card is a Codex card of ours, and its pane's Codex process runs from the MANAGED runner folder;
 *   2. the managed tree is in place, not stale, and an upgrade to a DIFFERENT version proved itself (runners.js
 *      upgradeStamp: a same-version repair or a first install leaves no record, so nothing fires; a put-back leaves the
 *      tree stale);
 *   3. that process STARTED BEFORE that upgrade's swap (the record's time), read off the process table, not
 *      remembered: a process started after it already runs the new version;
 *   4. it has NO code-mode host under it that started before the swap: such a host is the old tree's, the measured
 *      safe case, and restarting it would cost its context for nothing. A host started AFTER the swap is the new
 *      tree's, the measured failure, so that agent is restarted too;
 *   5. nothing else runs under it (a background shell job reads idle, and a restart would kill it);
 *   6. it read idle at this pass and the previous one, and again on a fresh roster just before the restart.
 * An agent that has made any tool call on a code-mode model already has its host, so in practice this restarts agents
 * that have done little since they started. The weak spot, named on the card: an agent mid-turn whose FIRST code-mode
 * call comes after the swap still fails until that turn ends; only a folder per version would close it.
 *
 * NOT COVERED: a host that exits and starts again later (an idle timeout, a crash) was not measured; nothing here can
 * predict it. Windows upgrades only while no agent runs from the managed folder (runners.install, kosmos#8593), so no Windows agent is ever left on a swapped tree and this sweep is Mac/Linux only (the caller gates it).
 *
 * Everything it reads or does is injected (passOnce), so it is tested without a board, a process table or tmux.
 */

const path = require('node:path');

const MAX_PER_PASS = 1;   // restarts are spread out: one per pass, a pass a minute
const MAX_TRIES = 3;      // per agent per pin per board run, so a restart that keeps failing is not repeated forever

/** ps etime ("[[dd-]hh:]mm:ss") -> seconds, or null when it is not that shape. */
function etimeSeconds(s) {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(String(s || ''));
  if (!m) return null;
  const [d, h, mi, se] = [m[1], m[2], m[3], m[4]].map((x) => (x === undefined ? 0 : Number(x)));
  if (mi > 59 || se > 59 || h > 23) return null;
  return ((d * 24 + h) * 60 + mi) * 60 + se;
}

/* The one pane listing this sweep reads, and its one parser (server.js passes PANE_FORMAT to `tmux list-panes -a -F`).
   A tab separates the fields because a session name can hold a space. */
const SEP = '\t';
const PANE_FORMAT = ['#{session_name}', '#{window_index}.#{pane_index}', '#{pane_pid}'].join(SEP);
/** PANE_FORMAT lines -> Map keyed by the pane target (`session:window.pane`, as a card's target) and by the session
    (its first pane listed), to the pane's pid. */
function parsePanes(text) {
  const map = new Map();
  for (const line of String(text || '').split('\n')) {
    const m = /^(.+)\t(\d+\.\d+)\t(\d+)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[3]);
    map.set(`${m[1]}:${m[2]}`, pid);
    if (!map.has(m[1])) map.set(m[1], pid);
  }
  return map;
}

/* The process table this sweep reads (server.js runs `ps` with these). -ww: some Linux ps cut a piped line to 80
   columns, which would cut the managed folder's prefix off a long path (review 5). */
const PS_ARGS = ['-ww', '-eo', 'pid=,ppid=,etime=,command='];

/** PS_ARGS output -> Map pid -> { ppid, ageSec, command }. */
function parseProcs(text) {
  const map = new Map();
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const age = etimeSeconds(m[3]);
    if (age === null) continue;
    map.set(Number(m[1]), { ppid: Number(m[2]), ageSec: age, command: m[4] });
  }
  return map;
}

/* The program a command line runs is read against a KNOWN prefix, not as its first word: the managed folder can sit
   under a path with a space in it, which a split on whitespace would cut (review 2). */
function runsProgram(command, prefix, name) {
  const c = String(command || '').trim();
  if (!prefix || !c.startsWith(prefix)) return false;
  // Below the folder the path is Kosmos's own layout (codex, pkg/vendor/<triple>/bin/...), with no space in it.
  const prog = c.slice(prefix.length).split(/\s/)[0];
  return prog.split(/[\\/]/).pop() === name;
}

/**
 * Children of every pid, built once per table. A table read in one shot can hold a recycled pid whose parent link
 * points back into the walk, so the walk below is breadth-first and cycle-guarded.
 */
function childrenOf(procs) {
  const kids = new Map();
  for (const [pid, p] of procs) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(pid);
  }
  return kids;
}

function descendants(root, kids) {
  const out = [];
  const seen = new Set([root]);
  const queue = [root];
  while (queue.length) {
    const pid = queue.shift();
    out.push(pid);
    for (const c of kids.get(pid) || []) if (!seen.has(c)) { seen.add(c); queue.push(c); }
  }
  return out;
}

/* The folder as Kosmos names it and, when they differ, as the filesystem resolves it: Codex finds its vendored host
   through its own resolved path, so a symlink anywhere above the managed folder puts the real path on the host's
   command line (review 7). managedDir may be one path or a list of them. */
function prefixes(managedDir) {
  return (Array.isArray(managedDir) ? managedDir : [managedDir]).filter(Boolean)
    .map((d) => (d.endsWith(path.sep) ? d : d + path.sep));
}
/** True when this command runs a program from the managed Codex folder (the stable link or the tree behind it). */
function isManagedCodex(command, managedDir) {
  return prefixes(managedDir).some((dir) => runsProgram(command, dir, 'codex'));
}

/** The host is started by absolute path from the same folder; matched by its name after the folder (managedDir). */
function isCodeModeHost(command, managedDir) {
  return prefixes(managedDir).some((dir) => runsProgram(command, dir, 'codex-code-mode-host'));
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'ksh', 'tcsh', 'csh']);
/** A shell, by the name of the program its command line starts with (a login shell's leading '-' dropped). */
function isShell(command) {
  const first = String(command || '').trim().split(/\s/)[0] || '';
  return SHELLS.has(first.split(/[\\/]/).pop().replace(/^-/, ''));
}

/**
 * What one agent's pane holds, from one process table: the managed Codex process under the pane (the first found,
 * breadth-first, so the pane's own leader wins over anything it started), when it started, and whether a code-mode
 * host runs under it. null when the pane runs no managed Codex.
 */
function codexUnderPane(panePid, procs, kids, managedDir, nowMs) {
  if (!Number.isInteger(panePid) || !procs.has(panePid)) return null;
  for (const pid of descendants(panePid, kids)) {
    const p = procs.get(pid);
    if (!p || !isManagedCodex(p.command, managedDir)) continue;
    const under = descendants(pid, kids).filter((d) => d !== pid && procs.has(d));
    const hosts = under.filter((d) => isCodeModeHost(procs.get(d).command, managedDir));
    /* A command the agent runs is a SHELL Codex starts (its shell tools run through one); a background one reads idle on
       the card, and a restart would kill it (the hazard engine/automove.js names), so it waits for a pass where none
       runs. Only Codex's own shell children count: a long-lived child that is not a shell (a tool server it keeps for
       the session) would otherwise hold the restart for good (review 3). */
    const job = (kids.get(pid) || []).some((d) => procs.has(d) && isShell(procs.get(d).command));
    // The newest host's start time: one started after the swap is the NEW tree's host, the measured failure.
    const hostStartedAt = hosts.length ? Math.max(...hosts.map((d) => nowMs - procs.get(d).ageSec * 1000)) : null;
    return { pid, startedAt: nowMs - p.ageSec * 1000, host: hosts.length > 0, hostStartedAt, job };
  }
  return null;
}

/*
 * One pass. Never throws. Injected:
 *   roster()            the board's cards (safeRoster)
 *   isIdle(card)        agentnudge.nudgeableCard
 *   seenIdle            a Set kept by the caller: the sessions idle at the previous pass (refilled here)
 *   allowed()           live execution and the brake
 *   managed()           managedState() below: { dir, ready, swappedAt, pin }; null or not ready skips the pass
 *   heldByMove(s)       remove.heldByMove: true leaves the agent to the account move holding it
 *   panes()             Map -> pane pid, keyed by pane target (`session:window.pane`) and by tmux session name
 *   procs()             Map pid -> { ppid, ageSec, command } (parseProcs)
 *   restart(session)    async; resolves { outcome, because } (remove.restartAsync; the card shows it as a plain restart)
 *   reread()            async; { panes, procs, now } read again just before a restart (optional); a changed answer holds it
 *   RESTARTED           remove.OUTCOME.RESTARTED
 *   tried               a Map kept by the caller: `${pin}\t${session}` -> tries. A restart that worked spends them all
 *                       (one per agent per pin per board run); a refused one is tried again, up to MAX_TRIES. A board
 *                       restart empties it; a restarted agent then reads 'already-new', so it is not restarted again
 *   now                 ms (tests)
 * Returns [{ session, act }]: 'restarted' | 'refused' | 'not-idle' | 'has-host' | 'has-job' | 'held-by-move' | 'no-managed-codex' | 'changed' | 'already-new' | 'tried'.
 * A Codex card with no managed Codex under its pane is listed as 'no-managed-codex'.
 */
async function passOnce(o) {
  const out = [];
  try {
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    let roster = null;
    try { roster = o.roster(); } catch { roster = null; }
    const seen = o.seenIdle instanceof Set ? new Set(o.seenIdle) : new Set();
    if (!Array.isArray(roster) || !roster.length) { if (o.seenIdle instanceof Set) o.seenIdle.clear(); return out; }
    const isIdle = (c) => { try { return o.isIdle(c) === true; } catch { return false; } };
    const idleNow = new Set();
    for (const c of roster) if (c && c.sessionName && isIdle(c)) idleNow.add(String(c.sessionName));
    if (o.seenIdle instanceof Set) { o.seenIdle.clear(); for (const s of idleNow) o.seenIdle.add(s); }

    let m = null;
    try { m = o.managed(); } catch { m = null; }
    if (!m || m.ready !== true || !m.dir || (Array.isArray(m.dir) && !m.dir.length) || !Number.isFinite(m.swappedAt)) return out;

    const codexCards = roster.filter((c) => c && c.sessionName && c.isNamedOurs === true && c.runner === 'codex');
    if (!codexCards.length) return out;
    let panes = null; let procs = null;
    try { panes = o.panes(); } catch { panes = null; }
    try { procs = o.procs(); } catch { procs = null; }
    if (!(panes instanceof Map) || !(procs instanceof Map) || !procs.size) return out;
    const kids = childrenOf(procs);
    const tried = o.tried instanceof Map ? o.tried : new Map();
    let used = 0;

    for (const card of codexCards) {
      const session = String(card.sessionName);
      /* The pane the card describes, by its target (the real tmux session and pane), then the real session: the board
         name (sessionName) differs from the tmux session for a legacy agent and on a named-world board (review 3), and
         a tmux session that merely shares the board name is somebody else's (review 5). */
      const panePid = [card.target, card.session].map((k) => (k ? panes.get(String(k)) : undefined)).find((v) => v !== undefined);
      const found = codexUnderPane(panePid, procs, kids, m.dir, now);
      // Not the managed Codex (a person's own codex, or no process): not ours to restart. Said, so a match that never
      // fires (a launch path the prefix does not see) is told from a fleet with nobody on the old version (review 5).
      if (!found) { out.push({ session, act: 'no-managed-codex' }); continue; }
      /* Started after the swap: it runs the new version already. The 1 s slack is ps's etime resolution: a process a
         second either side of the swap is called old, which costs at most one restart, never a missed one. */
      if (found.startedAt > m.swappedAt + 1000) { out.push({ session, act: 'already-new' }); continue; }
      /* A host from before the swap is the old tree's (the safe case); one started after it is the new tree's. Within a
         second of the swap (ps etime's resolution) it cannot be told, so it counts as the new tree's: a restart, never a
         missed one (review 2). */
      if (found.host && found.hostStartedAt < m.swappedAt - 1000) { out.push({ session, act: 'has-host' }); continue; }
      if (found.job) { out.push({ session, act: 'has-job' }); continue; }
      const key = `${m.pin || ''}\t${session}`;
      let held = false;
      if (typeof o.heldByMove === 'function') { try { held = o.heldByMove(session) === true; } catch { held = true; } }
      // An account move holding it restarts it itself; remove.restartAsync does not refuse a held agent (it is the move's path).
      if (held) { out.push({ session, act: 'held-by-move' }); continue; }
      if ((tried.get(key) || 0) >= MAX_TRIES) { out.push({ session, act: 'tried' }); continue; }
      if (!idleNow.has(session) || !seen.has(session)) { out.push({ session, act: 'not-idle' }); continue; }
      if (used >= (Number.isInteger(o.max) ? o.max : MAX_PER_PASS)) break;
      let ok = false;
      try { ok = o.allowed() === true; } catch { ok = false; }
      if (!ok) break;
      // The checks above can be a second old: read the roster again and check THIS card is still idle just before.
      let fresh = null;
      try { fresh = o.roster(); } catch { fresh = null; }
      const now2 = Array.isArray(fresh) ? fresh.find((c) => c && String(c.sessionName) === session) : null;
      if (!now2 || !isIdle(now2)) { out.push({ session, act: 'not-idle' }); continue; }
      /* Review 6: the tables are a few seconds old by now. Read them again for this one agent and act only if the same
         Codex process is still there, still from before the swap, with no shell job and no pre-swap host. */
      if (typeof o.reread === 'function') {
        let again = null;
        try { again = await o.reread(); } catch { again = null; }
        const ap = again && again.panes instanceof Map && again.procs instanceof Map ? again : null;
        const pid2 = ap ? [card.target, card.session].map((k) => (k ? ap.panes.get(String(k)) : undefined)).find((v) => v !== undefined) : undefined;
        const f2 = ap ? codexUnderPane(pid2, ap.procs, childrenOf(ap.procs), m.dir, Number.isFinite(ap.now) ? ap.now : now) : null;
        const same = f2 && f2.pid === found.pid && f2.startedAt <= m.swappedAt + 1000 && !f2.job && !(f2.host && f2.hostStartedAt < m.swappedAt - 1000);
        if (!same) { out.push({ session, act: 'changed' }); continue; }
      }
      tried.set(key, (tried.get(key) || 0) + 1);
      used += 1;
      let r = null;
      try { r = await o.restart(session); } catch (err) { r = { outcome: 'partial', because: String((err && err.message) || err) }; }
      const restarted = r && o.RESTARTED !== undefined && r.outcome === o.RESTARTED;
      if (restarted) tried.set(key, MAX_TRIES);
      out.push({ session, act: restarted ? 'restarted' : 'refused', because: (r && r.because) || null });
    }
  } catch { /* the next pass tries again */ }
  return out;
}

/**
 * The managed Codex as the sweep needs it, from engine/runners.js: { dir, ready, swappedAt, pin } (dir is the folder, or
 * the folder and its resolved path when a symlink makes them differ). ready only when the
 * tree in place is not stale, nothing is installing, and the last proved upgrade replaced a DIFFERENT version with the
 * one now installed. Never throws: anything unreadable is not ready.
 */
function managedState(runners) {
  try {
    const r = runners.resolveBin('openai');
    const stamp = runners.upgradeStamp('openai');
    const installed = runners.installedVersion('openai');
    const named = path.join(runners.managedRoot(), 'openai');
    let real = named;
    try { real = require('node:fs').realpathSync(named); } catch { real = named; }
    const dir = real === named ? named : [named, real];
    const ready = Boolean(r && r.managed === true && r.present === true && r.stale !== true && !runners.installing('openai')
      && stamp && stamp.from && stamp.from !== stamp.to && installed === stamp.to);
    return { dir, ready, swappedAt: stamp ? stamp.at : NaN, pin: stamp ? stamp.to : null };
  } catch { return null; }
}

/**
 * The board's once-a-minute tick (server.js calls makeTick once and runs what it returns). Everything it touches is
 * passed in, so it is tested without a board:
 *   run(cmd, args)  async; stdout, or null when the command failed
 *   roster()        safeRoster        isIdle(card)  agentnudge.nudgeableCard
 *   runners         engine/runners    removal       engine/remove (restartAsync, heldByMove, OUTCOME)
 *   allowed()       live execution and the brake, read at the start and again just before a restart
 *   platform        process.platform  tmuxBin       the tmux to run
 *   write(line)     the board log     warn(line)    the board's warnings
 * Returns the pass's acts (for tests); never throws.
 */
function makeTick(d) {
  const seenIdle = new Set();
  const tried = new Map();
  const said = new Map();   // one key per agent per pin per act, for the board run
  const warned = { tmux: false, ps: false };   // review 7: one per source, so an early tmux miss cannot hide a ps one
  let running = false;
  return async function tick() {
    if (running || d.platform === 'win32') return [];
    let ok = false;
    try { ok = d.allowed() === true; } catch { ok = false; }
    if (!ok) return [];
    running = true;
    try {
      // No Codex card of ours, or no proved upgrade to a different version: nothing to read the process table for.
      let cards = null;
      try { cards = d.roster(); } catch { cards = null; }
      if (!Array.isArray(cards) || !cards.some((c) => c && c.runner === 'codex' && c.isNamedOurs === true)) { seenIdle.clear(); return []; }
      const ms = managedState(d.runners);
      if (!ms || ms.ready !== true) { seenIdle.clear(); return []; }
      const readTables = async () => {
        const now = Date.now();   // before ps, so a process's start time (now minus its age) is never read late
        const pt = await d.run(d.tmuxBin, ['list-panes', '-a', '-F', PANE_FORMAT]);
        const ps = pt === null ? null : await d.run('ps', PS_ARGS);
        return { pt, ps, panes: parsePanes(pt), procs: parseProcs(ps), now };
      };
      const first = await readTables();
      if (first.pt === null && !warned.tmux) { warned.tmux = true; d.warn('[runner-restart] tmux list-panes failed, so no Codex agent can be checked'); }
      if (first.pt !== null && first.ps === null && !warned.ps) { warned.ps = true; d.warn('[runner-restart] ps failed, so no Codex agent can be checked'); }
      const done = await passOnce({
        roster: d.roster, isIdle: d.isIdle, seenIdle, tried,
        allowed: d.allowed,
        managed: () => managedState(d.runners),
        heldByMove: (session) => d.removal.heldByMove(session),
        panes: () => first.panes, procs: () => first.procs, now: first.now,
        reread: readTables,
        // 'restart': the card's word for a plain restart (engine/disruption.js CAUSES); the board line below says why.
        restart: (session) => d.removal.restartAsync(session, 'restart'),
        RESTARTED: d.removal.OUTCOME.RESTARTED,
      });
      for (const a of done) {
        /* A restart or refusal is said each time. An agent held back by a running job, or a Codex card with no managed
           Codex under it, is said the first time and then once an hour while it lasts (60 passes), so a sweep that
           never acts is told from one with nobody to restart (reviews 3 and 5). */
        if (a.act === 'has-job' || a.act === 'no-managed-codex') {
          const key = `${ms.pin}\t${a.session}\t${a.act}`;
          const n = (said.get(key) || 0) + 1;
          said.set(key, n);
          if (n % 60 !== 1) continue;
        } else if (a.act !== 'restarted' && a.act !== 'refused') continue;
        d.write(`runner-restart: ${a.session} ${a.act}${a.because ? ' (' + a.because + ')' : ''}\n`);
      }
      return done;
    } catch (err) {
      try { d.warn(`[runner-restart] ${String((err && err.message) || err)}`); } catch { /* never fatal */ }
      return [];
    } finally { running = false; }
  };
}

module.exports = { makeTick, PANE_FORMAT, PS_ARGS, managedState, passOnce, parsePanes, parseProcs, etimeSeconds, codexUnderPane, childrenOf, isManagedCodex, isCodeModeHost, isShell, MAX_PER_PASS, MAX_TRIES };
