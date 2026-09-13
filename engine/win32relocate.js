'use strict';
/**
 * "Move Kosmos" (win32-installer-native, installer audit W-06): copy a Kosmos that is running
 * from Downloads, the Desktop, OneDrive or a temporary folder into its own per-user folder,
 * `%LOCALAPPDATA%\Programs\Kosmos`.
 *
 * 🛑 THE FOLDER IS THE INSTALL. The board's and every agent's logon task run the app through
 * the engine pointer, which names wherever Kosmos was last started from. A Downloads folder
 * tidied away later leaves Kosmos unable to start at the next sign-in, and nothing says why.
 *
 * 🔑 THE LAUNCHER DECIDES WHERE KOSMOS IS AND ASKS; THIS DECIDES WHETHER IT MAY MOVE AND COPIES.
 * The launcher has the Known Folder API and the person. What a safe move needs is already in
 * the engine, once each:
 *   - what a build is made of: win32update.ENTRIES, the updater's own list, so a move copies
 *     exactly what an update would swap, a build counts as complete only with every entry, and
 *     `Projects` or anything else in the folder is never copied;
 *   - whether a board may be open on the port: win32handoff.probeBoardOnEveryAddress (both loopbacks
 *     and engine/bindhost.js's bind host), read by win32handoff.boardMayBeOpen (only a refused
 *     connection is no board);
 *   - which folder the running Kosmos runs from: win32anchor.readPointer, the engine pointer;
 *   - which of two builds is newer: update.newer, the updater's own comparison.
 *
 * Rules, each a sentence when it refuses:
 *   - never while a board from THIS folder is serving: a board answers on the port AND the
 *     pointer is inside this folder, or cannot be read;
 *   - never over a different Kosmos, an incomplete one (any ENTRIES item missing; our own move
 *     never leaves one, because it renames a whole staging folder into place), or a folder
 *     holding other files;
 *   - the same build already in place is not copied again (`already-there`);
 *   - the copy goes to a sibling staging folder and is renamed into place. A staging folder an
 *     interrupted move left behind is swept first, but only when its process is gone;
 *   - the old folder is left exactly where it is. After a move the pointer is anchored to the new
 *     folder here, and the new copy's boot anchors it again (win32board.anchorBundle).
 *
 * `compare` answers the other question the launcher has (round 1, finding 4): a copy running from a
 * temporary place when the per-user folder already holds a complete Kosmos. Same build or older:
 * hand off to the installed one. Newer: run from here, as a by-hand update does today.
 *
 * ⚠️ GATED (convention 3): `relocate()` refuses without `liveExecutionAllowed`, and the move CLI is
 * a dry run unless `--yes`, which only the launcher passes after the person chose Move Kosmos.
 * `--compare` only reads.
 *
 *     node app\engine\win32relocate.js --move --from <folder> --to <folder> --port <n> [--report <file>] [--yes]
 *     node app\engine\win32relocate.js --compare --from <folder> --to <folder> [--report <file>]
 *     node app\engine\win32relocate.js --compare --from <folder> --pointer [--report <file>]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const liveExec = require('./live-execution');
const win32anchor = require('./win32anchor');

const MANIFEST_NAME = 'manifest.json';
/* Beside the target, so the rename that finishes a move is a rename on one volume. The process id
   follows it, so a leftover can be told from a move still under way. */
const STAGING_INFIX = '.kosmos-move-';

const KEEPS_WORKING = 'Kosmos keeps working from here.';
const MAY_BE_RUNNING_FROM_UNKNOWN_FOLDER = 'Kosmos was not moved, because Kosmos may be running and it could not tell from which folder. ' + KEEPS_WORKING;
const RESTART_THEN_OPEN_AGAIN = 'Restart your computer, then open Kosmos again.';

const USAGE = 'usage: node engine/win32relocate.js --move --from <folder> --to <folder> --port <n> [--report <file>] [--yes]\n'
  + '       node engine/win32relocate.js --compare --from <folder> --to <folder> [--report <file>]\n'
  + '       node engine/win32relocate.js --compare --from <folder> --pointer [--report <file>]';

function firstLine(value) {
  return String((value && value.message) || value || 'no detail').trim().split(/\r?\n/)[0];
}

/** Case-insensitive on Windows, where paths are; exact elsewhere. */
function isSameOrInside(child, parent) {
  const fold = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const c = fold(path.resolve(String(child))).replace(/[\\/]+$/, '');
  const r = fold(path.resolve(String(parent))).replace(/[\\/]+$/, '');
  if (!r) return false;
  return c === r || c.startsWith(r + path.sep);
}

