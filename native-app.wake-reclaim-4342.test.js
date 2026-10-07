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

test('#4342: the probe->outcome decision is a pure function the build runs as an executable selftest', () => {
  // The decision: any HTTP answer = alive, a timeout = wedged, anything else = down.
  assert.match(SRC, /enum WakeProbeOutcome: String \{ case alive, wedged, down \}/, 'no WakeProbeOutcome enum');
  const fnAt = SRC.indexOf('func wakeProbeOutcome(hasHTTPResponse: Bool, errorCode: Int) -> WakeProbeOutcome');
  assert.notEqual(fnAt, -1, 'wakeProbeOutcome pure function is gone');
  const fn = SRC.slice(fnAt, SRC.indexOf('\n}\n', fnAt) + 2);
  assert.match(fn, /if hasHTTPResponse \{ return \.alive \}/, 'any HTTP answer is not treated as alive');
  assert.match(fn, /if errorCode == NSURLErrorTimedOut \{ return \.wedged \}/, 'a timeout is not treated as wedged');
  assert.match(fn, /return \.down/, 'a non-timeout failure is not treated as down');
  // The executable selftest hatch exists AND the bundle build actually RUNS it and diffs the
  // expected table -- an unrun guard is no guard (kosmos#1934 family).
  assert.match(SRC, /--kosmos-app-wake-reclaim-selftest/, 'no selftest hatch in the app');
  const BUILD = fs.readFileSync(path.join(__dirname, 'tools', 'build-kosmos-bundle.sh'), 'utf8');
  assert.match(BUILD, /"\$STAGE\/app\/bin\/kosmos-app" --kosmos-app-wake-reclaim-selftest/, 'the build never runs the wake-reclaim selftest');
  assert.match(BUILD, /hasHTTPResponse=false errorCode=-1001 -> wedged/, 'the build does not pin the wedged (timeout) row');
  assert.match(BUILD, /hasHTTPResponse=false errorCode=-1004 -> down/, 'the build does not pin the down (refused) row');
  assert.match(BUILD, /hasHTTPResponse=true errorCode=-1001 -> alive/, 'the build does not pin the alive (any-answer) row');
  assert.match(BUILD, /\$_wake_table_actual" = "\$_wake_table_expected/, 'the build does not compare the actual table to the expected one');
});

