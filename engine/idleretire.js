'use strict';
/**
 * kosmos#8720 (the remaining ask, routed 11-27): retire agents that have not run in N days. OPT-IN, OFF BY DEFAULT.
 *
 * Retiring is the board's own Remove (engine/remove.js), never forced: nothing on disk is deleted, the agent's job and
 * session are stopped on Mac, Linux and Windows alike, and it can be put back from Removed agents. This module only
 * decides WHO, and keeps what it did.
 *
 * Idle is counted in days KOSMOS WAS RUNNING, not calendar days: the board writes the liveness record when a report
 * reaches it, so while the board is closed nobody can beat. Each tick records today as a running day; an agent is
 * retired only when both its calendar days and the running days since its last beat reach N. A board closed for a
 * month therefore retires nobody on its first morning back.
 *
 * "Has not run" is engine/liveness.js: every self-report beats it, on every platform and runner that reports (the
 * Claude hooks, the Codex, Gemini, Grok and Antigravity bridges, Muse). Its three answers stay three here:
 *  - no record at all (never reported, or just put back or made again, which forget the record) is UNKNOWN: listed,
 *    never retired. So a restored agent cannot be retired again before it has reported once.
 *  - a record newer than N days: kept.
 *  - a record N days old or older: retired, unless something below protects it.
 *
 * Protected, listed with the reason and never retired, because there "idle" may be the person's own wait:
 *  - an agent the board shows as anything but idle or stopped right now (its pane is a second sign it is running);
 *  - a card the board does not run (row.isNamedOurs false), which Remove refuses anyway;
 *  - the setup guide (row.isGuide);
 *  - an agent whose latest report is needs_you or blocked (it is waiting on the person);
 *  - an agent named on an open task;
 *  - an agent on a project that is not archived.
 *
 * Weakest premise (on the card): that an agent which works always reports. #5957 measured every running agent's
 * record fresh within minutes; being wrong needs a hook broken for N days.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const DAY_MS = 86400000;
const DAY_CHOICES = Object.freeze([14, 30, 60, 90]);
const DEFAULT_DAYS = 30;
const KEEP_LOG = 50;        // the retirements kept for the Settings list, newest first
const KEEP_UP_DAYS = 120;   // running days kept, more than the longest choice
const MAX_PER_TICK = 3;     // remove() is synchronous; a long first day is spread over the hourly ticks
const RETIRABLE_STATES = Object.freeze(['idle', 'stopped']);
const RETRY_AFTER_MS = 7 * DAY_MS;   // a refused or partial removal is tried again a week later, not every day

/* Read at each use, never frozen at load (store.js #1443). */
function settingFile() { return path.join(store.ROOT, 'idleretire.json'); }
function logFile() { return path.join(store.ROOT, 'idleretire-log.json'); }

/** The setting, defaults filled in: { on, days, ok }. A missing file is off; a damaged one is off with ok:false. */
function readSetting() {
  let raw;
  try { raw = fs.readFileSync(settingFile(), 'utf8'); } catch (e) {
    return { on: false, days: DEFAULT_DAYS, ok: !!(e && e.code === 'ENOENT') };
  }
  let v;
  try { v = JSON.parse(raw); } catch { return { on: false, days: DEFAULT_DAYS, ok: false }; }
  if (!v || typeof v !== 'object') return { on: false, days: DEFAULT_DAYS, ok: false };
  return { on: v.on === true, days: DAY_CHOICES.includes(v.days) ? v.days : DEFAULT_DAYS, ok: true };
}

/** Saves { on, days }. Either may be left out to keep what is there. { ok, setting } or { ok: false, because }. */
function writeSetting(change) {
  const c = change && typeof change === 'object' ? change : {};
  if (c.on !== undefined && typeof c.on !== 'boolean') return { ok: false, because: 'on must be true or false' };
  if (c.days !== undefined && !DAY_CHOICES.includes(c.days)) return { ok: false, because: 'days must be one of ' + DAY_CHOICES.join(', ') };
  const now = readSetting();
  const next = { on: c.on === undefined ? now.on : c.on, days: c.days === undefined ? now.days : c.days };
  try { fs.mkdirSync(store.ROOT, { recursive: true }); store.saveFlushed(settingFile(), JSON.stringify(next) + '\n'); } catch (e) {
    return { ok: false, because: 'the setting could not be saved (' + (e && e.code ? e.code : 'error') + ')' };
  }
  return { ok: true, setting: next };
}

