'use strict';

/**
 * Which of your agents will still be here after you restart the computer.
 *
 * 🛑 THE ANSWER WAS NOT AVAILABLE ANYWHERE, and on Josh's machine it was one
 * out of sixteen. Measured 2026-08-22, after the first real reboot:
 *
 *   ~/work/workers/          16 folders
 *   ~/Library/LaunchAgents/   1 job      com.kosmos.agent.anna
 *   tmux ls                   1 session  anna
 *
 * ⚠️ AN AGENT WITH NO JOB IS NOT BROKEN AND DOES NOT LOOK BROKEN. It runs, it
 * answers, it draws exactly the same card as a registered one. The difference
 * only appears at the next login, and by then the session that was holding it
 * up is gone. **Nobody could have found this out except by restarting**, which
 * is how Josh found it out.
 *
 * ⚠️ WHAT IS NOT AT RISK, because it changes how urgent this is rather than how
 * serious: nothing was deleted. The folders, the instructions, the history and
 * the profiles are all on disk. These agents are STOPPED and UNREGISTERED, not
 * lost, and nothing decays while somebody works out what to do.
 *
 * 🔑 THE ROSTER COMES FROM WHAT KOSMOS ITSELF WROTE, never from "there is a
 * folder here". `~/work/workers` is a plain directory a person may keep their
 * own things in — on this fleet's own Mac it holds worker checkouts that are
 * not Kosmos agents at all — and writing launchd jobs for whatever is sitting
 * in it would start strangers' processes at every login. A profile under the
 * product's own data directory is a record only this product writes, so it is
 * the evidence used, and the failure direction is to do nothing.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const store = require('./store');
const liveness = require('./liveness');     // #6714: whether an agent has ever run here
const selfreport = require('./selfreport'); // #6714: the same, from before liveness records existed
const launchidentity = require('./launchidentity'); // #1704: this board's Kosmos

/**
 * What this agent is called by the person who made it.
 *
 * 🛑 THE PANEL PRINTED THE MACHINE NAME, and Josh met it head on: the list read
 * `ava, bob, brigitte…` while his board showed **Ava**, **Brigitte** and
 * **Scarlett**. The same agents, in two vocabularies, on one screen. He
 * reasonably read it as Scarlett being missing from a list she was in.
 *
 * 🔑 THE RULE THIS BREAKS IS ALREADY WRITTEN DOWN, in `create.js`: act on the
 * machine name, speak the display name. Every value this module ACTS on stays
 * the slug; this is only for the sentence.
 *
 * ⚠️ THROUGH `status.readIdentity`, which is the board's own reader, so a name
 * cannot differ between the card and the panel that names the card. It prefers
 * the stored record over the instruction file, handles the overrides, and falls
 * back to the slug — three behaviours a local `readProfile().displayName` would
 * have to grow one at a time, wrongly, in a second place.
 */
function shownName(name) {
  try {
    const id = status.readIdentity(name);
    const shown = id && typeof id.displayName === 'string' ? id.displayName.trim() : '';
    return shown || name;
  } catch {
    /* A name we cannot look up is still a name. The slug is what the machine
       calls it, which is worse to read and never wrong. */
    return name;
  }
}

/** Names Kosmos has written a profile for: its own record that an agent exists. */
function known() {
  let files;
  try { files = fs.readdirSync(store.PROFILES); } catch (err) {
    /* ⚠️ "NOTHING HAS EVER BEEN WRITTEN" IS NOT "WE COULD NOT LOOK", and this
       module would have shipped saying the second on every fresh machine: the
       directory does not exist until the first profile is written. That is the
       exact distinction the rest of this product is built on, inverted, in the
       one place where the wrong answer is a permanent alarming sentence on a
       board that has no agents to be alarmed about. */
    if (err && err.code === 'ENOENT') return { ok: true, names: [] };
    return { ok: false, names: [] };
  }
  const names = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    /* ⚠️ Filtered through `create.NAME_RE`, the writer's own rule, and NOT
       through `slugFor`: `slugFor` folds and lower-cases but never REFUSES, so
       it cannot stand in for the rule -- a `..json` file slugs to `-` (#2605
       folds the periods) rather than being rejected, and `..` is a path, not a
       name. A profile file whose name does not survive the rule is not
       something we can build a job from, and guessing at what it was meant to
       be is how a job ends up pointing into a folder belonging to something
       else. */
    .filter((n) => create.NAME_RE.test(n));
  return { ok: true, names: names.sort() };
}

/**
 * Every agent Kosmos knows about, and whether it survives a restart.
 *
 * ⚠️ THREE SEPARATE FACTS PER AGENT, deliberately not collapsed into a verdict.
 * A folder with no job is recoverable; a job with no folder is a job that fails
 * every thirty seconds forever; and a removed agent is neither, it is somebody's
 * decision. A single "healthy" boolean would hide which of the three you have.
 */
/**
 * The names holding a folder or a startup job ON DISK with no profile
 * behind them (#500). The survey enumerates from profiles, so without
 * this walk a profile-less leftover is not merely stale in the roster,
 * it is absent from the enumeration entirely, while create.js still
 * refuses its name: the name is unusable and nothing on any screen says
 * why.
 *
 * ⚠️ FAIL SOFT TO NOTHING, per root. An unreadable stray sweep must not
 * take the profile-backed roster down with it; contributing nothing
 * leaves exactly the blindness the product has today, which is the
 * inert direction. ENOENT is a fresh machine, not an error.
 *
 * ⚠️ THE ROOTS THEMSELVES, not workerDir(): that helper consults
 * recorded folders and would resolve a recorded name right out of the
 * root being walked. And names are gated through `create.NAME_RE`, the
 * writer's own rule, same as known() gates profile files.
 *
 * ⚠️ KNOWN LIMIT, deliberate: on the default case-insensitive macOS
 * filesystem a case-variant directory ("Casey") makes create's
 * existsSync refusal fire for "casey" while failing NAME_RE here, so
 * that hostage class stays invisible. Surfacing it under the slug would
 * draw a row whose removal then refuses (remove acts by EXACT spelling,
 * existsExactly, and rightly so), and a row whose control cannot work
 * is worse than the blindness. The class belongs to #514, where a
 * delete that names exact spellings can carry it. The same limit block
 * owns a second class: a Kosmos-made folder RESTORED from backup or
 * copied back wears the copy's birthtime, fails the later-tenant bound
 * below, and stays invisible; the bound requires it, and #514 is where
 * a content witness could readmit it.
 *
 * 🛑 A FOLDER IS OURS ONLY IF THE BIRTH RECORD SAYS SO. The workers root
 * is a plain directory: on this fleet's own Mac it holds worker
 * checkouts that are not Kosmos agents at all, and a walk that showed
 * every directory would put a Remove control under each of them. The
 * roster-from-records ruling stands; what #500 adds is the one case the
 * records DO vouch for with the state gone: `created.jsonl` is the
 * append-only receipt that answers "did Kosmos ever create this name"
 * after every deletable file is deleted (#157), and #170 put the id on
 * that line for exactly this kind of reconciliation. A `created` or
 * `partial` line is the tie; a stranger's checkout has none. A plist in
 * OUR label namespace (com.kosmos.agent.*) is ours by construction and
 * needs no second witness.
 */
