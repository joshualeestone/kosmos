'use strict';

/**
 * #4382, the Windows half: a computer that connects to agents on another computer must still update,
 * and must still be able to roll back, with no board.
 *
 * On Windows the board is what looks for updates (update.js polls latest-win.json) and what starts the
 * updater (update.js beginInstall -> win32update.begin, and the Roll back button -> rollbackToPrevious).
 * A computer set to "Connect to agents on another computer" (#4381) has stopped its board and switched
 * its logon task off on purpose, so neither ever runs there. Kosmos.exe's window, the only part of
 * Kosmos such a computer runs, asks this file instead: at launch, once a day while the window is open,
 * and when the person picks "Update Kosmos" or "Roll back Kosmos" in the window's system menu.
 *
 * It runs the board's OWN rules by requiring the board's own modules, not copies of them:
 *   - the look, the channel, the pointer and the consent: engine/update-ifnewer.js decide(), the Mac
 *     half's look, which is platform-neutral (on win32 update.js reads latest-win.json and the bundle
 *     root, and autoupdate.read() is the same switch: no file is on, an unreadable one is off);
 *   - the install: win32update.begin(), the same download, checks, journal and detached helper the
 *     board's Update button starts, held to the connect computer's preconditions
 *     (win32update.connectComputerRefusal) in place of the board task's;
 *   - the rollback: win32update.rollbackToPrevious(), the same kept build and the same helper the
 *     board's Roll back button uses, with the same preconditions;
 *   - the outcome: win32update.waitForOutcome(), the status record the helper writes.
 * The helper itself already leaves a connect computer's board stopped: H7, H8, the resumers and the
 * post-exit restart start no board while the mode file does not read run or both (#4381,
 * win32apply.startAndConfirm and restartBoardAfterExit). Nothing here starts one either.
 *
 *   <bundle>\runtime\node.exe <bundle>\app\engine\win32connectupdate.js --look|--install|--rollback
 *       [--port <n>] [--report <file>] --yes
 *
 *   --look      the look; installs too when updates are on (the board does the same, maybeAutoInstall)
 *   --install   the person chose "Update Kosmos": installs a newer build whatever the switch says
 *   --rollback  the person chose "Roll back Kosmos": restores the build the last update replaced
 *
 * Without --yes nothing is looked at or changed (exit 2). The answer is the FIRST line of the report
 * (and of stdout), one word and its value:
 *   current <v>        nothing newer than <v>, the installed version
 *   newer <v>          newer, and updates are off here (or the switch cannot be read): offered, not installed
 *   updated <v>        installed; the board was left stopped
 *   rolledback <v>     rolled back to <v>; the board was left stopped
 *   failed <v> <why>   the update to <v>, or the rollback to <v>, was started and did not finish
 *   board              a Kosmos board answers on this computer, and it updates itself
 *   unknown <why>      the release host could not be reached or read, or this is not an installed Kosmos
 *   refused <why>      not done here: not a connect computer, an agent asked, or a precondition failed
 * and, after it, when a kept build can be rolled back to on this computer (connectReadyBuild):
 *   rollback <v>
 * Exit 0 for current, newer, updated, rolledback and board; 1 for failed and unknown; 3 for refused.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const update = require('./update');
const ifnewer = require('./update-ifnewer');
const win32update = require('./win32update');
/* Loaded here, before anything runs: an update moves this build's app folder aside, and a module first
   required after that would be read from the NEW build (the helper's own rule, H1). */
const win32apply = require('./win32apply');
const win32handoff = require('./win32handoff');
const liveExec = require('./live-execution');
const win32anchor = require('./win32anchor');
const win32swap = require('./win32swap');

const ACTIONS = Object.freeze(['look', 'install', 'rollback']);
const EXIT = Object.freeze({ current: 0, newer: 0, updated: 0, rolledback: 0, board: 0, failed: 1, unknown: 1, refused: 3 });

/** An agent never updates the Kosmos it runs under (install/kosmos _invoked_by_agent, the same marks). */
function invokedByAgent(env) {
  const e = env || {};
  return Boolean(e.KOSMOS_AGENT_SESSION || e.KOSMOS_AGENT_TOKEN);
}

function oneLine(text) { return String(text === undefined || text === null ? '' : text).replace(/[\t\r\n]+/g, ' ').trim(); }

