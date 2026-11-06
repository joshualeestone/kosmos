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
    const next = f.indexOf('\n        case .', at + arm.length);   // the whole arm, up to the next case
    assert.match(f.slice(at, next > 0 ? next : f.length), act, arm + ' no longer does what the step says');
  }
});

test('#8118: the one ask latches first, and reads its answer only from the page it asked', () => {
  const f = body('private func askPageToReopen(');
  assert.ok(f.indexOf('reopenAskedThisLaunch = true') < f.indexOf('callAsyncJavaScript'), 'the latch is set after the ask, so a reload can ask twice');
  // Round 3: counted at COMMIT (#5167's pageCommits, bumped in didCommit): a reload tears the page down when the new
  // page commits, before it finishes, so a finished-load count would let the stale failure through.
  assert.match(f, /let askedOn = pageCommits/);
  assert.match(body('func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!)'), /pageCommits \+= 1/, 'commits are no longer counted');
  const guard = f.indexOf('guard self.pageCommits == askedOn else {');
  assert.ok(guard > 0 && guard < f.indexOf('let answer = reopenAnswerKeeps(said)'), 'a stale answer is acted on (review 2: a reload while it waits)');
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
  assert.match(f, /let answer = reopenAnswerKeeps\(said\)[\s\S]*switch answer \{/, 'the page\'s answer no longer goes through reopenAnswerKeeps (its rows are in the selftest)');
  const arm = (name) => f.slice(f.indexOf(name), f.indexOf('case .', f.indexOf(name) + name.length) > 0 ? f.indexOf('case .', f.indexOf(name) + name.length) : undefined);
  assert.match(arm('case .forget:'), /self\.reopenOutstanding = false[\s\S]*if self\.reopenComputerHost == host \{ self\.reopenComputerHost = nil \}/, 'a forget answer no longer forgets the host');
  // Review 6: the count moves only through reopenMissesAfter (its rows are in the selftest), before the arms run.
  assert.ok(f.indexOf('self.reopenMisses = reopenMissesAfter(answer, self.reopenMisses)') > 0
    && f.indexOf('self.reopenMisses = reopenMissesAfter(answer, self.reopenMisses)') < f.indexOf('switch answer {'), 'the miss count is not moved by reopenMissesAfter before the arms');
  assert.doesNotMatch(arm('case .opening:'), /reopenMisses/, 'a switch started resets the misses (only the page landing may, review 6)');
  assert.match(arm('case .opening:'), /self\.reopenLandingDue = true/, 'an opening answer does not note that a landing is due (#8125)');
  assert.doesNotMatch(arm('case .notChecked:'), /reopenMisses/, 'a not-checked answer moves the misses');
  assert.match(arm('case .missed:'), /if reopenMissesForget\(self\.reopenMisses\)[\s\S]*self\.reopenComputerHost = nil/,
    'REOPEN_MISS_LIMIT misses do not forget (review 5: a computer that stays off toasts for ever)');
  assert.match(arm('case .retryNextBoardLoad:'), /self\.reopenAskedThisLaunch = false/, 'a sign-in page does not leave the ask for the next board load');
  // Review 7: the bound is applied where the second ask would happen.
  const step = body('private func rememberOrReopenComputer(');
  const ask = step.slice(step.indexOf('case .ask(let host):'));
  assert.match(ask, /if reopenRetryUntil != nil, !reopenRetryAllowed\(now: Date\(\), until: reopenRetryUntil\) \{[\s\S]*reopenAskedThisLaunch = true[\s\S]*\} else \{\s*askPageToReopen\(host, webView\)/,
    'a retry hours later still asks (review 7: the bound must be where the ask happens)');
  const home = body('@objc func backToThisComputer(_ sender: Any?)');
  assert.match(home, /reopenOutstanding = false/, 'going home on purpose leaves a reopen outstanding');
  const forget = home.indexOf('reopenComputerHost = nil');
  assert.ok(forget > 0 && forget < home.lastIndexOf('loadBoard()'), 'Back to This Computer does not forget the computer before loading home');
});

test('#8118: the kept value is a plain string in UserDefaults under its own key, removed (not blanked) when forgotten', () => {
  assert.match(SRC, /private static let reopenComputerKey = "kosmos\.reopenComputerHost"/);
  assert.match(SRC, /UserDefaults\.standard\.removeObject\(forKey: Self\.reopenComputerKey\)/);
});

test('#8118 (round 3): quit decides: on another computer its host, at home nothing, only in run or both', () => {
  const f = body('func applicationWillTerminate(_ notification: Notification)');
  assert.match(f, /guard computerMode == \.run \|\| computerMode == \.both else \{ return \}/);
  assert.match(f, /let away = isOnAnotherComputer\(\) \? computerToRemember\(committedPageURL, board: badgeOrigin, ownPlusHost: ownKosmosPlusHost\(\)\) : nil/,
    'quit no longer reads what the window shows');
  assert.match(f, /let host = quitKeeps\(awayHost: away, hasPage: committedPageURL != nil, reopenOutstanding: reopenOutstanding, kept: reopenComputerHost\)/,
    'quit no longer goes through quitKeeps (its rows are in the selftest)');
  assert.match(f, /reopenComputerHost = host/, 'quit does not write the decision');
});

test('#8118 (round 4): the ask marks the reopen outstanding, and the other computer\'s page settles it', () => {
  assert.match(body('private func askPageToReopen('), /reopenAskedThisLaunch = true\n\s+reopenOutstanding = true/);
  const f = body('private func rememberOrReopenComputer(');
  const at = f.indexOf('case .keep(let host):');
  const keepArm = f.slice(at, f.indexOf('case .forget:', at));
  assert.match(keepArm, /reopenOutstanding = false/, 'the remote page loading leaves the reopen outstanding');
  assert.match(keepArm, /reopenMisses = 0   \/\/ review 6/, 'the page LANDING no longer resets the misses');
});

test('#8125: a switch that never landed counts one miss at quit, before quit decides; landing or going home clears it', () => {
  const q = body('func applicationWillTerminate(_ notification: Notification)');
  const awayAt = q.indexOf('let away = isOnAnotherComputer()');
  const due = q.indexOf('let neverLanded = reopenLandingDue && away == nil && reopenComputerHost != nil');
  const decide = q.indexOf('let host = quitKeeps(');
  assert.ok(awayAt > 0 && due > awayAt && decide > due,
    'the landing is not judged from where the window is (review 1: a page that committed has landed), or after quit decides');
  const part = q.slice(due, decide);
  assert.match(part, /reopenMisses = quitMissesAfter\(prior: reopenMisses, landingDue: neverLanded\)/,
    'a switch that never landed is not counted through quitMissesAfter (its rows are in the selftest)');
  // Review 1: the forget at the limit itself is pinned, not only the count.
  assert.match(part, /if neverLanded, reopenMissesForget\(reopenMisses\), let gone = reopenComputerHost \{[\s\S]*reopenComputerHost = nil[\s\S]*reopenMisses = 0/,
    'reaching the limit with a switch that never landed does not forget the computer');
  const f = body('private func rememberOrReopenComputer(');
  const at = f.indexOf('case .keep(let host):');
  assert.match(f.slice(at, f.indexOf('case .forget:', at)), /reopenLandingDue = false/, 'the page landing does not clear the due landing');
  assert.match(body('@objc func backToThisComputer(_ sender: Any?)'), /reopenLandingDue = false/, 'going home on purpose leaves a landing due');
});