/* A root that has never been written is an empty contribution, the same
   split known() makes: ENOENT is a fresh machine, anything else is
   could-not-look and sets the failed flag. */
function readRoot(dir) {
  try { return fs.readdirSync(dir); }
  catch (err) { if (err && err.code === 'ENOENT') return []; throw err; }
}

/**
 * "Does this agent have a startup job?", answered once for the whole fleet.
 *
 * 🔑 ONE PROBE, NOT ONE PER AGENT, on win32 -- the shape `create.disabledJobs`
 * and `create.runningJobs` already use for the same question on the Mac. This
 * screen polls every five seconds, and asking `schtasks` per agent would spend
 * ~18ms x N (measured on this box) on every tick. Every agent job lives under
 * one Task Scheduler folder, so the folder query IS the fleet query.
 *
 * Answers `true`, `false`, or `null` for "we could not look" -- and null is the
 * point: this screen makes a CLAIM to a person, and a claim built from a failed
 * look is what §3b is about. A null row is reported and never acted on.
 *
 * 📌 THE MAC ARM: our own plist is still checked with `existsSync`, which swallows
 * EACCES into false. Since #6310 it also reads the login jobs Kosmos did not write
 * (see foreignLoginFolders), and answers null when one of them that might start
 * this agent could not be read: a broken plist that names its folder, or a plist or
 * launcher script that could not be read at all (then null for every agent without
 * its own plist that no WorkingDirectory covers), the login jobs folder could not be
 * listed, or the agent's own folder could not be resolved (other than "it does not
 * exist").
 */
function jobReader(platform) {
  /* #4918 review 11: on Linux the startup job is a systemd user unit, never a plist, so the survey reads the unit;
     the plist check said no Linux agent comes back after a restart. */
  if (platform === 'linux') {
    const lj = require('./linuxjob');
    return { win32: false, linux: true, mac: false, known: true, fleet: null, of: (name) => lj.presence(name) };
  }
  if (platform !== 'win32') {
    /* #6310: OUR plist is one way an agent starts at login, not the only one. The fleet Mac's 18 agents each start from
       their own LaunchAgent (com.<name>.discord, KeepAlive, WorkingDirectory = the worker folder), so the banner said
       all 18 "will not come back" and its button would have installed and started a second copy of each. An agent
       that a login job not written by Kosmos starts has a job (foreignLoginFolders says what counts). Read lazily: the
       foreign jobs are only looked at for a name with no plist of ours. */
    let foreign = null;
    const NULL_WHY = new Map();   // #6320: this survey's reason for each null answer, read by survey() after its pass
    return {
      win32: false, known: true, fleet: null,
      // #6320: why an agent read null: 'waiting' (a plist only waiting its turn; not to be said to a person) or 'unread'.
      whyNull: (name) => NULL_WHY.get(name) || 'unread',
      mac: true,   // #6320: only the Mac's nulls mean "a login job could not be read"; the unknown list is Mac-only
      of: (name) => {
        if (fs.existsSync(create.plistPath(name))) return true;
        if (!foreign) {
          foreign = foreignLoginFolders();
          if (VERDICTS.sig !== foreign.sig) VERDICTS = { sig: foreign.sig, map: new Map() };
        }
        let dir = null;
        // .native: the path as the disk spells it, so a WorkingDirectory written in another case still matches.
        try { dir = fs.realpathSync.native(create.workerDir(name)); } catch (e) {
          if (!(e && e.code === 'ENOENT')) { NULL_WHY.set(name, 'unread'); return null; }   // could not look at the folder itself: not a proven absence
          dir = null;   // no folder: nothing can start in it, and survey's `missing` needs a folder anyway
        }
        // The answer for a folder only changes when a login job, a launcher script or the home folder does.
        const memoKey = name + '\0' + dir + '\0' + create.homeDir() + '\0' + os.homedir();
        if (VERDICTS.map.has(memoKey)) { const m = VERDICTS.map.get(memoKey); NULL_WHY.set(name, m.why); return m.verdict; }
        let why = null;   // #6320: for a null, 'waiting' when the only reason is a plist waiting its turn, else 'unread'
        const verdict = (() => {
          // The folder itself or a folder inside it, as a start script's mention is.
          if (dir && [...foreign.dirs].some((d) => d === dir || d.startsWith(dir + '/'))) return true;
          /* While something could not be read, no answer here can be a proven absence, so the text scan is skipped. An
             agent a script would have shown as covered reads as unknown instead: intended, and safe (never repaired). */
          const spellings = folderSpellings(dir, create.workerDir(name));
          if (foreign.unknownAll) {
            // Waiting alone is not to be said; but a broken plist naming this folder is a real could-not-read.
            why = foreign.deferred && !(dir && mentionsFolder(foreign.suspects, spellings)) ? 'waiting' : 'unread';
            return null;
          }
          if (dir && mentionsFolder(foreign.texts, spellings)) return true;
          /* A login job that could not be read and names this agent's folder might start it, so "no job" is not
             proven: null, which Repair never acts on (#570). One that could not be read at all might be anyone's. */
          if (dir && mentionsFolder(foreign.suspects, spellings)) { why = 'unread'; return null; }
          return false;
        })();
        VERDICTS.map.set(memoKey, { verdict, why });
        NULL_WHY.set(name, why);
        return verdict;
      },
    };
  }
  let all;
  try { all = require('./win32job').list(); } catch { all = { known: false }; }
  if (!all.known) return { win32: true, mac: false, known: false, fleet: null, of: () => null };
  return { win32: true, mac: false, known: true, fleet: all.names, of: (name) => all.names.has(name) };
}