test('#4342: the probe hits the light /api/health route and reports on the main thread', () => {
  const pAt = SRC.indexOf('private func probeBoardHealth(port: Int, completion:');
  assert.notEqual(pAt, -1, 'probeBoardHealth is gone');
  const probe = SRC.slice(pAt, SRC.indexOf('\n    }\n', pAt) + 6);
  assert.match(probe, /\/api\/health/, 'the probe does not hit the light public /api/health route (a busy board can be slow to serve /api/status\'s snapshot and be falsely reclaimed)');
  assert.match(probe, /127\.0\.0\.1/, 'the probe is not aimed at the loopback board');
  assert.match(probe, /req\.timeoutInterval = 10/, 'the probe has no 10s stuck limit');
  assert.match(probe, /wakeProbeOutcome\(hasHTTPResponse: response != nil, errorCode: \(error as NSError\?\)\?\.code \?\? 0\)/,
    'the probe does not compute its outcome from the pure function (so the build gate would not cover the real decision)');
  assert.match(probe, /DispatchQueue\.main\.async \{ completion/, 'the probe does not hop to the main thread before reporting');
});

test('#4342: the wake handler reclaims ONLY a sustained wedge, re-checking the gate before every kill', () => {
  // The gate the handler consults before the first probe AND again before each kill.
  const gateAt = SRC.indexOf('private func wakeRecoveryGateOpen(home: String) -> Bool');
  assert.notEqual(gateAt, -1, 'wakeRecoveryGateOpen is gone');
  const gate = SRC.slice(gateAt, SRC.indexOf('\n    }\n', gateAt) + 6);
  assert.match(gate, /if boardStartInFlight \{/, 'a second wake (or a Cmd-R) could race a start already in flight');
  assert.match(gate, /fileExists\(atPath: home \+ "\/board\.stopped"\)/, 'a board stopped on purpose would be resurrected');
  assert.match(gate, /Self\.installUnderWay\(kosmosHome: home\)/, 'a board an update is restarting would be fought');

  const at = SRC.indexOf('private func recoverStuckBoardAfterWake()');
  assert.notEqual(at, -1, 'recoverStuckBoardAfterWake is gone');
  const body = SRC.slice(at, SRC.indexOf('\n    }\n', at) + 6);
  assert.match(body, /guard wakeRecoveryGateOpen\(home: home\) else \{ return \}/, 'the handler does not consult the gate before probing');
  assert.match(body, /case \.alive:/, 'no alive case (an answering board must be left alone)');
  // A refused/down board is left to launchd's relaunch, NOT reclaimed (that would race the relaunch).
  assert.match(body, /case \.down:[\s\S]*?launchd relaunches it/, 'a down (refused) board is not left to launchd');
  // The wedge path CONFIRMS with a second probe after a settle, re-checking the gate, before any kill.
  assert.match(body, /case \.wedged:/, 'no wedged case');
  assert.match(body, /asyncAfter\(deadline: \.now\(\) \+ 4\)/, 'the wedge path does not settle before a confirm probe (so wake-thrash could false-reclaim a healthy board)');
  assert.match(body, /guard confirm == \.wedged else \{[\s\S]*?return\n\s+\}/, 'the reclaim fires on a confirm result other than a second wedge');
  // Two probes (first + confirm), and the kill happens exactly once, only on the confirmed wedge.
  assert.equal((body.match(/probeBoardHealth\(port: port\)/g) || []).length, 2, 'the handler does not probe twice (first + confirm)');
  assert.equal((body.match(/reclaimStuckBoard\(home: home, port: port\)/g) || []).length, 1, 'the reclaim is reachable from more than the confirmed-wedge path');
  // The gate is consulted three times: at entry, before the confirm probe, and before the kill
  // (TOCTOU: the ~14s probe+confirm window is long enough for a deliberate stop or an update to begin).
  assert.equal((body.match(/wakeRecoveryGateOpen\(home: home\)/g) || []).length, 3,
    'the gate is not re-checked before the confirm probe AND before the kill (not just once up front)');
  // Overlapping wake chains are serialized by a generation token captured at entry and re-checked at
  // every continuation, so a second didWake cannot drive a second chain that kills a freshly-restarted board.
  assert.match(body, /wakeRecoveryGeneration \+= 1\n\s+let gen = wakeRecoveryGeneration/, 'the handler does not capture a wake generation at entry');
  assert.equal((body.match(/self\.wakeRecoveryGeneration == gen/g) || []).length, 3,
    'not every continuation (first completion, settle, confirm completion) drops out when a newer wake supersedes this chain');
});

test('#4342: the reclaim runs the --force form through boardStartInFlight, with no redundant second flag', () => {
  const at = SRC.indexOf('private func reclaimStuckBoard(home: String, port: Int)');
  assert.notEqual(at, -1, 'reclaimStuckBoard is gone');
  const body = SRC.slice(at, SRC.indexOf('\n    }\n', at) + 6);
  assert.match(body, /guard !boardStartInFlight else \{ return \}/, 'the reclaim does not re-check the in-flight guard before starting');
  assert.match(body, /boardStartInFlight = true\n\s+boardStartGeneration \+= 1\n\s+let generation = boardStartGeneration/,
    'the reclaim does not take a start generation, so a Cmd-R could race it');
  assert.match(body, /startBoard\(kosmosHome: home, port: port, reclaim: true\)/, 'the reclaim does not call the reclaim form of startBoard');
  assert.match(body, /asyncAfter\(deadline: \.now\(\) \+ 300\)/, 'a reclaim that never returns would leave every later Cmd-R a silent no-op (#965)');
  // #4356: the completion undoes a start that finished after a switch to connect (switchToConnect
  // does not bump the generation, so the generation guard alone would miss it), mirroring loadBoard.
  // The undo must hold Run-agents until its stop finishes (stopsInFlight += 1 / -= 1 balanced) and
  // must run BEFORE the stale-generation guard, or a reclaimed board is orphaned on a connect computer.
  assert.match(body, /if self\.computerMode == \.connect \{[\s\S]*?self\.stopsInFlight \+= 1[\s\S]*?stopBoard\(kosmosHome: home, port: port\)[\s\S]*?self\?\.stopsInFlight -= 1[\s\S]*?return\n\s+\}/,
    'the reclaim completion does not stop a board left running after a switch to connect, with balanced stopsInFlight bookkeeping');
  const connectAt = body.indexOf('if self.computerMode == .connect');
  const genGuardAt = body.indexOf('guard self.boardStartGeneration == generation');
  assert.ok(connectAt !== -1 && genGuardAt !== -1 && connectAt < genGuardAt,
    'the connect-undo must run before the stale-generation guard, or the undo is skipped for a stale generation and the board is orphaned');
  // Control: the redundant boardWakeReclaimInFlight flag is gone; boardStartInFlight alone serializes,
  // so there is no second flag that could latch true and silently disable all future wake recovery.
  assert.doesNotMatch(SRC, /boardWakeReclaimInFlight/, 'the redundant wake-reclaim-in-flight flag is back (it can latch true and disable recovery)');
});