/**
 * May a computer that connects elsewhere roll back to the build in `dir`? Only when that build can itself
 * live with no board: it carries this file (so it can update itself again, and it is from #4382 or later),
 * which also means its Kosmos.exe is launcher 8.1 or later and honours the connect choice (#4381; the
 * launcher is committed beside the engine, so a build carrying this file carries a launcher at least that
 * new). A build older than that would start a board on a computer whose person chose not to run one, and
 * could never update again. A sentence saying why not, or null.
 */
function connectReadyRefusal(dir, version) {
  let here = false;
  try { here = fs.statSync(path.join(dir, 'app', 'engine', path.basename(__filename))).isFile(); } catch { here = false; }
  if (here) return null;
  return `the version kept for a rollback (${version}) is too old for a computer that connects to agents on another computer: it would start agents here, and could not update itself again. Download the version you want from the Kosmos website instead`;
}

/** The rollback this computer can take, as the version, or null: the board's own offer (a kept build
    strictly older than the one installed, in a folder the updater takes), narrowed to a build that is
    connect-ready (connectReadyRefusal). */
function connectRollbackOffer(root) {
  try {
    if (update.windowsLocationRefusal()) return null;
    const kept = win32update.keptPreviousBuild(root);
    if (!kept || connectReadyRefusal(kept.dir, kept.version)) return null;
    return kept.version;
  } catch { return null; }
}

/**
 * A version the person rolled back from, so the window's own look does not install it again by itself a
 * few seconds later (updates are on by default). Kept beside the update journal, in the updater's anchor
 * folder. The look offers a held version instead of installing it; the person picking Update installs it
 * (the helper lets it go at any finished forward update, win32apply.finishUpdated), and a version strictly
 * newer than the held one installs as usual. The board's own
 * automatic install has the same gap after its Roll back button; that is not changed here.
 */
/* Only reached once run() has refused anything but win32, so the anchor is always Windows'. */
function heldPath(env, home) { return path.join(win32anchor.anchorDir('win32', home, env), win32anchor.UPDATE_HELD_NAME); }
function readHeld(env, home) {
  try { const v = JSON.parse(fs.readFileSync(heldPath(env, home), 'utf8')).version; return typeof v === 'string' ? v : null; } catch { return null; }
}
function writeHeld(env, home, version, log) {
  try { win32swap.writeFileAtomic(heldPath(env, home), JSON.stringify({ version, at: new Date().toISOString() }) + '\n'); } catch (e) {
    log(`could not record that ${version} was rolled back from, so the next look may install it again (${(e && e.code) || 'error'})`);
  }
}

/**
 * One run. Resolves to `{ answer: [word, value?], rollback: <version>|null, note: <text>|null }`. Options:
 * expect (the version the person agreed to: for a rollback any other kept build is refused; for an install
 * a newer release than that is offered, not installed). Seams, each with
 * its production default: platform, env, home, port, root (update.installedRoot), probe
 * (win32handoff.probeBoard), readsConnect (win32apply.readsConnect), decide (update-ifnewer.decide),
 * begin, rollbackToPrevious, wait (waitForOutcome's seams), liveExecutionAllowed (the live-execution
 * gate; cliMain's --yes opens it), log.
 */