/* #6310: the worker folders that a login job NOT written by Kosmos starts. A job not Disabled that is KeepAlive or
   RunAtLoad covers its WorkingDirectory; its start scripts are searched only when it is KeepAlive, or RunAtLoad with no
   schedule or trigger (StartInterval, StartCalendarInterval, WatchPaths, QueueDirectories, StartOnMount). The XML form is read as text, so the five-second poll runs no process; a binary plist goes
   through plutil. Plists and the start scripts they name are cached by mtime and size. */
const FOREIGN_CACHE = new Map();
const SCRIPT_CACHE = new Map();
let VERDICTS = { sig: null, map: new Map() };   // per-agent answers for one state of the login jobs and their scripts
function unxml(v) {
  const cp = (m, n) => (n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m);   // an impossible one stays as written
  const named = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
  // One pass, so a decoded '&' never starts another reference.
  return v.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|quot|apos|amp);/g, (m, r) =>
    (r[0] === '#' ? cp(m, r[1] === 'x' ? parseInt(r.slice(2), 16) : parseInt(r.slice(1), 10)) : named[r]));
}
const PLIST_MAX = 262144;   // a launchd plist is a few hundred bytes; anything this large is not read
/* plutil runs synchronously on the board's request path, so one survey converts at most PLUTIL_BUDGET binary plists;
   the rest wait their turn (agents they might cover read unknown for that survey, and are not said to the person) and
   are read on the next survey. */
const PLUTIL_BUDGET = 4;
let plutilLeft = PLUTIL_BUDGET;
function plistKeys(file) {
  if (fs.statSync(file).size > PLIST_MAX) {
    // Not a job launchd would load; its first PLIST_MAX bytes are kept as a suspect (only an agent it names is unknown).
    const fd = fs.openSync(file, 'r');
    let head; try { head = Buffer.alloc(PLIST_MAX); head = head.subarray(0, fs.readSync(fd, head, 0, PLIST_MAX, 0)); } finally { fs.closeSync(fd); }
    const e = new Error('too large to be a login job'); e.raw = head.toString('utf8'); throw e;
  }
  const buf = fs.readFileSync(file);
  let text;
  if (buf.slice(0, 8).toString('latin1') === 'bplist00') {
    if (plutilLeft <= 0) throw new Error('plutil budget spent for this survey');
    plutilLeft -= 1;
    text = require('child_process').execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', file], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
  } else text = buf.toString('utf8');
  if (!/<plist[\s>]/.test(text) || !/<\/dict>/.test(text)) { const e = new Error('not a property list'); e.raw = text; throw e; }
  /* Top-level keys only: a key of the same name inside a nested dict (EnvironmentVariables, a KeepAlive condition)
     does not count. Inner dicts are folded to <dict/> from the innermost out. */
  if (text.indexOf('<dict') < 0) { const e = new Error('not a property list'); e.raw = text; throw e; }
  let top = text.slice(text.indexOf('<dict'), text.lastIndexOf('</dict>') + 7);
  const outer = /^<dict\s*>([\s\S]*)<\/dict>$/.exec(top);
  top = outer ? outer[1] : top;
  for (let prev = ''; prev !== top;) { prev = top; top = top.replace(/<dict\s*>(?:(?!<dict[\s>])[\s\S])*?<\/dict>/g, '<dict/>'); }
  const flag = (k) => new RegExp('<key>' + k + '</key>\\s*(<true\\s*/>|<dict\\s*>|<dict\\s*/>)').test(top);
  const has = (k) => new RegExp('<key>' + k + '</key>').test(top);
  const wd = /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(top);
  const pa = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(top);
  const prog = /<key>Program<\/key>\s*<string>([^<]*)<\/string>/.exec(top);
  const args = (prog ? [unxml(prog[1])] : []).concat(pa ? [...pa[1].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => unxml(m[1])) : []);
  // Run on a schedule or on an event: a task, not an agent.
  const periodic = ['StartInterval', 'StartCalendarInterval', 'WatchPaths', 'QueueDirectories', 'StartOnMount'].some(has);
  const on = !flag('Disabled');
  /* A job that starts at login IN the folder covers it, whatever else it is scheduled for. A mention in a start script
     is weaker evidence (a digest or backup script names folders it does not start), so a scheduled job's script counts
     only when the job is also KeepAlive. */
  const startsHere = on && (flag('KeepAlive') || flag('RunAtLoad'));
  const starts = on && (flag('KeepAlive') || (flag('RunAtLoad') && !periodic));
  return { dir: wd ? unxml(wd[1]) : null, startsHere, starts, args };
}
/* The ways a start script may write the folder: as it is, as its real path, and under the home folder as ~ or $HOME. */
function folderSpellings(...dirs) {
  const homes = new Set([os.homedir(), create.homeDir()].filter(Boolean));
  const out = new Set();
  for (const d of dirs) {
    if (!d) continue;
    out.add(d);
    for (const home of homes) {
      if (d.startsWith(home + '/')) { const rest = d.slice(home.length); out.add('~' + rest); out.add('$HOME' + rest); out.add('${HOME}' + rest); }
    }
  }
  return [...out];
}
/* The whole folder path, bounded by characters a name cannot hold: .../workers/leo does not match .../workers/leonardo
   or .../xworkers/leo. A path below the folder (.../leo/sub) does match. */
function mentionsFolder(texts, spellings) {
  for (const sp of new Set(spellings)) {
    if (!sp) continue;
    const re = new RegExp('(?<![A-Za-z0-9._/-])' + sp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_-])', 'i');   // the Mac's disks ignore case
    if (texts.some((t) => re.test(t))) return true;
  }
  return false;
}
/* Whether an argument looks like something that runs: executable, or named like a script. Only these are searched
   or can leave "no job" unproven; a log being followed or a data file passed along is neither. */
