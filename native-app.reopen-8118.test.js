'use strict';
/**
 * kosmos#8118: the Mac app reopens on the computer the window was last on. The rules (computerToRemember: only
 * another computer's host; rememberableHost: a kept value is used only while it is a plain host) are proved by their
 * rows in --kosmos-app-mode-selftest. This file pins the wiring the selftest cannot reach: when the host is kept and
 * forgotten, that the reopen waits for this computer's own board, runs once a launch, only in run or both, and hands
 * the host to the page as an argument rather than inside the script text.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');
function body(sig) {
  const at = SRC.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from main.swift');
  return SRC.slice(at, SRC.indexOf('\n    }\n', at) + 6);
}

test('#8118: every finished page load decides whether to keep or reopen', () => {
  assert.match(body('func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!)'), /rememberOrReopenComputer\(webView\)/,
    'didFinish no longer keeps or reopens the computer');
});

test('#8118: only run or both; on another computer it keeps the host and returns; at home it reopens once a launch', () => {
  const f = body('private func rememberOrReopenComputer(');
  assert.match(f, /guard computerMode == \.run \|\| computerMode == \.both else \{ return \}/,
    'the reopen is no longer limited to run and both (connect has no board; unset shows the first screen)');
  assert.ok(f.indexOf('if computerMode == .connect, reopenComputerHost != nil { reopenComputerHost = nil') < f.indexOf('guard computerMode == .run'),
    'a connect Mac no longer forgets a host kept while it ran agents');
  const away = f.indexOf('if isOnAnotherComputer() {');
  const keep = f.indexOf('computerToRemember(committedPageURL', away);
  const ret = f.indexOf('return\n', keep);
  const once = f.indexOf('if reopenAskedThisLaunch {');
  assert.ok(away > 0 && keep > away && ret > keep && once > ret,
    'on another computer the host is not kept by computerToRemember before the reopen branch');
  // Review 1: after the launch's one reopen, every load of this computer's own board means the window is home.
  const later = f.slice(once, f.indexOf('reopenAskedThisLaunch = true'));
  assert.match(later, /reopenComputerHost = nil/, 'a later load of the own board does not forget the host, so a session at home is lost');
  assert.match(f, /isBoardOrigin\(host: pageHost, port: page\.port \?\? 0, scheme: page\.scheme\)/,
    'the reopen no longer waits for this computer\'s own board to have loaded');
  assert.ok(f.indexOf('reopenAskedThisLaunch = true') > once, 'the once-a-launch latch is not set');
  assert.match(f, /guard rememberableHost\(host\) else \{ reopenComputerHost = nil/, 'a kept value that is not a plain host is used');
});

test('#8118: the host reaches the page as an ARGUMENT, never inside the script text', () => {
  const f = body('private func rememberOrReopenComputer(');
  const call = f.slice(f.indexOf('webView.callAsyncJavaScript('));
  assert.match(call, /arguments: \["host": host\]/, 'the host is no longer passed as an argument');
  const script = call.slice(0, call.indexOf('arguments:'));
  assert.doesNotMatch(script, /\\\(host\)/, 'the host is interpolated into the script text');
  assert.match(script, /computersReopen\(host\)/);
});

test('#8118: forgotten on the page\'s gone or home, and on Back to This Computer before the board loads', () => {
  const f = body('private func rememberOrReopenComputer(');
  assert.match(f, /switch reopenAnswerKeeps\(said\) \{/, 'the page\'s answer no longer goes through reopenAnswerKeeps (its rows are in the selftest)');
  assert.match(f, /case \.forget: if self\.reopenComputerHost == host \{ self\.reopenComputerHost = nil \}/, 'a forget answer no longer forgets the host');
  assert.match(f, /case \.retryNextBoardLoad: self\.reopenAskedThisLaunch = false/, 'a page that cannot answer spends the launch\'s reopen');
  const home = body('@objc func backToThisComputer(_ sender: Any?)');
  const forget = home.indexOf('reopenComputerHost = nil');
  assert.ok(forget > 0 && forget < home.lastIndexOf('loadBoard()'), 'Back to This Computer does not forget the computer before loading home');
});

test('#8118: the kept value is a plain string in UserDefaults under its own key, removed (not blanked) when forgotten', () => {
  assert.match(SRC, /private static let reopenComputerKey = "kosmos\.reopenComputerHost"/);
  assert.match(SRC, /UserDefaults\.standard\.removeObject\(forKey: Self\.reopenComputerKey\)/);
});
