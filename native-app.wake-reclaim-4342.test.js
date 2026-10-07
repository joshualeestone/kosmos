'use strict';

/**
 * #4342: the board comes back on its own after the Mac wakes from sleep.
 *
 * THE BUG. A Mac that slept with the board running wakes with the board process
 * ALIVE but no longer answering on 127.0.0.1:16180 -- the "frozen board" of
 * #4543/#4562, which still accepts the TCP connection but never replies. The
 * window then sits on "Kosmos is not answering on this computer" and nothing
 * recovers it until the person quits and reopens the app.
 *
 * WHY launchd + the watchdog did not already cover it (die-vs-hang). If the board
 * had merely DIED, launchd's KeepAlive (PathState on board.stopped) relaunches it,
 * so the symptom -- only a quit/reopen clears it -- is the hang, not a death. A
 * plain `kosmos start` REFUSES the held port, so it cannot recover a hang; only the
 * reclaim form (KOSMOS_RECLAIM_BUSY=1 kosmos start --force, which board-watchdog.sh
 * already uses) kills this user's own wedged board and starts fresh. The watchdog
 * can do that too, but only after its 300s busy-grace -- far longer than the ~1min a
 * user waits before quitting. So the fix is the missing macOS analog of the Windows
 * launcher's ReplaceBoardIfStuck (#4543): a wake observer on a RUN computer that
 * probes the board and reclaim-restarts it only when it is genuinely not answering.
 *
 * WHAT IS READ HERE. The probe, the reclaim and the AppKit wiring are Swift that the
 * node suite cannot execute, so this reads them from source: startBoard's new reclaim
 * form, the run-computer wake observer and where it is wired up and torn down, and the
 * handler's gates (in-flight, deliberate-stop marker, mid-update) and its 10s
 * any-HTTP-answer-is-alive probe.
 *
 *   node --test native-app.wake-reclaim-4342.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');

test('#4342: the instrument is reading the app', () => {
  assert.ok(SRC.length > 40000, 'main.swift read back only ' + SRC.length + ' bytes');
});

test('#4342: startBoard gained a reclaim form that is the watchdog\'s own, and the plain form is unchanged', () => {
  assert.match(SRC, /func startBoard\(kosmosHome: String, port: Int, reclaim: Bool = false,/,
    'startBoard has no opt-in reclaim parameter');
  assert.match(SRC, /process\.arguments = reclaim \? \["start", "--force"\] : \["start"\]/,
    'the reclaim form does not run `kosmos start --force`, or the plain form is no longer a bare start');
  assert.match(SRC, /if reclaim \{ env\["KOSMOS_RECLAIM_BUSY"\] = "1" \}/,
    'the reclaim form does not set KOSMOS_RECLAIM_BUSY=1 (the #3079 authorisation)');
  // Control: a plain start must NEVER reclaim. The ONLY place KOSMOS_RECLAIM_BUSY is set is
  // inside `if reclaim`, so a default-argument start can never kill a board.
  const reclaimSets = SRC.match(/KOSMOS_RECLAIM_BUSY"\] = "1"/g) || [];
  assert.equal(reclaimSets.length, 1, 'KOSMOS_RECLAIM_BUSY is set in more than one place; a plain start could reclaim');
});

test('#4342: a run computer gets its own wake observer, distinct from the connect update one', () => {
  assert.match(SRC, /private var boardWakeObserver: NSObjectProtocol\?/, 'no board wake observer field');
  // It is NOT the update observer: that one (updateWakeObserver) only looks for an app update.
  assert.notEqual(SRC.indexOf('private var updateWakeObserver: NSObjectProtocol?'), -1, 'control: the update observer still exists');
  assert.match(SRC, /private func startBoardWakeWatch\(\) \{/, 'no startBoardWakeWatch');
  assert.match(SRC, /guard computerMode != \.connect, boardWakeObserver == nil else \{ return \}/,
    'the watch is not gated to a run computer, or would register twice');
  assert.match(SRC, /forName: NSWorkspace\.didWakeNotification, object: nil, queue: \.main\) \{ \[weak self\] _ in\n\s+guard let self, self\.computerMode != \.connect else \{ return \}\n\s+self\.recoverStuckBoardAfterWake\(\)/,
    'the observer does not re-check the run mode and call the recovery on wake');
  assert.match(SRC, /private func stopBoardWakeWatch\(\) \{/, 'no stopBoardWakeWatch');
});

test('#4342: the watch is started where the board is hosted and stopped when it is not', () => {
  // Launch: inside the `computerMode != .connect` block, beside the other board-only watchers.
  assert.match(SRC, /startPromptRequestWatcher\(\)\n\s+\/\/ #4342[^\n]*\n\s+startBoardWakeWatch\(\)\n\s+\}/,
    'the watch is not started at launch for a run computer');
  // Connect -> run switch (runAgentsHere): the board is now hosted here, so start watching.
  assert.match(SRC, /startA11yTrustChecks\(\)\n\s+startPromptRequestWatcher\(\)\n\s+startBoardWakeWatch\(\)   \/\/ #4342/,
    'switching to run agents does not start the wake watch');
  // Run -> connect switch (switchToConnect): no board here any more, so stop watching.
  assert.match(SRC, /promptRequestTimer\?\.invalidate\(\); promptRequestTimer = nil\n\s+stopBoardWakeWatch\(\)/,
    'switching to connect does not stop the wake watch');
});

test('#4342: the handler recovers only a genuinely-stuck board, and stays out of the cases it must not touch', () => {
  const at = SRC.indexOf('private func recoverStuckBoardAfterWake()');
  assert.notEqual(at, -1, 'recoverStuckBoardAfterWake is gone');
  // Slice to its first method-level closing brace.
  const body = SRC.slice(at, SRC.indexOf('\n    }\n', at) + 6);
  assert.match(body, /guard !boardWakeReclaimInFlight, !boardStartInFlight else \{/,
    'a second wake (or a Cmd-R) could start a reclaim over one already running');
  assert.match(body, /fileExists\(atPath: home \+ "\/board\.stopped"\)/,
    'a board the person stopped on purpose would be resurrected');
  assert.match(body, /Self\.installUnderWay\(kosmosHome: home\)/,
    'a board that an update is deliberately restarting would be fought');
  assert.match(body, /\/api\/health/, 'the probe does not ask the light /api/health route (a busy board can be slow to serve /api/status\'s snapshot and get falsely reclaimed)');
  assert.match(body, /127\.0\.0\.1/, 'the probe is not aimed at the loopback board');
  assert.match(body, /req\.timeoutInterval = 10/,
    'the probe has no 10s stuck limit; a frozen board accepts the connection and would hang the check');
  // Any HTTP answer at all means alive (a 403 is still an answer) -> no restart.
  assert.match(body, /if response != nil \{[\s\S]*?return\n\s+\}/,
    'an answering board is not left alone');
  // Only no-answer reclaims.
  assert.match(body, /self\.reclaimStuckBoard\(home: home, port: port\)/,
    'a non-answering board is not reclaim-restarted');
});

test('#4342: the reclaim runs the --force form through the same in-flight guard as every other start', () => {
  const at = SRC.indexOf('private func reclaimStuckBoard(home: String, port: Int)');
  assert.notEqual(at, -1, 'reclaimStuckBoard is gone');
  const body = SRC.slice(at, SRC.indexOf('\n    }\n', at) + 6);
  assert.match(body, /guard !boardWakeReclaimInFlight, !boardStartInFlight else \{ return \}/,
    'the reclaim does not re-check the in-flight guard before starting');
  assert.match(body, /boardStartInFlight = true\n\s+boardStartGeneration \+= 1\n\s+let generation = boardStartGeneration/,
    'the reclaim does not take a start generation, so a Cmd-R could race it');
  assert.match(body, /startBoard\(kosmosHome: home, port: port, reclaim: true\)/,
    'the reclaim does not call the reclaim form of startBoard');
  assert.match(body, /asyncAfter\(deadline: \.now\(\) \+ 300\)/,
    'a reclaim that never returns would leave every later Cmd-R a silent no-op (#965)');
});