const SCRIPT_EXT = /\.(sh|bash|zsh|command|js|mjs|cjs|py|rb|pl)$/i;
function launcherLike(file, st) { return !!(st.mode & 0o111) || SCRIPT_EXT.test(file); }
/* A launcher's text; null when the argument is not a launcher-like text file (a binary such as the interpreter, a
   data file, a folder, nothing); UNREADABLE when it is a launcher-like file this survey cannot read. Text over
   SCRIPT_MAX is not searched (null): a bundled CLI is many megabytes and never names a worker folder, and treating it
   as unreadable would make every agent unknown. A failed read is not cached. */
const SCRIPT_MAX = 2 * 1024 * 1024;
const UNREADABLE = Symbol('unreadable');
/* Folders macOS guards with a privacy prompt (TCC), and other volumes: a launcher there is not touched at all, so the
   board never raises a prompt on its five-second poll. A script-like name there leaves "no job" unproven. */
function guardedSpelling(file) {
  const f = file.toLowerCase();   // the Mac's disks ignore case, so ~/documents is Documents
  const under = (d) => { const x = d.toLowerCase(); return f === x || f.startsWith(x + '/'); };
  if (under('/Volumes')) return true;
  // Both homes, as folderSpellings uses: the OS user's is the one whose privacy prompt would appear.
  for (const home of new Set([os.homedir(), create.homeDir()].filter(Boolean))) {
    if (['Documents', 'Desktop', 'Downloads', 'Library/Containers', 'Library/Group Containers', 'Library/Mobile Documents']
      .some((d) => under(path.join(home, d)))) return true;
  }
  return false;
}
/* Guarded as written, or a symlink (followed a few links deep) that points into a guarded place. lstat and readlink
   look at the link itself, never into the folder it points to, so following a link this way raises no prompt. A link
   that cannot be read counts as guarded: the safe answer, and it is not touched further. */
function protectedPath(file) {
  let cur = file;
  for (let hop = 0; hop < 8; hop++) {
    if (guardedSpelling(cur)) return true;
    let lst;
    try { lst = fs.lstatSync(cur); } catch { return false; }   // nothing there: nothing to protect
    if (!lst.isSymbolicLink()) return false;
    let to;
    try { to = fs.readlinkSync(cur); } catch { return true; }
    cur = path.resolve(path.dirname(cur), to);
  }
  return true;   // a chain this long is not followed: treat as guarded
}
const SCRIPT_RETRY_MS = 60000;
function scriptText(file) {
  if (protectedPath(file)) return SCRIPT_EXT.test(file) ? UNREADABLE : null;
  const prev = SCRIPT_CACHE.get(file);
  if (prev && prev.text === UNREADABLE && Date.now() < prev.retryAt) return UNREADABLE;   // asked again a minute later
  const unreadable = () => { SCRIPT_CACHE.set(file, { sig: null, text: UNREADABLE, retryAt: Date.now() + SCRIPT_RETRY_MS }); return UNREADABLE; };
  let st;
  try { st = fs.statSync(file); } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return null;
    // Cannot even look (a folder it sits in is closed): only a name that reads as a script leaves "no job" unproven.
    return SCRIPT_EXT.test(file) ? unreadable() : null;
  }
  if (!st.isFile() || !launcherLike(file, st)) return null;
  const sig = st.mtimeMs + ':' + st.size;
  const got = SCRIPT_CACHE.get(file);
  if (got && got.sig === sig) return got.text;
  let head;
  try {
    const fd = fs.openSync(file, 'r');
    try { head = Buffer.alloc(4096); head = head.subarray(0, fs.readSync(fd, head, 0, 4096, 0)); } finally { fs.closeSync(fd); }
  } catch { return unreadable(); }
  // A binary is never a launcher script, whatever its size (the interpreter itself: /bin/bash is about 1.9 MB).
  if (head.includes(0) || st.size > SCRIPT_MAX) { SCRIPT_CACHE.set(file, { sig, text: null }); return null; }
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return unreadable(); }
  SCRIPT_CACHE.set(file, { sig, text });
  return text;
}
function foreignLoginFolders() {
  const dirs = new Set();
  /* The fleet's older jobs set no WorkingDirectory; the folder is only in the start script they run (WORK_DIR=...), so
     a starting job's arguments and any small script file they name are kept as text to search. */
  const texts = new Set();   // each distinct text once: many jobs run the same script
  /* A plist that reads as text but not as a property list: an agent whose folder it names is unknown, nobody else. */
  const suspects = [];
  let unknownAll = false;
  let names;
  try { names = fs.readdirSync(create.AGENTS_DIR); } catch (e) { return { dirs, texts: [], suspects, unknownAll: !(e && e.code === 'ENOENT'), sig: 'none:' + (e && e.code) }; }
  plutilLeft = PLUTIL_BUDGET;
  const seen = new Set();
  const scripts = new Set();
  const sigParts = [];   // everything the answers depend on, so a change anywhere drops the remembered ones
  let deferred = false;  // #6320: a plist left for the next survey by the plutil budget: not read YET, not unreadable
  for (const f of names) {
    if (!f.endsWith('.plist') || f.startsWith(create.SERVICE_LABEL_PREFIX)) continue;
    const file = path.join(create.AGENTS_DIR, f);
    seen.add(file);
    let st;
    // A plist that is a link into a guarded folder is not read: unknown for everyone, untouched.
    if (protectedPath(file)) { unknownAll = true; sigParts.push(file + ':guarded'); continue; }
    try { st = fs.statSync(file); } catch (e) { if (!(e && e.code === 'ENOENT')) unknownAll = true; continue; }   // gone since the listing: skipped
    if (!st.isFile()) continue;
    const sig = st.mtimeMs + ':' + st.size;
    sigParts.push(file + ':' + sig);
    let got = FOREIGN_CACHE.get(file);
    const kept = got;   // what was known before this survey looked again
    if (!got || got.sig !== sig || (got.retryAt && Date.now() >= got.retryAt)) {
      try { got = { sig, keys: plistKeys(file) }; } catch (e) {
        got = { sig, keys: null, raw: e && typeof e.raw === 'string' ? e.raw : null };
        /* Said once per file and version (a changed file that still fails is said again), so a login job that keeps the
           banner quiet leaves a trace in the board's log. A spent plutil budget is not a failure and is not said. */
        const prevEntry = FOREIGN_CACHE.get(file) || {};
        const budget = e && /budget spent/.test(String(e.message));
        got.budget = budget;
        if (got.raw === null && !budget && !(prevEntry.logged && prevEntry.sig === sig)) { console.warn('[register] #6310: could not read login job ' + file + ' (' + (e && e.message) + '); agents without their own plist read as unknown'); }
        if (got.raw === null && !budget) got.logged = true;
      }
      // A file that could not be read at all is asked again a minute later (a timeout or a permission may clear), so a
      // slow plutil does not run on every poll; one that read but is not a property list stays as read until it changes.
      const budgetSkip = !got.keys && got.raw === null && got.budget;
      // Read on the next survey, not a failure. What was known before (its logged record, its retry) is left as it was.
      if (budgetSkip) { deferred = true; if (kept) FOREIGN_CACHE.set(file, kept); else FOREIGN_CACHE.delete(file); continue; }
      if (!got.keys && got.raw === null) got.retryAt = Date.now() + 60000;
      FOREIGN_CACHE.set(file, got);
    }
    if (!got.keys) { if (got.raw !== null && got.raw !== undefined) suspects.push(got.raw); else unknownAll = true; continue; }
    if (!got.keys.startsHere) continue;
    if (got.keys.dir) {
      // The written folder goes into the signature too, so a folder created later is seen at once.
      sigParts.push('wd=' + got.keys.dir);
      if (path.isAbsolute(got.keys.dir) && !protectedPath(got.keys.dir)) {   // relative: no meaning outside the job; guarded: never touched
        try { const real = fs.realpathSync.native(got.keys.dir); dirs.add(real); sigParts.push('wd:' + real); } catch { /* not there (yet) */ }
      }
    }
    if (!got.keys.starts) continue;   // a scheduled job's own folder counted above; its scripts do not
    texts.add(got.keys.args.join('\n'));
    for (const a of got.keys.args) {
      if (!path.isAbsolute(a)) continue;
      scripts.add(a);
      const t = scriptText(a);
      let ast = null;
      if (!protectedPath(a)) { try { ast = fs.statSync(a); } catch { ast = null; } }   // a guarded path is never touched
      // Mode too: a file made executable (or renamed to a script) becomes a launcher without its contents changing.
      sigParts.push(a + ':' + (ast ? ast.mode + ':' + ast.size + ':' + ast.mtimeMs : 'none') + ':' + String(t === UNREADABLE));
      if (t === UNREADABLE) unknownAll = true;   // a launcher we cannot read may be any agent's
      else if (t !== null) texts.add(t.replace(/"\$\{?HOME\}?"/g, '$HOME'));   // "$HOME"/work reads as $HOME/work
    }
  }
  for (const k of FOREIGN_CACHE.keys()) if (!seen.has(k)) FOREIGN_CACHE.delete(k);
  for (const k of SCRIPT_CACHE.keys()) if (!scripts.has(k)) SCRIPT_CACHE.delete(k);
  // A failed read is retried, so while one stands nothing is remembered (the sig is unique each time).
  const sig = unknownAll || deferred || [...FOREIGN_CACHE.values()].some((g) => g.retryAt) ? 'retry:' + Date.now() + ':' + Math.random() : sigParts.join('|');
  return { dirs, texts: [...texts], suspects, unknownAll: unknownAll || deferred, deferred: deferred && !unknownAll, sig };
}