/** The build's manifest, as the build script writes it, or null. */
function readManifest(root) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_NAME), 'utf8'));
    return m && typeof m === 'object' ? m : null;
  } catch { return null; }
}

function buildEntries(o) {
  return (o && o.entries) || require('./win32update').ENTRIES;
}

/** The ENTRIES items this folder does not have. ONE check, for the folder moved from and to. */
function missingEntries(root, entries) {
  return entries.filter((entry) => !fs.existsSync(path.join(root, entry)));
}

/* A Kosmos build: its manifest names the product and the platform, and every entry is there. */
function isCompleteBuild(root, manifest, entries) {
  return Boolean(manifest) && manifest.product === 'kosmos' && manifest.platform === 'win32' && missingEntries(root, entries).length === 0;
}

function sameBuild(a, b) {
  return String(a.version || '') === String(b.version || '') && String(a.source_sha || '') === String(b.source_sha || '');
}

/**
 * The ONE verdict on two Kosmos builds, this copy (`mine`) against the installed one (`theirs`),
 * read by both `compare` and `relocate` so they can never disagree about "the same build" (round 2,
 * finding 3: compare looked at the version alone, relocate at the version and the commit).
 *   'same'             same version AND same source_sha
 *   'installed-newer'  the installed version is newer, by update.newer (the updater's comparison)
 *   'this-newer'       this copy's version is newer, by update.newer
 *   'rebuilt'          the same readable version from another commit (a rebuilt candidate)
 *   'unreadable'       anything else: a missing manifest, or a version update.newer cannot read.
 *                      update.newer reads only `x.y.z`, so `0.6.62-rc.1` is unreadable here too.
 */
function buildVerdict(mine, theirs, newer) {
  if (!mine || !theirs) return 'unreadable';
  if (sameBuild(mine, theirs)) return 'same';
  const isNewer = typeof newer === 'function' ? newer : require('./update').newer;
  if (isNewer(theirs.version, mine.version)) return 'installed-newer';
  if (isNewer(mine.version, theirs.version)) return 'this-newer';
  /* A version update.newer can read is newer than 0.0.0 or IS 0.0.0; one it cannot read is neither. */
  const readable = (v) => isNewer(v, '0.0.0') || String(v).trim() === '0.0.0';
  if (String(mine.version).trim() === String(theirs.version).trim() && readable(mine.version)) return 'rebuilt';
  return 'unreadable';
}

function refused(because) { return { ok: false, action: 'refused', because }; }

/**
 * Round 1, finding 10: remove the staging folders of moves that were interrupted, before staging a
 * new one. Only a folder whose process is GONE (win32orphan.pidState, the rule the updater's lock
 * uses; never its age), and never through a link: a junction or symbolic link with a staging name
 * is removed as a link, so the folder it points at is never entered. A staging folder of a process
 * still running, or one we cannot check, is left.
 */
function sweepInterruptedMoves(to, pidState) {
  const parent = path.dirname(to);
  const prefix = (path.basename(to) + STAGING_INFIX).toLowerCase();
  const swept = [];
  let names;
  try { names = fs.readdirSync(parent); } catch { return swept; }
  for (const name of names) {
    if (!name.toLowerCase().startsWith(prefix)) continue;
    const pid = Number(name.slice(prefix.length));
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const at = path.join(parent, name);
    let st;
    try { st = fs.lstatSync(at); } catch { continue; }
    try {
      if (st.isSymbolicLink()) {
        try { fs.rmdirSync(at); } catch { fs.unlinkSync(at); }
        swept.push(at);
      } else if (st.isDirectory() && (pid === process.pid || pidState(pid) === 'gone')) {
        fs.rmSync(at, { recursive: true, force: true });
        swept.push(at);
      }
    } catch { /* a leftover that will not go is only a leftover; the move itself stages elsewhere */ }
  }
  return swept;
}

/**
 * Point the engine pointer at the folder Kosmos now lives in (round 1, finding 3). The moved copy's
 * own boot anchors again; doing it here too means a move is complete even if that boot never comes.
 * A failure is reported, not fatal: the move itself happened.
 */
