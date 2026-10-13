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
 *   failed <why>       the update or rollback was started and did not finish
 *   board              a board answers on this computer, and it updates itself
 *   unknown <why>      the release host could not be reached or read, or this is not an installed Kosmos
 *   refused <why>      not done here: not a connect computer, an agent asked, or a precondition failed
 * and, after it, when a kept build can be rolled back to:
 *   rollback <v>
 * Exit 0 for current, newer, updated, rolledback and board; 1 for failed and unknown; 3 for refused.
 */

const os = require('node:os');
const fs = require('node:fs');
const update = require('./update');
const ifnewer = require('./update-ifnewer');
const win32update = require('./win32update');
/* Loaded here, before anything runs: an update moves this build's app folder aside, and a module first
   required after that would be read from the NEW build (the helper's own rule, H1). */
const win32apply = require('./win32apply');
const win32handoff = require('./win32handoff');

const ACTIONS = Object.freeze(['look', 'install', 'rollback']);
const EXIT = Object.freeze({ current: 0, newer: 0, updated: 0, rolledback: 0, board: 0, failed: 1, unknown: 1, refused: 3 });

/** An agent never updates the Kosmos it runs under (install/kosmos _invoked_by_agent, the same marks). */
function invokedByAgent(env) {
  const e = env || {};
  return Boolean(e.KOSMOS_AGENT_SESSION || e.KOSMOS_AGENT_TOKEN);
}

function oneLine(text) { return String(text === undefined || text === null ? '' : text).replace(/[\t\r\n]+/g, ' ').trim(); }

/**
 * One run. Resolves to `{ answer: [word, value?], rollback: <version>|null }`. Seams, each with its
 * production default: platform, env, home, port, root (update.installedRoot), probe
 * (win32handoff.probeBoard), readsConnect (win32apply.readsConnect), decide (update-ifnewer.decide),
 * begin, rollbackToPrevious, wait (waitForOutcome's seams), rollbackOffer (update.rollbackOffer),
 * liveExecutionAllowed, log.
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
  const offerRollback = () => {
    try { const r = (o.rollbackOffer || update.rollbackOffer)(); return r && r.version ? r.version : null; } catch { return null; }
  };
  const done = (answer, rollback) => ({ answer, rollback: rollback === undefined ? offerRollback() : rollback });

  if (!ACTIONS.includes(action)) return done(['refused', `no such action: ${action}`], null);
  if (platform !== 'win32') return done(['refused', 'this is the Windows connect computer\'s update, and this is not Windows'], null);
  if (invokedByAgent(env)) return done(['refused', 'an agent may not update Kosmos; the person who runs this computer does'], null);
  if (readsConnect() !== true) {
    return done(['refused', 'this computer is not set to connect to agents elsewhere; its own board keeps it updated'], null);
  }
  const root = o.root !== undefined ? o.root : update.installedRoot();
  if (!root) return done(['unknown', 'this is not an installed copy of Kosmos'], null);

  /* A board that answers looks for itself every fifteen minutes, and two updaters must never race. Asked
     once here and handed to the precondition as measured, so B0 refuses on the same answer. */
  const answer = await probe(port);
  if (answer && answer.answering === true) return done(['board']);
  const connectComputer = { connects: () => readsConnect() === true, boardAnswers: () => Boolean(answer && answer.answering === true) };
  const common = {
    root, port, boardPid: null, connectComputer, log, env, home,
    liveExecutionAllowed: o.liveExecutionAllowed || (() => true),
    ...(o.helperOptions || {}),
  };

  if (action === 'rollback') {
    const r = await (o.rollbackToPrevious || win32update.rollbackToPrevious)(common);
    if (!r || !r.ok) return done(['refused', oneLine((r && r.because) || 'the rollback could not be started')]);
    const outcome = await outcomeOf(r.journal, probe, o.wait);
    if (outcome.outcome === 'updated') return done(['rolledback', r.version]);
    return done(['failed', oneLine(outcome.sentence || outcome.because || `the rollback ended as ${outcome.outcome || 'unknown'}`)]);
  }

  const look = await (o.decide || ifnewer.decide)();
  const [kind, version, consent] = (look && look.line) || [];
  if (kind === 'current') return done(['current', version]);
  if (kind === 'source') return done(['unknown', 'this is not an installed copy of Kosmos'], null);
  if (kind !== 'newer') return done(['unknown', oneLine(version || 'the update check gave no answer')]);
  if (action === 'look' && consent !== 'on') return done(['newer', version]);

  const r = await (o.begin || win32update.begin)({ ...common, expectVersion: version });
  if (!r || !r.ok) return done(['refused', oneLine((r && r.because) || 'the update could not be started')]);
  const outcome = await outcomeOf(r.journal, probe, o.wait);
  if (outcome.outcome === 'updated') return done(['updated', outcome.to || r.version || version]);
  return done(['failed', oneLine(outcome.sentence || outcome.because || `the update ended as ${outcome.outcome || 'unknown'}`)]);
}

/** The helper's outcome for the journal begin() or rollbackToPrevious() wrote: win32update's own wait. */
async function outcomeOf(journalAt, probe, waitSeams) {
  const token = (win32apply.readJournal(journalAt).journal || {}).token;
  return win32update.waitForOutcome(journalAt, token, { probe, ...(waitSeams || {}) });
}

function parseArgs(argv) {
  const a = { action: null, port: null, report: null, yes: false, unknown: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--look' || arg === '--install' || arg === '--rollback') {
      if (a.action) a.unknown = arg; else a.action = arg.slice(2);
    } else if (arg === '--yes') a.yes = true;
    else if (arg === '--port') { a.port = argv[i + 1] || null; i += 1; }
    else if (arg === '--report') { a.report = argv[i + 1] || null; i += 1; }
    else a.unknown = arg;
  }
  return a;
}

const USAGE = 'usage: node engine/win32connectupdate.js --look|--install|--rollback [--port <n>] [--report <file>] --yes';

/** The lines of a run's answer: the answer itself, then the rollback offer when there is one. */
function reportLines(result) {
  const lines = [result.answer.map(oneLine).filter((part) => part !== '').join(' ')];
  if (result.rollback) lines.push('rollback ' + oneLine(result.rollback));
  return lines;
}

async function cliMain(argv, write, seams) {
  const out = typeof write === 'function' ? write : (s) => process.stdout.write(s);
  const a = parseArgs(argv);
  const port = a.port === null ? win32update.DEFAULT_BOARD_PORT : Number(a.port);
  if (!a.action || a.unknown || !Number.isInteger(port) || port <= 0) { out(USAGE + '\n'); return 2; }
  /* --yes is the person's opt-in (Kosmos.exe adds it only for a look it runs, or a choice the person
     made), and it stands in for allowLiveExecution(), which only server.js's real start may call. */
  if (!a.yes) { out(`nothing was looked at or changed: add --yes to ${a.action}\n`); return 2; }
  let result;
  try {
    result = await run(a.action, { port, ...(seams || {}) });
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

module.exports = { run, cliMain, reportLines, parseArgs, invokedByAgent, ACTIONS, EXIT };

/* Guarded on being the main module: requiring this file must never look, download or swap anything. */
if (require.main === module) {
  cliMain(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { process.stderr.write(String((e && e.stack) || e) + '\n'); process.exitCode = 1; },
  );
}