function strays(profileNames, jobs) {
  let failed = false;
  const have = new Set(profileNames);
  const born = new Map();
  try {
    const log = create.createdLog();
    /* createdLog swallows its own read errors into [], so an empty
       answer from a file that HAS bytes is could-not-read (or a log of
       lines nothing could parse), not nothing-ever-written; the flag
       says so instead of every folder stray silently vanishing. ENOENT
       stays a fresh machine. */
    if (!log.length) {
      try { if (fs.statSync(create.createdLogFile()).size > 0) failed = true; }
      catch (err) { failed = failed || (err && err.code !== 'ENOENT'); }
    }
    for (const e of log) {
      if (e.outcome === create.OUTCOME.CREATED || e.outcome === create.OUTCOME.PARTIAL) {
        /* ⚠️ THE SLUG, not the name as typed: the birth line records the
           spelling the person used ("Casey"), the folder is made under
           slugFor ("casey"), and the tie must speak the folder's own
           language or capitalized creations never match their remains.
           The value is the LATEST such line's time: a line vouches for
           the folder its creation made, not for the name forever, so a
           directory that appeared long after every line (a checkout
           dropped under a once-used name) is not what any line made. */
        const slug = create.slugFor(String(e.name || ''));
        const at = Date.parse(e.at || '') || 0;
        if (!born.has(slug) || born.get(slug) < at) born.set(slug, at);
      }
    }
  } catch { /* no receipts, no folder ties; jobs still speak for themselves */ }
  const found = new Map();
  const note = (name, what) => {
    if (have.has(name) || !create.NAME_RE.test(name)) return;
    const cur = found.get(name) || { folder: false, job: false };
    cur[what] = true;
    found.set(name, cur);
  };
  try {
    for (const d of readRoot(create.WORKERS_DIR)) {
      try {
        if (!born.has(d)) continue;
        const st = fs.statSync(path.join(create.WORKERS_DIR, d));
        /* A day of slack covers clock skew and a slow creation; a
           directory born long after every line for its name is a later
           tenant, not the remains the line vouched for. birthtimeMs is
           0 on filesystems that cannot answer, and 0 passes: absence of
           the witness must not hide a genuine stray. */
        const bound = born.get(d) + 24 * 60 * 60 * 1000;
        if (st.isDirectory() && (st.birthtimeMs || 0) <= bound) note(d, 'folder');
      } catch (err) { failed = failed || (err && err.code !== 'ENOENT'); }
    }
  } catch (err) { failed = failed || (err && err.code !== 'ENOENT'); }
  /* 🛑 THE STRAY-JOB HALF HAS NO DIRECTORY TO WALK ON WINDOWS (#570). A
     Scheduled Task is a registration, not a file, so this loop found nothing
     there and the sweep silently reported "no stray jobs" about a machine it had
     not looked at. `win32job.list` is the enumeration, in one query; a query
     that fails sets `failed` rather than passing a blank answer off as a clean
     one, which is the whole reason that flag exists. */
  if (jobs.win32) {
    if (!jobs.known) failed = true;
    else for (const n of jobs.fleet) note(n, 'job');
  } else if (jobs.linux) {
    /* #5445 (display parity): on Linux the jobs are systemd user units, so the walk is the unit folder's, read by
       name and world as the plist walk below reads labels; a folder that cannot be read is could-not-look. */
    try {
      const myWorld = launchidentity.currentWorldId();
      for (const u of require('./linuxjob').listUnits()) if (u.worldId === myWorld) note(u.name, 'job');
    } catch { failed = true; }
  } else {
    try {
      const myWorld = launchidentity.currentWorldId();
      for (const f of readRoot(create.AGENTS_DIR)) {
        if (!f.endsWith('.plist')) continue;
        /* #1704: the LaunchAgents folder holds every Kosmos's agents; a board
           reconciles only its own world's, and note() is keyed on the BARE agent
           name (NAME_RE rejects the `+` in a launch key anyway). */
        const parsed = create.parseServiceLabel(f.slice(0, f.length - '.plist'.length));
        if (!parsed || parsed.worldId !== myWorld) continue;
        try {
          if (fs.statSync(path.join(create.AGENTS_DIR, f)).isFile()) note(parsed.name, 'job');
        } catch (err) { failed = failed || (err && err.code !== 'ENOENT'); }
      }
    } catch (err) { failed = failed || (err && err.code !== 'ENOENT'); }
  }
  /* found-nothing and could-not-look are different facts; the flag keeps
     the soft direction without manufacturing a confident absence. No
     screen reads it yet; #514's surface is where it lands. */
  return { found, failed };
}