function anchorTo(o, to) {
  if (typeof o.anchor !== 'function' && liveExec.inTestProcess()) {
    throw new Error('win32relocate: a test must pass an anchor seam; the real one rewrites %LOCALAPPDATA%\\Kosmos');
  }
  const anchor = typeof o.anchor === 'function' ? o.anchor : (spec) => win32anchor.ensureAnchored(spec);
  let a;
  try {
    a = anchor({ platform: 'win32', home: o.home, env: o.env, node: path.join(to, 'runtime', 'node.exe'), engineDir: path.join(to, 'app', 'engine') });
  } catch (e) { a = { ok: false, because: firstLine(e) }; }
  return a && a.ok ? { anchored: true } : { anchored: false, anchorProblem: (a && a.because) || 'no detail' };
}

/**
 * @param {object} opts  from, to, port, liveExecutionAllowed; seams: probe(port), readPointer(),
 *                       copy(src, dst), entries, anchor(spec), pidState(pid), env, home
 * @returns {Promise<{ok: true, action: 'moved'|'already-there', target: string, anchored: boolean}|{ok: false, action: 'refused', because: string}>}
 */
async function relocate(opts) {
  const o = opts || {};
  const allowed = typeof o.liveExecutionAllowed === 'function' ? o.liveExecutionAllowed() : liveExec.liveExecutionAllowed();
  if (!allowed) return refused('Kosmos was not moved, because moving it was not confirmed. ' + KEEPS_WORKING);
  if (!o.from || !o.to) return refused('Kosmos was not told where to move from and to. ' + KEEPS_WORKING);
  const from = path.resolve(o.from);
  const to = path.resolve(o.to);
  if (isSameOrInside(to, from) || isSameOrInside(from, to)) {
    return refused('Kosmos was not moved, because ' + to + ' and the folder it runs from overlap. ' + KEEPS_WORKING);
  }

  const entries = buildEntries(o);
  const mine = readManifest(from);
  if (!mine || mine.product !== 'kosmos' || mine.platform !== 'win32') {
    return refused('Kosmos was not moved, because this folder is not a complete Kosmos. ' + KEEPS_WORKING);
  }
  const missing = missingEntries(from, entries);
  if (missing.length) {
    return refused('Kosmos was not moved, because this Kosmos folder is missing ' + missing.join(', ') + '. ' + KEEPS_WORKING);
  }

  /* Never while a board from this folder is serving. */
  const port = Number(o.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return refused('Kosmos was not moved, because it could not tell which port Kosmos uses, so it could not check whether Kosmos is running from this folder. ' + KEEPS_WORKING);
  }
  const handoff = require('./win32handoff');
  /* Round 4, finding 1: every address a board of this user could be on, not 127.0.0.1 alone. */
  const probe = typeof o.probe === 'function' ? o.probe : (p) => handoff.probeBoardOnEveryAddress(p, o.env || process.env, undefined, o.lookup);
  let answer = null;
  try { answer = await probe(port); } catch { answer = null; }
  /* Round 3, finding 1: only a refused connection proves no board is there (win32handoff.boardMayBeOpen,
     the uninstall's reading too). One that did not answer, or a look that failed, cannot even be asked
     which folder it serves, so nothing moves. Round 4, finding 3: the sentence says which. */
  if ((!answer || !answer.answering) && handoff.boardMayBeOpen(answer)) {
    if (answer && answer.outcome === handoff.PROBE_OUTCOMES.TIMED_OUT) {
      return refused('Kosmos was not moved, because Kosmos may be running and did not answer in time. ' + KEEPS_WORKING);
    }
    let task = null;
    try { task = require('./win32board').status(); } catch { task = null; }
    if (task && task.known && task.running !== true) return refused(handoff.cannotTellIfOpenSentence(port, task) + ' ' + RESTART_THEN_OPEN_AGAIN);
    return refused(MAY_BE_RUNNING_FROM_UNKNOWN_FOLDER);
  }
  if (answer && answer.answering) {
    let pointer = null;
    try {
      pointer = typeof o.readPointer === 'function'
        ? o.readPointer()
        : win32anchor.readPointer('win32', o.home || os.homedir(), o.env || process.env);
    } catch { pointer = null; }
    if (!pointer) return refused(MAY_BE_RUNNING_FROM_UNKNOWN_FOLDER);
    if (isSameOrInside(pointer, from)) {
      return refused('Kosmos is running from this folder right now, so it was not moved. ' + KEEPS_WORKING);
    }
  }

  /* The target: absent, empty, or already this very build, complete. */
  if (fs.existsSync(to)) {
    let stat;
    try { stat = fs.statSync(to); } catch (e) { return refused('Kosmos was not moved, because ' + to + ' could not be read (' + firstLine(e) + '). ' + KEEPS_WORKING); }
    if (!stat.isDirectory()) return refused('Kosmos was not moved, because ' + to + ' is a file, not a folder. ' + KEEPS_WORKING);
    if (fs.readdirSync(to).length) {
      const theirs = readManifest(to);
      if (!theirs || theirs.product !== 'kosmos') {
        return refused('Kosmos was not moved, because ' + to + ' already holds other files. ' + KEEPS_WORKING);
      }
      const theirsMissing = missingEntries(to, entries);
      if (theirsMissing.length) {
        return refused('Kosmos was not moved, because the Kosmos in ' + to + ' is incomplete (it is missing ' + theirsMissing.join(', ') + '). ' + KEEPS_WORKING);
      }
      if (buildVerdict(mine, theirs, o.newer) !== 'same') {
        return refused('There is already a different Kosmos (version ' + (theirs.version || 'unknown') + ') in ' + to
          + ', so this one was not moved there. ' + KEEPS_WORKING);
      }
      return { ok: true, action: 'already-there', target: to, ...anchorTo(o, to) };
    }
  }

  const copy = typeof o.copy === 'function' ? o.copy : (src, dst) => fs.cpSync(src, dst, { recursive: true, errorOnExist: true, force: false });
  sweepInterruptedMoves(to, typeof o.pidState === 'function' ? o.pidState : require('./win32orphan').pidState);
  const staging = to + STAGING_INFIX + process.pid;
  try {
    fs.mkdirSync(staging, { recursive: true });
    for (const entry of entries) copy(path.join(from, entry), path.join(staging, entry));
    /* rmdir, not rm: it refuses a folder that is no longer empty, so nothing that arrived in
       the target since it was checked is ever deleted. */
    if (fs.existsSync(to)) fs.rmdirSync(to);
    fs.renameSync(staging, to);
  } catch (e) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* the sentence below still names the failure */ }
    return refused('Kosmos could not be copied to ' + to + ' (' + firstLine(e) + '), so it was not moved. ' + KEEPS_WORKING);
  }
  return { ok: true, action: 'moved', target: to, ...anchorTo(o, to) };
}