async function run(action, opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const env = o.env || process.env;
  const home = o.home || os.homedir();
  const port = Number.isInteger(o.port) ? o.port : win32update.DEFAULT_BOARD_PORT;
  const log = typeof o.log === 'function' ? o.log : () => {};
  const probe = o.probe || win32handoff.probeBoard;
  const readsConnect = o.readsConnect || (() => win32apply.readsConnect(env, home));
  let root = null;
  let note = null;
  const done = (answer, rollback) => ({ answer, note, rollback: rollback === undefined ? (root ? connectRollbackOffer(root) : null) : rollback });

  if (!ACTIONS.includes(action)) return done(['refused', `no such action: ${action}`], null);
  if (platform !== 'win32') return done(['refused', 'this is the Windows connect computer\'s update, and this is not Windows'], null);
  if (invokedByAgent(env)) return done(['refused', 'an agent may not update Kosmos; the person who runs this computer does'], null);
  if (readsConnect() !== true) {
    return done(['refused', 'this computer is not set to connect to agents elsewhere; its own board keeps it updated'], null);
  }
  root = o.root !== undefined ? o.root : update.installedRoot();
  if (!root) return done(['unknown', 'this is not an installed copy of Kosmos'], null);

  /* A board that answers looks for itself every fifteen minutes, and two updaters must never race. Asked
     once here and handed to the precondition as measured, so B0 refuses on the same answer. On loopback a
     Kosmos board always names itself (win32handoff, x-kosmos-board-identity), so an answer with no identity
     is another program holding the port: the update's stop could not free it, so nothing is started. */
  const answer = await probe(port);
  if (answer && answer.answering === true) {
    if (answer.identity) return done(['board']);
    return done(['refused', `another program answers on port ${port}, so Kosmos did not start`]);
  }
  const connectComputer = { connects: () => readsConnect() === true, boardAnswers: () => Boolean(answer && answer.answering === true) };
  const common = {
    root, port, boardPid: null, connectComputer, log, env, home,
    liveExecutionAllowed: o.liveExecutionAllowed || liveExec.liveExecutionAllowed,
    ...(o.helperOptions || {}),
  };

  /* An update this computer started and never finished (a crash, a power cut, a helper killed) has nobody
     else to finish it here: the board's logon shim, which resumes one at every start, never runs on a
     computer that connects elsewhere. So every run first hands such a journal to begin()'s own resume
     (resumeOnly: it starts the resumer from the old build's code, or clears a journal nobody can finish,
     and never installs anything new), and says so instead of doing what it was asked. */
  const journalAt = win32apply.journalPathFor(win32anchor.anchorDir(platform, home, env));
  if (win32apply.readJournal(journalAt).state === 'unfinished') {
    const resumed = await (o.begin || win32update.begin)({ ...common, resumeOnly: true });
    note = 'an earlier update had not finished: ' + oneLine((resumed && resumed.because) || 'it was handed to its resumer');
    log(note);
    return done(['refused', oneLine((resumed && resumed.because) || 'an earlier update has not finished')]);
  }

  if (action === 'rollback') {
    const kept = win32update.keptPreviousBuild(root);
    const tooOld = kept && connectReadyRefusal(kept.dir, kept.version);
    if (tooOld) return done(['refused', tooOld]);
    /* The person agreed to roll back to one version, read at the last look; a kept build that changed since
       (another update ran here) is not the one they agreed to. */
    if (o.expect && kept && kept.version !== o.expect) {
      return done(['refused', `the version kept for a rollback is now ${kept.version}, not the ${o.expect} you chose, so nothing was rolled back. Pick Roll back again to go back to ${kept.version}`]);
    }
    const r = await (o.rollbackToPrevious || win32update.rollbackToPrevious)(common);
    if (!r || !r.ok) return done(['refused', oneLine((r && r.because) || 'the rollback could not be started')]);
    /* The hold is written as soon as the rollback is on its way, not when it is seen to finish: a wait that
       runs out must not leave the next automatic look free to put back the version rolled back from. If
       the rollback does not take, the held version is the one installed, which no look offers anyway. */
    if (r.from) writeHeld(env, home, r.from, log);
    const outcome = await outcomeOf(r.journal, probe, o.wait);
    if (outcome.outcome === 'updated') return done(['rolledback', r.version]);
    /* No outcome yet is not a failure: the helper may still finish the rollback. Its hold is already written. */
    if (!outcome.outcome) return done(['failed', r.version, `the roll back to ${r.version} has not finished yet and may still finish; open Kosmos again in a few minutes to see which version it is on`]);
    return done(['failed', r.version, oneLine(outcome.sentence || outcome.because || `the rollback ended as ${outcome.outcome}`)]);
  }

  /* decide() reads the consent and the channel through update.js and autoupdate.js, which use process.env
     and the account's own folders; the env/home seams above do not reach it (a test sets process.env). */
  const look = await (o.decide || ifnewer.decide)();
  const [kind, version, consent] = (look && look.line) || [];
  if (kind === 'current') return done(['current', version]);
  if (kind === 'source') return done(['unknown', 'this is not an installed copy of Kosmos'], null);
  if (kind !== 'newer') return done(['unknown', oneLine(version || 'the update check gave no answer')]);
  if (action === 'look' && consent !== 'on') return done(['newer', version]);
  /* The person picked "Update Kosmos to <expect>". A newer release since is offered, not installed unseen. */
  if (action === 'install' && o.expect && o.expect !== version) {
    note = `${version} is now the newest, not the ${o.expect} that was picked; it is offered instead`;
    return done(['newer', version]);
  }
  const held = readHeld(env, home);
  if (action === 'look' && held && !update.newer(version, held)) {
    note = `${version} is not installed by itself, because it was rolled back from on this computer; it stays on offer`;
    return done(['newer', version]);
  }

  const r = await (o.begin || win32update.begin)({ ...common, expectVersion: version });
  if (!r || !r.ok) {
    const because = oneLine((r && r.because) || 'the update could not be started');
    /* The window's own look with updates on: the newer build is still offered, so the person learns it is
       there and hears why it would not install when they pick Update. Silence here would hide it for good
       on a computer where begin() always refuses (a Kosmos folder in OneDrive, say). */
    if (action === 'look') {
      note = `the automatic update to ${version} was not started: ${because}`;
      log(note);
      return done(['newer', version]);
    }
    return done(['refused', because]);
  }
  const outcome = await outcomeOf(r.journal, probe, o.wait);
  if (outcome.outcome === 'updated') {
    if (outcome.finishUnrecorded) note = `${version} is in place, but its helper did not record the finish in time`;
    return done(['updated', outcome.to || r.version || version]);
  }
  return done(['failed', version, oneLine(outcome.sentence || outcome.because || `the update ended as ${outcome.outcome || 'unknown'}`)]);
}