/**
 * #6714: has this agent ever run on this board? A running agent reports in, and each report leaves a record: the
 * liveness beat (since #2558) and the self-report history (older). Either one is evidence it ran. Removing an agent
 * clears its liveness but keeps its self-report history, so an agent re-made under a removed one's name counts as run
 * before it starts: that errs toward showing its notice, the safe side. ⚠️ Anything that writes a self-report FOR an
 * agent (an operator action, `by: 'operator'`) would make it count as run; today those only act on a report that
 * already exists (server.js clearLeftovers and the stale needs_you dismiss).
 *
 * 🛑 WHY THE SURVEY NEEDS IT. A profile and a folder are not an agent. A test that stopped half way left
 * `leftover-unrelated` with exactly those two and a CLAUDE.md, and the board told Josh it "will not come back if you
 * restart", offering only to start it at login (2026-10-20). Something that has never run loses nothing on a restart.
 *
 * ⚠️ IT FAILS TOWARD "NOT RUN": an agent with no record is left off the restart notice and never started by the
 * repair. That is safe for the repair and NOT for the warning: a real agent whose report hook was never wired (its
 * settings file could not be merged, or hooks are off) writes no record, so it drops off the notice silently
 * (review 21). Kept, on Josh's rule ("a login it has run"), and named as the plan's weakest premise.
 */
function hasRun(name) {
  for (const fileFor of [liveness.fileFor, selfreport.fileFor]) {
    try { if (fs.existsSync(fileFor(name))) return true; } catch { /* a name with no record path has no record */ }
  }
  return false;
}

/* #6714: the agents the person asked not to be reminded about. A notice, not a fix: hiding one changes nothing about
   whether it comes back, so Settings lists them with a way to show them again. */
function hiddenFile() { return path.join(store.ROOT, 'restart-notices-hidden.json'); }

/** The hidden notices, each the agent's name and which notice was closed (`missing`: "will not come back"; `unknown`:
    "could not check"). Kept per notice (review 17): closing the uncertain one must not silence the certain one that can
    follow it. A file that is missing is none hidden; one we cannot read is none hidden too, so a broken file shows every
    notice rather than hiding them. */
const HIDDEN_GROUPS = ['missing', 'unknown'];
function readHidden() {
  try {
    const e = JSON.parse(fs.readFileSync(hiddenFile(), 'utf8')).entries;
    return Array.isArray(e)
      ? e.filter((x) => x && typeof x.name === 'string' && create.NAME_RE.test(x.name) && HIDDEN_GROUPS.includes(x.group))
        .map((x) => ({ name: x.name, group: x.group }))
      : [];
  } catch { return []; }
}

function writeHidden(entries) {
  const file = hiddenFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const byKey = new Map(entries.map((e) => [e.group + ':' + e.name, { name: e.name, group: e.group }]));
  const out = [...byKey.keys()].sort().map((k) => byKey.get(k));
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ entries: out }) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Drop every hidden notice for these names, reading the list afresh at the write (review 4): the survey that found them
    stale read the list earlier, and writing that older copy back would lose a hide made in between. */
function forgetHidden(names) {
  const now = readHidden();
  const kept = now.filter((e) => !names.includes(e.name));
  if (kept.length !== now.length) writeHidden(kept);
}

/** Stop reminding about one agent's notice, the one it is showing now. Only a name the notice is showing can be
    hidden, so the file holds nothing else. */
function hide(name, opts) {
  const seen = survey(opts);
  if (!seen.ok) return { ok: false, because: seen.because };
  if (seen.hidden.includes(name)) return { ok: true };
  const group = seen.missing.includes(name) ? 'missing' : seen.unknown.includes(name) ? 'unknown' : null;
  if (!group) return { ok: false, notOffered: true, because: 'there is no restart notice for that agent' };
  try { writeHidden([...readHidden(), { name, group }]); } catch { return { ok: false, because: 'we could not record that' }; }
  return { ok: true };
}

/** Show the notices for an agent again. */
function show(name) {
  const now = readHidden();
  if (!now.some((e) => e.name === name)) return { ok: true };
  try { writeHidden(now.filter((e) => e.name !== name)); } catch { return { ok: false, because: 'we could not record that' }; }
  return { ok: true };
}

