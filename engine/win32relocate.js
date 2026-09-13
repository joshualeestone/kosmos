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
 *     exactly what an update would swap, and never `Projects` or anything else in the folder;
 *   - whether a board answers on the port: win32handoff.probeBoard;
 *   - which folder the running Kosmos runs from: win32anchor.readPointer, the engine pointer.
 *
 * Rules, each a sentence when it refuses:
 *   - never while a board from THIS folder is serving: a board answers on the port AND the
 *     pointer is inside this folder, or cannot be read;
 *   - never over a different Kosmos, an incomplete one, or a folder holding other files;
 *   - the same build already in place is not copied again (`already-there`);
 *   - the copy goes to a sibling staging folder and is renamed into place, so the target is
 *     either absent or whole. A failed copy removes only its own staging folder;
 *   - the old folder is left exactly where it is. The launcher starts the new copy, whose boot
 *     re-anchors (win32board.ensureInstalled), which moves the engine pointer.
 *
 * ⚠️ GATED (convention 3): `relocate()` refuses without `liveExecutionAllowed`, and the CLI is a
 * dry run unless `--yes`, which only the launcher passes after the person chose Move Kosmos.
 *
 *     node app\engine\win32relocate.js --move --from <folder> --to <folder> --port <n> [--report <file>] [--yes]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const liveExec = require('./live-execution');
const win32anchor = require('./win32anchor');

const MANIFEST_NAME = 'manifest.json';
/* Beside the target, so the rename that finishes a move is a rename on one volume. */
const STAGING_INFIX = '.kosmos-move-';

const KEEPS_WORKING = 'Kosmos keeps working from here.';

const USAGE = 'usage: node engine/win32relocate.js --move --from <folder> --to <folder> --port <n> [--report <file>] [--yes]';

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

/* The files KosmosLauncher.cs checks before it starts anything, plus the launcher itself. */
function isCompleteBuild(root, manifest) {
  return Boolean(manifest) && manifest.product === 'kosmos' && manifest.platform === 'win32'
    && ['Kosmos.exe', path.join('runtime', 'node.exe'), path.join('app', 'server.js')].every((f) => fs.existsSync(path.join(root, f)));
}

function sameBuild(a, b) {
  return String(a.version || '') === String(b.version || '') && String(a.source_sha || '') === String(b.source_sha || '');
}

function refused(because) { return { ok: false, action: 'refused', because }; }