/** The helper's outcome for the journal begin() or rollbackToPrevious() wrote: win32update's own wait. */
async function outcomeOf(journalAt, probe, waitSeams) {
  const token = (win32apply.readJournal(journalAt).journal || {}).token;
  /* noBoard: nothing answers as the new build here, so the journal's own record counts (waitForOutcome). */
  return win32update.waitForOutcome(journalAt, token, { probe, noBoard: true, ...(waitSeams || {}) });
}

function parseArgs(argv) {
  const a = { action: null, port: null, report: null, expect: null, yes: false, unknown: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--look' || arg === '--install' || arg === '--rollback') {
      if (a.action) a.unknown = arg; else a.action = arg.slice(2);
    } else if (arg === '--yes') a.yes = true;
    else if (arg === '--port') { a.port = argv[i + 1] || null; i += 1; }
    else if (arg === '--report') { a.report = argv[i + 1] || null; i += 1; }
    else if (arg === '--expect') { a.expect = argv[i + 1] || null; i += 1; }
    else a.unknown = arg;
  }
  return a;
}

const USAGE = 'usage: node engine/win32connectupdate.js --look|--install|--rollback [--expect <version>] [--port <n>] [--report <file>] --yes';

/** The lines of a run's answer: the answer itself, then the rollback offer when there is one, then a note
    for the record (why an automatic update did not start), which Kosmos.exe does not act on. */
function reportLines(result) {
  const lines = [result.answer.map(oneLine).filter((part) => part !== '').join(' ')];
  if (result.rollback) lines.push('rollback ' + oneLine(result.rollback));
  if (result.note) lines.push('note ' + oneLine(result.note));
  return lines;
}

async function cliMain(argv, write, seams) {
  const out = typeof write === 'function' ? write : (s) => process.stdout.write(s);
  const a = parseArgs(argv);
  const port = a.port === null ? win32update.DEFAULT_BOARD_PORT : Number(a.port);
  if (!a.action || a.unknown || !Number.isInteger(port) || port <= 0 || (a.expect !== null && a.action === 'look')) { out(USAGE + '\n'); return 2; }
  /* --yes is the person's opt-in (Kosmos.exe adds it only for a look it runs, or a choice the person
     made), and it stands in for allowLiveExecution(), which only server.js's real start may call. */
  if (!a.yes) { out(`nothing was looked at or changed: add --yes to ${a.action}\n`); return 2; }
  let result;
  try {
    result = await run(a.action, { port, expect: a.expect, liveExecutionAllowed: () => true, ...(seams || {}) });
  } catch (e) {
    result = { answer: ['unknown', oneLine((e && e.message) || e)], rollback: null };
  }
  const lines = reportLines(result);
  out(lines.join('\n') + '\n');
  if (a.report) {
    try { fs.writeFileSync(a.report, lines.join('\r\n') + '\r\n', 'utf8'); } catch (e) { out(`could not write the report to ${a.report}: ${oneLine(e && e.message)}\n`); }
  }
  const code = EXIT[result.answer[0]];
  return code === undefined ? 1 : code;
}

module.exports = { run, cliMain, reportLines, parseArgs, invokedByAgent, connectReadyRefusal, ACTIONS, EXIT };

/* Guarded on being the main module: requiring this file must never look, download or swap anything. */
if (require.main === module) {
  cliMain(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { process.stderr.write(String((e && e.stack) || e) + '\n'); process.exitCode = 1; },
  );
}