/**
 * 🛑 THIS SCREEN TOLD EVERY WINDOWS USER "NO" (#570, roadmap §3b). `job` was
 * `fs.existsSync(create.plistPath(name))`, and Windows never writes a plist --
 * it registers a Scheduled Task. So the one screen whose entire purpose is
 * answering "will this agent be here after I restart?" answered NO for every
 * agent on the platform, about a property that had just been MEASURED true on a
 * real reboot (R8, 2026-09-08). Measured here before the fix: three agents with
 * registered tasks, three `job: false` rows.
 *
 * ⚠️ AND IT WOULD HAVE ACTED ON IT. `missing` feeds the restart notice's "Start at
 * login" button, so every Windows agent was offered for repair -- and
 * `installJob`'s never-overwrite guard stat-ed the same plist, so it would not
 * have fired either. On win32 that path launches, so the repair would have put a
 * SECOND live agent in each agent's folder. Both halves are fixed; either alone
 * would have left the other loaded.
 *
 * `opts.platform` is injected so the fleet's Macs can drive the win32 arm; it
 * defaults to the real platform, so production is unchanged.
 */
function survey(opts) {
  const platform = (opts && opts.platform) || process.platform;
  const k = known();
  const rem = remove.removedNames();
  if (!k.ok) {
    return { ok: false, because: 'we could not read what Kosmos knows about your agents', agents: [], missing: [] };
  }
  if (!rem.ok) {
    /* ⚠️ FAIL CLOSED. Without a readable removed list we cannot tell a
       forgotten agent from one somebody deliberately took off the board, and
       the wrong guess starts a process they stopped on purpose. */
    return { ok: false, because: 'we could not read which agents you have removed, so we are not going to change anything', agents: [], missing: [] };
  }
  const removed = new Set(rem.names);
  const jobs = jobReader(platform);
  const agents = k.names.map((name) => ({
    name,
    /* ⚠️ ACT ON `name`, SPEAK `shownAs`. Both travel, and the caller must not
       have to choose: the panel printed the machine name and Josh read
       `ava, bob, brigitte` beside cards saying Ava, Brigitte and Scarlett. */
    shownAs: shownName(name),
    removed: removed.has(name),
    folder: fs.existsSync(create.workerDir(name)),
    /* true, false, or NULL for "we could not look" -- see `jobReader`. */
    job: jobs.of(name),
    /* #500: whether a profile stands behind the name. The stray rows
       below carry false, and everything that ACTS on a name (repair's
       `missing` here, and nothing else today) must require true. */
    profile: true,
    ran: hasRun(name),   // #6714
  }));
  /* #500: what the disk holds that no profile accounts for. */
  const sweep = strays(k.names, jobs);
  for (const [name, on] of sweep.found) {
    agents.push({
      name,
      shownAs: shownName(name),
      removed: removed.has(name),
      folder: on.folder,
      job: on.job,
      profile: false,
      ran: hasRun(name),
    });
  }
  const missingAll = agents.filter((x) => !x.removed && x.folder && x.job === false && x.profile && x.ran).map((x) => x.name);
  const unknownAll = jobs.mac
    ? agents.filter((x) => !x.removed && x.folder && x.job === null && x.profile && x.ran && jobs.whyNull(x.name) !== 'waiting').map((x) => x.name) : [];
  const hiddenList = readHidden();
  const hiddenMissing = new Set(hiddenList.filter((e) => e.group === 'missing').map((e) => e.name));
  const hiddenUnknown = new Set(hiddenList.filter((e) => e.group === 'unknown').map((e) => e.name));
  /* #6714: a hidden name is forgotten when its agent now starts at login, was removed, or is no longer on the board, so
     a later loss shows the notice again and nothing sits hidden where Settings would never list it. "Starts at login"
     is `job === true`, which every reader gives only for a job really found: the Mac's plist or a login job covering
     the agent, Linux's unit file, Windows's name in a Task Scheduler list that answered (a failed list is unknown,
     never true). Read afresh at the write (forgetHidden); written only when something changes. Residuals: an agent
     with a profile but no folder, or a folder but no profile (a stray), keeps its name and Settings cannot list it
     until the agent is whole again; a job waiting its plutil turn drops out of `hidden` for one look. */
  const stale = [...new Set(hiddenList.map((e) => e.name))]
    .filter((n) => !agents.some((x) => x.name === n && x.job !== true && !x.removed));
  if (stale.length) { try { forgetHidden(stale); } catch { /* next look */ } }
  return {
    ok: true,
    because: null,
    straySweepFailed: sweep.failed,
    agents,
    /* The ones a repair would act on: known, not removed, on disk, no job.
       Machine names, because this is the list a repair ACTS on; the sentence
       naming them reads `shownAs` off `agents`.
       ⚠️ AND PROFILE-BACKED ONLY (#500). A stray folder with no profile
       must never be "repaired" into a launchd job: repair would resurrect
       an agent nobody registered, from nothing but a directory name.
       ⚠️ `job === false`, NOT `!job` (#570). `job` is now three-valued, and the
       third value is "we could not look" -- which `!job` would read as "has no
       job" and hand to a button that starts processes. Only a PROVEN absence is
       acted on; an unknown row is left alone. On the Mac `job` is null when a
       login job Kosmos did not write might start the agent but could not be read (#6310). */
    /* #6714: and only agents that have RUN here (hasRun), less the ones the person hid (`hidden`, below). */
    missing: missingAll.filter((n) => !hiddenMissing.has(n)),
    /* #6320: the ones we could not check (job === null), the same filter as `missing` for the other answer, so the two
       lists never overlap. Only on the Mac, where the null comes from something we could not read; never for an agent
       whose only reason is a plist waiting its turn (the plutil budget). jobs.whyNull reads what the `agents` pass
       above recorded, so this must stay after it. */
    unknown: unknownAll.filter((n) => !hiddenUnknown.has(n)),
    /* #6714: the agents that would be on the notice but the person asked not to be reminded about; Settings lists
       them with Show again. A hidden name that no longer needs a notice is not listed. */
    /* Each kept per notice: a closed "could not check" does not hide the "will not come back" that can follow it. */
    hidden: [...missingAll.filter((n) => hiddenMissing.has(n)), ...unknownAll.filter((n) => hiddenUnknown.has(n))],
  };
}

