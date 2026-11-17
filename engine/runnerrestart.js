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
 * predict it. Windows stays on 0.149.1 (Homer's lane), so the sweep is Mac/Linux only (the caller gates it).
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

/** `ps -eo pid=,ppid=,etime=,command=` -> Map pid -> { ppid, ageSec, command }. */
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

/** The program a command line runs: its first word (the managed path has no spaces in the cases measured). */
function argv0(command) {
  return String(command || '').trim().split(/\s+/)[0] || '';
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

/** True when this command runs a program from the managed Codex folder (the stable link or the tree behind it). */
function isManagedCodex(command, managedDir) {
  const prog = argv0(command);
  if (!prog || !managedDir) return false;
  const dir = managedDir.endsWith(path.sep) ? managedDir : managedDir + path.sep;
  return prog.startsWith(dir) && path.basename(prog) === 'codex';
}

function isCodeModeHost(command) {
  return path.basename(argv0(command)) === 'codex-code-mode-host';
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
    const hosts = under.filter((d) => isCodeModeHost(procs.get(d).command));
    /* Anything else still running under it (a background shell job) reads idle on the card, and a restart would kill
       it (the hazard engine/automove.js names), so it waits for a pass where nothing runs. */
    const job = under.some((d) => !isCodeModeHost(procs.get(d).command));
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
 *   panes()             Map session -> pane pid
 *   procs()             Map pid -> { ppid, ageSec, command } (parseProcs)
 *   restart(session)    async; resolves { outcome, because } (remove.restartAsync; the card shows it as a plain restart)
 *   RESTARTED           remove.OUTCOME.RESTARTED
 *   tried               a Map kept by the caller: `${pin}\t${session}` -> tries. A restart that worked spends them all
 *                       (one per agent per pin per board run); a refused one is tried again, up to MAX_TRIES
 *   now                 ms (tests)
 * Returns [{ session, act }]: 'restarted' | 'refused' | 'not-idle' | 'has-host' | 'has-job' | 'held-by-move' | 'already-new' | 'tried'.
 * Agents that are not managed Codex are not listed.
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
    if (!m || m.ready !== true || !m.dir || !Number.isFinite(m.swappedAt)) return out;

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
      const found = codexUnderPane(panes.get(session), procs, kids, m.dir, now);
      if (!found) continue;   // not the managed Codex (a person's own codex, or no process): not ours to restart
      /* Started after the swap: it runs the new version already. The 1 s slack is ps's etime resolution: a process a
         second either side of the swap is called old, which costs at most one restart, never a missed one. */
      if (found.startedAt > m.swappedAt + 1000) { out.push({ session, act: 'already-new' }); continue; }
      // A host from before the swap is the old tree's (the safe case); one started after it is the new tree's.
      if (found.host && found.hostStartedAt <= m.swappedAt + 1000) { out.push({ session, act: 'has-host' }); continue; }
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
 * The managed Codex as the sweep needs it, from engine/runners.js: { dir, ready, swappedAt, pin }. ready only when the
 * tree in place is not stale, nothing is installing, and the last proved upgrade replaced a DIFFERENT version with the
 * one now installed. Never throws: anything unreadable is not ready.
 */
function managedState(runners) {
  try {
    const r = runners.resolveBin('openai');
    const stamp = runners.upgradeStamp('openai');
    const installed = runners.installedVersion('openai');
    const dir = path.join(runners.managedRoot(), 'openai');
    const ready = Boolean(r && r.managed === true && r.present === true && r.stale !== true && !runners.installing('openai')
      && stamp && stamp.from && stamp.from !== stamp.to && installed === stamp.to);
    return { dir, ready, swappedAt: stamp ? stamp.at : NaN, pin: stamp ? stamp.to : null };
  } catch { return null; }
}

module.exports = { managedState, passOnce, parseProcs, etimeSeconds, codexUnderPane, childrenOf, isManagedCodex, isCodeModeHost, MAX_PER_PASS, MAX_TRIES };
