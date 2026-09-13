'use strict';

/**
 * The board's login job, asserted about the installer's TEXT.
 *
 * ⚠️ WHAT THIS CAN AND CANNOT DO. `yarn test` never executes `install/setup.sh`;
 * `tools/test-install.sh` really installs and is what covers behaviour. What a
 * node test can pin is the shape of the script, and the two claims below are
 * exactly that shape: one block must not contain a command, and the two blocks
 * must remain distinguishable. Both turn red when the file changes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');

/* ⚠️ SLICED BY STRUCTURE, not by the next occurrence of some word. The first
   version of this cut at the next `printf` and landed inside the block's own
   `_xmlq` helper, so it reported the probe missing on a file that had it. */
/* ⚠️ COMMENTS STRIPPED, because the claim is about what RUNS. The comment
   explaining why this block does not tear the job down names the command it
   does not use, so a text search over the whole block finds it and reports the
   opposite of the truth. That trap has now cost this codebase five separate
   findings; the instrument answers it once instead of every author remembering
   not to quote themselves. */
function runs(text) {
  return text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

/* The commands the installer EXECUTES, with plist heredoc DATA dropped too. A
   plist body (its <string>/<key>/<array>/... lines) is written to a file, not run
   here, so a `launchctl bootout` embedded in a login-agent plist's own program
   (the com.kosmos.open-once one-shot boots itself out at login, #2151) is not the
   install path booting anything out. Used only by the no-bootout claim below;
   `runs()` itself stays markup-preserving because other claims inspect the board
   plist's <key>/<string> shape. A real shell command never begins with an XML
   tag, so dropping `^\s*<tag` cannot hide a bare install-path launchctl. */
function runsNoPlistData(text) {
  return runs(text)
    .split('\n')
    .filter((l) => !/^\s*<[a-z?!/]/i.test(l))
    .join('\n');
}
function stepBlock(title) {
  const at = SETUP.indexOf(`step "${title}"`);
  assert.ok(at > -1, `the step "${title}" is gone from the installer`);
  const rest = SETUP.slice(at + 1);
  const next = rest.indexOf('\nstep "');
  return runs(next === -1 ? rest : rest.slice(0, next));
}

test('installing does not boot out a board that is already registered', () => {
  /* 🛑 AN UPDATE IS RUN BY THE BOARD. `engine/update.js` spawns this installer
     as a detached child of the running server, so once the board is a launchd
     job, `bootout` terminates the job running the update. The child is setsid-ed
     and very likely survives; "very likely" is not a property to rest an update
     path on, and the failure lands hard: the bootout succeeds, the shell dies
     before `bootstrap`, and the machine has the job booted out and no board at
     all until the next login. */
  const block = stepBlock('Keeping Kosmos running after a restart.');
  /* Strip plist DATA for the no-bootout claim: this step also writes the
     com.kosmos.open-once login agent, whose OWN program boots itself out at
     login (#2151) -- a bootout inside a plist <string>, not a command the
     installer runs. The concern here is the install path executing a bootout of
     the board; a bare `launchctl bootout` command still trips this. */
  assert.ok(!/bootout/.test(runsNoPlistData(block)),
    'the install path boots the board out, which can kill the update that is running it');
  assert.match(block, /launchctl print/,
    'nothing probes whether the job is already loaded, so the skip cannot happen');
  /* And it still registers a machine that does not have one yet. */
  assert.match(block, /launchctl bootstrap/);
  assert.match(block, /launchctl enable/);
});

test('uninstalling does boot it out, because there is nothing left to protect', () => {
  /* The opposite direction on purpose: the files are going, so a job left
     loaded would run a deleted `kosmos` at every login. */
  const at = SETUP.indexOf('removing the login job for the board');
  assert.ok(at > -1, 'the uninstall no longer removes the board job');
  const block = runs(SETUP.slice(at, at + 900));
  assert.match(block, /launchctl bootout/);
  /* enable first, or a standing per-user disable outlives the plist and a
     reinstalled Kosmos is silently refused. */
  assert.ok(block.indexOf('launchctl enable') < block.indexOf('launchctl bootout'));
});

test('the one-shot open agent boots ITSELF out, not just deletes its plist (#2151)', () => {
  /* The com.kosmos.open-once RunAtLoad job used to only `rm` its plist file,
     leaving the job loaded-but-idle in launchd's registry until logout. Its
     program must ALSO `launchctl bootout` its own label so nothing lingers. This
     is a bootout inside the job's OWN plist program (login-time self-teardown),
     which is exactly why the board-job no-bootout claim above filters plist
     markup -- the two are not in tension. */
  const at = SETUP.indexOf('_open_label=com.kosmos.open-once');
  assert.ok(at > -1, 'the open-once one-shot job is gone from the installer');
  /* Anchor to the plist heredoc's closing PLIST marker, not a fixed char count,
     so the slice tracks the block if it grows (a positional +N slice is the
     brittle shape this codebase keeps getting bitten by). */
  const end = SETUP.indexOf('\nPLIST\n', at);
  assert.ok(end > at, 'the open-once plist heredoc no longer closes with PLIST; the anchor is stale');
  const block = SETUP.slice(at, end);
  assert.match(block, /launchctl bootout "gui\/\$_open_uid\/\$_open_label"/,
    'the open-once program does not boot itself out; it lingers in the launchd registry until logout (#2151)');
});

test('a sandboxed run reaches launchd in neither direction', () => {
  /* launchd has no directory to point somewhere harmless: a bootstrap under a
     harness registers a REAL job on the machine running the test, and it
     outlives the test. Both blocks gate on the same variable. */
  for (const block of [stepBlock('Keeping Kosmos running after a restart.'),
    runs(SETUP.slice(SETUP.indexOf('removing the login job for the board'), SETUP.indexOf('removing the login job for the board') + 900))]) {
    assert.match(block, /if \[ -z "\$\{AGENT_WORKFORCE_LAUNCH:-\}" \]/);
  }
});

test('the job carries what launchd does not set', () => {
  /* Bisected on this fleet's hand-written copy: launchd sets neither PATH nor
     LANG, and without LANG tmux sanitises its format output so every agent
     comes back on the board with its tab separators replaced. */
  const block = stepBlock('Keeping Kosmos running after a restart.');
  assert.match(block, /<key>LANG<\/key><string>en_US\.UTF-8<\/string>/);
  assert.match(block, /<key>PATH<\/key>/);
  assert.match(block, /<key>KOSMOS_PORT<\/key>/);
  /* 🔑 ONE LOG FILE, and there were two. `kosmos start` sends the server's own
     output to board.log; this job captures the narration of the script that
     starts it, and it went to a second file nothing named. Josh tailed board.log
     on 2026-08-22 looking for why his board could not read his agents, found six
     startup lines and no error, and reasonably read that as not logging. */
  assert.match(block, /StandardOutPath[^\n]*logs\/board\.log/);
  assert.ok(!/login\.log/.test(block), 'the login job writes to a second log file again');
  /* #2956: RunAtLoad AND a KeepAlive keyed on the deliberate-stop marker. The old
     job ran `kosmos start` (daemonise + exit), where a plain KeepAlive would have
     relaunch-looped; now ProgramArguments runs `board-run`, a foreground mode that
     execs node in place, so launchd owns the board process and KeepAlive relaunches
     a crash. It is PathState-keyed on the board.stopped marker (kept up while the
     marker is ABSENT, i.e. <false/>), so a deliberate `kosmos stop` still means
     stopped, and ThrottleInterval bounds a crash loop. */
  assert.match(block, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(block, /<string>board-run<\/string>/, 'the login job must run the supervised foreground entry');
  assert.match(block, /<key>KeepAlive<\/key>/, 'launchd must supervise the board');
  assert.match(block, /<key>PathState<\/key>/, 'supervision must be keyed on the stop-marker path');
  assert.match(block, /board\.stopped/, 'the PathState key must be the board.stopped marker');
  assert.match(block, /<false\/>/, 'kept up while the marker is absent');
  assert.match(block, /<key>ThrottleInterval<\/key>/, 'a crash loop must be throttled');
});