const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

const EMPTY_LOG = () => ({ up: [], tried: { day: null, names: [] }, retired: [] });

/* { up: [running days, oldest first], tried: { day, names }, retired: [newest first], unreadable }. Missing reads empty.
   A file that cannot be READ (permissions, a lock) reads empty with unreadable: true, and the tick then writes nothing
   over it. A file that reads but does not parse reads empty; with { setAside: true } (the tick, never the Settings
   read) it is first renamed aside, never deleted, so the next write starts fresh without losing it. Empty counts no
   running days, so it can only retire fewer. */
function readLog({ setAside = false } = {}) {
  let raw;
  try { raw = fs.readFileSync(logFile(), 'utf8'); } catch (e) {
    return e && e.code === 'ENOENT' ? EMPTY_LOG() : { ...EMPTY_LOG(), unreadable: true };
  }
  let v;
  try { v = JSON.parse(raw); } catch {
    if (!setAside) return { ...EMPTY_LOG(), unreadable: true };
    try { fs.renameSync(logFile(), logFile() + '.damaged-' + Date.now()); } catch { return { ...EMPTY_LOG(), unreadable: true }; }
    return EMPTY_LOG();
  }
  if (!v || typeof v !== 'object') return EMPTY_LOG();
  const t = v.tried && typeof v.tried === 'object' ? v.tried : {};
  return {
    up: Array.isArray(v.up) ? v.up.filter(isDay).slice(-KEEP_UP_DAYS) : [],
    tried: { day: isDay(t.day) ? t.day : null, names: Array.isArray(t.names) ? t.names.filter((n) => typeof n === 'string') : [] },
    retired: Array.isArray(v.retired) ? v.retired.filter((x) => x && typeof x === 'object' && typeof x.name === 'string').slice(0, KEEP_LOG) : [],
  };
}

/* A name the tick will not try now: tried today, or its last attempt was refused or partial under a week ago. Returns
   the local day it is tried again, or null. */
function heldUntil(log, name, t) {
  const triedToday = log.tried.day === dayOf(t) && log.tried.names.includes(name) ? dayOf(t + DAY_MS) : null;
  const last = log.retired.find((x) => x.name === name);
  const at = last && last.outcome !== 'removed' ? Date.parse(last.tried || last.at) : NaN;
  const backOff = Number.isFinite(at) && t - at < RETRY_AFTER_MS ? dayOf(at + RETRY_AFTER_MS) : null;
  return [triedToday, backOff].filter(Boolean).sort().pop() || null;   // the later of the two holds
}
function writeLog(log) {
  try {
    fs.mkdirSync(store.ROOT, { recursive: true });
    store.saveFlushed(logFile(), JSON.stringify({ up: log.up.slice(-KEEP_UP_DAYS), tried: log.tried, retired: log.retired.slice(0, KEEP_LOG) }) + '\n');
    return true;
  } catch { return false; }
}