/**
 * Give every agent that is missing one the job it never got.
 *
 * ⚠️ IT REPORTS PER AGENT AND NEVER IN AGGREGATE. "12 agents repaired" over a
 * run where three of them could not be started is the shape of sentence this
 * product keeps removing: the person needs to know WHICH, because the ones that
 * did not start are the ones they will go looking for.
 *
 * ⚠️ `model` is what the caller could read of what each agent last ran as, and
 * it is a live reading rather than a stored choice — the model an agent was
 * SET to run on lived only in the job that does not exist. Passing nothing is
 * honest and lands the agent on Claude's own default; what must not happen is
 * a sentence claiming we restored a choice we never had.
 */
function repair(opts) {
  /* The platform travels from the survey into the install, or the two disagree
     about what a job IS and the repair acts on a set the survey did not report.
     Defaults to the real platform in both. */
  const platform = (opts && opts.platform) || process.platform;
  const seen = survey({ platform });
  if (!seen.ok) return { ok: false, because: seen.because, results: [] };
  /* #6714: one agent, from its own Start at login. Only a name the notice offers: the set a repair acts on is still
     exactly what the survey reports, so a caller cannot name an agent the survey refused. */
  const only = opts && typeof opts.only === 'string' ? opts.only : null;
  if (only !== null && !seen.missing.includes(only)) {
    return { ok: false, refused: true, because: 'that agent does not need this', results: [] };
  }
  const modelFor = (opts && typeof opts.modelFor === 'function') ? opts.modelFor : () => null;
  const results = (only !== null ? [only] : seen.missing).map((name) => {
    let model = null;
    /* A model we cannot read is not a reason to leave the agent unregistered.
       An agent that comes back on the default model is recoverable in one
       click; an agent that does not come back at all is not. */
    try { model = modelFor(name) || null; } catch { model = null; }
    /* 🛑 THE RUNNER TRAVELS TOO, OR A CODEX AGENT IS REPAIRED INTO A CLAUDE ONE
       (#1400). `installJob` reads an absent runner as claude, so this rebuilt a
       missing job pointing at the claude binary with the `codex` argument gone -
       and reported success. The agent comes back on the wrong runner, silently,
       running Claude in a folder set up for Codex.

       🔑 THE ANSWER WAS ALREADY ON DISK. `server.js` derives a card's runner from
       `profile.provider`; this path simply did not read it.

       ⚠️ SAME POSTURE AS THE MODEL ABOVE: an unreadable profile must not leave the
       agent unregistered. A repair onto the default runner is recoverable in one
       click; no repair at all is not. */
    /* 📌 NO try/catch, AND THAT IS MEASURED RATHER THAN ASSUMED. `store.readProfile`
       returns `{}` for a missing file AND for unparseable JSON - it does not throw
       - so a guard here would be unreachable, and a perturbation removing one
       changed no test. The corrupt-profile control below is what holds this: if
       that contract ever changes, it goes red rather than a dead catch hiding it. */
    const provider = (store.readProfile(name) || {}).provider || null;
    /* #3296/#3391: name the runner for every non-claude provider, mirroring the
       codex arm. installJob would resolve the same value via recordedRunner (the
       plist is missing during a repair, so it falls to profile.provider), but
       passing it explicitly from the same read is robust against an unreadable
       profile and keeps repair symmetric across providers. Absent/claude -> pass
       nothing, so installJob's claude default is unchanged. */
    const runnerOpt = provider === 'openai' ? { runner: 'codex' }
      : provider === 'google' ? { runner: 'gemini' }
        : provider === 'xai' ? { runner: 'grok' }
          : provider === 'antigravity' ? { runner: 'antigravity' } // #3568
            : provider === 'meta' ? { runner: 'muse' } // #3939
              : {};
    /* #5977 review 5: a Qwen agent is codex ON ITS QWEN ACCOUNT. Rebuilt without that folder it would be a plain
       OpenAI agent on the default sign-in (billing OpenAI, a different model) and nothing would say so. The account
       is the one the profile recorded; with none, or one that is gone, Repair refuses and says how to fix it. */
    if (provider === 'alibaba') {
      const rec = (store.readProfile(name) || {}).qwenAccount;
      if (typeof rec !== 'string' || !rec || !require('./qwenaccounts').isQwenHome(rec) || !fs.existsSync(rec)) {
        return { name, shownAs: shownName(name), ok: false, because: 'it runs on Qwen and Kosmos does not know which Qwen account any more; switch it to Qwen again to pick one' };
      }
      runnerOpt.runner = 'codex';
      runnerOpt.configDir = rec;
    }
    /* #5534: an imported agent the company policy held never ran here, so Repair does not start it either while
       the policy still says no. An agent that ran before is restored as always (nothing is bricked). */
    if ((store.readProfile(name) || {}).policyHeld === true) {
      const allowed = create.policyAllows(provider || 'anthropic', model, runnerOpt.configDir);   // review 6: a Qwen account names its model
      if (!allowed.ok) return { name, shownAs: shownName(name), ok: false, because: allowed.because };
    }
    const r = create.installJob(name, { model, platform, ...runnerOpt });
    // #5534: once it has run, it is an agent that ran: Repair restores it later whatever the policy says.
    if (r && r.ok) { try { if ((store.readProfile(name) || {}).policyHeld) store.writeProfile(name, { policyHeld: false }); } catch { /* best effort */ } }
    return { name, shownAs: shownName(name), ...r };
  });
  return {
    ok: true,
    because: null,
    results,
    /* Counts for a headline, beside the list rather than instead of it. */
    installed: results.filter((r) => r.ok).length,
    // #4918 review 34: a Linux unit already active is running too (installJob's alreadyRunning), not a failure to start.
    started: results.filter((r) => r.ok && (r.started || r.alreadyRunning)).length,
  };
}

module.exports = { known, survey, repair, shownName, jobReader, hasRun, hide, show };   // jobReader exported for its Linux test (#4918 review 11)
