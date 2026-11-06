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

test('#8118: every finished load runs reopenStep (its rules are rows in the selftest) and does what it says', () => {
  const f = body('private func rememberOrReopenComputer(');
  assert.match(f, /pageLoadSerial &\+= 1/, 'a finished load no longer counts, so a stale reopen answer cannot be told apart');
  assert.match(f, /switch reopenStep\(mode: computerMode, awayHost: away, onOwnBoard: onOwnBoard, asked: reopenAskedThisLaunch, kept: reopenComputerHost\)/,
    'the load no longer goes through reopenStep');
  assert.match(f, /let away = isOnAnotherComputer\(\) \? computerToRemember\(page,/, 'the away host is not computerToRemember for the page on screen');
  assert.match(f, /isBoardOrigin\(host: host, port: page\.port \?\? 0, scheme: page\.scheme\)/, 'the own board is not told by its origin');
  for (const [arm, act] of [
    ['case .keep(let host):', /reopenComputerHost = host/],
    ['case .forget:', /reopenComputerHost = nil/],
    ['case .markAsked:', /reopenAskedThisLaunch = true/],
    ['case .forgetAndMarkAsked:', /reopenAskedThisLaunch = true; reopenComputerHost = nil/],
    ['case .ask(let host):', /askPageToReopen\(host, webView\)/],
  ]) {
    const at = f.indexOf(arm);
    assert.ok(at > 0, arm + ' is gone');
    assert.match(f.slice(at, f.indexOf('\n', at)), act, arm + ' no longer does what the step says');
  }
});

test('#8118: the one ask latches first, and reads its answer only from the page it asked', () => {
  const f = body('private func askPageToReopen(');
  assert.ok(f.indexOf('reopenAskedThisLaunch = true') < f.indexOf('callAsyncJavaScript'), 'the latch is set after the ask, so a reload can ask twice');
  assert.match(f, /let askedOn = pageLoadSerial/);
  const guard = f.indexOf('guard self.pageLoadSerial == askedOn else {');
  assert.ok(guard > 0 && guard < f.indexOf('switch reopenAnswerKeeps(said)'), 'a stale answer is acted on (review 2: a reload while it waits)');
});

test('#8118: the host reaches the page as an ARGUMENT, never inside the script text', () => {
  const f = body('private func askPageToReopen(');
  const call = f.slice(f.indexOf('webView.callAsyncJavaScript('));
  assert.match(call, /arguments: \["host": host\]/, 'the host is no longer passed as an argument');
  const script = call.slice(0, call.indexOf('arguments:'));
  assert.doesNotMatch(script, /\\\(host\)/, 'the host is interpolated into the script text');
  assert.match(script, /computersReopen\(host\)/);
});

test('#8118: forgotten on the page\'s gone or home, and on Back to This Computer before the board loads', () => {
  const f = body('private func askPageToReopen(');
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
