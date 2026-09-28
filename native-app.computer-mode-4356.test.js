'use strict';

/**
 * #4356: a computer either runs agents or connects to agents on another computer.
 *
 * Reading the choice and deciding a connect computer's links are pure Swift functions that
 * --kosmos-app-mode-selftest drives at bundle build (34 rows). What no selftest can reach is the
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

test('#4356: the choice is read before anything starts, and a connect computer never starts its board at launch', () => {
  const launch = body('func applicationDidFinishLaunching(_ notification: Notification)');
  const read = launch.indexOf('readLaunchComputerMode()');
  assert.notEqual(read, -1, 'the app does not read this computer\'s choice at launch');
  assert.ok(read < launch.indexOf('loadBoard()'), 'the board can start before the choice is read');
  assert.match(launch, /if computerMode == \.connect \{\n[^\n]*\n\s+loadConnect\(\)\n\s+\} else \{\n\s+loadBoard\(\)\n\s+\}/,
    'a connect computer starts its board, or a run computer does not');
  assert.match(launch, /if computerMode != \.connect \{[\s\S]*startA11yTrustChecks\(\)[\s\S]*startPromptRequestWatcher\(\)\n\s+\}/,
    'a connect computer runs the Accessibility checks and prompt watcher of a board it does not have');
});

test('#4356: the choice comes from $KOSMOS_HOME/mode, the file the installer reads', () => {
  assert.match(SRC, /func computerModePath\(kosmosHome: String\) -> String \{ kosmosHome \+ "\/mode" \}/);
  const read = body('private func readLaunchComputerMode()');
  assert.match(read, /resolveInstall\(config: KosmosInstallConfig\.load\(\)\)\.kosmosHome/);
  assert.match(read, /computerMode = readComputerMode\(kosmosHome: home\)/);
});

test('#4356: the board\'s page is told when it must ask, and only then', () => {
  assert.match(SRC, /guard let url = self\.withModeQuery\(tokenizedBoardURL\(urlString\)\) else \{/, 'the board URL does not say whether to ask');
  const q = body('func withModeQuery(_ url: URL?) -> URL?');
  assert.match(q, /computerMode == \.unset \|\| computerMode == \.unreadable/);
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
  const stop = sw.indexOf('stopBoard(kosmosHome: home)');
  assert.notEqual(stop, -1, 'switching to connect leaves the board the installer started running');
  assert.ok(stop < sw.indexOf('self.loadConnect()'), 'sign-in loads before the board is stopped');
  assert.match(sw, /DispatchQueue\.global\(qos: \.userInitiated\)\.async/, 'kosmos stop runs on the main thread and beachballs the app');
  const at = SRC.indexOf('func stopBoard(kosmosHome: String) -> Bool');
  assert.notEqual(at, -1, 'stopBoard is gone from main.swift');
  assert.match(SRC.slice(at, SRC.indexOf('\n}\n', at)), /process\.arguments = \["stop"\]/);
});

test('#4356: Reload on a connect computer never starts the board', () => {
  const reload = body('@objc func reloadBoard(_ sender: Any?)');
  const guard = reload.indexOf('if computerMode == .connect {');
  assert.notEqual(guard, -1, 'Reload on a connect computer falls into the board start path');
  assert.ok(guard < reload.indexOf('loadBoard()'), 'the connect check comes after a path that starts the board');
  assert.match(reload, /if computerMode == \.connect \{\n\s+if webView\.url == nil \|\| lastLoadFailed \{ loadConnect\(\) \} else \{ webView\.reload\(\) \}\n\s+return\n\s+\}/);
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
  assert.match(body('private func updateRunAgentsItem()'), /item\?\.isHidden = computerMode != \.connect/);
  const back = body('@objc func runAgentsHere(_ sender: Any?)');
  assert.match(back, /guard writeComputerMode\(\.run, kosmosHome: home\) else \{/);
  assert.ok(back.indexOf('writeComputerMode(.run') < back.indexOf('loadBoard()'), 'the board starts before the choice is saved, so the next launch stops it again');
  assert.match(BUILD, /item:Run agents on this computer\tshortcut:-\taction:runAgentsHere:\ttarget:set/, 'the menu gate does not know the item');
});

test('#4356: quitting a connect computer does not say its agents keep running', () => {
  const quit = body('func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply');
  assert.ok(quit.indexOf('if computerMode == .connect {') < quit.indexOf('showQuitDialog()'));
});

test('#4356: the bundle build runs the mode selftest and fails on a wrong row or a hollow run', () => {
  assert.match(BUILD, /--kosmos-app-mode-selftest/);
  assert.match(BUILD, /\*"mode-check: all good"\*\) ;;/);
  assert.match(SRC, /let expected = 34\n\s+if ran != expected \{\n\s+print\("\\nmode-check: only/);
});