/**
 * Round 1 finding 4, round 2 findings 3 and 4: this copy runs from anywhere outside `to` (the per-user
 * folder) and `to` exists. Which one should run? From buildVerdict, the one derivation:
 *   'none'     `to` holds no complete Kosmos (a missing manifest, another product, any ENTRIES item
 *              missing): the launcher's ordinary behaviour applies, and so does Keep it here.
 *   'newer'    this copy is newer ('this-newer'), or the same version rebuilt from another commit
 *              ('rebuilt', which staging verification of a rebuilt candidate needs): run from here and
 *              re-point, as a by-hand update does today (until the in-app update from a downloaded zip
 *              reuses engine/win32apply.js).
 *   'handoff'  the same build, an installed build that is newer, or anything unreadable: the installed
 *              Kosmos is the one that runs, and this copy re-points nothing.
 */
function compare(opts) {
  const o = opts || {};
  const from = path.resolve(o.from);
  const to = path.resolve(o.to);
  const theirs = readManifest(to);
  if (!isCompleteBuild(to, theirs, buildEntries(o))) return { verdict: 'none', target: to };
  const mine = readManifest(from);
  const build = buildVerdict(mine, theirs, o.newer);
  const runsHere = build === 'this-newer' || build === 'rebuilt';
  return { verdict: runsHere ? 'newer' : 'handoff', build, target: to, mine: mine ? mine.version : null, installed: theirs.version };
}

/**
 * Round 3, finding 6: this copy IS the per-user install (`from` is `Programs\Kosmos`), and the engine
 * pointer may name another copy the person started last, a newer downloaded zip, say. Starting the
 * installed copy must never move the pointer back to an older build (Josh: never downgrade). From the
 * pointer (win32anchor.readPointer) and the one build verdict, the pointed-at copy against this one:
 *   'handoff'  the pointed-at copy is complete and newer, or the same version from another commit: it
 *              runs, and this copy re-points nothing;
 *   'none'     no pointer, a pointer naming this copy, or a pointed-at copy that is missing, incomplete,
 *              unreadable or not newer: this copy runs and re-points, as before. It never hands off to a
 *              copy that is not there.
 */
