'use strict';

/**
 * #4356: a computer either runs agents or connects to agents on another computer.
 *
 * Reading the choice and deciding a connect computer's links are pure Swift functions that
 * --kosmos-app-mode-selftest drives at bundle build (40 rows). What no selftest can reach is the
 * wiring in the AppKit delegate, so that is read here from source: a connect computer never starts
 * its board, not at launch, not on Reload, not after an unreadable choice; switching stops what
 * belongs to a board before sign-in loads; only the board's own page, and only while the app is
 * asking, can make the choice; and the way back is this Mac's own menu.
 *
 *   node --test native-app.computer-mode-4356.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');
const BUILD = fs.readFileSync(path.join(__dirname, 'tools', 'build-kosmos-bundle.sh'), 'utf8');
function body(sig) {
  const at = SRC.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from main.swift');
  return SRC.slice(at, SRC.indexOf('\n    }\n', at) + 6);
}

test('#4356: the instrument is reading the app', () => {
  assert.ok(SRC.length > 40000, 'main.swift read back only ' + SRC.length + ' bytes');
});

test('#4356: the release switch (KOSMOS_FIRSTRUN_CHOICE) is ON, and only with a connect Mac able to update (#4382)', () => {
  // Liu Kang m2647: Connect must not reach any release until a connect Mac can update; #4382 is that, and turns
  // this on. So the switch is on only beside the update look a connect computer runs with no board.
  assert.match(SRC, /\nlet kosmosFirstRunChoice = true\n/, 'the first-run choice is switched off in this build');
  assert.match(SRC, /\nfunc runKosmosUpdate\(kosmosHome: String, port: Int\?, install: Bool\) -> UpdateAnswer \{/,
    'the first-run choice is on, but a connect Mac has no way to update itself (#4382)');
  // Off still means first run as before: the switch is the first thing the launch-time read checks.
  assert.match(body('private func readLaunchComputerMode()'), /^[^\n]*\n[^\n]*\n\s+guard kosmosFirstRunChoice else \{ computerMode = \.run; return \}/,
    'the switch is not the first thing the launch-time read checks');
  assert.equal((SRC.match(/kosmosFirstRunChoice/g) || []).length, 2, 'the switch is read in more than one place, so off may not mean off everywhere');
});

test('#4356: the choice is read before anything starts, and a connect computer never starts its board at launch', () => {
  const launch = body('func applicationDidFinishLaunching(_ notification: Notification)');
  const read = launch.indexOf('readLaunchComputerMode()');
  assert.notEqual(read, -1, 'the app does not read this computer\'s choice at launch');
  assert.ok(read < launch.indexOf('loadBoard()'), 'the board can start before the choice is read');
  assert.match(launch, /if computerMode == \.connect \{\n[^\n]*\n\s+loadConnect\(\)\n\s+stopBoardIfRunning\(\)\n\s+\} else \{\n\s+loadBoard\(\)\n\s+\}/,
    'a connect computer starts its board, or a run computer does not');
  assert.match(launch, /if computerMode != \.connect \{[\s\S]*startA11yTrustChecks\(\)[\s\S]*startPromptRequestWatcher\(\)\n\s+\}/,
    'a connect computer runs the Accessibility checks and prompt watcher of a board it does not have');
});

test('#4356: the choice comes from $KOSMOS_HOME/mode, the file the installer reads', () => {
  assert.match(SRC, /func computerModePath\(kosmosHome: String\) -> String \{ kosmosHome \+ "\/mode" \}/);
  const read = body('private func readLaunchComputerMode()');
  assert.match(read, /let install = try\? resolveInstall\(config: KosmosInstallConfig\.load\(\)\)/);
  assert.match(read, /modePort = install\.port/);
  assert.match(read, /computerMode = readComputerMode\(kosmosHome: home\)/);
});

test('#4356: the board\'s page is told when it must ask, and only then', () => {
  assert.match(SRC, /guard let url = self\.withModeQuery\(tokenizedBoardURL\(urlString\)\) else \{/, 'the board URL does not say whether to ask');
  const q = body('func withModeQuery(_ url: URL?) -> URL?');
  assert.match(q, /computerMode == \.unset \|\| computerMode == \.unreadable \|\| computerMode == \.both/, 'a both computer\'s first run would not end at Kosmos Plus sign-in');
  assert.match(q, /URLQueryItem\(name: "mode", value: computerMode\.rawValue\)/);
});

test('#4356: only the board\'s own page, in the main frame, while the app is asking, can choose', () => {
  const proxy = SRC.slice(SRC.indexOf('final class ModeMessageProxy'), SRC.indexOf('final class AppDelegate'));
  assert.match(proxy, /guard message\.frameInfo\.isMainFrame, let owner else \{ return \}/);
  assert.match(proxy, /guard owner\.isBoardOrigin\(host: origin\.host, port: origin\.port, scheme: origin\.protocol\) else \{ return \}/,
    'another origin, Kosmos Plus included, could change this computer\'s mode');
  assert.match(SRC, /config\.userContentController\.add\(ModeMessageProxy\(delegate\), name: "kosmosMode"\)/);
  const chose = body('func pageChoseMode(_ body: Any)');
  assert.match(chose, /computerMode == \.unset \|\| computerMode == \.unreadable/, 'a page can flip the mode at any time');
  assert.match(chose, /guard writeComputerMode\(\.connect, kosmosHome: home\) else \{[\s\S]*?loadBoard\(\)\n\s+return\n\s+\}/,
    'a connect choice that could not be saved still switches, so the next launch starts the board again');
});

test('#4356: switching to connect stops what belongs to a board, then the board, then loads sign-in', () => {
  const sw = body('private func switchToConnect(home: String)');
  for (const t of ['badgeTimer', 'a11yTimer', 'promptRequestTimer']) {
    assert.match(sw, new RegExp(t + '\\?\\.invalidate\\(\\); ' + t + ' = nil'), t + ' keeps running on a computer with no board');
  }
  assert.match(sw, /NSApp\.dockTile\.badgeLabel = nil/, 'a stale waiting count stays on the Dock icon');
  const stop = sw.indexOf('stopBoard(kosmosHome: home, port: port)');
  assert.notEqual(stop, -1, 'switching to connect leaves the board the installer started running');
  assert.ok(stop < sw.indexOf('self.loadConnect()'), 'sign-in loads before the board is stopped');
  assert.match(sw, /DispatchQueue\.global\(qos: \.userInitiated\)\.async/, 'kosmos stop runs on the main thread and beachballs the app');
  const at = SRC.indexOf('func stopBoard(kosmosHome: String, port: Int?) -> StopOutcome');
  assert.notEqual(at, -1, 'stopBoard is gone from main.swift');
  assert.match(SRC.slice(at, SRC.indexOf('\n}\n', at)), /process\.arguments = \["stop"\]/);
});

test('#4356: loadBoard itself refuses on a connect computer, so no path into it can start the board', () => {
  // Launch, Reload's fall-through and a navigation failure's one-shot all reach loadBoard(); the
  // guard is in loadBoard so a new caller cannot forget it.
  const load = body('private func loadBoard()');
  const guard = load.indexOf('guard computerMode != .connect else {');
  assert.notEqual(guard, -1, 'loadBoard can run kosmos start on a connect computer');
  assert.ok(guard < load.indexOf('startBoard('), 'the guard comes after the start');
  // A start already running when Connect was chosen is stopped again when it lands.
  const late = load.slice(load.indexOf('if self.computerMode == .connect {'));
  assert.match(late, /self\.boardStartInFlight = false\n\s+self\.boardStartGeneration \+= 1\n\s+self\.stopsInFlight \+= 1/,
    'a start that landed after Connect leaves the 300 s watchdog armed, or its stop races Run agents');
  assert.match(late, /_ = stopBoard\(kosmosHome: resolved\.kosmosHome, port: resolved\.port\)\n\s+DispatchQueue\.main\.async \{ self\?\.stopsInFlight -= 1 \}/);
  assert.ok(load.indexOf('if self.computerMode == .connect {') < load.indexOf('guard self.boardStartGeneration == generation'),
    'the stale-generation check drops a start that landed after Connect before it can be undone');
});

test('#4356: a failed stop is said, and every connect launch stops a board left running', () => {
  const sw = body('private func switchToConnect(home: String)');
  assert.match(sw, /if outcome == \.failed \{ self\.showBoardStillRunning\(\) \}/, 'a stop that failed is only logged');
  assert.match(sw, /recoverOnReloadFailure = false\n\s+reloadNavigation = nil/, 'a Reload in flight can fall through to a board start');
  const launch = body('func applicationDidFinishLaunching(_ notification: Notification)');
  assert.match(launch, /loadConnect\(\)\n\s+stopBoardIfRunning\(\)/);
  const retry = body('private func stopBoardIfRunning()');
  // Not gated on the marker: a failed stop leaves it written (holdBoardStopped), which would make
  // the promised retry impossible (review round 9).
  assert.doesNotMatch(retry, /board\.stopped/, 'the launch-time retry is skipped whenever a marker exists');
  assert.match(retry, /if outcome == \.failed \{ self\?\.showBoardStillRunning\(\) \}/, 'a retry that fails is only logged');
});

test('#4356: another install\'s board on the port is not "still running here"', () => {
  const at = SRC.indexOf('func stopBoard(kosmosHome: String, port: Int?) -> StopOutcome');
  const stop = SRC.slice(at, SRC.indexOf('\n}\n', at));
  assert.match(stop, /said\.contains\("not started by this command"\)[\s\S]*return \.notOurs/);
  // The CLI's own sentence, so the two cannot drift apart unnoticed.
  assert.match(fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8'), /but it was not started by this command, so it was left alone/);
  for (const f of ['private func stopBoardIfRunning()', 'private func switchToConnect(home: String)']) {
    assert.match(body(f), /if outcome == \.failed \{ self\??\.showBoardStillRunning\(\) \}/, f + ' warns about a board that is not this install\'s');
    assert.match(body(f), /let port = modePort/, f + ' reads modePort from a background queue');
  }
});

test('#4356: kosmos stop is told the same port as kosmos start', () => {
  const at = SRC.indexOf('func stopBoard(kosmosHome: String, port: Int?) -> StopOutcome');
  assert.notEqual(at, -1, 'stopBoard takes no port, so it judges "running" on the default one');
  assert.match(SRC.slice(at, SRC.indexOf('\n}\n', at)), /if let port \{ env\["KOSMOS_PORT"\] = String\(port\) \}/);
  assert.doesNotMatch(SRC, /stopBoard\(kosmosHome: [^,)]+\)/, 'a call that leaves the port out');
});

test('#4356: a stop that failed still leaves board.stopped, so the next login does not start the board', () => {
  const at = SRC.indexOf('func stopBoard(kosmosHome: String, port: Int?) -> StopOutcome');
  const stop = SRC.slice(at, SRC.indexOf('\n}\n', at));
  assert.match(stop, /if process\.terminationStatus == 0 \{ return \.stopped \}\n\s+holdBoardStopped\(kosmosHome: kosmosHome\)/, 'a failed stop leaves no marker');
  const hold = SRC.slice(SRC.indexOf('func holdBoardStopped(kosmosHome: String)'));
  assert.match(hold, /let marker = kosmosHome \+ "\/board\.stopped"\n\s+if FileManager\.default\.createFile\(atPath: marker/);
});

test('#4356: a run or both answer starts the board if an update stopped it while the screen waited', () => {
  const chose = body('func pageChoseMode(_ body: Any)');
  assert.equal((chose.match(/ensureBoardRunning\(home: home\)/g) || []).length, 2, 'run and both each make sure the board is up');
  assert.match(body('private func ensureBoardRunning(home: String)'), /startBoard\(kosmosHome: home, port: port\)/);
});

test('#4356: on a connect computer a new window to Kosmos Plus opens in the app, not the browser', () => {
  const at = SRC.indexOf('createWebViewWith configuration: WKWebViewConfiguration,');
  const fn = SRC.slice(at, SRC.indexOf('\n    }\n', at));
  const inApp = fn.indexOf('if computerMode == .connect && connectLinkDecision(for: url, clicked: true) == .inApp {');
  assert.notEqual(inApp, -1, 'a new window to Kosmos Plus leaves the app for the browser');
  assert.ok(inApp < fn.indexOf('NSWorkspace.shared.open(url)'), 'the browser is chosen before the connect check');
  assert.match(fn, /webView\.load\(URLRequest\(url: url\)\)\n\s+return nil/);
});

test('#4356: a start after the choice that fails is said, not only logged', () => {
  const ensure = body('private func ensureBoardRunning(home: String)');
  assert.match(ensure, /self\.showStartupFailureAlert\(/);
  // Counted as a board start, so Reload does not run a second one alongside it.
  assert.match(ensure, /!boardStartInFlight else \{ return \}/);
  assert.match(ensure, /boardStartInFlight = true[\s\S]*self\.boardStartInFlight = false/);
  assert.match(ensure, /asyncAfter\(deadline: \.now\(\) \+ 300\)/, 'a start that never returns leaves Reload dead (#965)');
});

test('#4356: the computers\' domain is derived from the sign-in host, not written twice', () => {
  const fn = SRC.slice(SRC.indexOf('func isKosmosPlusURL(_ url: URL) -> Bool'));
  assert.doesNotMatch(fn.slice(0, fn.indexOf('\n}\n')), /"\.kosmosplus\.com"/);
  assert.match(fn, /labels\.dropFirst\(\)\.joined\(separator: "\."\)/);
});

test('#4356: Settings refuses on a connect computer even from its key equivalent', () => {
  assert.match(body('@objc func openSettings(_ sender: Any?)'), /guard computerMode != \.connect else \{ NSSound\.beep\(\); return \}/);
});

test('#4356: the timers restart cleanly after a switch back to run', () => {
  assert.match(body('private func startPromptRequestWatcher()'), /promptRequestTimer\?\.invalidate\(\)/);
  assert.match(body('private func startA11yTrustChecks()'), /a11yTimer\?\.invalidate\(\)/);
});

test('#4356: Settings (the other computer\'s, on a connect computer) is hidden with Run agents shown', () => {
  assert.match(body('private func updateRunAgentsItem()'), /#selector\(AppDelegate\.openSettings\(_:\)\) \}\)\?\.isHidden = computerMode == \.connect/);
});

test('#4356: Run agents refuses until every stop of ours has finished; a count, so overlapping stops cannot clear each other', () => {
  assert.match(SRC, /private var stopsInFlight = 0/);
  assert.equal((SRC.match(/stopsInFlight \+= 1/g) || []).length, (SRC.match(/stopsInFlight -= 1/g) || []).length, 'a stop that raises the count and never lowers it (or the reverse)');
  assert.match(body('@objc func runAgentsHere(_ sender: Any?)'), /guard stopsInFlight == 0 else \{/);
  const relaunch = body('private func stopBoardIfRunning()');
  assert.match(relaunch, /stopsInFlight \+= 1/, 'the launch-time stop can race Run agents');
  assert.match(relaunch, /self\?\.stopsInFlight -= 1/);
  assert.match(body('private func switchToConnect(home: String)'), /self\.stopsInFlight -= 1\n\s+guard self\.computerMode == \.connect/);
});

test('#4356: no Dock badge on a connect computer, even from a page still posting while the stop runs', () => {
  assert.match(body('func pageSaidWaiting(_ body: Any)'), /guard computerMode != \.connect else \{ return \}/);
  assert.match(body('private func showBadge(_ label: String?, asked: Int)'), /guard self\.computerMode != \.connect else \{ NSApp\.dockTile\.badgeLabel = nil; return \}/);
});

test('#4356: a connect computer that cannot reach Kosmos Plus says so, not a blank window', () => {
  const fail = body('private func handleNavigationFailure(_ navigation: WKNavigation?, _ error: Error, stage: String)');
  assert.match(fail, /if computerMode == \.connect && !policyCancel && \(isBoardLoadNav \|\| webView\.backForwardList\.currentItem == nil\) \{\n\s+showStartupFailureAlert/);
  assert.ok(fail.indexOf('if computerMode == .connect && !policyCancel') < fail.indexOf('loadBoard()'), 'the connect failure can reach the board start fallback');
});

test('#4356: Reload on a connect computer never starts the board', () => {
  const reload = body('@objc func reloadBoard(_ sender: Any?)');
  const guard = reload.indexOf('if computerMode == .connect {');
  assert.notEqual(guard, -1, 'Reload on a connect computer falls into the board start path');
  assert.ok(guard < reload.indexOf('loadBoard()'), 'the connect check comes after a path that starts the board');
  assert.match(reload, /if computerMode == \.connect \{\n\s+if webView\.backForwardList\.currentItem == nil \|\| lastLoadFailed \{ loadConnect\(\) \} else \{ webView\.reload\(\) \}\n\s+return\n\s+\}/);
});

test('#4356: a connect computer is not offered #4347\'s restart-to-update for a board that is not its own', () => {
  assert.match(body('private func checkWhetherThisAppIsBehind(port: Int)'), /guard computerMode != \.connect else \{\n\s+sayQuietStaleReason\("this computer connects to agents on another computer/);
  // And a loop already running when Connect is chosen stops at its next step (review round 19).
  const at = SRC.indexOf('private func stepRelaunch(');
  const head = SRC.slice(at, SRC.indexOf('{\n', at) + 600);
  assert.match(head, /guard computerMode != \.connect else \{ logLine\("stale-app: stopped, this computer switched to connect"\); return \}/);
  assert.match(body('private func switchToConnect(home: String)'), /resolvedPort = nil/, 'the stale-app check stays armed on the local port after Connect');
});

test('#4356: a missing CLI is logged, not said as "still running here", and still holds the board off', () => {
  const at = SRC.indexOf('func stopBoard(kosmosHome: String, port: Int?) -> StopOutcome');
  assert.match(SRC.slice(at, SRC.indexOf('\n}\n', at)), /is missing"\)\n\s+holdBoardStopped\(kosmosHome: kosmosHome\)[^\n]*\n\s+return \.missing/);
});

test('#4356: the connect navigation policy is pinned to WebKit\'s selector, so a signature drift cannot switch it off', () => {
  assert.match(SRC, /@objc\(webView:decidePolicyForNavigationAction:decisionHandler:\)\n\s+func webView\(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,/);
});

test('#4356: a connect computer keeps its window to Kosmos Plus; a run computer is unchanged', () => {
  const policy = body('func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,');
  assert.match(policy, /guard computerMode == \.connect, let url = navigationAction\.request\.url,\n\s+let frame = navigationAction\.targetFrame, frame\.isMainFrame\n\s+else \{ decisionHandler\(\.allow\); return \}/,
    'the policy reaches a computer that runs agents, which had none before');
  assert.match(policy, /connectLinkDecision\(for: url, clicked: navigationAction\.navigationType == \.linkActivated\)/);
  assert.match(SRC, /let kosmosPlusSignIn = URL\(string: "https:\/\/login\.kosmosplus\.com\/"\)!/, 'connect does not load the sign-in the phone apps load');
});

test('#4356: the way back is this Mac\'s own menu, shown only on a connect computer', () => {
  assert.match(SRC, /let runAgentsItem = NSMenuItem\(title: "Run agents on this computer",\n\s+action: #selector\(AppDelegate\.runAgentsHere\(_:\)\),/);
  assert.match(SRC, /runAgentsItem\.isHidden = true/);
  assert.match(body('private func updateRunAgentsItem()'), /#selector\(AppDelegate\.runAgentsHere\(_:\)\) \}\)\?\.isHidden = computerMode != \.connect/);
  const back = body('@objc func runAgentsHere(_ sender: Any?)');
  assert.match(back, /guard writeComputerMode\(\.run, kosmosHome: home\) else \{/);
  assert.ok(back.indexOf('writeComputerMode(.run') < back.indexOf('loadBoard()'), 'the board starts before the choice is saved, so the next launch stops it again');
  assert.match(BUILD, /item:Run agents on this computer\tshortcut:-\taction:runAgentsHere:\ttarget:set/, 'the menu gate does not know the item');
});

test('#4356: quitting a connect computer does not say its agents keep running', () => {
  const quit = body('func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply');
  const at = quit.indexOf('if computerMode == .connect {');
  assert.notEqual(at, -1, 'quitting a connect computer shows "Your agents keep running"');
  assert.ok(at < quit.indexOf('showQuitDialog()'));
});

test('#4356: the bundle build runs the mode selftest and fails on a wrong row or a hollow run', () => {
  assert.match(BUILD, /--kosmos-app-mode-selftest/);
  assert.match(BUILD, /\*"mode-check: all good"\*\) ;;/);
  assert.match(SRC, /let expected = 40\n\s+if ran != expected \{\n\s+print\("\\nmode-check: only/);
});