/* The person's local day, as YYYY-MM-DD. */
function dayOf(now) {
  const d = new Date(now);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const plural = (n) => n + (n === 1 ? ' day' : ' days');
const WAITING = () => require('./selfreport').WAITING_ON_A_PERSON;

/**
 * One verdict per agent row: { name, shownAs, verdict: 'retire'|'keep'|'unknown', days, why }.
 * `readers`: lastBeat(name) -> { found, at }, latestState(name) -> string|null, onOpenTask(name) -> boolean,
 * activeProject(name) -> project name|null. A reader that throws counts as protecting (never retire on a failed read).
 * `upDays`: the days Kosmos was running (YYYY-MM-DD); anything but an array counts none.
 */
function assess(rows, readers, { days, now = Date.now(), upDays } = {}) {
  const limit = DAY_CHOICES.includes(days) ? days : DEFAULT_DAYS;
  const up = Array.isArray(upDays) ? upDays.filter(isDay) : [];
  const today = dayOf(now);
  const out = [];
  for (const a of Array.isArray(rows) ? rows : []) {
    const name = a && typeof a.sessionName === 'string' ? a.sessionName : null;
    if (!name) continue;
    const shownAs = typeof a.name === 'string' && a.name ? a.name : name;   // the board's row: name is what the person sees
    const row = (verdict, idle, why) => out.push({ name, shownAs, verdict, days: idle, why });
    let beat;
    try { beat = readers.lastBeat(name); } catch { beat = null; }
    const at = beat && beat.found ? Date.parse(beat.at) : NaN;
    if (!Number.isFinite(at)) { row('unknown', null, 'Kosmos has no record of it running yet, so it cannot tell how long it has been idle'); continue; }
    const idle = Math.max(0, Math.floor((now - at) / DAY_MS));
    if (idle < limit) { row('keep', idle, 'it ran ' + (idle === 0 ? 'today' : plural(idle) + ' ago')); continue; }
    const beatDay = dayOf(at);
    const ran = up.filter((d) => d > beatDay && d <= today).length;
    let why = null;
    if (ran < limit) why = 'Kosmos was running on only ' + plural(ran) + ' since it last ran';
    else if (!RETIRABLE_STATES.includes(a.state)) why = 'the board shows it as ' + (typeof a.state === 'string' && a.state ? a.state.replace(/_/g, ' ') : 'unknown') + ' right now';
    else if (a.isNamedOurs === false) why = 'it is not an agent Kosmos runs';
    else if (a.isGuide === true) why = 'it is the setup guide';
    else if (a.isGuide === null) why = 'Kosmos could not tell whether it is the setup guide';
    if (!why) {
      try {
        const state = readers.latestState(name);
        if (WAITING().includes(state)) why = 'its last word was a question or a block that waits on you';
      } catch { why = 'its last report could not be read'; }
    }
    if (!why) { try { if (readers.onOpenTask(name)) why = 'it is named on an open task'; } catch { why = 'its tasks could not be read'; } }
    if (!why) {
      try { const p = readers.activeProject(name); if (p) why = 'it is on the project ' + p; } catch { why = 'its projects could not be read'; }
    }
    if (why) { row('keep', idle, why); continue; }
    row('retire', idle, 'it has not run in ' + plural(idle));
  }
  return out;
}

/* The readers over the board's own records. An unreadable self-report throws, so it protects. */
function realReaders() {
  const liveness = require('./liveness');
  const selfreport = require('./selfreport');
  const projects = require('./projects');
  const tasks = require('./tasks');
  let all = null;
  const everyProject = () => { if (all === null) all = projects.readAll() || []; return all; };
  return {
    lastBeat: (name) => liveness.read(name),
    latestState: (name) => {
      const r = selfreport.read(name);
      if (r && r.found === false && r.because === selfreport.NO_READING.UNREADABLE) throw new Error(r.because);
      return r && typeof r.state === 'string' ? r.state : null;
    },
    onOpenTask: (name) => everyProject().some((p) => p && tasks.columnTasks(p).some((t) => tasks.whoOf(t).includes(name))),
    activeProject: (name) => {
      const p = everyProject().find((x) => x && !x.archived && Array.isArray(x.agents) && x.agents.includes(name));
      if (!p) return null;
      return typeof p.name === 'string' && p.name ? p.name : '(unnamed)';
    },
  };
}

/**
 * The hourly sweep. deps: allowed() (live execution), roster() -> rows, remove(name) -> { outcome, because, dryRun },
 * readers (default realReaders()), now(), log(line). Each tick records today as a running day; when the setting is on,
 * it sends up to MAX_PER_TICK 'retire' verdicts through remove(), never forced, skipping a name heldUntil() holds (the
 * attempt is written down before it is made). Under dry-run nothing happened (engine/remove.js markDryRun), so any
 * outcome but refused is recorded as refused. A refusal repeating the newest entry for that agent is not logged again.
 */
function makeTick(deps) {
  const now = deps.now || Date.now;
  return function tick() {
    try {
      if (!deps.allowed()) return { act: 'skip', because: 'live execution is off' };
      const t = now();
      const today = dayOf(t);
      const log = readLog({ setAside: true });
      if (log.unreadable) return { act: 'skip', because: 'its record could not be read, so it did nothing' };
      if (!log.up.includes(today)) { log.up.push(today); log.up.sort(); if (!writeLog(log)) { if (deps.log) deps.log('idle-retire: its record could not be written, so it did nothing'); return { act: 'skip', because: 'its record could not be written, so it did nothing' }; } }
      const setting = readSetting();
      if (!setting.on) return { act: 'skip', because: 'off' };
      const rows = deps.roster();
      if (!Array.isArray(rows)) return { act: 'skip', because: 'the agent list could not be read' };
      if (log.tried.day !== today) log.tried = { day: today, names: [] };
      const due = assess(rows, deps.readers || realReaders(), { days: setting.days, now: t, upDays: log.up })
        .filter((v) => v.verdict === 'retire' && !heldUntil(log, v.name, t)).slice(0, MAX_PER_TICK);
      const did = [];
      for (const v of due) {
        log.tried.names.push(v.name);
        if (!writeLog(log)) break;
        let r;
        // A throw from remove() can come after a step was taken (server.js's DELETE route says the same), so it is partial.
        try { r = deps.remove(v.name); } catch (e) { r = { outcome: 'partial', because: 'the removal failed partway and may have stopped part of it (' + (e && e.message ? e.message : 'error') + ')' }; }
        let outcome = r && typeof r.outcome === 'string' ? r.outcome : 'refused';
        if (r && r.dryRun && outcome !== 'refused') outcome = 'refused';
        const entry = { name: v.name, shownAs: v.shownAs, at: new Date(t).toISOString(), days: v.days, outcome, because: outcome === 'removed' ? v.why : String((r && r.because) || 'not removed') };
        did.push(entry);
        const last = log.retired.find((x) => x.name === v.name);
        const repeat = outcome !== 'removed' && last && last.outcome === outcome && last.because === entry.because;
        if (repeat) last.tried = entry.at; else log.retired.unshift(entry);
        if (!writeLog(log) && deps.log) deps.log('idle-retire: ' + v.name + ' ' + outcome + ', but its record could not be written');
        if (deps.log) deps.log('idle-retire: ' + v.name + ' ' + outcome + ' - ' + entry.because);
      }
      return { act: 'ran', did };
    } catch (e) {
      return { act: 'skip', because: 'error: ' + (e && e.message ? e.message : 'unknown') };
    }
  };
}

/** What Settings shows: the setting, every verdict (shown while off too, as a preview), and the recent retirements.
 * A retire verdict the tick would hold (heldUntil) is shown as kept, with the day it is tried again. `active` is whether
 * the sweep acts on this board now, for the screen to say when it is paused. */
function view(rows, readers, now = Date.now(), { active = true } = {}) {
  const setting = readSetting();
  const log = readLog();
  const up = log.up.includes(dayOf(now)) ? log.up : log.up.concat([dayOf(now)]);   // the next tick counts today before it judges
  const verdicts = assess(rows, readers || realReaders(), { days: setting.days, now, upDays: up }).map((v) => {
    const until = v.verdict === 'retire' ? heldUntil(log, v.name, now) : null;
    return until ? { ...v, verdict: 'keep', why: 'its last removal did not go through, so Kosmos tries again on ' + until } : v;
  });
  return { setting, choices: DAY_CHOICES, verdicts, recent: log.retired, unreadable: log.unreadable === true, active: active === true };
}

module.exports = { readSetting, writeSetting, assess, makeTick, view, realReaders, readLog, dayOf, DAY_CHOICES, DEFAULT_DAYS, KEEP_LOG, MAX_PER_TICK };