function compareWithPointer(opts) {
  const o = opts || {};
  const here = path.resolve(o.from);
  let pointer = null;
  try {
    pointer = typeof o.readPointer === 'function'
      ? o.readPointer()
      : win32anchor.readPointer('win32', o.home || os.homedir(), o.env || process.env);
  } catch { pointer = null; }
  if (!pointer) return { verdict: 'none', target: here, because: 'there is no engine pointer' };
  /* The pointer names <bundle>\app\engine. */
  const pointed = path.resolve(pointer, '..', '..');
  if (isSameOrInside(pointed, here) && isSameOrInside(here, pointed)) return { verdict: 'none', target: here, because: 'the pointer names this copy' };
  const theirs = readManifest(pointed);
  if (!isCompleteBuild(pointed, theirs, buildEntries(o))) return { verdict: 'none', target: pointed, because: 'the copy the pointer names is missing or incomplete' };
  const build = buildVerdict(theirs, readManifest(here), o.newer);
  if (build === 'this-newer' || build === 'rebuilt') return { verdict: 'handoff', target: pointed, build };
  return { verdict: 'none', target: pointed, build };
}

/** The report the launcher reads: its first line is the outcome. */
function reportText(result) {
  if (result.verdict) return result.verdict.toUpperCase() + ' ' + result.target + '\r\n';
  if (result.ok) return (result.action === 'moved' ? 'MOVED ' : 'SAME ') + result.target + '\r\n';
  return 'REFUSED ' + String(result.because).replace(/\s*\r?\n\s*/g, ' ') + '\r\n';
}

function parseCliArgs(argv) {
  const a = { move: false, compare: false, pointer: false, yes: false, from: null, to: null, port: null, report: null, unknown: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--move') a.move = true;
    else if (arg === '--compare') a.compare = true;
    else if (arg === '--pointer') a.pointer = true;
    else if (arg === '--yes') a.yes = true;
    else if (['--from', '--to', '--port', '--report'].includes(arg)) { a[arg.slice(2)] = argv[i + 1] || null; i += 1; }
    else a.unknown = arg;
  }
  return a;
}

function writeReport(a, result, out) {
  if (!a.report) return true;
  try {
    fs.writeFileSync(a.report, reportText(result), 'utf8');
    return true;
  } catch (e) {
    out('could not write the report to ' + a.report + ': ' + firstLine(e) + '\n');
    return false;
  }
}

/**
 * `--yes` is the launcher's word that the person chose Move Kosmos; it stands in for
 * allowLiveExecution(). Without it a move prints what it would do and exits 2, copying nothing.
 * `--compare` changes nothing, so it needs no `--yes`.
 */
async function cliMain(argv, deps) {
  const d = deps || {};
  const out = typeof d.write === 'function' ? d.write : (s) => process.stdout.write(s);
  const a = parseCliArgs(argv);
  const withPointer = a.compare && a.pointer;
  if ((a.move === a.compare) || !a.from || (!withPointer && !a.to) || (a.pointer && !a.compare) || (withPointer && a.to) || a.unknown) { out(USAGE + '\n'); return 64; }
  if (a.compare) {
    const verdict = withPointer ? (d.compareWithPointer || compareWithPointer)({ from: a.from }) : (d.compare || compare)({ from: a.from, to: a.to });
    if (!writeReport(a, verdict, out)) return 1;
    out(JSON.stringify(verdict, null, 2) + '\n');
    return 0;
  }
  if (!a.yes) {
    out(JSON.stringify({ dryRun: true, from: path.resolve(a.from), to: path.resolve(a.to), because: 'nothing was copied: add --yes to move Kosmos' }, null, 2) + '\n');
    return 2;
  }
  const result = await (d.relocate || relocate)({ from: a.from, to: a.to, port: a.port, liveExecutionAllowed: () => true });
  if (!writeReport(a, result, out)) return 1;
  out(JSON.stringify(result, null, 2) + '\n');
  return result.ok ? 0 : 1;
}

module.exports = { relocate, compare, compareWithPointer, buildVerdict, cliMain, reportText, sweepInterruptedMoves, STAGING_INFIX };

/* Guarded on being the main module: requiring this file must never copy anything. */
if (require.main === module) {
  cliMain(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { process.stderr.write(String((e && e.stack) || e) + '\n'); process.exitCode = 1; },
  );
}