/**
 * @param {object} opts  from, to, port, liveExecutionAllowed; seams: probe(port), readPointer(),
 *                       copy(src, dst), entries, env, home
 * @returns {Promise<{ok: true, action: 'moved'|'already-there', target: string}|{ok: false, action: 'refused', because: string}>}
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

  const mine = readManifest(from);
  if (!isCompleteBuild(from, mine)) return refused('Kosmos was not moved, because this folder is not a complete Kosmos. ' + KEEPS_WORKING);
  const entries = o.entries || require('./win32update').ENTRIES;
  const missing = entries.filter((entry) => !fs.existsSync(path.join(from, entry)));
  if (missing.length) {
    return refused('Kosmos was not moved, because this Kosmos folder is missing ' + missing.join(', ') + '. ' + KEEPS_WORKING);
  }

  /* Never while a board from this folder is serving. */
  const port = Number(o.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return refused('Kosmos was not moved, because it could not tell which port Kosmos uses, so it could not check whether Kosmos is running from this folder. ' + KEEPS_WORKING);
  }
  const probe = typeof o.probe === 'function' ? o.probe : (p) => require('./win32handoff').probeBoard(p);
  let answer = null;
  try { answer = await probe(port); } catch { answer = null; }
  if (!answer || answer.answering) {
    let pointer = null;
    try {
      pointer = typeof o.readPointer === 'function'
        ? o.readPointer()
        : win32anchor.readPointer('win32', o.home || os.homedir(), o.env || process.env);
    } catch { pointer = null; }
    if (!pointer) {
      return refused('Kosmos was not moved, because Kosmos may be running and it could not tell from which folder. ' + KEEPS_WORKING);
    }
    if (isSameOrInside(pointer, from)) {
      return refused('Kosmos is running from this folder right now, so it was not moved. ' + KEEPS_WORKING);
    }
  }

  /* The target: absent, empty, or already this very build. */
  if (fs.existsSync(to)) {
    let stat;
    try { stat = fs.statSync(to); } catch (e) { return refused('Kosmos was not moved, because ' + to + ' could not be read (' + firstLine(e) + '). ' + KEEPS_WORKING); }
    if (!stat.isDirectory()) return refused('Kosmos was not moved, because ' + to + ' is a file, not a folder. ' + KEEPS_WORKING);
    if (fs.readdirSync(to).length) {
      const theirs = readManifest(to);
      if (!theirs || theirs.product !== 'kosmos') {
        return refused('Kosmos was not moved, because ' + to + ' already holds other files. ' + KEEPS_WORKING);
      }
      if (!sameBuild(mine, theirs)) {
        return refused('There is already a different Kosmos (version ' + (theirs.version || 'unknown') + ') in ' + to
          + ', so this one was not moved there. ' + KEEPS_WORKING);
      }
      if (!isCompleteBuild(to, theirs)) {
        return refused('Kosmos was not moved, because the Kosmos in ' + to + ' is incomplete. ' + KEEPS_WORKING);
      }
      return { ok: true, action: 'already-there', target: to };
    }
  }

  const copy = typeof o.copy === 'function' ? o.copy : (src, dst) => fs.cpSync(src, dst, { recursive: true, errorOnExist: true, force: false });
  const staging = to + STAGING_INFIX + process.pid;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
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
  return { ok: true, action: 'moved', target: to };
}

/** The report the launcher reads: its first line is the outcome. */
function reportText(result) {
  if (result.ok) return (result.action === 'moved' ? 'MOVED ' : 'SAME ') + result.target + '\r\n';
  return 'REFUSED ' + String(result.because).replace(/\s*\r?\n\s*/g, ' ') + '\r\n';
}

function parseCliArgs(argv) {
  const a = { move: false, yes: false, from: null, to: null, port: null, report: null, unknown: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--move') a.move = true;
    else if (arg === '--yes') a.yes = true;
    else if (['--from', '--to', '--port', '--report'].includes(arg)) { a[arg.slice(2)] = argv[i + 1] || null; i += 1; }
    else a.unknown = arg;
  }
  return a;
}

/**
 * `--yes` is the launcher's word that the person chose Move Kosmos; it stands in for
 * allowLiveExecution(). Without it this prints what it would do and exits 2, copying nothing.
 */
async function cliMain(argv, deps) {
  const d = deps || {};
  const out = typeof d.write === 'function' ? d.write : (s) => process.stdout.write(s);
  const a = parseCliArgs(argv);
  if (!a.move || !a.from || !a.to || a.unknown) { out(USAGE + '\n'); return 64; }
  if (!a.yes) {
    out(JSON.stringify({ dryRun: true, from: path.resolve(a.from), to: path.resolve(a.to), because: 'nothing was copied: add --yes to move Kosmos' }, null, 2) + '\n');
    return 2;
  }
  const result = await (d.relocate || relocate)({ from: a.from, to: a.to, port: a.port, liveExecutionAllowed: () => true });
  if (a.report) {
    try {
      fs.writeFileSync(a.report, reportText(result), 'utf8');
    } catch (e) {
      out('could not write the report to ' + a.report + ': ' + firstLine(e) + '\n');
      return 1;
    }
  }
  out(JSON.stringify(result, null, 2) + '\n');
  return result.ok ? 0 : 1;
}

module.exports = { relocate, cliMain, reportText, STAGING_INFIX };

/* Guarded on being the main module: requiring this file must never copy anything. */
if (require.main === module) {
  cliMain(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { process.stderr.write(String((e && e.stack) || e) + '\n'); process.exitCode = 1; },
  );
}
