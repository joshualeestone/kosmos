'use strict';
/**
 * kosmos#8720 (the remaining ask, routed 11-27): retire agents that have not run in N days. OPT-IN, OFF BY DEFAULT.
 *
 * Retiring is the board's own Remove (engine/remove.js), never forced: nothing on disk is deleted, the agent's job and
 * session are stopped on Mac, Linux and Windows alike, and it can be put back from Removed agents. This module only
 * decides WHO, once a day, and keeps what it did.
 *
 * "Has not run" is engine/liveness.js: every self-report beats it, on every platform and runner that reports (the
 * Claude hooks, the Codex, Gemini, Grok and Antigravity bridges, Muse). Its three answers stay three here:
 *  - no record at all (never reported, or just put back or made again, which forget the record) is UNKNOWN: listed,
 *    never retired. So a restored agent cannot be retired again before it has reported once.
 *  - a record newer than N days: kept.
 *  - a record N days old or older: retired, unless something below protects it.
 *
 * Protected, listed with the reason and never retired, because there "idle" may be the person's own wait:
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
const KEEP_LOG = 50;   // the retirements kept for the Settings list, newest first

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

function readLog() {
  try {
    const v = JSON.parse(fs.readFileSync(logFile(), 'utf8'));
    return { day: typeof v.day === 'string' ? v.day : null, retired: Array.isArray(v.retired) ? v.retired.slice(0, KEEP_LOG) : [] };
  } catch { return { day: null, retired: [] }; }
}
function writeLog(log) {
  try { fs.mkdirSync(store.ROOT, { recursive: true }); store.saveFlushed(logFile(), JSON.stringify({ day: log.day, retired: log.retired.slice(0, KEEP_LOG) }) + '\n'); return true; } catch { return false; }
}

/**
 * One verdict per agent row: { name, shownAs, verdict: 'retire'|'keep'|'unknown', days, why }.
 * `readers`: lastBeat(name) -> { found, at }, latestState(name) -> string|null, onOpenTask(name) -> boolean,
 * activeProject(name) -> project name|null. A reader that throws counts as protecting (never retire on a failed read).
 */
function assess(rows, readers, { days, now = Date.now() } = {}) {
  const limit = DAY_CHOICES.includes(days) ? days : DEFAULT_DAYS;
  const out = [];
  for (const a of Array.isArray(rows) ? rows : []) {
    const name = a && typeof a.sessionName === 'string' ? a.sessionName : null;
    if (!name) continue;
    const shownAs = typeof a.displayName === 'string' && a.displayName ? a.displayName : name;
    const row = (verdict, idle, why) => out.push({ name, shownAs, verdict, days: idle, why });
    let beat;
    try { beat = readers.lastBeat(name); } catch { beat = null; }
    const at = beat && beat.found ? Date.parse(beat.at) : NaN;
    if (!Number.isFinite(at)) { row('unknown', null, 'Kosmos has no record of it running yet, so it cannot tell how long it has been idle'); continue; }
    const idle = Math.max(0, Math.floor((now - at) / DAY_MS));
    if (idle < limit) { row('keep', idle, 'it ran ' + (idle === 0 ? 'today' : idle + (idle === 1 ? ' day' : ' days') + ' ago')); continue; }
    if (a.isGuide === true) { row('keep', idle, 'it is the setup guide'); continue; }
    let why = null;
    try {
      const state = readers.latestState(name);
      if (state === 'needs_you' || state === 'blocked') why = 'its last word was a question or a block that waits on you';
    } catch { why = 'its last report could not be read'; }
    if (!why) { try { if (readers.onOpenTask(name)) why = 'it is named on an open task'; } catch { why = 'its tasks could not be read'; } }
    if (!why) {
      try { const p = readers.activeProject(name); if (p) why = 'it is on the project ' + p; } catch { why = 'its projects could not be read'; }
    }
    if (why) { row('keep', idle, why); continue; }
    row('retire', idle, 'it has not run in ' + idle + ' days');
  }
  return out;
}

/* The readers over the board's own records. */
function realReaders() {
  const liveness = require('./liveness');
  const selfreport = require('./selfreport');
  const projects = require('./projects');
  const tasks = require('./tasks');
  let all = null;
  const everyProject = () => { if (all === null) all = projects.readAll() || []; return all; };
  return {
    lastBeat: (name) => liveness.read(name),
    latestState: (name) => { const r = selfreport.read(name); return r && typeof r.state === 'string' ? r.state : null; },
    onOpenTask: (name) => everyProject().some((p) => p && tasks.columnTasks(p).some((t) => tasks.whoOf(t).includes(name))),
    activeProject: (name) => {
      const p = everyProject().find((x) => x && !x.archived && Array.isArray(x.agents) && x.agents.includes(name));
      return p ? String(p.name || p.id || 'a project') : null;
    },
  };
}

/* The person's local day, as YYYY-MM-DD. */
function dayOf(now) {
  const d = new Date(now);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * The daily sweep. deps: allowed() (live execution), roster() -> rows, remove(name) -> { outcome, because },
 * readers (default realReaders()), now(), log(line). Returns the tick; each tick resolves what it did.
 * Once a day (kept on disk), when the setting is on: every 'retire' verdict goes through remove(), never forced.
 */
function makeTick(deps) {
  const now = deps.now || Date.now;
  return function tick() {
    try {
      if (!deps.allowed()) return { act: 'skip', because: 'live execution is off' };
      const setting = readSetting();
      if (!setting.on) return { act: 'skip', because: 'off' };
      const t = now();
      const log = readLog();
      const today = dayOf(t);
      if (log.day === today) return { act: 'skip', because: 'already ran today' };
      const verdicts = assess(deps.roster(), deps.readers || realReaders(), { days: setting.days, now: t });
      log.day = today;
      if (!writeLog(log)) return { act: 'skip', because: 'its record could not be written, so it did nothing' };
      const did = [];
      for (const v of verdicts.filter((x) => x.verdict === 'retire')) {
        let r;
        try { r = deps.remove(v.name); } catch (e) { r = { outcome: 'refused', because: 'remove failed (' + (e && e.message ? e.message : 'error') + ')' }; }
        const outcome = r && typeof r.outcome === 'string' ? r.outcome : 'refused';
        const entry = { name: v.name, shownAs: v.shownAs, at: new Date(t).toISOString(), days: v.days, outcome, because: outcome === 'removed' ? v.why : String((r && r.because) || 'not removed') };
        log.retired.unshift(entry);
        did.push(entry);
        if (deps.log) deps.log('idle-retire: ' + v.name + ' ' + outcome + ' - ' + entry.because);
      }
      writeLog(log);
      return { act: 'ran', did };
    } catch (e) {
      return { act: 'skip', because: 'error: ' + (e && e.message ? e.message : 'unknown') };
    }
  };
}

/** What Settings shows: the setting, every verdict, and the recent retirements. */
function view(rows, readers, now = Date.now()) {
  const setting = readSetting();
  return { setting, choices: DAY_CHOICES, verdicts: assess(rows, readers || realReaders(), { days: setting.days, now }), recent: readLog().retired };
}

module.exports = { readSetting, writeSetting, assess, makeTick, view, realReaders, readLog, DAY_CHOICES, DEFAULT_DAYS, KEEP_LOG };
